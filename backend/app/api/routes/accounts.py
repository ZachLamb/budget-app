from __future__ import annotations

import logging
from decimal import Decimal
from datetime import date
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_

from app.database import get_db
from app.api.deps import get_household_id
from app.models import Account, AccountSnapshot, Payee, Reconciliation, Transaction
from app.schemas.account import AccountCreate, AccountUpdate, AccountResponse
from app.schemas.reconciliation import (
    ReconcileRequest,
    ReconciliationResponse,
    ReconciliationViewResponse,
)
from app.services.reconciliation import build_view
from app.utils import validate_category_ownership

router = APIRouter()
logger = logging.getLogger(__name__)


async def _compute_balance(db: AsyncSession, account: Account) -> Decimal:
    if account.is_budget_account:
        result = await db.execute(
            select(func.coalesce(func.sum(Transaction.amount), 0))
            .where(Transaction.account_id == account.id)
            .where(Transaction.parent_transaction_id.is_(None))
        )
        return result.scalar()
    else:
        result = await db.execute(
            select(AccountSnapshot.balance)
            .where(AccountSnapshot.account_id == account.id)
            .order_by(AccountSnapshot.date.desc())
            .limit(1)
        )
        row = result.scalar_one_or_none()
        return row if row is not None else Decimal("0.00")


async def _compute_balances(db: AsyncSession, accounts: list) -> dict[str, Decimal]:
    budget_ids = [a.id for a in accounts if a.is_budget_account]
    tracking_ids = [a.id for a in accounts if not a.is_budget_account]
    balances: dict[str, Decimal] = {}

    if budget_ids:
        result = await db.execute(
            select(Transaction.account_id, func.coalesce(func.sum(Transaction.amount), 0))
            .where(Transaction.account_id.in_(budget_ids))
            .where(Transaction.parent_transaction_id.is_(None))
            .group_by(Transaction.account_id)
        )
        for acct_id, total in result.all():
            balances[acct_id] = total

    if tracking_ids:
        subq = (
            select(
                AccountSnapshot.account_id,
                func.max(AccountSnapshot.date).label("max_date")
            )
            .where(AccountSnapshot.account_id.in_(tracking_ids))
            .group_by(AccountSnapshot.account_id)
            .subquery()
        )
        result = await db.execute(
            select(AccountSnapshot.account_id, AccountSnapshot.balance)
            .select_from(AccountSnapshot)
            .join(subq, and_(
                AccountSnapshot.account_id == subq.c.account_id,
                AccountSnapshot.date == subq.c.max_date,
            ))
        )
        for acct_id, balance in result.all():
            balances[acct_id] = balance

    return balances


@router.get("", response_model=list[AccountResponse])
async def list_accounts(
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    try:
        result = await db.execute(
            select(Account)
            .where(Account.household_id == household_id)
            .where(Account.closed_at.is_(None))
            .order_by(Account.account_type, Account.name)
        )
        accounts = result.scalars().all()

        balances = await _compute_balances(db, accounts)
        responses = []
        for acct in accounts:
            resp = AccountResponse.model_validate(acct)
            resp.balance = balances.get(acct.id, Decimal("0.00"))
            responses.append(resp)
        return responses
    except Exception as e:
        logger.exception("list_accounts failed: %s", e)
        raise HTTPException(status_code=500, detail="Failed to load accounts") from e


@router.post("", response_model=AccountResponse, status_code=201)
async def create_account(
    data: AccountCreate,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    account = Account(
        household_id=household_id,
        name=data.name,
        account_type=data.account_type,
        institution=data.institution,
        currency=data.currency,
        is_budget_account=data.is_budget_account,
        interest_rate=data.interest_rate,
        minimum_payment=data.minimum_payment,
    )
    db.add(account)
    await db.flush()

    if data.starting_balance != Decimal("0.00"):
        if account.is_budget_account:
            txn = Transaction(
                account_id=account.id,
                date=date.today(),
                amount=data.starting_balance,
                notes="Starting balance",
                cleared=True,
            )
            db.add(txn)
        else:
            snapshot = AccountSnapshot(
                account_id=account.id,
                date=date.today(),
                balance=data.starting_balance,
            )
            db.add(snapshot)

    resp = AccountResponse.model_validate(account)
    resp.balance = data.starting_balance
    return resp


@router.get("/{account_id}", response_model=AccountResponse)
async def get_account(
    account_id: str,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Account).where(Account.id == account_id, Account.household_id == household_id)
    )
    account = result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    balance = await _compute_balance(db, account)
    resp = AccountResponse.model_validate(account)
    resp.balance = balance
    return resp


@router.put("/{account_id}", response_model=AccountResponse)
async def update_account(
    account_id: str,
    data: AccountUpdate,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Account).where(Account.id == account_id, Account.household_id == household_id)
    )
    account = result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(account, field, value)
    balance = await _compute_balance(db, account)
    resp = AccountResponse.model_validate(account)
    resp.balance = balance
    return resp


