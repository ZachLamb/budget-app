from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.api.deps import get_household_id
from app.schemas.deductions import DeductionsSummaryResponse
from app.services.deductions import compute_deductions_summary

router = APIRouter()


@router.get("/summary", response_model=DeductionsSummaryResponse)
async def get_deductions_summary(
    year: int = Query(default_factory=lambda: date.today().year),
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    return await compute_deductions_summary(db, household_id, year)
