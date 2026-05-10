from __future__ import annotations

"""Retention pruning for the LLM audit log.

The privacy page promises that ``llm_audit`` rows are kept for at most 30
days. The audit table stores metadata only (no prompt/completion text), but
"metadata only" is still personal data — feature usage patterns reveal what
a user is asking the AI to do. Bounded retention is the contract.

This module owns the delete query. The scheduler in ``app.tasks.scheduler``
calls :func:`prune_old_audit_rows` on an hourly job; tests call it directly
against an in-memory DB.

Failures here are logged and re-raised — the scheduler wrapper swallows
them so a transient DB blip doesn't kill the AsyncIOScheduler thread.
"""

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session
from app.models.llm import LlmAudit

logger = logging.getLogger(__name__)

# Default retention window. Aligns with the wording on /privacy.
DEFAULT_MAX_AGE_DAYS = 30


async def prune_old_audit_rows(
    db: AsyncSession,
    *,
    max_age_days: int = DEFAULT_MAX_AGE_DAYS,
) -> int:
    """Delete ``llm_audit`` rows older than ``max_age_days``.

    Returns the number of rows deleted. Commits on success; on failure the
    caller's transaction state is left to them (we re-raise after logging).
    """
    if max_age_days <= 0:
        raise ValueError(f"max_age_days must be > 0, got {max_age_days}")

    cutoff = datetime.now(timezone.utc) - timedelta(days=max_age_days)
    stmt = delete(LlmAudit).where(LlmAudit.created_at < cutoff)
    result = await db.execute(stmt)
    await db.commit()
    deleted = result.rowcount or 0
    if deleted:
        logger.info(
            "llm_audit retention prune: deleted %d row(s) older than %s",
            deleted,
            cutoff.isoformat(),
        )
    return deleted


async def scheduled_prune_audit() -> None:
    """Scheduler entry point — opens its own session, never raises.

    Designed to be registered with :class:`AsyncIOScheduler`. Errors are
    logged but not propagated, because an exception in a scheduler job
    silently kills future runs of that job in some apscheduler versions.
    """
    try:
        async with async_session() as db:
            await prune_old_audit_rows(db)
    except Exception as e:  # pragma: no cover — defensive logging only
        logger.warning("Scheduled llm_audit prune failed: %s", e)
