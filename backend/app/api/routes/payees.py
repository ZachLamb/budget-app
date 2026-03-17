from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.api.deps import get_household_id
from app.models import Payee
from app.schemas.payee import PayeeCreate, PayeeUpdate, PayeeResponse
from app.utils import escape_like, validate_category_ownership, validate_account_ownership

router = APIRouter()


@router.get("", response_model=list[PayeeResponse])
async def list_payees(
    q: Optional[str] = Query(None, max_length=200),
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    query = select(Payee).where(Payee.household_id == household_id).order_by(Payee.name)
    if q:
        query = query.where(Payee.name.ilike(f"%{escape_like(q)}%"))
    result = await db.execute(query)
    return [PayeeResponse.model_validate(p) for p in result.scalars().all()]


@router.post("", response_model=PayeeResponse, status_code=201)
async def create_payee(
    data: PayeeCreate,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    existing = await db.execute(
        select(Payee).where(Payee.household_id == household_id, Payee.name == data.name)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Payee already exists")

    await validate_category_ownership(db, data.default_category_id, household_id)
    await validate_account_ownership(db, data.transfer_account_id, household_id)

    payee = Payee(household_id=household_id, **data.model_dump())
    db.add(payee)
    await db.flush()
    return PayeeResponse.model_validate(payee)


@router.put("/{payee_id}", response_model=PayeeResponse)
async def update_payee(
    payee_id: str,
    data: PayeeUpdate,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Payee).where(Payee.id == payee_id, Payee.household_id == household_id)
    )
    payee = result.scalar_one_or_none()
    if not payee:
        raise HTTPException(status_code=404, detail="Payee not found")
    updates = data.model_dump(exclude_unset=True)
    if "default_category_id" in updates:
        await validate_category_ownership(db, updates["default_category_id"], household_id)
    if "transfer_account_id" in updates:
        await validate_account_ownership(db, updates["transfer_account_id"], household_id)
    for field, value in updates.items():
        setattr(payee, field, value)
    return PayeeResponse.model_validate(payee)


@router.delete("/{payee_id}", status_code=204)
async def delete_payee(
    payee_id: str,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Payee).where(Payee.id == payee_id, Payee.household_id == household_id)
    )
    payee = result.scalar_one_or_none()
    if not payee:
        raise HTTPException(status_code=404, detail="Payee not found")
    await db.delete(payee)
