"""Atomic claim of the per-household "sync in progress" slot.

The partial unique index ``uq_sync_log_household_in_progress`` allows at most
one ``in_progress`` SyncLog row per household. Inserting the row IS the lock
acquisition — a concurrent claimer hits an IntegrityError instead of starting
a duplicate sync. This closes the check-then-insert race the scheduler and
the manual trigger route used to have.
"""
from __future__ import annotations

import logging

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import SyncLog

logger = logging.getLogger(__name__)


async def try_claim_sync(db: AsyncSession, household_id: str) -> SyncLog | None:
    """Insert an in_progress SyncLog; None if another sync holds the slot.

    Commits on success. On conflict the session is rolled back and is safe
    to keep using.
    """
    sync_log = SyncLog(
        household_id=household_id,
        provider="simplefin",
        status="in_progress",
    )
    db.add(sync_log)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        logger.info("Sync claim conflict for household %s (already in progress)", household_id)
        return None
    return sync_log
