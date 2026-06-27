from __future__ import annotations

"""Shared LLM context builder.

Produces a compact financial summary injected as context for insights, chat,
and other AI features. Only aggregate balances and category-level spending are
included — no account numbers, credentials, or individual transaction details.
"""

import logging
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Account,
    BudgetAssignment,
    Category,
    FinancialGoal,
    Transaction,
)

logger = logging.getLogger(__name__)


async def build_financial_context(db: AsyncSession, household_id: str) -> str:
    """Build a compact financial summary to inject as LLM context.

    Security notes:
    - Only account names, types, and aggregate balances are included.
    - No account numbers, routing numbers, SSNs, or credentials are ever included.
    - SimpleFIN access URLs are never included.
    - Spending data is category-level only (no individual transaction details).
    """
    today = date.today()
    month_start = today.replace(day=1)
    three_months_ago = today - timedelta(days=90)

    # Account balances
    acct_result = await db.execute(
        select(Account)
        .where(Account.household_id == household_id)
        .where(Account.closed_at.is_(None))
    )
    accounts = acct_result.scalars().all()

    from app.api.routes.accounts import _compute_balances
    balances = await _compute_balances(db, accounts)

    acct_summary = []
    total_assets = Decimal("0")
    total_debt = Decimal("0")
    for a in accounts:
        bal = balances.get(a.id, Decimal("0"))
        is_debt = a.account_type in ("credit", "loan")
        if is_debt:
            total_debt += abs(bal)
        else:
            total_assets += bal
        apr_str = f" APR={float(a.interest_rate)*100:.1f}%" if (a.interest_rate is not None) else ""
        acct_summary.append(f"  {a.name} ({a.account_type}): ${bal:,.2f}{apr_str}")

    # Current month spending by category
    spend_result = await db.execute(
        select(Category.name, func.sum(Transaction.amount))
        .join(Transaction, Transaction.category_id == Category.id)
        .join(Account, Transaction.account_id == Account.id)
        .where(Account.household_id == household_id)
        .where(Transaction.date >= month_start)
        .where(Transaction.amount < 0)
        .group_by(Category.name)
        .order_by(func.sum(Transaction.amount))
        .limit(10)
    )
    spending = [(name, abs(amt)) for name, amt in spend_result.all()]

    # Budget this month
    budget_result = await db.execute(
        select(func.sum(BudgetAssignment.assigned_amount))
        .where(BudgetAssignment.household_id == household_id)
        .where(BudgetAssignment.month == month_start.strftime("%Y-%m"))
    )
    total_budgeted = budget_result.scalar() or Decimal("0")

    # Goals
    goals_result = await db.execute(
        select(FinancialGoal)
        .where(FinancialGoal.household_id == household_id)
        .where(FinancialGoal.is_completed == False)  # noqa: E712
    )
    goals = goals_result.scalars().all()

    ctx_parts = [
        f"Today: {today.isoformat()}",
        f"Net worth: ${total_assets - total_debt:,.2f} (assets ${total_assets:,.2f}, debt ${total_debt:,.2f})",
        "",
        "Accounts:",
        *acct_summary,
        "",
        f"Budget assigned this month: ${total_budgeted:,.2f}",
        "",
        "Top spending this month:",
        *[f"  {name}: ${amt:,.2f}" for name, amt in spending],
    ]

    if goals:
        ctx_parts += ["", "Active financial goals:"]
        for g in goals:
            pct = 0
            if g.target_amount > 0:
                pct = float(g.current_amount / g.target_amount * 100)
            ctx_parts.append(f"  {g.name} ({g.goal_type}): ${g.current_amount:,.2f} / ${g.target_amount:,.2f} ({pct:.0f}%)")

    return "\n".join(ctx_parts)


async def build_context_facts(db: AsyncSession, household_id: str) -> dict[str, object]:
    """Deterministic, model-free STRUCTURED financial snapshot.

    Sibling to :func:`build_financial_context` (which returns a free-text blob
    still used by the model path). This returns typed numbers/ids — shaped for
    ``app.schemas.facts.ContextFacts`` — so the on-device verifier can reconcile
    model output against real figures. There is intentionally NO LLM call here.

    The account-balance and net-worth math mirror ``build_financial_context``
    exactly (open accounts, debt = ``credit``/``loan``). Recent spend mirrors the
    same current-month outflow aggregation, additionally surfacing ``category_id``
    (grouping by id+name instead of name only) so the client can verify by id.
    The budget and goals sections reuse the A1/A2 helpers
    (``compute_budget_facts`` / ``compute_goal_facts``) verbatim — one
    deterministic source of truth shared across all fact endpoints.
    """
    # Lazy imports: these live under app.api.routes and importing them at module
    # top would couple this service to route load-time wiring (potential cycle).
    from app.api.routes.accounts import _compute_balances
    from app.api.routes.goals import compute_goal_facts
    from app.services.ai.budget import compute_budget_facts

    today = date.today()
    month_start = today.replace(day=1)

    # Account balances + net worth (mirrors build_financial_context).
    acct_result = await db.execute(
        select(Account)
        .where(Account.household_id == household_id)
        .where(Account.closed_at.is_(None))
    )
    accounts = acct_result.scalars().all()
    balances = await _compute_balances(db, accounts)

    account_facts: list[dict[str, object]] = []
    total_assets = Decimal("0")
    total_debt = Decimal("0")
    for a in accounts:
        bal = balances.get(a.id, Decimal("0"))
        if a.account_type in ("credit", "loan"):
            total_debt += abs(bal)
        else:
            total_assets += bal
        account_facts.append(
            {"account_id": a.id, "name": a.name, "balance": float(bal)}
        )
    net_worth = float(total_assets - total_debt)

    # Recent (current-month) spend by category — same outflow aggregation as
    # build_financial_context, with category_id surfaced for client verification.
    spend_result = await db.execute(
        select(Category.id, Category.name, func.sum(Transaction.amount))
        .join(Transaction, Transaction.category_id == Category.id)
        .join(Account, Transaction.account_id == Account.id)
        .where(Account.household_id == household_id)
        .where(Transaction.date >= month_start)
        .where(Transaction.amount < 0)
        .group_by(Category.id, Category.name)
        .order_by(func.sum(Transaction.amount))
        .limit(10)
    )
    recent_spend_by_category = [
        {"category_id": cid, "name": cname, "amount": float(abs(amt))}
        for cid, cname, amt in spend_result.all()
    ]

    budget = await compute_budget_facts(db, household_id)
    goals = (await compute_goal_facts(db, household_id))["goals"]

    return {
        "net_worth": net_worth,
        "accounts": account_facts,
        "recent_spend_by_category": recent_spend_by_category,
        "budget": budget,
        "goals": goals,
    }
