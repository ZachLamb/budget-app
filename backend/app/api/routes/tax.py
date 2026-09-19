"""Tax profile, paystub, and prior-year CRUD.

Every query filters on household_id -- authorization is at the route
layer, and an id belonging to another household must 404 rather than
act. No tax math lives here.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Path, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_household_id
from app.database import get_db
from app.models import Paystub, PriorYearReturn, TaxProfile
from app.schemas.tax import (
    PaystubCreate,
    PaystubResponse,
    PriorYearReturnResponse,
    PriorYearReturnUpdate,
    TaxProfileResponse,
    TaxProfileUpdate,
)

router = APIRouter()


@router.get("/profile", response_model=TaxProfileResponse)
async def get_profile(
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    profile = (
        await db.execute(select(TaxProfile).where(TaxProfile.household_id == household_id))
    ).scalar_one_or_none()
    if profile is None:
        return TaxProfileResponse()
    return TaxProfileResponse.model_validate(profile)


@router.put("/profile", response_model=TaxProfileResponse)
async def put_profile(
    data: TaxProfileUpdate,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    profile = (
        await db.execute(select(TaxProfile).where(TaxProfile.household_id == household_id))
    ).scalar_one_or_none()
    updates = data.model_dump(exclude_unset=True)

    if profile is None:
        profile = TaxProfile(id=str(uuid.uuid4()), household_id=household_id, **updates)
        db.add(profile)
    else:
        for key, value in updates.items():
            setattr(profile, key, value)

    if "walkthrough_answers" in updates:
        profile.walkthrough_completed_at = datetime.now(timezone.utc)

    await db.flush()
    await db.refresh(profile)
    return TaxProfileResponse.model_validate(profile)


@router.get("/paystubs", response_model=list[PaystubResponse])
async def list_paystubs(
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Paystub)
        .where(Paystub.household_id == household_id)
        .order_by(Paystub.pay_date.desc())
    )
    return [PaystubResponse.model_validate(s) for s in result.scalars().all()]


@router.post("/paystubs", response_model=PaystubResponse, status_code=status.HTTP_201_CREATED)
async def create_paystub(
    data: PaystubCreate,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    existing = (
        await db.execute(
            select(Paystub).where(
                Paystub.household_id == household_id,
                Paystub.pay_date == data.pay_date,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A paystub for {data.pay_date} already exists.",
        )

    # Year-to-date figures only ever increase. A decrease means a typo or
    # the wrong year, and accepting it would quietly scale the entire
    # projection -- so flag it rather than absorbing it silently.
    if data.gross_ytd < data.gross:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Year-to-date gross ({data.gross_ytd}) is less than this "
                f"paystub's gross ({data.gross}). Check the year-to-date column."
            ),
        )

    prior = (
        await db.execute(
            select(Paystub)
            .where(
                Paystub.household_id == household_id,
                Paystub.pay_date < data.pay_date,
            )
            .order_by(Paystub.pay_date.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if prior is not None and data.gross_ytd < prior.gross_ytd:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Year-to-date gross ({data.gross_ytd}) is lower than the "
                f"previous paystub's ({prior.gross_ytd}). Year-to-date totals "
                "only go up -- check the date and the year-to-date column."
            ),
        )

    stub = Paystub(id=str(uuid.uuid4()), household_id=household_id, **data.model_dump())
    db.add(stub)
    await db.flush()
    await db.refresh(stub)
    return PaystubResponse.model_validate(stub)


@router.delete("/paystubs/{paystub_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_paystub(
    paystub_id: str,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    stub = (
        await db.execute(
            select(Paystub).where(
                Paystub.id == paystub_id,
                Paystub.household_id == household_id,
            )
        )
    ).scalar_one_or_none()
    if stub is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Paystub not found")
    await db.delete(stub)
    await db.flush()


@router.get("/prior-year/{year}", response_model=PriorYearReturnResponse)
async def get_prior_year(
    year: int = Path(ge=2000, le=2100),
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    prior = (
        await db.execute(
            select(PriorYearReturn).where(
                PriorYearReturn.household_id == household_id,
                PriorYearReturn.year == year,
            )
        )
    ).scalar_one_or_none()
    if prior is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No return recorded for that year")
    return PriorYearReturnResponse.model_validate(prior)


@router.put("/prior-year/{year}", response_model=PriorYearReturnResponse)
async def put_prior_year(
    data: PriorYearReturnUpdate,
    year: int = Path(ge=2000, le=2100),
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    prior = (
        await db.execute(
            select(PriorYearReturn).where(
                PriorYearReturn.household_id == household_id,
                PriorYearReturn.year == year,
            )
        )
    ).scalar_one_or_none()
    updates = data.model_dump(exclude_unset=True)

    if prior is None:
        prior = PriorYearReturn(
            id=str(uuid.uuid4()), household_id=household_id, year=year, **updates
        )
        db.add(prior)
    else:
        for key, value in updates.items():
            setattr(prior, key, value)

    await db.flush()
    await db.refresh(prior)
    return PriorYearReturnResponse.model_validate(prior)
