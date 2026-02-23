from __future__ import annotations

from decimal import Decimal
from datetime import date
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.database import get_db
from app.api.deps import get_household_id
from app.models import Account, AccountSnapshot, Transaction
from app.schemas.account import AccountCreate, AccountUpdate, AccountResponse

router = APIRouter()


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


@router.get("/", response_model=list[AccountResponse])
async def list_accounts(
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Account)
        .where(Account.household_id == household_id)
        .where(Account.closed_at.is_(None))
        .order_by(Account.account_type, Account.name)
    )
    accounts = result.scalars().all()

    responses = []
    for acct in accounts:
        balance = await _compute_balance(db, acct)
        resp = AccountResponse.model_validate(acct)
        resp.balance = balance
        responses.append(resp)
    return responses


@router.post("/", response_model=AccountResponse, status_code=201)
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
