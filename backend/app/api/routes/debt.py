from __future__ import annotations

"""Debt payoff planning endpoints.

Implements Avalanche (highest-interest first) and Snowball (lowest-balance first)
payoff strategies with month-by-month projections.
"""

import math
from decimal import Decimal
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.api.deps import get_household_id
from app.models import Account
from app.api.routes.accounts import _compute_balances

router = APIRouter()

DEBT_TYPES = {"credit", "loan"}


# ── Schemas ────────────────────────────────────────────────────────────────────

class DebtAccount(BaseModel):
    id: str
    name: str
    institution: Optional[str]
    account_type: str
    balance: Decimal           # current balance (negative = you owe money)
    interest_rate: Optional[Decimal]   # APR, e.g. 0.2499
    minimum_payment: Optional[Decimal]

    @property
    def balance_owed(self) -> Decimal:
        return abs(self.balance)


class PayoffMonthDetail(BaseModel):
    month: int
    balance: Decimal
    interest: Decimal
    payment: Decimal
    principal: Decimal


class DebtPayoffResult(BaseModel):
    account_id: str
    account_name: str
    starting_balance: Decimal
    interest_rate: Optional[Decimal]
    minimum_payment: Optional[Decimal]
    months_to_payoff: Optional[int]
    total_interest: Decimal
    total_paid: Decimal
    payoff_date: Optional[str]
    schedule: list[PayoffMonthDetail]


class PayoffPlanResponse(BaseModel):
    strategy: str           # avalanche | snowball | hybrid
    extra_monthly: Decimal
    total_months: int
    total_interest: Decimal
    total_paid: Decimal
    debts: list[DebtPayoffResult]


class PayoffPlanRequest(BaseModel):
    strategy: str = "avalanche"   # avalanche | snowball | hybrid
    extra_monthly: Decimal = Decimal("0")
    priority_account_ids: Optional[List[str]] = None


# ── Helpers ────────────────────────────────────────────────────────────────────

def _months_to_payoff(balance: Decimal, apr: Decimal, monthly_payment: Decimal) -> Optional[int]:
    """Return the number of months to pay off a balance, or None if it never pays off."""
    if balance <= 0:
        return 0
    monthly_rate = apr / 12
    if monthly_rate == 0:
        if monthly_payment <= 0:
            return None
        return math.ceil(float(balance / monthly_payment))
    # Standard amortisation check: minimum payment must cover at least one month's interest
    if monthly_payment <= balance * monthly_rate:
        return None  # payment too low to ever pay off
    n = -math.log(1 - float(balance * monthly_rate / monthly_payment)) / math.log(1 + float(monthly_rate))
    return math.ceil(n)


def _build_schedule(
    starting_balance: Decimal,
    apr: Decimal,
    payments: list[Decimal],   # payment amount for each month (variable due to extra)
    max_months: int = 600,
) -> tuple[list[PayoffMonthDetail], Decimal]:
    """Simulate month-by-month payoff. Returns (schedule, total_interest)."""
    monthly_rate = apr / 12
    balance = starting_balance
    schedule: list[PayoffMonthDetail] = []
    total_interest = Decimal("0")
    payment_iter = iter(payments)

    for month in range(1, max_months + 1):
        if balance <= 0:
            break
        interest = (balance * monthly_rate).quantize(Decimal("0.01"))
        payment = min(next(payment_iter, payments[-1] if payments else Decimal("0")), balance + interest)
        principal = payment - interest
        balance = max(Decimal("0"), balance - principal)
        total_interest += interest
        schedule.append(PayoffMonthDetail(
            month=month,
            balance=balance,
            interest=interest,
            payment=payment,
            principal=principal,
        ))
        if balance <= 0:
            break

    return schedule, total_interest


