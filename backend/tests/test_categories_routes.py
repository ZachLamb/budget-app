"""Route tests for /api/categories: validation, ordering, usage, smart delete, reorder."""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
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
from app.models import (
    Account,
    AutoCategorizationRule,
    BudgetAssignment,
    Category,
    CategoryGroup,
    Household,
    Payee,
    RecurringTransaction,
    Transaction,
    User,
)


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


async def _seed_household(session) -> tuple[str, dict]:
    hid = str(uuid.uuid4())
    uid = str(uuid.uuid4())
    session.add(Household(id=hid, name="H"))
    session.add(User(
        id=uid, email=f"{uid}@t.io", name="T", password_hash=None,
        household_id=hid, role="owner", status="approved",
    ))
    await session.commit()
    return hid, {"Authorization": f"Bearer {_token_for(uid)}"}


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.mark.asyncio
async def test_group_name_blank_or_whitespace_rejected(fixture):
    session, _ = fixture
    _, headers = await _seed_household(session)
    async with _client() as client:
        for bad in ("", "   "):
            resp = await client.post("/api/categories/groups", headers=headers, json={"name": bad})
            assert resp.status_code == 422, f"expected 422 for name {bad!r}"


@pytest.mark.asyncio
async def test_group_name_too_long_rejected(fixture):
    session, _ = fixture
    _, headers = await _seed_household(session)
    async with _client() as client:
        resp = await client.post("/api/categories/groups", headers=headers, json={"name": "x" * 256})
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_group_name_whitespace_stripped(fixture):
    session, _ = fixture
    _, headers = await _seed_household(session)
    async with _client() as client:
        resp = await client.post("/api/categories/groups", headers=headers, json={"name": "  Bills  "})
    assert resp.status_code == 201
    assert resp.json()["name"] == "Bills"


@pytest.mark.asyncio
async def test_category_name_validation(fixture):
    session, _ = fixture
    _, headers = await _seed_household(session)
    async with _client() as client:
        grp = await client.post("/api/categories/groups", headers=headers, json={"name": "Everyday"})
        gid = grp.json()["id"]
        blank = await client.post("/api/categories", headers=headers, json={"group_id": gid, "name": "  "})
        assert blank.status_code == 422
        ok = await client.post("/api/categories", headers=headers, json={"group_id": gid, "name": " Groceries "})
        assert ok.status_code == 201
        assert ok.json()["name"] == "Groceries"
        update = await client.put(f"/api/categories/{ok.json()['id']}", headers=headers, json={"name": ""})
        assert update.status_code == 422


@pytest.mark.asyncio
async def test_new_groups_append_in_creation_order(fixture):
    session, _ = fixture
    _, headers = await _seed_household(session)
    async with _client() as client:
        for name in ("Alpha", "Beta", "Gamma"):
            resp = await client.post("/api/categories/groups", headers=headers, json={"name": name})
            assert resp.status_code == 201
        listing = await client.get("/api/categories/groups", headers=headers)
    body = listing.json()
    assert [g["name"] for g in body] == ["Alpha", "Beta", "Gamma"]
    assert [g["sort_order"] for g in body] == [0, 1, 2]


@pytest.mark.asyncio
async def test_new_categories_append_in_creation_order(fixture):
    session, _ = fixture
    _, headers = await _seed_household(session)
    async with _client() as client:
        grp = await client.post("/api/categories/groups", headers=headers, json={"name": "Everyday"})
        gid = grp.json()["id"]
        for name in ("Groceries", "Dining", "Fun"):
            resp = await client.post("/api/categories", headers=headers, json={"group_id": gid, "name": name})
            assert resp.status_code == 201
        listing = await client.get("/api/categories/groups", headers=headers)
    cats = listing.json()[0]["categories"]
    assert [c["name"] for c in cats] == ["Groceries", "Dining", "Fun"]
    assert [c["sort_order"] for c in cats] == [0, 1, 2]
