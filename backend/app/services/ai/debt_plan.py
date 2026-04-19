from __future__ import annotations

"""Debt payoff strategy service — /debt-plan-suggestion."""

import json
import logging
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Account
from app.services.ai import llm_client

logger = logging.getLogger(__name__)

_NO_AI_MSG = "No AI backend available. Start Ollama and ensure OLLAMA_URL points to it."


def normalize_priority_order_from_llm(raw: object) -> list[str]:
    """Coerce LLM `priority_order` to a list of strings; non-lists become []."""
    if not isinstance(raw, list):
        return []
    return [str(x) for x in raw]


def parse_debt_plan_suggestion_from_llm_response(
    response_text: str, model_source: str
) -> dict[str, object]:
    """Parse model JSON (optional markdown fence) into a dict shaped for DebtPlanSuggestion."""
    text = response_text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1].rsplit("```", 1)[0]
    data = json.loads(text)
    raw_extra = data.get("monthly_extra", 0)
    try:
        monthly_extra = float(raw_extra)
    except (TypeError, ValueError):
        monthly_extra = 0.0
    raw_strategy = str(data.get("strategy", "avalanche")).lower().strip()
    if raw_strategy not in ("avalanche", "snowball", "hybrid"):
        raw_strategy = "avalanche"
    return {
        "strategy": raw_strategy,
        "rationale": str(data.get("rationale", "")),
        "priority_order": normalize_priority_order_from_llm(data.get("priority_order", [])),
        "monthly_extra": monthly_extra,
        "model_source": model_source,
    }


async def suggest_debt_plan(db: AsyncSession, household_id: str) -> dict[str, object]:
    """Recommend a debt payoff strategy. Returns dict shaped for DebtPlanSuggestion."""
    from app.api.routes.accounts import _compute_balances

    acct_result = await db.execute(
        select(Account)
        .where(Account.household_id == household_id)
        .where(Account.closed_at.is_(None))
        .where(Account.account_type.in_(["credit", "loan"]))
    )
    debt_accounts = acct_result.scalars().all()

    if not debt_accounts:
        raise HTTPException(400, "No debt accounts found.")

    balances = await _compute_balances(db, debt_accounts)

    debt_lines = []
    for a in debt_accounts:
        bal = abs(balances.get(a.id, Decimal("0")))
        apr = (
            f"{float(a.interest_rate) * 100:.2f}%"
            if a.interest_rate is not None
            else "unknown"
        )
        min_pay = (
            f"${float(a.minimum_payment):,.2f}"
            if a.minimum_payment is not None
            else "unknown"
        )
        debt_lines.append(f"  - {a.name}: balance ${bal:,.2f}, APR {apr}, min payment {min_pay}")

    context = "Debt accounts:\n" + "\n".join(debt_lines)

    prompt = f"""{context}

Based on these debt accounts, recommend a payoff strategy.
- avalanche: highest APR first (minimizes interest).
- snowball: smallest balance first (psychological wins).
- hybrid: highest APR first; when two debts have the same APR (or unknown APR), order smaller balance first.
Use hybrid when both high-APR cards and small balances deserve emphasis. priority_order must list every account name once, in payoff order.
Return JSON exactly:
{{"strategy": "avalanche", "rationale": "2-3 sentences explaining why", "priority_order": ["Account Name 1", "Account Name 2"], "monthly_extra": 100.0}}
No other text."""

    # Single attempt only. The earlier blind retry amplified cold-Ollama stalls —
    # each call can hold a worker for up to _OLLAMA_READ_TIMEOUT (120s), and
    # connect failures are already surfaced as None without the read timeout.
    response, source = await llm_client.complete_with_source(prompt, json_format=True)
    if not response:
        raise HTTPException(503, _NO_AI_MSG)

    try:
        return parse_debt_plan_suggestion_from_llm_response(response, source)
    except Exception:
        raise HTTPException(500, "Failed to parse AI response.")
