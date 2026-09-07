from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.database import get_db
from app.api.deps import get_household_id
from app.models import TaxSettings
from app.schemas.tax_settings import TaxSettingsUpdate, TaxSettingsResponse

router = APIRouter()


async def _get(db: AsyncSession, household_id: str) -> TaxSettings | None:
    result = await db.execute(select(TaxSettings).where(TaxSettings.household_id == household_id))
    return result.scalar_one_or_none()


@router.get("", response_model=TaxSettingsResponse)
async def get_tax_settings(
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    settings = await _get(db, household_id)
    if settings is None:
        # Pure read: no row for this household yet — return all-nulls
        # WITHOUT inserting anything. GET must be side-effect-free.
        return TaxSettingsResponse(
            marginal_federal_rate=None,
            marginal_state_rate=None,
            current_federal_withholding_per_period=None,
            remaining_pay_periods_this_year=None,
        )
    return TaxSettingsResponse.model_validate(settings)


@router.put("", response_model=TaxSettingsResponse)
async def update_tax_settings(
    data: TaxSettingsUpdate,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    updates = data.model_dump(exclude_unset=True)
    settings = await _get(db, household_id)
    if settings is None:
        settings = TaxSettings(household_id=household_id, **updates)
        db.add(settings)
        try:
            await db.flush()
        except IntegrityError:
            # A concurrent PUT already created the row (unique household_id
            # constraint). Roll back this insert, re-select the existing
            # row, and apply our update to it instead of crashing.
            await db.rollback()
            settings = await _get(db, household_id)
            assert settings is not None
            for field, value in updates.items():
                setattr(settings, field, value)
    else:
        for field, value in updates.items():
            setattr(settings, field, value)
    await db.commit()
    await db.refresh(settings)
    return TaxSettingsResponse.model_validate(settings)
