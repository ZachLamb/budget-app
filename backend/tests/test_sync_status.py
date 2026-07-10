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


def _household(**kwargs):
    """Minimal household stand-in — the route only reads two attributes."""
    hh = MagicMock()
    hh.simplefin_access_url = kwargs.get("simplefin_access_url", "https://bank.example/access")
    hh.sync_interval_hours = kwargs.get("sync_interval_hours", 4)
    return hh


def _db_returning(last_sync, household):
    """Route queries the sync log first, then the household."""
    sync_result = MagicMock()
    sync_result.scalar_one_or_none.return_value = last_sync
    hh_result = MagicMock()
    hh_result.scalar_one_or_none.return_value = household
    db = AsyncMock()
    db.execute = AsyncMock(side_effect=[sync_result, hh_result])
    db.commit = AsyncMock()
    return db


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

    db = _db_returning(last, _household())

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

    db = _db_returning(last, _household())

    settings = MagicMock()
    settings.sync_stale_minutes = 60
    monkeypatch.setattr(sync_routes, "get_settings", lambda: settings)

    out = await sync_routes.get_sync_status(household_id="hh-1", db=db)

    assert last.status == "error"
    assert last.error_message is not None
    assert out.syncing is False
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_no_bank_connected_is_never_stale(monkeypatch):
    """Manual/CSV-only users (no SimpleFIN) must not be nagged to sync."""
    old = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=30)
    last = _sync_log(status="success", started_at=old, completed_at=old)

    db = _db_returning(last, _household(simplefin_access_url=None))

    settings = MagicMock()
    settings.sync_stale_minutes = 30
    monkeypatch.setattr(sync_routes, "get_settings", lambda: settings)

    out = await sync_routes.get_sync_status(household_id="hh-1", db=db)

    assert out.is_stale is False


@pytest.mark.asyncio
async def test_stale_threshold_respects_sync_interval(monkeypatch):
    """A sync younger than the auto-sync interval + grace is not stale."""
    # 2h old, interval 4h → well within the interval; must not be stale.
    completed = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=2)
    last = _sync_log(status="success", started_at=completed, completed_at=completed)

    db = _db_returning(last, _household(sync_interval_hours=4))

    settings = MagicMock()
    settings.sync_stale_minutes = 30  # old fixed threshold would (wrongly) flag stale
    monkeypatch.setattr(sync_routes, "get_settings", lambda: settings)

    out = await sync_routes.get_sync_status(household_id="hh-1", db=db)

    assert out.is_stale is False


@pytest.mark.asyncio
async def test_stale_when_older_than_interval_plus_grace(monkeypatch):
    """Beyond interval + grace, data is flagged stale as expected."""
    # 5h old, interval 4h, grace 30m → threshold 4.5h → stale.
    completed = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=5)
    last = _sync_log(status="success", started_at=completed, completed_at=completed)

    db = _db_returning(last, _household(sync_interval_hours=4))

    settings = MagicMock()
    settings.sync_stale_minutes = 30
    monkeypatch.setattr(sync_routes, "get_settings", lambda: settings)

    out = await sync_routes.get_sync_status(household_id="hh-1", db=db)

    assert out.is_stale is True
