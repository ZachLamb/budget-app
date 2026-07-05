"""Connection-establishment retry in the get_db dependency.

Prod incident 2026-07-05: a memory-starved Postgres dropped connections
mid-establishment (asyncpg ConnectionDoesNotExistError inside connect), which
pool_pre_ping cannot catch — every affected request surfaced a raw 500.
_ensure_live_connection retries once before any handler statement runs and
maps persistent connect failure to a clean 503.
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy.exc import OperationalError, ProgrammingError

from app import database
from app.database import _ensure_live_connection


def _conn_error() -> OperationalError:
    return OperationalError(
        "SELECT 1", {}, Exception("connection was closed in the middle of operation"),
        connection_invalidated=True,
    )


class FakeSession:
    def __init__(self, failures: int, error_factory=_conn_error):
        self.failures = failures
        self.error_factory = error_factory
        self.calls = 0
        self.rollbacks = 0

    async def execute(self, _stmt):
        self.calls += 1
        if self.calls <= self.failures:
            raise self.error_factory()
        return None

    async def rollback(self):
        self.rollbacks += 1


@pytest.fixture(autouse=True)
def no_retry_delay(monkeypatch):
    monkeypatch.setattr(database, "_CONNECT_RETRY_DELAY_S", 0)


@pytest.mark.asyncio
async def test_transient_connect_failure_recovers_on_retry():
    session = FakeSession(failures=1)
    await _ensure_live_connection(session)
    assert session.calls == 2
    assert session.rollbacks == 1


@pytest.mark.asyncio
async def test_persistent_connect_failure_maps_to_503():
    session = FakeSession(failures=2)
    with pytest.raises(HTTPException) as exc_info:
        await _ensure_live_connection(session)
    assert exc_info.value.status_code == 503
    assert "try again" in exc_info.value.detail.lower()


@pytest.mark.asyncio
async def test_non_connection_errors_are_not_retried():
    def prog_error():
        return ProgrammingError("SELECT nope", {}, Exception("syntax error"))

    session = FakeSession(failures=2, error_factory=prog_error)
    with pytest.raises(ProgrammingError):
        await _ensure_live_connection(session)
    assert session.calls == 1  # no retry on non-connection failures
