from __future__ import annotations

from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc

from app.database import get_db
from app.api.deps import get_household_id, get_current_user
from app.config import get_settings
from app.models import SyncLog, User, Household
from app.schemas.sync import SyncLogResponse, SyncStatusResponse

router = APIRouter()


def _as_utc(dt: datetime) -> datetime:
    """Coerce a possibly tz-naive DB timestamp to UTC-aware for arithmetic."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


@router.get("/status", response_model=SyncStatusResponse)
async def get_sync_status(
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(SyncLog)
        .where(SyncLog.household_id == household_id)
        .order_by(desc(SyncLog.started_at))
        .limit(1)
    )
    last_sync = result.scalar_one_or_none()

    is_stale = True
    now = datetime.now(timezone.utc)
    if last_sync and last_sync.completed_at:
        age_minutes = (now - _as_utc(last_sync.completed_at)).total_seconds() / 60
        is_stale = age_minutes > get_settings().sync_stale_minutes

    # A sync stuck in_progress for >10 minutes is a crashed background task — treat as failed
    if last_sync and last_sync.status == "in_progress":
        age = now - _as_utc(last_sync.started_at)
        if age > timedelta(minutes=10):
            last_sync.status = "error"
            last_sync.error_message = "Sync timed out (no response within 10 minutes)"
            last_sync.completed_at = datetime.now(timezone.utc)
            await db.commit()

    syncing = last_sync.status == "in_progress" if last_sync else False

    return SyncStatusResponse(
        last_sync=SyncLogResponse.model_validate(last_sync) if last_sync else None,
        is_stale=is_stale,
        syncing=syncing,
    )


@router.post("/trigger", response_model=SyncLogResponse)
async def trigger_sync(
    background_tasks: BackgroundTasks,
    household_id: str = Depends(get_household_id),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.services.sync.manager import run_sync
    from fastapi import HTTPException

    household_result = await db.execute(
        select(Household).where(Household.id == household_id)
    )
    household = household_result.scalar_one_or_none()
    if not household or not household.simplefin_access_url:
        raise HTTPException(400, "SimpleFIN is not configured. Go to Settings to connect your bank.")

    # Atomic claim via the partial unique index — no check-then-insert race
    # with the scheduler or a double-clicked trigger button.
    from app.services.sync.claim import try_claim_sync

    sync_log = await try_claim_sync(db, household_id)
    if sync_log is None:
        raise HTTPException(409, "A sync is already in progress for this household")

    background_tasks.add_task(run_sync, household_id, sync_log.id)
    return SyncLogResponse.model_validate(sync_log)


@router.get("/history", response_model=list[SyncLogResponse])
async def get_sync_history(
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(SyncLog)
        .where(SyncLog.household_id == household_id)
        .order_by(desc(SyncLog.started_at))
        .limit(20)
    )
    return [SyncLogResponse.model_validate(s) for s in result.scalars().all()]
