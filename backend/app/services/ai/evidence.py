"""Deterministic chat-evidence assembly (server data only, never LLM output)."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import extract, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Account, BudgetAssignment, Category, FinancialGoal, Transaction
from app.schemas.ai import (
    build_budget_pace_evidence_rows,
    build_category_spending_evidence,
    build_goal_progress_evidence_rows,
)


async def build_chat_evidence_list(db: AsyncSession, household_id: str) -> list[dict]:
    """Display-only snippets: category spend, active goals, budget vs spent (budget accounts)."""
    today = date.today()
    month_start = today.replace(day=1)
    month_key = month_start.strftime("%Y-%m")

    spend_result = await db.execute(
        select(Category.name, func.sum(Transaction.amount))
        .join(Transaction, Transaction.category_id == Category.id)
        .join(Account, Transaction.account_id == Account.id)
        .where(Account.household_id == household_id)
        .where(Transaction.date >= month_start)
        .where(Transaction.amount < 0)
        .group_by(Category.name)
        .order_by(func.sum(Transaction.amount))
        .limit(12)
    )
    cat_rows = list(spend_result.all())
    out: list[dict] = []
    out.extend(build_category_spending_evidence(month_key, cat_rows))

    goals_result = await db.execute(
        select(
            FinancialGoal.name,
            FinancialGoal.goal_type,
            FinancialGoal.current_amount,
            FinancialGoal.target_amount,
        )
        .where(FinancialGoal.household_id == household_id)
        .where(FinancialGoal.is_completed == False)  # noqa: E712
        .order_by(FinancialGoal.target_amount.desc())
        .limit(8)
    )
    goal_tuples = [(n, gt, cur, tgt) for n, gt, cur, tgt in goals_result.all()]
    goal_ev = build_goal_progress_evidence_rows(goal_tuples)
    if goal_ev:
        out.append(goal_ev)

    budget_account_subq = (
        select(Account.id)
        .where(Account.household_id == household_id)
        .where(Account.is_budget_account.is_(True))
        .where(Account.closed_at.is_(None))
        .scalar_subquery()
    )
    y, m = today.year, today.month
    spent_by_cat: dict[str, Decimal] = {}
    spent_result = await db.execute(
        select(Transaction.category_id, func.sum(Transaction.amount))
        .where(Transaction.account_id.in_(budget_account_subq))
        .where(extract("year", Transaction.date) == y)
        .where(extract("month", Transaction.date) == m)
        .where(Transaction.amount < 0)
        .where(Transaction.category_id.isnot(None))
        .group_by(Transaction.category_id)
    )
    for cid, amt in spent_result.all():
        spent_by_cat[cid] = abs(amt)

    assign_result = await db.execute(
        select(Category.name, BudgetAssignment.category_id, BudgetAssignment.assigned_amount)
        .join(Category, BudgetAssignment.category_id == Category.id)
        .where(BudgetAssignment.household_id == household_id)
        .where(BudgetAssignment.month == month_key)
    )
    pace_rows: list[tuple[str, float, float]] = []
    for cat_name, cat_id, assigned in assign_result.all():
        sp = float(spent_by_cat.get(cat_id, Decimal("0")))
        bud = float(assigned)
        pace_rows.append((cat_name, bud, sp))
    pace_rows.sort(key=lambda x: x[2] - x[1])
    pace_ev = build_budget_pace_evidence_rows(month_key, pace_rows[:12])
    if pace_ev:
        out.append(pace_ev)

    return out
