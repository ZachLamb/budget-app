from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.api.deps import get_household_id
from app.models import Payee
from app.schemas.payee import PayeeCreate, PayeeUpdate, PayeeResponse

router = APIRouter()


@router.get("/", response_model=list[PayeeResponse])
async def list_payees(
    q: str | None = None,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    query = select(Payee).where(Payee.household_id == household_id).order_by(Payee.name)
    if q:
        query = query.where(Payee.name.ilike(f"%{q}%"))
    result = await db.execute(query)
    return [PayeeResponse.model_validate(p) for p in result.scalars().all()]


@router.post("/", response_model=PayeeResponse, status_code=201)
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
    for field, value in data.model_dump(exclude_unset=True).items():
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
