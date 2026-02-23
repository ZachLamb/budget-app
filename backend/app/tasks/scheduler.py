import asyncio
import logging
from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import select

from app.config import get_settings
from app.database import async_session
from app.models import Household, SyncLog
from app.services.sync.manager import run_sync

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()


async def scheduled_sync():
    """Sync all active households."""
    settings = get_settings()
    if not settings.simplefin_access_url:
        return

    async with async_session() as db:
        result = await db.execute(select(Household))
        households = result.scalars().all()

        for household in households:
            sync_log = SyncLog(
                household_id=household.id,
                provider="simplefin",
                status="in_progress",
            )
            db.add(sync_log)
            await db.flush()
            await db.commit()

            try:
                await run_sync(household.id, sync_log.id)
                logger.info(f"Scheduled sync completed for household {household.id}")
            except Exception as e:
                logger.error(f"Scheduled sync failed for household {household.id}: {e}")


def start_scheduler():
    settings = get_settings()
    scheduler.add_job(
        scheduled_sync,
        "interval",
        hours=settings.sync_interval_hours,
        id="periodic_sync",
        replace_existing=True,
    )
    scheduler.start()
    logger.info(f"Scheduler started: syncing every {settings.sync_interval_hours} hours")


def stop_scheduler():
    scheduler.shutdown()
