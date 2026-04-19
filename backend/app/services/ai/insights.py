from __future__ import annotations

"""Insights generation — /insights and /budget-insights.

Route handlers in `app.api.routes.ai` keep their pydantic response models and
simply call into the functions here.
"""

import json
import logging
from datetime import date
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import extract, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Account, Category, Transaction
from app.services.ai import llm_client
from app.services.ai.context import build_financial_context

logger = logging.getLogger(__name__)

_NO_AI_MSG = "No AI backend available. Start Ollama and ensure OLLAMA_URL points to it."


def normalize_insights_list(raw: object) -> list[str]:
    """Normalize `insights` from LLM JSON to a list of strings."""
    if raw is None:
        return []
    if isinstance(raw, list):
        return [str(x) for x in raw]
    return [str(raw)]


async def generate_insights(db: AsyncSession, household_id: str) -> dict[str, object]:
    """Generate personalised financial insights.

    Returns a dict shaped for `InsightsResponse` (keys: insights, model_source).
    """
    acct_count = await db.execute(
        select(func.count(Account.id)).where(
            Account.household_id == household_id,
            Account.closed_at.is_(None),
        )
    )
    if (acct_count.scalar() or 0) == 0:
        return {
            "insights": [
                "Connect and sync your accounts (or add them manually) to get personalised insights."
            ],
            "model_source": "none",
        }
    ctx = await build_financial_context(db, household_id)

    system = (
        "You are a compassionate, practical personal finance advisor. "
        "Analyse the user's financial data and give 3-5 specific, actionable insights. "
        "Focus on debt reduction, savings opportunities, and budget optimisation. "
        "Be encouraging but realistic. Use plain language. Keep each insight to 1-2 sentences."
    )
    prompt = f"""Based on this financial snapshot, give me 3-5 specific insights and actionable advice:

{ctx}

Return a JSON object with an "insights" key containing an array of strings (one per insight). No other text."""

    response, source = await llm_client.complete_with_source(
        prompt, system=system, json_format=True
    )
    if not response:
        raise HTTPException(503, _NO_AI_MSG)

    try:
        text = response.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1].rsplit("```", 1)[0]
        data = json.loads(text)
        insights = normalize_insights_list(data.get("insights"))
    except Exception:
        # If the LLM didn't return JSON, split by newlines as fallback
        insights = [line.lstrip("•-* ").strip() for line in response.split("\n") if line.strip()]

    return {"insights": insights[:6], "model_source": source}


async def _build_budget_context(
    db: AsyncSession, household_id: str
) -> tuple[str, list[dict[str, object]]]:
    """Build 3-month spending trend context for LLM.

    Returns (prompt_text, list-of-pattern-dicts). The dicts match
    `SpendingTrend` (category / trend / pct_change) — route layer wraps them.
    """
    today = date.today()

    # Generate last 4 months (3 previous + current) as "YYYY-MM" strings
    month_keys: list[str] = []
    for i in range(3, -1, -1):
        total = today.month - 1 - i
        year = today.year + total // 12
        month = total % 12 + 1
        month_keys.append(f"{year}-{month:02d}")

    budget_account_subq = (
        select(Account.id)
        .where(Account.household_id == household_id)
        .where(Account.is_budget_account.is_(True))
        .where(Account.closed_at.is_(None))
        .scalar_subquery()
    )

    monthly_spend: dict[str, dict[str, Decimal]] = {m: {} for m in month_keys}
    for mk in month_keys:
        year_num, month_num = int(mk[:4]), int(mk[5:])
        result = await db.execute(
            select(Category.name, func.sum(Transaction.amount))
            .join(Transaction, Transaction.category_id == Category.id)
            .where(
                Transaction.account_id.in_(budget_account_subq),
                extract("year", Transaction.date) == year_num,
                extract("month", Transaction.date) == month_num,
                Transaction.amount < 0,
                Transaction.category_id.isnot(None),
            )
            .group_by(Category.name)
        )
        monthly_spend[mk] = {name: abs(amt) for name, amt in result.all()}

    current_key = month_keys[-1]
    past_keys = month_keys[:-1]
    all_categories = set(monthly_spend[current_key].keys())

    patterns: list[dict[str, object]] = []
    for cat in all_categories:
        cur_val = float(monthly_spend[current_key].get(cat, Decimal("0")))
        past_vals = [float(monthly_spend[m].get(cat, Decimal("0"))) for m in past_keys]
        past_avg = sum(past_vals) / len(past_vals) if past_vals else 0
        if past_avg == 0:
            pct_change = 0.0
            trend = "stable"
        else:
            pct_change = (cur_val - past_avg) / past_avg * 100
            trend = "up" if pct_change > 5 else ("down" if pct_change < -5 else "stable")
        patterns.append({"category": cat, "trend": trend, "pct_change": round(pct_change, 1)})

    patterns.sort(key=lambda p: abs(p["pct_change"]), reverse=True)

    # Build text representation for LLM
    lines = ["Month-by-month spending by category (last 3 months):"]
    for cat in sorted(all_categories):
        vals = " | ".join(
            f"{m}: ${float(monthly_spend[m].get(cat, Decimal('0'))):,.2f}" for m in month_keys
        )
        lines.append(f"  {cat}: {vals}")

    return "\n".join(lines), patterns[:12]


async def generate_budget_insights(
    db: AsyncSession, household_id: str
) -> dict[str, object]:
    """Generate spending pattern insights and category trends.

    Returns a dict shaped for `BudgetInsightsResponse`.
    """
    ctx, patterns = await _build_budget_context(db, household_id)

    system = (
        "You are a personal finance advisor specialising in budget analysis. "
        "Identify meaningful spending trends and give 3-4 specific, actionable insights. "
        "Focus on categories with unusual spikes, recurring waste, or opportunities to save. "
        "Be concise, encouraging, and practical."
    )
    prompt = f"""{ctx}

Based on these spending trends, provide 3-4 actionable insights about spending patterns and where money could be saved.
Return JSON: {{"insights": ["...", "..."]}}
No other text."""

    response, source = await llm_client.complete_with_source(
        prompt, system=system, json_format=True
    )
    insights: list[str] = []
    if response:
        try:
            text = response.strip()
            if text.startswith("```"):
                text = text.split("\n", 1)[1].rsplit("```", 1)[0]
            insights = json.loads(text).get("insights", [])
        except Exception:
            insights = [ln.lstrip("•-* ").strip() for ln in response.split("\n") if ln.strip()]

    return {
        "insights": insights[:5],
        "patterns": patterns,
        "model_source": source,
    }
