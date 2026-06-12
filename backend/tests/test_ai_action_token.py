"""Confirmation-token gating for /api/ai/execute-action.

The execute route performs financial writes; it must only run when a
single-use token from /advisor-turn or /parse-action accompanies the request.
"""
from __future__ import annotations

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.middleware.rate_limit_store import InMemoryStore
from app.models import Account, Household, Transaction
from app.services.ai.action_token import issue_action_token, redeem_action_token
from app.services.auth import challenges
from app.services.auth.ephemeral_store import InMemoryEphemeralStore


@pytest.fixture(autouse=True)
def fresh_ephemeral_store():
    prior = challenges.get_store()
    challenges.set_store(InMemoryEphemeralStore())
    yield
    challenges.set_store(prior)


# ── Token unit tests ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_token_roundtrip_and_single_use():
    token = await issue_action_token("hh-1", "add_transaction")
    assert await redeem_action_token(token, "hh-1", "add_transaction") is True
    # Single use: the second redeem must fail.
    assert await redeem_action_token(token, "hh-1", "add_transaction") is False


@pytest.mark.asyncio
async def test_token_bound_to_household_and_action():
    token = await issue_action_token("hh-1", "add_transaction")
    assert await redeem_action_token(token, "hh-OTHER", "add_transaction") is False

    token2 = await issue_action_token("hh-1", "add_transaction")
    assert await redeem_action_token(token2, "hh-1", "add_debt") is False


@pytest.mark.asyncio
async def test_empty_or_unknown_token_rejected():
    assert await redeem_action_token("", "hh-1", "add_transaction") is False
    assert await redeem_action_token("garbage", "hh-1", "add_transaction") is False


# ── Route integration ─────────────────────────────────────────────────────────


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

    household = Household(name="Test HH")
    test_session.add(household)
    await test_session.flush()
    account = Account(
        household_id=household.id,
        name="Checking",
        account_type="checking",
        is_budget_account=True,
    )
    test_session.add(account)
    await test_session.commit()

    async def _override_get_db():
        yield test_session

    from app.api.deps import get_household_id

    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_household_id] = lambda: household.id

    prior_store = getattr(app.state, "rate_limit_store", None)
    app.state.rate_limit_store = InMemoryStore()
    try:
        yield test_session, household.id, account.id
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
async def test_execute_action_rejected_without_valid_token(api_fixture):
    test_session, household_id, _account_id = api_fixture
    async with _client() as client:
        resp = await client.post(
            "/api/ai/execute-action",
            json={
                "action_type": "add_transaction",
                "data": {"account_name": "Checking", "payee_name": "X", "amount": 5},
                "confirmation_token": "forged-token",
            },
        )
    assert resp.status_code == 403

    txn_count = (
        await test_session.execute(select(Transaction))
    ).scalars().all()
    assert txn_count == []


@pytest.mark.asyncio
async def test_execute_action_requires_token_field(api_fixture):
    async with _client() as client:
        resp = await client.post(
            "/api/ai/execute-action",
            json={
                "action_type": "add_transaction",
                "data": {"account_name": "Checking", "payee_name": "X", "amount": 5},
            },
        )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_execute_action_succeeds_with_issued_token(api_fixture):
    test_session, household_id, account_id = api_fixture
    token = await issue_action_token(household_id, "add_transaction")
    async with _client() as client:
        resp = await client.post(
            "/api/ai/execute-action",
            json={
                "action_type": "add_transaction",
                "data": {
                    "account_name": "Checking",
                    "payee_name": "Coffee",
                    "amount": 4.5,
                    "date": "2026-06-01",
                },
                "confirmation_token": token,
            },
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True

    txns = (
        await test_session.execute(
            select(Transaction).where(Transaction.account_id == account_id)
        )
    ).scalars().all()
    assert len(txns) == 1

    # Replay with the same token must fail.
    async with _client() as client:
        resp2 = await client.post(
            "/api/ai/execute-action",
            json={
                "action_type": "add_transaction",
                "data": {"account_name": "Checking", "payee_name": "Coffee", "amount": 4.5},
                "confirmation_token": token,
            },
        )
    assert resp2.status_code == 403
