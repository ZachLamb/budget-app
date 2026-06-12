import logging
from datetime import datetime, timedelta, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import select, desc

from app.database import async_session
from app.models import Household, SyncLog
from app.services.ai.audit_retention import scheduled_prune_audit
from app.services.sync.claim import try_claim_sync
from app.services.sync.manager import run_sync

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()

# 0 = manual only (never auto-sync)
SYNC_INTERVAL_MANUAL = 0


async def scheduled_sync():
    """Check all households and sync those whose interval has elapsed."""
    async with async_session() as db:
        result = await db.execute(
            select(Household).where(Household.simplefin_access_url.isnot(None))
        )
        households = result.scalars().all()

    if not households:
        logger.debug("Scheduled sync: no households with SimpleFIN configured")
        return

    now = datetime.now(timezone.utc)

    for household in households:
        if household.sync_interval_hours == SYNC_INTERVAL_MANUAL:
            continue

        async with async_session() as db:
            # Check if enough time has elapsed since last completed sync
            last_result = await db.execute(
                select(SyncLog)
                .where(
                    SyncLog.household_id == household.id,
                    SyncLog.completed_at.isnot(None),
                )
                .order_by(desc(SyncLog.completed_at))
                .limit(1)
            )
            last_log = last_result.scalar_one_or_none()
            if last_log and last_log.completed_at:
                elapsed = now - last_log.completed_at
                if elapsed < timedelta(hours=household.sync_interval_hours):
                    continue

            # Atomic claim: the partial unique index on sync_log guarantees a
            # concurrent claimer (manual trigger or another replica) loses.
            sync_log = await try_claim_sync(db, household.id)
            if sync_log is None:
                logger.info("Scheduled sync: skipping household %s (sync already in progress)", household.id)
                continue
            sync_log_id = sync_log.id

        try:
            await run_sync(household.id, sync_log_id)
            logger.info("Scheduled sync completed for household %s", household.id)
        except Exception as e:
            logger.error("Scheduled sync failed for household %s: %s", household.id, e)


def start_scheduler():
    scheduler.add_job(
        scheduled_sync,
        "interval",
        hours=1,
        id="periodic_sync",
        replace_existing=True,
    )
    # Hourly prune of llm_audit rows older than 30 days. Backs the retention
    # claim on /privacy. The job opens its own session and swallows errors so
    # a transient DB issue doesn't kill the scheduler thread.
    scheduler.add_job(
        scheduled_prune_audit,
        "interval",
        hours=1,
        id="prune_llm_audit",
        replace_existing=True,
    )
    scheduler.start()
    logger.info(
        "Scheduler started: checking for due syncs every hour; "
        "pruning llm_audit hourly"
    )


def stop_scheduler():
    scheduler.shutdown()