def hybrid_order_debts(
    debts: list[dict],
    priority_account_ids: Optional[List[str]],
) -> list[dict]:
    """Hybrid payoff order: optional explicit account id list first, then by APR desc, balance asc tie-break."""
    if not debts:
        return []
    by_id = {d["id"]: d for d in debts}
    if not priority_account_ids:
        out = list(debts)
        out.sort(key=lambda d: (-d["apr"], d["balance"]))
        return out
    seen: set[str] = set()
    ordered: list[dict] = []
    for pid in priority_account_ids:
        if pid in by_id and pid not in seen:
            ordered.append(by_id[pid])
            seen.add(pid)
    rest = [d for d in debts if d["id"] not in seen]
    rest.sort(key=lambda d: (-d["apr"], d["balance"]))
    return ordered + rest


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.get("/accounts", response_model=list[DebtAccount])
async def list_debt_accounts(
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    """Return all credit/loan accounts with their current balances."""
    result = await db.execute(
        select(Account)
        .where(Account.household_id == household_id)
        .where(Account.account_type.in_(DEBT_TYPES))
        .where(Account.closed_at.is_(None))
    )
    accounts = result.scalars().all()
    balances = await _compute_balances(db, accounts)

    return [
        DebtAccount(
            id=a.id,
            name=a.name,
            institution=a.institution,
            account_type=a.account_type,
            balance=balances.get(a.id, Decimal("0")),
            interest_rate=a.interest_rate,
            minimum_payment=a.minimum_payment,
        )
        for a in accounts
    ]


@router.post("/payoff-plan", response_model=PayoffPlanResponse)
async def calculate_payoff_plan(
    req: PayoffPlanRequest,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    """Calculate a debt payoff plan using avalanche, snowball, or hybrid ordering.

    Avalanche: pay off highest-interest debt first (minimises total interest).
    Snowball: pay off lowest-balance debt first (psychological momentum).
    Hybrid: highest APR first; ties (same APR) use smaller balance first. Optional
    ``priority_account_ids`` (debt account UUIDs) overrides initial ordering; any
    missing ids are appended using the hybrid tie-break sort.
    """
    if req.strategy not in ("avalanche", "snowball", "hybrid"):
        raise HTTPException(400, "strategy must be 'avalanche', 'snowball', or 'hybrid'")

    # Load debt accounts
    result = await db.execute(
        select(Account)
        .where(Account.household_id == household_id)
        .where(Account.account_type.in_(DEBT_TYPES))
        .where(Account.closed_at.is_(None))
    )
    accounts = result.scalars().all()
    balances = await _compute_balances(db, accounts)

    debts = []
    for a in accounts:
        bal = abs(balances.get(a.id, Decimal("0")))
        if bal <= 0:
            continue
        debts.append({
            "id": a.id,
            "name": a.name,
            "balance": bal,
            "apr": a.interest_rate or Decimal("0"),
            "min_payment": a.minimum_payment or Decimal("25"),
        })

    if not debts:
        return PayoffPlanResponse(
            strategy=req.strategy,
            extra_monthly=req.extra_monthly,
            total_months=0,
            total_interest=Decimal("0"),
            total_paid=Decimal("0"),
            debts=[],
        )

    # Sort by strategy
    if req.strategy == "avalanche":
        debts.sort(key=lambda d: d["apr"], reverse=True)
    elif req.strategy == "snowball":
        debts.sort(key=lambda d: d["balance"])
    else:
        debts = hybrid_order_debts(debts, req.priority_account_ids)

    # Simulate month-by-month with rolling snowball/avalanche extra
    from datetime import date
    import calendar

    balances_sim = {d["id"]: d["balance"] for d in debts}
    total_interest = Decimal("0")
    total_paid = Decimal("0")
    month = 0
    MAX_MONTHS = 600
    debt_schedules: dict[str, list[PayoffMonthDetail]] = {d["id"]: [] for d in debts}
    debt_total_interest: dict[str, Decimal] = {d["id"]: Decimal("0") for d in debts}
    debt_total_paid: dict[str, Decimal] = {d["id"]: Decimal("0") for d in debts}

    active_order = [d["id"] for d in debts]

    while any(balances_sim[did] > 0 for did in active_order) and month < MAX_MONTHS:
        month += 1
        freed_up = Decimal("0")   # payments freed from paid-off debts go to next target

        # Available extra this month = user's extra + any freed minimums
        extra_pool = req.extra_monthly + freed_up

        for i, debt in enumerate(debts):
            did = debt["id"]
            bal = balances_sim[did]
            if bal <= 0:
                extra_pool += debt["min_payment"]  # free up this minimum for next debt
                continue

            monthly_rate = debt["apr"] / 12
            interest = (bal * monthly_rate).quantize(Decimal("0.01"))
            payment = debt["min_payment"]

            # Apply extra pool to the priority debt (first active in order)
            if i == next((j for j, d in enumerate(debts) if balances_sim[d["id"]] > 0), None):
                payment += extra_pool
                extra_pool = Decimal("0")

            payment = min(payment, bal + interest)
            principal = payment - interest
            balances_sim[did] = max(Decimal("0"), bal - principal)

            debt_total_interest[did] += interest
            debt_total_paid[did] += payment
            debt_schedules[did].append(PayoffMonthDetail(
                month=month,
                balance=balances_sim[did],
                interest=interest,
                payment=payment,
                principal=principal,
            ))

    # Build response
    from datetime import date
    today = date.today()

    def _payoff_date(n_months: int) -> str:
        import calendar
        m = today.month + n_months - 1
        y = today.year + m // 12
        m = m % 12 + 1
        return f"{y}-{m:02d}"

    results = []
    for debt in debts:
        did = debt["id"]
        sched = debt_schedules[did]
        n = len(sched)
        ti = debt_total_interest[did]
        tp = debt_total_paid[did]
        results.append(DebtPayoffResult(
            account_id=did,
            account_name=debt["name"],
            starting_balance=debt["balance"],
            interest_rate=debt["apr"] if debt["apr"] else None,
            minimum_payment=debt["min_payment"],
            months_to_payoff=n if n > 0 else None,
            total_interest=ti,
            total_paid=tp,
            payoff_date=_payoff_date(n) if n > 0 else None,
            schedule=sched[:24],  # return first 2 years of schedule only
        ))
        total_interest += ti
        total_paid += tp

    return PayoffPlanResponse(
        strategy=req.strategy,
        extra_monthly=req.extra_monthly,
        total_months=month,
        total_interest=total_interest,
        total_paid=total_paid,
        debts=results,
    )
