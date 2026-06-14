from __future__ import annotations

"""Deterministic budget facts and spending-pattern aggregates."""

from datetime import date
from decimal import Decimal

from sqlalchemy import extract, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Account, BudgetAssignment, Category, CategoryGroup, Transaction


async def compute_budget_facts(
    db: AsyncSession, household_id: str
) -> dict[str, object]:
    """Deterministic, model-free budget facts for the current month.

    Returns budgeted vs actual spending per category for the household,
    shaped for ``app.schemas.facts.BudgetFacts``. This is the grounding layer
    for the on-device pipeline — there is intentionally NO LLM call here.

    Semantics mirror ``GET /budget/month/{month}`` (the canonical
    budgeted-vs-actual view):
      - ``budgeted``  = the month's assigned amount (``BudgetAssignment``)
      - ``actual``    = net outflow = ``-sum(activity)`` so spending is positive
      - ``remaining`` = ``budgeted - actual`` (== assigned + activity)

    Only non-income categories with a non-zero assignment or activity for the
    month are included. Activity is summed over open budget accounts, ignoring
    split-parent rows to avoid double counting.
    """
    today = date.today()
    month = f"{today.year}-{today.month:02d}"

    # Non-income categories for the household (id -> name).
    cat_result = await db.execute(
        select(Category.id, Category.name)
        .join(CategoryGroup, Category.group_id == CategoryGroup.id)
        .where(
            CategoryGroup.household_id == household_id,
            CategoryGroup.is_income.is_(False),
        )
    )
    name_map: dict[str, str] = {cid: cname for cid, cname in cat_result.all()}

    # Budgeted (assigned) amounts for the current month.
    assign_result = await db.execute(
        select(BudgetAssignment.category_id, BudgetAssignment.assigned_amount).where(
            BudgetAssignment.household_id == household_id,
            BudgetAssignment.month == month,
        )
    )
    budgeted_map: dict[str, Decimal] = {
        cid: (amt or Decimal("0")) for cid, amt in assign_result.all()
    }

    budget_account_subq = (
        select(Account.id)
        .where(Account.household_id == household_id)
        .where(Account.is_budget_account.is_(True))
        .where(Account.closed_at.is_(None))
        .scalar_subquery()
    )

    # Net activity per category for the current month on budget accounts.
    activity_result = await db.execute(
        select(Transaction.category_id, func.sum(Transaction.amount))
        .where(
            Transaction.account_id.in_(budget_account_subq),
            extract("year", Transaction.date) == today.year,
            extract("month", Transaction.date) == today.month,
            Transaction.category_id.isnot(None),
            Transaction.parent_transaction_id.is_(None),
        )
        .group_by(Transaction.category_id)
    )
    activity_map: dict[str, Decimal] = {
        cid: (amt or Decimal("0")) for cid, amt in activity_result.all()
    }

    categories: list[dict[str, object]] = []
    total_budgeted = Decimal("0")
    total_actual = Decimal("0")
    for cid in sorted(name_map.keys(), key=lambda c: name_map[c].lower()):
        budgeted = budgeted_map.get(cid, Decimal("0"))
        actual = -activity_map.get(cid, Decimal("0"))  # positive == spent
        if budgeted == 0 and actual == 0:
            continue
        remaining = budgeted - actual
        categories.append(
            {
                "category_id": cid,
                "name": name_map[cid],
                "budgeted": float(budgeted),
                "actual": float(actual),
                "remaining": float(remaining),
            }
        )
        total_budgeted += budgeted
        total_actual += actual

    return {
        "month": month,
        "categories": categories,
        "total_budgeted": float(total_budgeted),
        "total_actual": float(total_actual),
    }


async def compute_spending_patterns(
    db: AsyncSession, household_id: str
) -> dict[str, object]:
    """Category spending trends vs a 3-month average (model-free).

    Returns ``{"patterns": [{"category", "trend", "pct_change"}, ...]}`` shaped
    for ``SpendingPatternsFacts``.
    """
    today = date.today()

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
        patterns.append(
            {"category": cat, "trend": trend, "pct_change": round(pct_change, 1)}
        )

    patterns.sort(key=lambda p: abs(p["pct_change"]), reverse=True)
    return {"patterns": patterns[:12]}
