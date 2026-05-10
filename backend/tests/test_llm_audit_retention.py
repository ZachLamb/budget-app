"""Tests for the LLM audit retention prune.

Backs the /privacy claim that ``llm_audit`` rows are retained for at most
30 days. Hits ``prune_old_audit_rows`` directly with an in-memory SQLite
database — no scheduler, no app fixture needed.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models.llm import LlmAudit
from app.services.ai.audit_retention import prune_old_audit_rows


@pytest_asyncio.fixture()
async def db_session() -> AsyncSession:
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False)
    async with Session() as s:
        yield s
    await engine.dispose()


def _audit_row(*, created_at: datetime, user_id: str = "u1") -> LlmAudit:
    return LlmAudit(
        user_id=user_id,
        feature="explain_charge",
        tier=4,
        status=200,
        prompt_tokens=10,
        completion_tokens=10,
        latency_ms=100,
        model="qwen2.5:7b",
        cache_hit=False,
        created_at=created_at,
    )


@pytest.mark.asyncio
async def test_prune_deletes_only_rows_older_than_30_days(db_session: AsyncSession):
    now = datetime.now(timezone.utc)
    # 3 ancient rows (well over 30d), 2 recent rows (well under 30d).
    db_session.add(_audit_row(created_at=now - timedelta(days=365)))
    db_session.add(_audit_row(created_at=now - timedelta(days=90)))
    db_session.add(_audit_row(created_at=now - timedelta(days=31)))
    db_session.add(_audit_row(created_at=now - timedelta(days=29)))
    db_session.add(_audit_row(created_at=now - timedelta(hours=1)))
    await db_session.commit()

    deleted = await prune_old_audit_rows(db_session)
    assert deleted == 3

    rows = (await db_session.execute(select(LlmAudit))).scalars().all()
    assert len(rows) == 2
    # Both survivors are inside the 30-day window. SQLite drops tzinfo on read,
    # so re-attach UTC before comparing — production (Postgres) preserves it.
    for r in rows:
        ts = r.created_at if r.created_at.tzinfo else r.created_at.replace(tzinfo=timezone.utc)
        assert (now - ts) < timedelta(days=30)


@pytest.mark.asyncio
async def test_prune_no_op_when_all_rows_recent(db_session: AsyncSession):
    now = datetime.now(timezone.utc)
    db_session.add(_audit_row(created_at=now - timedelta(hours=1)))
    db_session.add(_audit_row(created_at=now - timedelta(days=15)))
    await db_session.commit()

    deleted = await prune_old_audit_rows(db_session)
    assert deleted == 0

    count = len((await db_session.execute(select(LlmAudit))).scalars().all())
    assert count == 2


@pytest.mark.asyncio
async def test_prune_with_empty_table_returns_zero(db_session: AsyncSession):
    deleted = await prune_old_audit_rows(db_session)
    assert deleted == 0


@pytest.mark.asyncio
async def test_prune_respects_custom_max_age(db_session: AsyncSession):
    """Custom max_age lets us tune retention without touching the prune SQL."""
    now = datetime.now(timezone.utc)
    db_session.add(_audit_row(created_at=now - timedelta(days=8)))
    db_session.add(_audit_row(created_at=now - timedelta(days=2)))
    await db_session.commit()

    # 7-day window: the 8-day row goes, the 2-day row stays.
    deleted = await prune_old_audit_rows(db_session, max_age_days=7)
    assert deleted == 1

    rows = (await db_session.execute(select(LlmAudit))).scalars().all()
    assert len(rows) == 1
    ts = rows[0].created_at if rows[0].created_at.tzinfo else rows[0].created_at.replace(tzinfo=timezone.utc)
    assert (now - ts) < timedelta(days=7)


@pytest.mark.asyncio
async def test_prune_rejects_non_positive_max_age(db_session: AsyncSession):
    """Guard against an accidental ``max_age_days=0`` wiping the table."""
    with pytest.raises(ValueError):
        await prune_old_audit_rows(db_session, max_age_days=0)
    with pytest.raises(ValueError):
        await prune_old_audit_rows(db_session, max_age_days=-1)


@pytest.mark.asyncio
async def test_prune_is_per_row_not_per_user(db_session: AsyncSession):
    """Old rows for *any* user should be deleted; recent rows for *any* user kept."""
    now = datetime.now(timezone.utc)
    db_session.add(_audit_row(user_id="u1", created_at=now - timedelta(days=60)))
    db_session.add(_audit_row(user_id="u2", created_at=now - timedelta(days=60)))
    db_session.add(_audit_row(user_id="u1", created_at=now - timedelta(days=1)))
    db_session.add(_audit_row(user_id="u2", created_at=now - timedelta(days=1)))
    await db_session.commit()

    deleted = await prune_old_audit_rows(db_session)
    assert deleted == 2

    rows = (await db_session.execute(select(LlmAudit))).scalars().all()
    user_ids = sorted(r.user_id for r in rows)
    assert user_ids == ["u1", "u2"]
