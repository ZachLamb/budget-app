"""Unit tests for the cloud (Tier 4) consent helpers.

These hit the helper functions directly with an in-memory SQLite database —
they don't need the full app or an LLM backend. Verifies the grant/revoke
state machine and the cross-user isolation that the rest of the system
relies on.
"""
from __future__ import annotations

import os

import uuid

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models.household import Household
from app.models.user import User
from app.services.ai import consent as consent_service


@pytest_asyncio.fixture()
async def db_session() -> AsyncSession:
    """In-memory SQLite session with the full schema applied. StaticPool keeps
    the connection alive for the whole test so all queries see the same DB."""
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


async def _seed_user(s: AsyncSession, *, user_id: str = "u1", email: str = "u@example.com") -> User:
    # Find or create a single household per test session — multiple users can share it.
    from sqlalchemy import select

    existing = await s.execute(select(Household).limit(1))
    household = existing.scalar_one_or_none()
    if household is None:
        household = Household(id=uuid.uuid4().hex, name="Test")
        s.add(household)
        await s.flush()
    u = User(id=user_id, email=email, name="Test", household_id=household.id)
    s.add(u)
    await s.commit()
    return u


@pytest.mark.asyncio
async def test_grant_creates_active_row(db_session: AsyncSession):
    await _seed_user(db_session)
    row = await consent_service.grant_consent(db_session, "u1", "explain_charge")
    assert row.user_id == "u1"
    assert row.feature == "explain_charge"
    assert row.tier == 4
    assert row.revoked_at is None
    assert await consent_service.has_active_consent(db_session, "u1", "explain_charge")


@pytest.mark.asyncio
async def test_grant_is_idempotent_when_active(db_session: AsyncSession):
    await _seed_user(db_session)
    a = await consent_service.grant_consent(db_session, "u1", "explain_charge")
    b = await consent_service.grant_consent(db_session, "u1", "explain_charge")
    assert a.id == b.id  # same row, not a duplicate


@pytest.mark.asyncio
async def test_revoke_clears_active(db_session: AsyncSession):
    await _seed_user(db_session)
    await consent_service.grant_consent(db_session, "u1", "explain_charge")
    n = await consent_service.revoke_consent(db_session, "u1", "explain_charge")
    assert n == 1
    assert not await consent_service.has_active_consent(db_session, "u1", "explain_charge")


@pytest.mark.asyncio
async def test_revoke_then_grant_reactivates(db_session: AsyncSession):
    await _seed_user(db_session)
    await consent_service.grant_consent(db_session, "u1", "explain_charge")
    await consent_service.revoke_consent(db_session, "u1", "explain_charge")
    row = await consent_service.grant_consent(db_session, "u1", "explain_charge")
    assert row.revoked_at is None
    assert await consent_service.has_active_consent(db_session, "u1", "explain_charge")


@pytest.mark.asyncio
async def test_revoke_all_only_affects_active(db_session: AsyncSession):
    await _seed_user(db_session)
    await consent_service.grant_consent(db_session, "u1", "explain_charge")
    await consent_service.grant_consent(db_session, "u1", "spending_summary")
    n = await consent_service.revoke_all(db_session, "u1")
    assert n == 2
    rows = await consent_service.list_for_user(db_session, "u1")
    assert all(r.revoked_at is not None for r in rows)


@pytest.mark.asyncio
async def test_consent_is_per_user(db_session: AsyncSession):
    await _seed_user(db_session, user_id="u1", email="a@example.com")
    await _seed_user(db_session, user_id="u2", email="b@example.com")
    await consent_service.grant_consent(db_session, "u1", "explain_charge")
    assert await consent_service.has_active_consent(db_session, "u1", "explain_charge")
    assert not await consent_service.has_active_consent(db_session, "u2", "explain_charge")


@pytest.mark.asyncio
async def test_unknown_feature_rejected(db_session: AsyncSession):
    await _seed_user(db_session)
    with pytest.raises(ValueError):
        await consent_service.grant_consent(db_session, "u1", "made_up_feature")
    assert not await consent_service.has_active_consent(db_session, "u1", "made_up_feature")


@pytest.mark.asyncio
async def test_is_known_feature():
    assert consent_service.is_known_feature("explain_charge")
    assert consent_service.is_known_feature("financial_advice")
    assert not consent_service.is_known_feature("anything_else")
