"""Tests for CSV upload hardening (bounded read, UTF-8 decode errors).

Uses the in-memory SQLite + dependency_overrides pattern from
``test_facts_endpoints.py`` so the suite runs without a real DB.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
import jwt
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.api.deps import ALGORITHM
from app.config import get_settings
from app.database import Base, get_db
from app.main import app
from app.middleware.rate_limit_store import InMemoryStore
from app.models import Account, Household, User


def _token_for(user_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=30)
    return jwt.encode(
        {"sub": user_id, "exp": expire},
        get_settings().secret_key,
        algorithm=ALGORITHM,
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
        yield test_session, engine
    finally:
        app.dependency_overrides.pop(get_db, None)
        await test_session.close()
        await engine.dispose()
        if prior_store is not None:
            app.state.rate_limit_store = prior_store


async def _seed_user_with_account(db):
    hid = str(uuid.uuid4())
    uid = str(uuid.uuid4())
    account_id = str(uuid.uuid4())
    db.add(Household(id=hid, name="H"))
    db.add(User(
        id=uid, email=f"{uid}@t.io", name="T", password_hash=None,
        household_id=hid, role="owner", status="approved",
    ))
    db.add(Account(
        id=account_id, household_id=hid, name="Chk", account_type="checking",
    ))
    await db.commit()
    return hid, {"Authorization": f"Bearer {_token_for(uid)}"}, account_id


def _upload(client, headers, account_id, content: bytes, filename="t.csv"):
    return client.post(
        "/api/upload/csv",
        headers=headers,
        data={"account_id": account_id},
        files={"file": (filename, content, "text/csv")},
    )


@pytest.mark.asyncio
async def test_non_utf8_csv_returns_400(fixture):
    session, _ = fixture
    _, headers, account_id = await _seed_user_with_account(session)
    latin1 = "Date,Amount,Description\n2026-06-01,-12.34,Café\n".encode("latin-1")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await _upload(client, headers, account_id, latin1)
    assert resp.status_code == 400
    assert "UTF-8" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_oversize_csv_returns_413_without_full_read(fixture, monkeypatch):
    import app.api.routes.upload as upload_route
    monkeypatch.setattr(upload_route, "_MAX_CSV_BYTES", 64)
    session, _ = fixture
    _, headers, account_id = await _seed_user_with_account(session)
    big = b"Date,Amount,Description\n" + b"2026-06-01,-1.00,x\n" * 20
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await _upload(client, headers, account_id, big)
    assert resp.status_code == 413


@pytest.mark.asyncio
async def test_valid_generic_csv_imports(fixture):
    session, _ = fixture
    _, headers, account_id = await _seed_user_with_account(session)
    csv_bytes = b"Date,Amount,Description\n2026-06-01,-12.34,Coffee Shop\n2026-06-02,-8.00,Bakery\n"
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await _upload(client, headers, account_id, csv_bytes)
    assert resp.status_code == 200
    body = resp.json()
    assert body["imported"] == 2
    assert body["detected_format"] == "generic"
