from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.api.deps import get_household_id
from app.models import TaxSettings
from app.schemas.tax_settings import TaxSettingsUpdate, TaxSettingsResponse

router = APIRouter()


async def _get_or_create(db: AsyncSession, household_id: str) -> TaxSettings:
    result = await db.execute(select(TaxSettings).where(TaxSettings.household_id == household_id))
    settings = result.scalar_one_or_none()
    if settings is None:
        settings = TaxSettings(household_id=household_id)
        db.add(settings)
        await db.flush()
    return settings


@router.get("", response_model=TaxSettingsResponse)
async def get_tax_settings(
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    settings = await _get_or_create(db, household_id)
    await db.commit()
    return TaxSettingsResponse.model_validate(settings)


@router.put("", response_model=TaxSettingsResponse)
async def update_tax_settings(
    data: TaxSettingsUpdate,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    settings = await _get_or_create(db, household_id)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(settings, field, value)
    await db.commit()
    await db.refresh(settings)
    return TaxSettingsResponse.model_validate(settings)
