"""Tests for POST /api/ai/prepare-action."""
from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.api.deps import get_household_id
from app.database import Base, get_db
from app.main import app
from app.middleware.rate_limit_store import InMemoryStore
from app.models import Account, Category, CategoryGroup, Household, Payee, Transaction
from app.services.ai.action_token import redeem_action_token


@pytest_asyncio.fixture()
async def api_fixture():
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False)
    test_session = Session()

    household = Household(id="hh-1", name="Test HH", ai_enabled=True)
    test_session.add(household)
    await test_session.flush()
    grp = CategoryGroup(id="g-1", household_id=household.id, name="Fees")
    cat = Category(id="c-1", group_id="g-1", name="Foreign Transaction Fees")
    account = Account(
        household_id=household.id,
        name="Checking",
        account_type="checking",
        is_budget_account=True,
    )
    payee = Payee(household_id=household.id, name="Chase Foreign Fee")
    test_session.add_all([grp, cat, account, payee])
    await test_session.flush()
    test_session.add(
        Transaction(
            account_id=account.id,
            payee_id=payee.id,
            date=date.today(),
            amount=Decimal("-4.50"),
        )
    )
    await test_session.commit()

    async def _override_get_db():
        yield test_session

    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_household_id] = lambda: household.id

    prior_store = getattr(app.state, "rate_limit_store", None)
    app.state.rate_limit_store = InMemoryStore()
    try:
        yield test_session, household.id
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_household_id, None)
        await test_session.close()
        await engine.dispose()
        if prior_store is not None:
            app.state.rate_limit_store = prior_store


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.mark.asyncio
async def test_create_category_issues_token(api_fixture):
    _session, household_id = api_fixture
    async with _client() as client:
        resp = await client.post(
            "/api/ai/prepare-action",
            json={"action_type": "create_category", "data": {"name": "New Cat"}},
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert body["confirmation_token"]
    assert await redeem_action_token(
        body["confirmation_token"], household_id, "create_category"
    )


@pytest.mark.asyncio
async def test_unknown_action_type_returns_not_ok(api_fixture):
    async with _client() as client:
        resp = await client.post(
            "/api/ai/prepare-action",
            json={"action_type": "delete_everything", "data": {}},
        )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_bulk_recategorize_preview_and_token(api_fixture):
    _session, household_id = api_fixture
    async with _client() as client:
        resp = await client.post(
            "/api/ai/prepare-action",
            json={
                "action_type": "bulk_recategorize",
                "data": {
                    "payee_match": "foreign fee",
                    "category_name": "Foreign Transaction Fees",
                },
            },
        )
    body = resp.json()
    assert body["ok"] is True
    assert "1 transaction" in body["preview"].lower()
    assert body["confirmation_token"]
    assert await redeem_action_token(
        body["confirmation_token"], household_id, "bulk_recategorize"
    )


@pytest_asyncio.fixture()
async def ai_disabled_fixture():
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False)
    test_session = Session()
    household = Household(id="hh-off", name="Off", ai_enabled=False)
    test_session.add(household)
    await test_session.commit()

    async def _override_get_db():
        yield test_session

    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_household_id] = lambda: household.id
    prior_store = getattr(app.state, "rate_limit_store", None)
    app.state.rate_limit_store = InMemoryStore()
    try:
        yield
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_household_id, None)
        await test_session.close()
        await engine.dispose()
        if prior_store is not None:
            app.state.rate_limit_store = prior_store


@pytest.mark.asyncio
async def test_requires_ai_enabled(ai_disabled_fixture):
    async with _client() as client:
        resp = await client.post(
            "/api/ai/prepare-action",
            json={"action_type": "create_category", "data": {"name": "X"}},
        )
    assert resp.status_code == 403
