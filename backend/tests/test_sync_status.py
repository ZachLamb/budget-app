"""GET /api/sync/status — timezone-safe stale/in-progress handling."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.api.routes import sync as sync_routes
from app.models.sync import SyncLog


def _sync_log(**kwargs) -> SyncLog:
    row = SyncLog(
        id="log-1",
        household_id="hh-1",
        provider="simplefin",
        status="success",
        accounts_synced=1,
        transactions_imported=2,
    )
    for key, value in kwargs.items():
        setattr(row, key, value)
    return row


@pytest.mark.asyncio
async def test_get_sync_status_naive_completed_at_does_not_500(monkeypatch):
    """SQLite (and some drivers) return naive datetimes — must not crash stale math."""
    # App stores UTC without tzinfo; compare like sync route (_as_utc).
    naive_completed = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=5)
    last = _sync_log(
        status="success",
        started_at=naive_completed - timedelta(minutes=1),
        completed_at=naive_completed,
    )

    result_mock = MagicMock()
    result_mock.scalar_one_or_none.return_value = last
    db = AsyncMock()
    db.execute = AsyncMock(return_value=result_mock)

    settings = MagicMock()
    settings.sync_stale_minutes = 60
    monkeypatch.setattr(sync_routes, "get_settings", lambda: settings)

    out = await sync_routes.get_sync_status(household_id="hh-1", db=db)

    assert out.is_stale is False
    assert out.last_sync is not None
    assert out.syncing is False


@pytest.mark.asyncio
async def test_get_sync_status_stuck_in_progress_marked_error(monkeypatch):
    naive_started = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=15)
    last = _sync_log(
        status="in_progress",
        started_at=naive_started,
        completed_at=None,
    )

    result_mock = MagicMock()
    result_mock.scalar_one_or_none.return_value = last
    db = AsyncMock()
    db.execute = AsyncMock(return_value=result_mock)
    db.commit = AsyncMock()

    settings = MagicMock()
    settings.sync_stale_minutes = 60
    monkeypatch.setattr(sync_routes, "get_settings", lambda: settings)

    out = await sync_routes.get_sync_status(household_id="hh-1", db=db)

    assert last.status == "error"
    assert last.error_message is not None
    assert out.syncing is False
    db.commit.assert_awaited_once()
