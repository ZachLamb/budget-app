"""Route tests for /api/payees/duplicates and /api/payees/merge.

Merge must reassign every transaction + recurring item from the source payees
to the target and then delete the sources, scoped to the caller's household.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest
import pytest_asyncio
import jwt
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.api.deps import ALGORITHM
from app.config import get_settings
from app.database import Base, get_db
from app.main import app
from app.middleware.rate_limit_store import InMemoryStore
from app.models import (
    Account,
    Household,
    Payee,
    RecurringTransaction,
    Transaction,
    User,
)


def _token_for(user_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=30)
    return jwt.encode(
        {"sub": user_id, "exp": expire}, get_settings().secret_key, algorithm=ALGORITHM
    )


@pytest_asyncio.fixture()
async def fixture():
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False)
    test_session = Session()

    async def _override_get_db():
        yield test_session

    app.dependency_overrides[get_db] = _override_get_db
    prior_store = getattr(app.state, "rate_limit_store", None)
    app.state.rate_limit_store = InMemoryStore()
    try:
        yield test_session
    finally:
        app.dependency_overrides.pop(get_db, None)
        await test_session.close()
        await engine.dispose()
        if prior_store is not None:
            app.state.rate_limit_store = prior_store


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _seed(session):
    hid, uid = str(uuid.uuid4()), str(uuid.uuid4())
    session.add(Household(id=hid, name="H"))
    session.add(User(
        id=uid, email=f"{uid}@t.io", name="T", password_hash=None,
        household_id=hid, role="owner", status="approved",
    ))
    acct = Account(id=str(uuid.uuid4()), household_id=hid, name="Checking", account_type="checking")
    canonical = Payee(id=str(uuid.uuid4()), household_id=hid, name="Blue Bottle")
    dup = Payee(id=str(uuid.uuid4()), household_id=hid, name="SQ *BLUE BOTTLE #4471")
    session.add_all([acct, canonical, dup])
    await session.flush()
    session.add(Transaction(
        id=str(uuid.uuid4()), account_id=acct.id, date=date(2026, 7, 1),
        payee_id=dup.id, amount=Decimal("-6.50"),
    ))
    session.add(RecurringTransaction(
        id=str(uuid.uuid4()), household_id=hid, payee_id=dup.id,
        amount=Decimal("-6.50"), frequency="monthly", next_date=date(2026, 8, 1),
        account_id=acct.id,
    ))
    await session.commit()
    headers = {"Authorization": f"Bearer {_token_for(uid)}"}
    return hid, headers, acct.id, canonical.id, dup.id


@pytest.mark.asyncio
async def test_duplicates_detects_cluster(fixture):
    session = fixture
    _, headers, _, canonical_id, dup_id = await _seed(session)
    async with _client() as client:
        resp = await client.get("/api/payees/duplicates", headers=headers)
    assert resp.status_code == 200
    clusters = resp.json()
    assert len(clusters) == 1
    c = clusters[0]
    assert c["canonical_id"] == canonical_id
    assert c["duplicate_ids"] == [dup_id]


@pytest.mark.asyncio
async def test_merge_reassigns_and_deletes_source(fixture):
    session = fixture
    _, headers, _, canonical_id, dup_id = await _seed(session)
    async with _client() as client:
        resp = await client.post(
            "/api/payees/merge",
            headers=headers,
            json={"target_id": canonical_id, "source_ids": [dup_id]},
        )
    assert resp.status_code == 200
    assert resp.json()["id"] == canonical_id

    # Source payee gone; its transaction + recurring now point at the target.
    remaining = (await session.execute(select(Payee.id))).scalars().all()
    assert dup_id not in remaining
    assert canonical_id in remaining
    txn_payees = (await session.execute(select(Transaction.payee_id))).scalars().all()
    assert txn_payees == [canonical_id]
    rec_payees = (await session.execute(select(RecurringTransaction.payee_id))).scalars().all()
    assert rec_payees == [canonical_id]


@pytest.mark.asyncio
async def test_merge_rejects_target_in_sources(fixture):
    session = fixture
    _, headers, _, canonical_id, _ = await _seed(session)
    async with _client() as client:
        resp = await client.post(
            "/api/payees/merge",
            headers=headers,
            json={"target_id": canonical_id, "source_ids": [canonical_id]},
        )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_merge_rejects_foreign_payee(fixture):
    session = fixture
    _, headers, _, canonical_id, _ = await _seed(session)
    async with _client() as client:
        resp = await client.post(
            "/api/payees/merge",
            headers=headers,
            json={"target_id": canonical_id, "source_ids": [str(uuid.uuid4())]},
        )
    assert resp.status_code == 404
