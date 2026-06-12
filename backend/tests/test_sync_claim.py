"""Atomic sync-claim behavior backed by the partial unique index."""
from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import Household, SyncLog
from app.services.sync.claim import try_claim_sync


@pytest_asyncio.fixture()
async def db_env():
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False)

    async with Session() as db:
        household = Household(name="HH")
        db.add(household)
        await db.commit()
        hh_id = household.id

    try:
        yield Session, hh_id
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_second_claim_fails_while_first_in_progress(db_env):
    Session, hh_id = db_env

    async with Session() as db:
        first = await try_claim_sync(db, hh_id)
        assert first is not None

    async with Session() as db:
        second = await try_claim_sync(db, hh_id)
        assert second is None

    # Exactly one in_progress row exists.
    async with Session() as db:
        rows = (
            await db.execute(
                select(SyncLog).where(
                    SyncLog.household_id == hh_id, SyncLog.status == "in_progress"
                )
            )
        ).scalars().all()
        assert len(rows) == 1


@pytest.mark.asyncio
async def test_claim_succeeds_after_previous_sync_completes(db_env):
    Session, hh_id = db_env

    async with Session() as db:
        first = await try_claim_sync(db, hh_id)
        assert first is not None
        first.status = "success"
        await db.commit()

    async with Session() as db:
        second = await try_claim_sync(db, hh_id)
        assert second is not None


@pytest.mark.asyncio
async def test_claims_are_independent_per_household(db_env):
    Session, hh_id = db_env

    async with Session() as db:
        other = Household(name="Other")
        db.add(other)
        await db.commit()
        other_id = other.id

    async with Session() as db:
        assert await try_claim_sync(db, hh_id) is not None
    async with Session() as db:
        assert await try_claim_sync(db, other_id) is not None
