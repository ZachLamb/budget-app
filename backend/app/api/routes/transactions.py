from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc
from sqlalchemy.orm import aliased
from typing import Optional
from datetime import date

from app.database import get_db
from app.api.deps import get_household_id
from app.models import Transaction, Account, Payee, Category
from app.schemas.transaction import TransactionCreate, TransactionUpdate, TransactionResponse, TransactionListResponse

router = APIRouter()


async def _get_or_create_payee(db: AsyncSession, household_id: str, name: str) -> str:
    result = await db.execute(
        select(Payee).where(Payee.household_id == household_id, Payee.name == name)
    )
    payee = result.scalar_one_or_none()
    if payee:
        return payee.id
    payee = Payee(household_id=household_id, name=name)
    db.add(payee)
    await db.flush()
    return payee.id


async def _enrich_transaction(db: AsyncSession, txn: Transaction) -> TransactionResponse:
    resp = TransactionResponse.model_validate(txn)
    if txn.payee_id:
        result = await db.execute(select(Payee.name).where(Payee.id == txn.payee_id))
        resp.payee_name = result.scalar_one_or_none()
    if txn.category_id:
        result = await db.execute(select(Category.name).where(Category.id == txn.category_id))
        resp.category_name = result.scalar_one_or_none()
    return resp


@router.get("/", response_model=TransactionListResponse)
async def list_transactions(
    account_id: Optional[str] = None,
    category_id: Optional[str] = None,
    search: Optional[str] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    uncategorized: bool = False,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    base_query = (
        select(Transaction)
        .join(Account, Transaction.account_id == Account.id)
        .where(Account.household_id == household_id)
        .where(Transaction.parent_transaction_id.is_(None))
    )

    if account_id:
        base_query = base_query.where(Transaction.account_id == account_id)
    if category_id:
        base_query = base_query.where(Transaction.category_id == category_id)
    if uncategorized:
        base_query = base_query.where(Transaction.category_id.is_(None))
    if date_from:
        base_query = base_query.where(Transaction.date >= date_from)
    if date_to:
        base_query = base_query.where(Transaction.date <= date_to)
    if search:
        base_query = base_query.outerjoin(Payee, Transaction.payee_id == Payee.id).where(
            Payee.name.ilike(f"%{search}%") | Transaction.notes.ilike(f"%{search}%")
        )

    count_result = await db.execute(
        select(func.count()).select_from(base_query.subquery())
    )
    total = count_result.scalar()

    result = await db.execute(
        base_query.order_by(desc(Transaction.date), desc(Transaction.created_at))
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    transactions = result.scalars().all()

    enriched = [await _enrich_transaction(db, t) for t in transactions]
    return TransactionListResponse(transactions=enriched, total=total, page=page, page_size=page_size)


@router.post("/", response_model=TransactionResponse, status_code=201)
async def create_transaction(
    data: TransactionCreate,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    acct_result = await db.execute(
        select(Account).where(Account.id == data.account_id, Account.household_id == household_id)
    )
    if not acct_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Account not found")

    payee_id = data.payee_id
    if not payee_id and data.payee_name:
        payee_id = await _get_or_create_payee(db, household_id, data.payee_name)

    txn = Transaction(
        account_id=data.account_id,
        date=data.date,
        payee_id=payee_id,
        amount=data.amount,
        category_id=data.category_id,
        notes=data.notes,
        cleared=data.cleared,
    )
    db.add(txn)
    await db.flush()
    return await _enrich_transaction(db, txn)


@router.get("/{transaction_id}", response_model=TransactionResponse)
async def get_transaction(
    transaction_id: str,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Transaction)
        .join(Account)
        .where(Transaction.id == transaction_id, Account.household_id == household_id)
    )
    txn = result.scalar_one_or_none()
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return await _enrich_transaction(db, txn)


@router.put("/{transaction_id}", response_model=TransactionResponse)
async def update_transaction(
    transaction_id: str,
    data: TransactionUpdate,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Transaction)
        .join(Account)
        .where(Transaction.id == transaction_id, Account.household_id == household_id)
    )
    txn = result.scalar_one_or_none()
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(txn, field, value)
    return await _enrich_transaction(db, txn)


@router.delete("/{transaction_id}", status_code=204)
async def delete_transaction(
    transaction_id: str,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Transaction)
        .join(Account)
        .where(Transaction.id == transaction_id, Account.household_id == household_id)
    )
    txn = result.scalar_one_or_none()
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")
    await db.delete(txn)
