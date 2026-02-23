from datetime import datetime, timezone
from fastapi import APIRouter, Depends, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc

from app.database import get_db
from app.api.deps import get_household_id, get_current_user
from app.config import get_settings
from app.models import SyncLog, User
from app.schemas.sync import SyncLogResponse, SyncStatusResponse

router = APIRouter()


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
    if last_sync and last_sync.completed_at:
        age_minutes = (datetime.now(timezone.utc) - last_sync.completed_at).total_seconds() / 60
        is_stale = age_minutes > get_settings().sync_stale_minutes

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

    sync_log = SyncLog(
        household_id=household_id,
        provider="simplefin",
        status="in_progress",
    )
    db.add(sync_log)
    await db.flush()
    await db.commit()

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
