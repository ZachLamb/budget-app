from __future__ import annotations

import math
from datetime import datetime, date, timezone
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.api.deps import get_household_id
from app.models import FinancialGoal, Account
from app.schemas.goal import GoalCreate, GoalUpdate, GoalResponse
from app.api.routes.accounts import _compute_balances

router = APIRouter()
_DEBT_ACCOUNT_TYPES = {"credit", "loan"}


def _compute_goal_metrics(
    target_amount: Decimal,
    current_amount: Decimal,
    monthly_contribution: Optional[Decimal],
    target_date: Optional[date],
) -> tuple[float, Optional[int]]:
    progress_pct = 0.0
    months_remaining: Optional[int] = None

    if target_amount > 0:
        progress_pct = float((current_amount / target_amount) * 100)
    progress_pct = max(0.0, min(100.0, progress_pct))

    remaining = target_amount - current_amount
    if monthly_contribution and monthly_contribution > 0:
        months_remaining = math.ceil(float(remaining / monthly_contribution)) if remaining > 0 else 0
    elif target_date:
        today = date.today()
        if target_date > today:
            delta = (target_date.year - today.year) * 12 + (target_date.month - today.month)
            months_remaining = max(0, delta)
        else:
            months_remaining = 0

    return progress_pct, months_remaining


def _derive_linked_current_amount(goal: FinancialGoal, account_type: str, live_balance: Decimal) -> Decimal:
    if goal.goal_type == "debt_payoff" and account_type in _DEBT_ACCOUNT_TYPES:
        amount_paid = goal.target_amount + live_balance
        return max(Decimal("0.00"), amount_paid)
    return live_balance


def _apply_completion_state(goal: FinancialGoal, is_completed: bool) -> None:
    if is_completed:
        if not goal.completed_at:
            goal.completed_at = datetime.now(timezone.utc)
    else:
        goal.completed_at = None


def _enrich_goal(goal: FinancialGoal, account_name: Optional[str] = None) -> GoalResponse:
    resp = GoalResponse.model_validate(goal)
    resp.account_name = account_name

    progress_pct, months_remaining = _compute_goal_metrics(
        target_amount=goal.target_amount,
        current_amount=goal.current_amount,
        monthly_contribution=goal.monthly_contribution,
        target_date=goal.target_date,
    )
    resp.progress_pct = progress_pct
    resp.months_remaining = months_remaining

    return resp


@router.get("", response_model=list[GoalResponse])
async def list_goals(
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(FinancialGoal)
        .where(FinancialGoal.household_id == household_id)
        .order_by(FinancialGoal.is_completed, FinancialGoal.sort_order, FinancialGoal.created_at)
    )
    goals = result.scalars().all()

    # Fetch linked accounts (names + live balances)
    account_ids = {g.account_id for g in goals if g.account_id}
    account_names: dict[str, str] = {}
    account_types: dict[str, str] = {}
    account_balances: dict[str, Decimal] = {}
    if account_ids:
        acct_result = await db.execute(select(Account).where(Account.id.in_(account_ids)))
        linked_accounts = acct_result.scalars().all()
        for a in linked_accounts:
            account_names[a.id] = a.name
            account_types[a.id] = a.account_type
        account_balances = await _compute_balances(db, linked_accounts)

    enriched = []
    for g in goals:
        resp = _enrich_goal(g, account_names.get(g.account_id))
        # Override current_amount with linked account balance semantics.
        if g.account_id and g.account_id in account_balances:
            live_balance = account_balances[g.account_id]
            account_type = account_types.get(g.account_id, "")
            resp.current_amount = _derive_linked_current_amount(g, account_type, live_balance)
            resp.progress_pct, resp.months_remaining = _compute_goal_metrics(
                target_amount=g.target_amount,
                current_amount=resp.current_amount,
                monthly_contribution=g.monthly_contribution,
                target_date=g.target_date,
            )
        enriched.append(resp)
    return enriched


@router.post("", response_model=GoalResponse, status_code=201)
async def create_goal(
    data: GoalCreate,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    if data.account_id:
        acct = await db.execute(
            select(Account).where(Account.id == data.account_id, Account.household_id == household_id)
        )
        if not acct.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Account not found")

    goal = FinancialGoal(household_id=household_id, **data.model_dump())
    db.add(goal)
    await db.flush()

    account_name = None
    if goal.account_id:
        r = await db.execute(select(Account.name).where(Account.id == goal.account_id))
        account_name = r.scalar_one_or_none()

    return _enrich_goal(goal, account_name)


@router.put("/{goal_id}", response_model=GoalResponse)
async def update_goal(
    goal_id: str,
    data: GoalUpdate,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(FinancialGoal).where(FinancialGoal.id == goal_id, FinancialGoal.household_id == household_id)
    )
    goal = result.scalar_one_or_none()
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")

    updates = data.model_dump(exclude_unset=True)
    if "account_id" in updates and updates["account_id"]:
        acct = await db.execute(
            select(Account).where(Account.id == updates["account_id"], Account.household_id == household_id)
        )
        if not acct.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Account not found")

    for field, value in updates.items():
        setattr(goal, field, value)

    if data.is_completed is not None:
        _apply_completion_state(goal, data.is_completed)

    account_name = None
    if goal.account_id:
        r = await db.execute(select(Account.name).where(Account.id == goal.account_id))
        account_name = r.scalar_one_or_none()

    return _enrich_goal(goal, account_name)


@router.delete("/{goal_id}", status_code=204)
async def delete_goal(
    goal_id: str,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(FinancialGoal).where(FinancialGoal.id == goal_id, FinancialGoal.household_id == household_id)
    )
    goal = result.scalar_one_or_none()
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")
    await db.delete(goal)
