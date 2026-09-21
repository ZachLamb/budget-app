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


async def _check_paystub_is_sane(
    db: AsyncSession,
    household_id: str,
    data: PaystubCreate,
    *,
    excluding_id: str | None = None,
) -> None:
    """Shared by create and edit -- a correction deserves the same checks
    as an entry, or the edit route becomes the way to smuggle in the very
    typo these catch."""
    clash = select(Paystub).where(
        Paystub.household_id == household_id,
        Paystub.pay_date == data.pay_date,
    )
    if excluding_id is not None:
        clash = clash.where(Paystub.id != excluding_id)
    if (await db.execute(clash)).scalar_one_or_none() is not None:
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

    previous = select(Paystub).where(
        Paystub.household_id == household_id,
        Paystub.pay_date < data.pay_date,
    )
    if excluding_id is not None:
        previous = previous.where(Paystub.id != excluding_id)
    prior = (
        await db.execute(previous.order_by(Paystub.pay_date.desc()).limit(1))
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


@router.post("/paystubs", response_model=PaystubResponse, status_code=status.HTTP_201_CREATED)
async def create_paystub(
    data: PaystubCreate,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    await _check_paystub_is_sane(db, household_id, data)

    stub = Paystub(id=str(uuid.uuid4()), household_id=household_id, **data.model_dump())
    db.add(stub)
    await db.flush()
    await db.refresh(stub)
    return PaystubResponse.model_validate(stub)


@router.put("/paystubs/{paystub_id}", response_model=PaystubResponse)
async def update_paystub(
    paystub_id: str,
    data: PaystubCreate,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    """Correcting one figure should not cost the other fifteen -- deleting
    and re-entering is where the next typo comes from."""
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

    await _check_paystub_is_sane(db, household_id, data, excluding_id=paystub_id)

    for field, value in data.model_dump().items():
        setattr(stub, field, value)
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


from datetime import date as _date
from decimal import Decimal

from fastapi import Query

from app.schemas.tax import (
    ImpactRequest, ImpactResponse, ProjectionEnvelope, TaxProjectionResponse,
)
from app.services.tax import (
    ExtraBusinessExpense, ExtraItemizedDeduction, ExtraPretax401k,
    ExtraPretaxHsa, ExtraWages, UnknownTaxYearError,
    UnsupportedFilingStatusError, get_rates, impact_of, project,
)
from app.services.tax_assembly import build_tax_inputs

_CHANGE_TYPES = {
    "extra_wages": ExtraWages,
    "extra_pretax_401k": ExtraPretax401k,
    "extra_pretax_hsa": ExtraPretaxHsa,
    "extra_business_expense": ExtraBusinessExpense,
    "extra_itemized_deduction": ExtraItemizedDeduction,
}


def _rates_or_422(year: int):
    try:
        return get_rates(year)
    except UnknownTaxYearError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/projection", response_model=ProjectionEnvelope)
async def get_projection(
    year: int = Query(default_factory=lambda: _date.today().year, ge=2000, le=2100),
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    rates = _rates_or_422(year)
    supported = sorted(str(s) for s in rates.supported_statuses)
    assembled = await build_tax_inputs(db, household_id, year)
    if assembled.inputs is None:
        return ProjectionEnvelope(
            year=year,
            available=False,
            missing=assembled.missing,
            supported_filing_statuses=supported,
        )

    try:
        projection = project(assembled.inputs, rates, assembled.remaining_periods)
    except UnsupportedFilingStatusError:
        # A filing status we cannot compute is a data state, not a bad
        # request. Raising here replaced the entire Taxes page with an
        # engine message and a Retry button that could never succeed, and
        # took the walkthrough -- the only way to correct the status --
        # down with it.
        return ProjectionEnvelope(
            year=year,
            available=False,
            missing=[*assembled.missing, "unsupported_filing_status"],
            supported_filing_statuses=supported,
        )

    return ProjectionEnvelope(
        year=year,
        available=True,
        missing=assembled.missing,
        remaining_pay_periods=assembled.remaining_periods,
        projection=TaxProjectionResponse.model_validate(projection, from_attributes=True),
        supported_filing_statuses=supported,
    )


@router.post("/impact", response_model=ImpactResponse)
async def post_impact(
    data: ImpactRequest,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    rates = _rates_or_422(data.year)
    assembled = await build_tax_inputs(db, household_id, data.year)
    if assembled.inputs is None:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot compute impact yet. Still needed: {', '.join(assembled.missing)}",
        )

    change = _CHANGE_TYPES[data.kind](data.amount)
    try:
        dollars = impact_of(assembled.inputs, change, rates)
    except UnsupportedFilingStatusError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    blended = (dollars / data.amount * Decimal("100")).quantize(Decimal("0.01"))
    if dollars > 0:
        note = f"Adds ${dollars} in tax across this ${data.amount}."
    elif dollars < 0:
        note = f"Saves ${-dollars} in tax across this ${data.amount}."
    else:
        note = (
            f"Changes your tax by nothing. ${data.amount} here is worth "
            "$0 to you this year."
        )

    return ImpactResponse(
        kind=data.kind,
        change_amount=data.amount,
        amount_of_tax=dollars,
        blended_rate_percent=blended,
        note=note,
    )
