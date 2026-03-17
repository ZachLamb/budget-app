from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.api.deps import get_household_id
from app.models import RecurringTransaction, Payee, Category, Account
from app.schemas.recurring import RecurringCreate, RecurringUpdate, RecurringResponse
from app.utils import validate_category_ownership, validate_payee_ownership, validate_account_ownership

router = APIRouter()


async def _enrich(db: AsyncSession, r: RecurringTransaction) -> RecurringResponse:
    resp = RecurringResponse.model_validate(r)
    if r.payee_id:
        result = await db.execute(select(Payee.name).where(Payee.id == r.payee_id))
        resp.payee_name = result.scalar_one_or_none()
    if r.category_id:
        result = await db.execute(select(Category.name).where(Category.id == r.category_id))
        resp.category_name = result.scalar_one_or_none()
    if r.account_id:
        result = await db.execute(select(Account.name).where(Account.id == r.account_id))
        resp.account_name = result.scalar_one_or_none()
    return resp


async def _enrich_list(db: AsyncSession, items: list) -> list[RecurringResponse]:
    payee_ids = {r.payee_id for r in items if r.payee_id}
    cat_ids = {r.category_id for r in items if r.category_id}
    acct_ids = {r.account_id for r in items if r.account_id}

    payee_names: dict[str, str] = {}
    if payee_ids:
        result = await db.execute(select(Payee.id, Payee.name).where(Payee.id.in_(payee_ids)))
        payee_names = dict(result.all())

    cat_names: dict[str, str] = {}
    if cat_ids:
        result = await db.execute(select(Category.id, Category.name).where(Category.id.in_(cat_ids)))
        cat_names = dict(result.all())

    acct_names: dict[str, str] = {}
    if acct_ids:
        result = await db.execute(select(Account.id, Account.name).where(Account.id.in_(acct_ids)))
        acct_names = dict(result.all())

    enriched = []
    for r in items:
        resp = RecurringResponse.model_validate(r)
        if r.payee_id:
            resp.payee_name = payee_names.get(r.payee_id)
        if r.category_id:
            resp.category_name = cat_names.get(r.category_id)
        if r.account_id:
            resp.account_name = acct_names.get(r.account_id)
        enriched.append(resp)
    return enriched


@router.get("", response_model=list[RecurringResponse])
async def list_recurring(
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(RecurringTransaction)
        .where(RecurringTransaction.household_id == household_id)
        .order_by(RecurringTransaction.next_date)
    )
    return await _enrich_list(db, result.scalars().all())


@router.post("", response_model=RecurringResponse, status_code=201)
async def create_recurring(
    data: RecurringCreate,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    valid_frequencies = {"weekly", "biweekly", "monthly", "quarterly", "yearly"}
    if data.frequency not in valid_frequencies:
        raise HTTPException(status_code=400, detail=f"Frequency must be one of: {', '.join(valid_frequencies)}")

    await validate_category_ownership(db, data.category_id, household_id)
    await validate_payee_ownership(db, data.payee_id, household_id)
    await validate_account_ownership(db, data.account_id, household_id)

    rec = RecurringTransaction(household_id=household_id, **data.model_dump())
    db.add(rec)
    await db.flush()
    return await _enrich(db, rec)


@router.put("/{recurring_id}", response_model=RecurringResponse)
async def update_recurring(
    recurring_id: str,
    data: RecurringUpdate,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(RecurringTransaction)
        .where(RecurringTransaction.id == recurring_id, RecurringTransaction.household_id == household_id)
    )
    rec = result.scalar_one_or_none()
    if not rec:
        raise HTTPException(status_code=404, detail="Recurring transaction not found")
    updates = data.model_dump(exclude_unset=True)
    if "category_id" in updates:
        await validate_category_ownership(db, updates["category_id"], household_id)
    if "payee_id" in updates:
        await validate_payee_ownership(db, updates["payee_id"], household_id)
    if "account_id" in updates:
        await validate_account_ownership(db, updates["account_id"], household_id)
    for field, value in updates.items():
        setattr(rec, field, value)
    return await _enrich(db, rec)


@router.delete("/{recurring_id}", status_code=204)
async def delete_recurring(
    recurring_id: str,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(RecurringTransaction)
        .where(RecurringTransaction.id == recurring_id, RecurringTransaction.household_id == household_id)
    )
    rec = result.scalar_one_or_none()
    if not rec:
        raise HTTPException(status_code=404, detail="Recurring transaction not found")
    await db.delete(rec)