@router.delete("/{account_id}", status_code=204)
async def delete_account(
    account_id: str,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Account).where(Account.id == account_id, Account.household_id == household_id)
    )
    account = result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    await db.delete(account)


# ── reconciliation ────────────────────────────────────────────────────


async def _account_or_404(db: AsyncSession, account_id: str, household_id: str) -> Account:
    """Scope before anything else. Every route below reads or writes
    transactions belonging to the account, so an id from another
    household must stop here rather than at a later filter."""
    account = (
        await db.execute(
            select(Account).where(
                Account.id == account_id, Account.household_id == household_id
            )
        )
    ).scalar_one_or_none()
    if account is None:
        raise HTTPException(status_code=404, detail="Account not found")
    return account


@router.get("/{account_id}/reconciliation", response_model=ReconciliationViewResponse)
async def get_reconciliation(
    account_id: str,
    statement_date: date,
    statement_balance: Decimal,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    """Compare this account against a statement. Writes nothing.

    Reconciling by hand is a search: the balance is off and you have to
    find which transaction explains it. The search is deterministic, so
    the answer comes back with the comparison rather than being left to
    the person.
    """
    account = await _account_or_404(db, account_id, household_id)
    view = await build_view(
        db,
        account,
        statement_date=statement_date,
        statement_balance=statement_balance,
    )
    return ReconciliationViewResponse.model_validate(view, from_attributes=True)


@router.get("/{account_id}/reconciliations", response_model=list[ReconciliationResponse])
async def list_reconciliations(
    account_id: str,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    """When this account last agreed with the bank, and against what."""
    await _account_or_404(db, account_id, household_id)
    rows = (
        await db.execute(
            select(Reconciliation)
            .where(Reconciliation.account_id == account_id)
            .order_by(Reconciliation.statement_date.desc())
            .limit(24)
        )
    ).scalars().all()
    return [ReconciliationResponse.model_validate(r) for r in rows]


@router.post("/{account_id}/reconcile", response_model=ReconciliationResponse, status_code=201)
async def reconcile_account(
    account_id: str,
    body: ReconcileRequest,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    """Sign off a statement, locking the cleared transactions behind it.

    Refuses by default when the account does not balance: a
    reconciliation that tolerated a silent gap would record that the
    account agreed with the bank when it did not, which is worse than
    having no record at all. The two ways past it -- accept the gap, or
    close it with a balancing entry -- are both explicit, and both leave
    a trace in the record.
    """
    account = await _account_or_404(db, account_id, household_id)
    view = await build_view(
        db,
        account,
        statement_date=body.statement_date,
        statement_balance=body.statement_balance,
    )

    adjustment_id: str | None = None
    difference = view.difference

    if difference != 0:
        if body.create_adjustment:
            await validate_category_ownership(
                db, body.adjustment_category_id, household_id
            )
            payee = await _reconciliation_payee(db, household_id)
            adjustment = Transaction(
                account_id=account.id,
                date=body.statement_date,
                amount=difference,
                payee_id=payee.id,
                category_id=body.adjustment_category_id,
                notes=(
                    f"Balancing entry to match the statement of "
                    f"{body.statement_date.isoformat()}"
                ),
                cleared=True,
                reconciled=True,
            )
            db.add(adjustment)
            await db.flush()
            adjustment_id = adjustment.id
            # The entry closes the gap by construction, and the record
            # should say the account balanced -- with the adjustment id
            # alongside it saying how.
            difference = Decimal("0.00")
        elif not body.allow_difference:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"This account is out by {difference}. Find the missing "
                    "transaction, or choose to add a balancing entry."
                ),
            )

    locked = (
        await db.execute(
            select(Transaction)
            .where(Transaction.account_id == account.id)
            .where(Transaction.parent_transaction_id.is_(None))
            .where(Transaction.date <= body.statement_date)
            .where(Transaction.cleared.is_(True))
        )
    ).scalars().all()
    for txn in locked:
        txn.reconciled = True

    record = Reconciliation(
        account_id=account.id,
        statement_date=body.statement_date,
        statement_balance=body.statement_balance,
        cleared_balance=view.cleared_balance,
        difference=difference,
        transaction_count=len(locked),
        adjustment_transaction_id=adjustment_id,
    )
    db.add(record)
    await db.flush()
    return ReconciliationResponse.model_validate(record)


async def _reconciliation_payee(db: AsyncSession, household_id: str) -> Payee:
    """A named payee for balancing entries, so they are visible as a
    group rather than scattered as blank rows nobody can account for."""
    name = "Balance adjustment"
    payee = (
        await db.execute(
            select(Payee).where(Payee.household_id == household_id, Payee.name == name)
        )
    ).scalar_one_or_none()
    if payee is None:
        payee = Payee(household_id=household_id, name=name)
        db.add(payee)
        await db.flush()
    return payee
