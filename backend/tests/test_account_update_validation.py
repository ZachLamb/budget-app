"""Server-side range validation for the account update path.

Defense in depth for AI-suggested debt rates: even though the rate-suggestion
pipeline bounds values client-side, the ``PUT /api/accounts/{id}`` route must
independently reject out-of-range ``interest_rate`` / ``minimum_payment`` so a
crafted request (or a buggy/poisoned LLM path) can never persist a nonsense APR.

APR is stored as a fraction (e.g. ``0.2299`` = 22.99%), so the accepted range is
``[0, 1]``; ``minimum_payment`` must be ``>= 0``.

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
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
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


async def _seed_debt_account(session: AsyncSession) -> tuple[User, Account]:
    """Seed a household with one credit (debt) account missing rate fields."""
    household = Household(id=uuid.uuid4().hex, name="HH", ai_enabled=True)
    session.add(household)
    await session.flush()

    user = User(
        id=uuid.uuid4().hex,
        email=f"{uuid.uuid4().hex}@example.com",
        name="Test",
        password_hash="bcrypt-hash-not-real",
        household_id=household.id,
        role="owner",
        status="approved",
    )
    session.add(user)

    account = Account(
        household_id=household.id,
        name="Store Card",
        account_type="credit",
        is_budget_account=False,
    )
    session.add(account)
    await session.commit()
    return user, account


@pytest.mark.asyncio
async def test_rejects_out_of_range_apr(fixture):
    session, _engine = fixture
    user, account = await _seed_debt_account(session)

    headers = {"Authorization": f"Bearer {_token_for(user.id)}"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.put(
            f"/api/accounts/{account.id}",
            json={"interest_rate": 5.0},  # 500% — invalid (APR is a fraction)
            headers=headers,
        )
    assert r.status_code == 422, r.text


@pytest.mark.asyncio
async def test_rejects_negative_apr(fixture):
    session, _engine = fixture
    user, account = await _seed_debt_account(session)

    headers = {"Authorization": f"Bearer {_token_for(user.id)}"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.put(
            f"/api/accounts/{account.id}",
            json={"interest_rate": -0.05},  # negative APR — invalid
            headers=headers,
        )
    assert r.status_code == 422, r.text


@pytest.mark.asyncio
async def test_rejects_negative_min_payment(fixture):
    session, _engine = fixture
    user, account = await _seed_debt_account(session)

    headers = {"Authorization": f"Bearer {_token_for(user.id)}"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.put(
            f"/api/accounts/{account.id}",
            json={"minimum_payment": -10},  # negative — invalid
            headers=headers,
        )
    assert r.status_code == 422, r.text


@pytest.mark.asyncio
async def test_valid_update_succeeds(fixture):
    session, _engine = fixture
    user, account = await _seed_debt_account(session)

    headers = {"Authorization": f"Bearer {_token_for(user.id)}"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.put(
            f"/api/accounts/{account.id}",
            json={"interest_rate": 0.2299, "minimum_payment": 35},  # in-range fraction
            headers=headers,
        )
    assert r.status_code == 200, r.text
    data = r.json()
    assert float(data["interest_rate"]) == pytest.approx(0.2299)
    assert float(data["minimum_payment"]) == pytest.approx(35.0)


@pytest.mark.asyncio
async def test_accepts_boundary_values(fixture):
    """APR of exactly 0 and 1 are valid (inclusive bounds); min payment 0 is valid."""
    session, _engine = fixture
    user, account = await _seed_debt_account(session)

    headers = {"Authorization": f"Bearer {_token_for(user.id)}"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.put(
            f"/api/accounts/{account.id}",
            json={"interest_rate": 1, "minimum_payment": 0},
            headers=headers,
        )
    assert r.status_code == 200, r.text
