from __future__ import annotations

"""Budget suggestion service — /budget-suggestions."""

import json
import logging
from datetime import date
from decimal import Decimal

from sqlalchemy import extract, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Account, Category, Transaction
from app.services.ai import llm_client

logger = logging.getLogger(__name__)

# Returned when there is no categorized spending to analyze (not the same as LLM unavailable).
MODEL_SOURCE_NO_BUDGET_CATEGORY_DATA = "no_data"


async def generate_budget_suggestions(
    db: AsyncSession, household_id: str
) -> dict[str, object]:
    """Suggest monthly budget amounts per category.

    Returns a dict shaped for `BudgetSuggestionsResponse`. Each suggestion dict
    has keys: category_id, category_name, suggested_amount, reasoning.
    """
    today = date.today()

    # Build 3-month average spending per category
    month_keys: list[str] = []
    for i in range(3, 0, -1):
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
    cat_ids: dict[str, str] = {}  # name -> id

    for mk in month_keys:
        year_num, month_num = int(mk[:4]), int(mk[5:])
        result = await db.execute(
            select(Category.id, Category.name, func.sum(Transaction.amount))
            .join(Transaction, Transaction.category_id == Category.id)
            .where(
                Transaction.account_id.in_(budget_account_subq),
                extract("year", Transaction.date) == year_num,
                extract("month", Transaction.date) == month_num,
                Transaction.amount < 0,
                Transaction.category_id.isnot(None),
            )
            .group_by(Category.id, Category.name)
        )
        for cat_id, cat_name, amt in result.all():
            monthly_spend[mk][cat_name] = abs(amt)
            cat_ids[cat_name] = cat_id

    if not cat_ids:
        return {
            "suggestions": [],
            "model_source": MODEL_SOURCE_NO_BUDGET_CATEGORY_DATA,
        }

    lines = []
    for cat_name in sorted(cat_ids.keys()):
        vals = [float(monthly_spend[m].get(cat_name, Decimal("0"))) for m in month_keys]
        avg = sum(vals) / len(vals) if vals else 0
        lines.append(
            f"  {cat_name}: 3-month avg ${avg:,.2f} (months: {', '.join(f'${v:,.2f}' for v in vals)})"
        )

    context = "3-month average spending per category:\n" + "\n".join(lines)

    prompt = f"""{context}

Based on the following 3-month average spending per category, suggest monthly budget amounts.
For categories with consistent spending, suggest ~10% above average.
For categories with high variance, suggest closer to the highest of the three months (do not claim a statistical percentile unless you derive it from the three numbers shown).
Return JSON: {{"suggestions": [{{"category_name": "...", "suggested_amount": 150.00, "reasoning": "one line reason"}}]}}
No other text."""

    response, source = await llm_client.complete_with_source(prompt, json_format=True)
    suggestions: list[dict[str, object]] = []

    if response:
        try:
            text = response.strip()
            if text.startswith("```"):
                text = text.split("\n", 1)[1].rsplit("```", 1)[0]
            raw = json.loads(text).get("suggestions", [])
            for item in raw:
                cat_name = item.get("category_name", "")
                cat_id = cat_ids.get(cat_name)
                if cat_id and isinstance(item.get("suggested_amount"), (int, float)):
                    suggestions.append(
                        {
                            "category_id": cat_id,
                            "category_name": cat_name,
                            "suggested_amount": float(item["suggested_amount"]),
                            "reasoning": str(item.get("reasoning", "")),
                        }
                    )
        except Exception as e:
            logger.warning("Budget suggestions: failed to parse LLM JSON: %s", e, exc_info=True)

    return {"suggestions": suggestions, "model_source": source}
