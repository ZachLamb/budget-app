"""The dev-only endpoint that writes the back-test fixture.

The file it writes describes a real person's filed return. Two things
matter more than the feature: it must be unreachable in production, and
the path it writes must not be influenced by anything a caller sends.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone

import jwt
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.api.deps import ALGORITHM
from app.config import get_settings
from app.database import Base, get_db
from app.main import app
from app.middleware.rate_limit_store import InMemoryStore
from app.models import Household, User


def _token_for(user_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=30)
    return jwt.encode(
        {"sub": user_id, "exp": expire}, get_settings().secret_key, algorithm=ALGORITHM
    )


@pytest_asyncio.fixture()
async def fixture(tmp_path, monkeypatch):
    from app.api.routes import backtest_fixture as mod

    # Never write the repo's real fixture from a test.
    monkeypatch.setattr(mod, "FIXTURE_PATH", tmp_path / "returns.local.json")

    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False)
    session = Session()

    async def _override_get_db():
        yield session

    app.dependency_overrides[get_db] = _override_get_db
    prior = getattr(app.state, "rate_limit_store", None)
    app.state.rate_limit_store = InMemoryStore()
    try:
        yield session, tmp_path / "returns.local.json"
    finally:
        app.dependency_overrides.pop(get_db, None)
        await session.close()
        await engine.dispose()
        if prior is not None:
            app.state.rate_limit_store = prior


async def _seed(session) -> dict:
    hid, uid = str(uuid.uuid4()), str(uuid.uuid4())
    session.add(Household(id=hid, name="H"))
    await session.flush()
    session.add(User(
        id=uid, email=f"{uid}@t.io", name="T", password_hash=None,
        household_id=hid, role="owner", status="approved",
    ))
    await session.commit()
    return {"Authorization": f"Bearer {_token_for(uid)}"}


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


BODY = {
    "returns": [{
        "year": 2026,
        "filing_status": "single",
        "wages": "179000.00",
        "actual_taxable_income": "162900.00",
        "actual_federal_income_tax": "31694.00",
    }]
}


@pytest.mark.asyncio
async def test_writes_the_fixture(fixture):
    session, path = fixture
    headers = await _seed(session)
    async with _client() as client:
        resp = await client.post("/api/dev/backtest-fixture", headers=headers, json=BODY)
    assert resp.status_code == 204, resp.text
    written = json.loads(path.read_text())
    assert written["returns"][0]["actual_taxable_income"] == "162900.00"
    # Absent figures are left out rather than written as null or zero.
    assert "pretax_hsa" not in written["returns"][0]


@pytest.mark.asyncio
async def test_refuses_when_a_production_marker_is_set(fixture, monkeypatch):
    """The file holds a real filed return; production must not write it."""
    session, path = fixture
    headers = await _seed(session)
    monkeypatch.setenv("ENVIRONMENT", "production")
    async with _client() as client:
        resp = await client.post("/api/dev/backtest-fixture", headers=headers, json=BODY)
    assert resp.status_code == 404
    assert not path.exists()


@pytest.mark.asyncio
async def test_requires_auth(fixture):
    async with _client() as client:
        resp = await client.post("/api/dev/backtest-fixture", json=BODY)
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_rejects_a_record_with_nothing_to_compare(fixture):
    """A return with no expected figure would pass the gate on nothing."""
    session, path = fixture
    headers = await _seed(session)
    async with _client() as client:
        resp = await client.post(
            "/api/dev/backtest-fixture",
            headers=headers,
            json={"returns": [{"year": 2026, "filing_status": "single", "wages": "1.00"}]},
        )
    assert resp.status_code == 400
    assert "passes on nothing" in resp.json()["detail"]
    assert not path.exists()


@pytest.mark.asyncio
async def test_rejects_a_money_field_that_is_not_a_number(fixture):
    session, path = fixture
    headers = await _seed(session)
    bad = {"returns": [dict(BODY["returns"][0], wages="; rm -rf /")]}
    async with _client() as client:
        resp = await client.post("/api/dev/backtest-fixture", headers=headers, json=bad)
    assert resp.status_code == 422
    assert not path.exists()
