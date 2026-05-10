"""Tests for GET /api/me/export.

Use the in-memory SQLite + dependency_overrides pattern from
``test_google_oauth_demo_mode.py`` so these run without a real DB. Each
test gets its own engine/session so the state is isolated.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from jose import jwt
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
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
    FinancialGoal,
    Household,
    LlmAudit,
    LlmConsent,
    Payee,
    Transaction,
    User,
)


def _token_for(user_id: str) -> str:
    """Mint a JWT the way auth.py does so get_current_user accepts it."""
    expire = datetime.now(timezone.utc) + timedelta(minutes=30)
    return jwt.encode(
        {"sub": user_id, "exp": expire},
        get_settings().secret_key,
        algorithm=ALGORITHM,
    )


@pytest_asyncio.fixture()
async def fixture():
    """Spin up an isolated in-memory SQLite, override get_db on the app, and
    yield (client, session, ids)."""
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False)

    # Use a single connection-bound session for the whole test so writes from
    # the test setup are visible to the FastAPI handler. Pre-3.x SQLite +
    # in-memory needs StaticPool for cross-call visibility; pairing with a
    # single session keeps things simple.
    test_session = Session()

    async def _override_get_db():
        # Yield the same session the test set up data with so the handler sees it.
        yield test_session

    app.dependency_overrides[get_db] = _override_get_db

    # Replace the rate-limit store with a fresh in-memory one so previous
    # tests' counters don't bleed over.
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


async def _seed_user(
    session: AsyncSession,
    *,
    email: str,
    name: str = "Test",
    google_id: str | None = None,
    household: Household | None = None,
) -> tuple[User, Household]:
    if household is None:
        household = Household(id=uuid.uuid4().hex, name="HH")
        session.add(household)
        await session.flush()
    user = User(
        id=uuid.uuid4().hex,
        email=email,
        name=name,
        password_hash="bcrypt-hash-not-real",
        google_id=google_id,
        household_id=household.id,
        role="owner",
    )
    session.add(user)
    await session.commit()
    return user, household


@pytest.mark.asyncio
async def test_export_requires_auth(fixture):
    session, _engine = fixture
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/api/me/export")
    # No bearer header → HTTPBearer dependency should reject with 401 (or 403
    # depending on FastAPI's default). Both indicate "not authenticated."
    assert r.status_code in (401, 403), r.text


@pytest.mark.asyncio
async def test_export_returns_valid_json_with_expected_keys(fixture):
    session, _engine = fixture
    user, household = await _seed_user(session, email="exp@example.com", google_id="g-123")

    # Seed a tiny amount of data so several top-level arrays are non-empty.
    group = CategoryGroup(household_id=household.id, name="Food", sort_order=0)
    session.add(group)
    await session.flush()
    cat = Category(group_id=group.id, name="Groceries", sort_order=0)
    session.add(cat)
    payee = Payee(household_id=household.id, name="Trader Joes")
    session.add(payee)
    account = Account(
        household_id=household.id, name="Checking", account_type="checking"
    )
    session.add(account)
    await session.flush()
    txn = Transaction(
        account_id=account.id, date=datetime(2026, 5, 1).date(), amount=-12.50
    )
    session.add(txn)
    consent = LlmConsent(user_id=user.id, feature="explain_charge", tier=4)
    session.add(consent)
    audit = LlmAudit(
        user_id=user.id,
        feature="explain_charge",
        tier=4,
        prompt_tokens=10,
        completion_tokens=20,
        latency_ms=50,
        status=200,
        model="qwen",
        cache_hit=False,
    )
    session.add(audit)
    await session.commit()

    headers = {"Authorization": f"Bearer {_token_for(user.id)}"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/api/me/export", headers=headers)
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("application/json")
    cd = r.headers.get("content-disposition", "")
    assert "attachment" in cd and user.id in cd and ".json" in cd

    data = json.loads(r.content)
    # Always-present keys.
    assert data["schema_version"] == 1
    assert "exported_at" in data
    assert "user" in data
    assert "household" in data
    # Seeded keys must be present.
    for k in (
        "accounts",
        "category_groups",
        "categories",
        "payees",
        "transactions",
        "llm_consent",
        "llm_audit",
    ):
        assert k in data, f"missing key: {k}"
        assert isinstance(data[k], list)
        assert len(data[k]) >= 1


@pytest.mark.asyncio
async def test_export_strips_password_hash_and_raw_google_id(fixture):
    session, _engine = fixture
    user, _ = await _seed_user(
        session,
        email="secret@example.com",
        google_id="google-id-must-not-leak",
    )

    headers = {"Authorization": f"Bearer {_token_for(user.id)}"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/api/me/export", headers=headers)
    assert r.status_code == 200, r.text

    data = json.loads(r.content)
    user_obj = data["user"]
    # Must NOT contain the password hash field at all.
    assert "password_hash" not in user_obj
    # Must NOT contain raw google_id.
    assert "google_id" not in user_obj
    # has_google must be a non-empty boolean True for a Google-linked user.
    assert user_obj["has_google"] is True

    # Belt-and-suspenders: the raw google_id must not appear anywhere in the
    # serialized response.
    assert b"google-id-must-not-leak" not in r.content
    assert b"bcrypt-hash-not-real" not in r.content
    # password_hash key shouldn't appear anywhere either.
    assert b"password_hash" not in r.content


@pytest.mark.asyncio
async def test_export_has_google_false_when_no_google_link(fixture):
    session, _engine = fixture
    user, _ = await _seed_user(session, email="local@example.com", google_id=None)

    headers = {"Authorization": f"Bearer {_token_for(user.id)}"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/api/me/export", headers=headers)
    assert r.status_code == 200, r.text
    data = json.loads(r.content)
    assert data["user"]["has_google"] is False


@pytest.mark.asyncio
async def test_export_isolates_users_across_households(fixture):
    session, _engine = fixture
    # User A (household A) — has a transaction
    user_a, hh_a = await _seed_user(session, email="a@example.com")
    account_a = Account(household_id=hh_a.id, name="A-Checking", account_type="checking")
    session.add(account_a)
    await session.flush()
    txn_a = Transaction(
        account_id=account_a.id, date=datetime(2026, 5, 1).date(), amount=-1
    )
    session.add(txn_a)

    # User B (household B) — has a transaction with a distinct amount.
    user_b, hh_b = await _seed_user(session, email="b@example.com")
    account_b = Account(household_id=hh_b.id, name="B-Checking", account_type="checking")
    session.add(account_b)
    await session.flush()
    txn_b = Transaction(
        account_id=account_b.id, date=datetime(2026, 5, 1).date(), amount=-99999
    )
    session.add(txn_b)
    await session.commit()

    # Export as User A — must NOT see User B's transaction.
    headers = {"Authorization": f"Bearer {_token_for(user_a.id)}"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/api/me/export", headers=headers)
    assert r.status_code == 200, r.text
    data = json.loads(r.content)
    txn_account_ids = {t["account_id"] for t in data.get("transactions", [])}
    assert account_a.id in txn_account_ids
    assert account_b.id not in txn_account_ids
    # Also ensure User B's account isn't in the accounts list.
    assert all(acc["id"] != account_b.id for acc in data.get("accounts", []))
    # Defensive byte check: User B's account name shouldn't appear anywhere.
    assert b"B-Checking" not in r.content


@pytest.mark.asyncio
async def test_export_rate_limit_429_after_5(fixture):
    session, _engine = fixture
    user, _ = await _seed_user(session, email="rl@example.com")

    headers = {"Authorization": f"Bearer {_token_for(user.id)}"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # First 5 must succeed.
        for i in range(5):
            r = await client.get("/api/me/export", headers=headers)
            assert r.status_code == 200, f"call {i + 1}: {r.text}"
        # 6th call must be rate-limited.
        r = await client.get("/api/me/export", headers=headers)
        assert r.status_code == 429, r.text
