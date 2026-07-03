"""Route-level CRUD + cross-household isolation for transactions.

Uses the in-memory SQLite + dependency_overrides pattern from
``test_facts_endpoints.py`` so the suite runs without a real DB.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

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


@pytest.mark.asyncio
async def test_create_list_update_delete_transaction(fixture):
    session, _ = fixture
    _, headers, account_id = await _seed_user_with_account(session)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        created = await client.post("/api/transactions", headers=headers, json={
            "account_id": account_id, "date": "2026-06-15",
            "payee_name": "Coffee Shop", "amount": "-4.50", "cleared": True,
        })
        assert created.status_code == 201
        txn = created.json()
        assert Decimal(str(txn["amount"])) == Decimal("-4.50")
        assert txn["payee_name"] == "Coffee Shop"

        listed = await client.get("/api/transactions", headers=headers)
        assert listed.status_code == 200
        assert any(t["id"] == txn["id"] for t in listed.json()["transactions"])

        updated = await client.put(f"/api/transactions/{txn['id']}", headers=headers,
                                   json={"notes": "morning latte"})
        assert updated.status_code == 200
        assert updated.json()["notes"] == "morning latte"

        deleted = await client.delete(f"/api/transactions/{txn['id']}", headers=headers)
        assert deleted.status_code == 204
        gone = await client.get(f"/api/transactions/{txn['id']}", headers=headers)
        assert gone.status_code == 404


@pytest.mark.asyncio
async def test_cross_household_isolation(fixture):
    session, _ = fixture
    _, headers_a, account_a = await _seed_user_with_account(session)
    _, headers_b, _ = await _seed_user_with_account(session)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        created = await client.post("/api/transactions", headers=headers_a, json={
            "account_id": account_a, "date": "2026-06-15",
            "payee_name": "Private", "amount": "-10.00",
        })
        txn_id = created.json()["id"]

        assert (await client.get(f"/api/transactions/{txn_id}", headers=headers_b)).status_code == 404
        assert (await client.put(f"/api/transactions/{txn_id}", headers=headers_b,
                                 json={"notes": "hijack"})).status_code == 404
        assert (await client.delete(f"/api/transactions/{txn_id}", headers=headers_b)).status_code == 404
        assert (await client.post("/api/transactions", headers=headers_b, json={
            "account_id": account_a, "date": "2026-06-15", "amount": "-1.00",
        })).status_code == 404
