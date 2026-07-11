from __future__ import annotations

import asyncio
import csv
import io
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc
from typing import Optional
from datetime import date

from app.database import get_db
from app.api.deps import get_household_id
from app.models import Transaction, Account, Payee, Category
from app.services.realtime import emit_event
from app.schemas.transaction import TransactionCreate, TransactionUpdate, TransactionResponse, TransactionListResponse
from app.utils import escape_like, validate_category_ownership, validate_payee_ownership

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
    return (await _enrich_transactions(db, [txn]))[0]


async def _enrich_transactions(db: AsyncSession, txns: list) -> list[TransactionResponse]:
    payee_ids = {t.payee_id for t in txns if t.payee_id}
    cat_ids = {t.category_id for t in txns if t.category_id}

    payee_names: dict[str, str] = {}
    if payee_ids:
        result = await db.execute(select(Payee.id, Payee.name).where(Payee.id.in_(payee_ids)))
        payee_names = dict(result.all())

    cat_names: dict[str, str] = {}
    if cat_ids:
        result = await db.execute(select(Category.id, Category.name).where(Category.id.in_(cat_ids)))
        cat_names = dict(result.all())

    enriched = []
    for txn in txns:
        resp = TransactionResponse.model_validate(txn)
        if txn.payee_id:
            resp.payee_name = payee_names.get(txn.payee_id)
        if txn.category_id:
            resp.category_name = cat_names.get(txn.category_id)
        enriched.append(resp)
    return enriched


@router.get("", response_model=TransactionListResponse)
async def list_transactions(
    account_id: Optional[str] = None,
    category_id: Optional[str] = None,
    search: Optional[str] = Query(None, max_length=200),
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
        escaped = escape_like(search)
        base_query = base_query.outerjoin(Payee, Transaction.payee_id == Payee.id).where(
            Payee.name.ilike(f"%{escaped}%") | Transaction.notes.ilike(f"%{escaped}%")
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

    enriched = await _enrich_transactions(db, transactions)
    return TransactionListResponse(transactions=enriched, total=total, page=page, page_size=page_size)


@router.post("", response_model=TransactionResponse, status_code=201)
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

    await validate_category_ownership(db, data.category_id, household_id)

    payee_id = data.payee_id
    if payee_id:
        await validate_payee_ownership(db, payee_id, household_id)
    elif data.payee_name:
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
    asyncio.create_task(emit_event(household_id, "transaction.created"))
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

    updates = data.model_dump(exclude_unset=True)
    if "category_id" in updates:
        await validate_category_ownership(db, updates["category_id"], household_id)
    if "payee_id" in updates:
        await validate_payee_ownership(db, updates["payee_id"], household_id)

    for field, value in updates.items():
        setattr(txn, field, value)
    asyncio.create_task(emit_event(household_id, "transaction.updated"))
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
    asyncio.create_task(emit_event(household_id, "transaction.deleted"))


@router.get("/export/csv")
async def export_transactions_csv(
    account_id: Optional[str] = None,
    category_id: Optional[str] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    query = (
        select(Transaction)
        .join(Account, Transaction.account_id == Account.id)
        .where(Account.household_id == household_id)
        .where(Transaction.parent_transaction_id.is_(None))
    )
    if account_id:
        query = query.where(Transaction.account_id == account_id)
    if category_id:
        query = query.where(Transaction.category_id == category_id)
    if date_from:
        query = query.where(Transaction.date >= date_from)
    if date_to:
        query = query.where(Transaction.date <= date_to)

    # Join names inline (one query instead of four) and stream rows in
    # batches — memory stays flat no matter how many transactions a
    # household exports.
    export_query = (
        query.order_by(desc(Transaction.date))
        .outerjoin(Payee, Transaction.payee_id == Payee.id)
        .outerjoin(Category, Transaction.category_id == Category.id)
        .with_only_columns(
            Transaction.date,
            Account.name.label("account_name"),
            Payee.name.label("payee_name"),
            Category.name.label("category_name"),
            Transaction.amount,
            Transaction.notes,
            Transaction.cleared,
        )
    )

    async def generate_csv():
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(["Date", "Account", "Payee", "Category", "Amount", "Notes", "Cleared"])
        yield buffer.getvalue()
        buffer.seek(0)
        buffer.truncate(0)

        stream = await db.stream(export_query.execution_options(yield_per=500))
        async for partition in stream.partitions(500):
            for row in partition:
                writer.writerow([
                    row.date.isoformat(),
                    row.account_name or "",
                    row.payee_name or "",
                    row.category_name or "",
                    str(row.amount),
                    row.notes or "",
                    "Yes" if row.cleared else "No",
                ])
            yield buffer.getvalue()
            buffer.seek(0)
            buffer.truncate(0)

    return StreamingResponse(
        generate_csv(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=transactions.csv"},
    )


class SplitItem(BaseModel):
    amount: Decimal
    category_id: Optional[str] = None
    notes: Optional[str] = None


class SplitRequest(BaseModel):
    splits: list[SplitItem]


@router.post("/{transaction_id}/split", response_model=TransactionResponse)
async def split_transaction(
    transaction_id: str,
    data: SplitRequest,
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
    if txn.is_split:
        raise HTTPException(status_code=400, detail="Transaction is already split")

    total = sum(s.amount for s in data.splits)
    if total != txn.amount:
        raise HTTPException(
            status_code=400,
            detail=f"Split amounts ({total}) must equal transaction amount ({txn.amount})",
        )

    for split in data.splits:
        await validate_category_ownership(db, split.category_id, household_id)

    txn.is_split = True
    txn.category_id = None

    for split in data.splits:
        sub = Transaction(
            account_id=txn.account_id,
            date=txn.date,
            payee_id=txn.payee_id,
            amount=split.amount,
            category_id=split.category_id,
            notes=split.notes,
            cleared=txn.cleared,
            parent_transaction_id=txn.id,
        )
        db.add(sub)

    await db.flush()
    asyncio.create_task(emit_event(household_id, "transaction.updated"))
    return await _enrich_transaction(db, txn)


@router.get("/{transaction_id}/splits", response_model=list[TransactionResponse])
async def get_splits(
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

    subs_result = await db.execute(
        select(Transaction)
        .where(Transaction.parent_transaction_id == transaction_id)
        .order_by(Transaction.amount)
    )
    return await _enrich_transactions(db, subs_result.scalars().all())


class TransferRequest(BaseModel):
    from_account_id: str
    to_account_id: str
    amount: Decimal
    date: date
    notes: Optional[str] = None


@router.post("/transfer", response_model=TransactionResponse)
async def create_transfer(
    data: TransferRequest,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    for acct_id in [data.from_account_id, data.to_account_id]:
        acct_result = await db.execute(
            select(Account).where(Account.id == acct_id, Account.household_id == household_id)
        )
        if not acct_result.scalar_one_or_none():
            raise HTTPException(status_code=404, detail=f"Account {acct_id} not found")

    import uuid
    pair_id = str(uuid.uuid4())

    outgoing = Transaction(
        account_id=data.from_account_id,
        date=data.date,
        amount=-abs(data.amount),
        notes=data.notes or "Transfer",
        cleared=True,
        transfer_pair_id=pair_id,
    )
    incoming = Transaction(
        account_id=data.to_account_id,
        date=data.date,
        amount=abs(data.amount),
        notes=data.notes or "Transfer",
        cleared=True,
        transfer_pair_id=pair_id,
    )
    db.add(outgoing)
    db.add(incoming)
    await db.flush()
    asyncio.create_task(emit_event(household_id, "transaction.created"))
    return await _enrich_transaction(db, outgoing)
