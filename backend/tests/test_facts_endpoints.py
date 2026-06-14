"""Tests for the grounded (model-free) budget facts surface.

Covers the deterministic helper ``compute_budget_facts`` and the HTTP route
``GET /api/ai/facts/budget``. No LLM is involved — these assert exact
budgeted/actual/remaining arithmetic for the current month.

Uses the in-memory SQLite + dependency_overrides pattern from
``test_me_export.py`` so the suite runs without a real DB.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

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
from app.models import (
    Account,
    BudgetAssignment,
    Category,
    CategoryGroup,
    FinancialGoal,
    Household,
    Transaction,
    User,
)
from decimal import Decimal


def _current_month() -> str:
    today = date.today()
    return f"{today.year}-{today.month:02d}"


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


async def _seed_budget_fixture(
    session: AsyncSession,
    *,
    ai_enabled: bool = True,
    budgeted: float = 200.0,
    spent: float = 350.0,
) -> tuple[User, Household, Category]:
    """Seed a household with one non-income category that is budgeted and spent
    against in the current month on a budget account."""
    household = Household(id=uuid.uuid4().hex, name="HH", ai_enabled=ai_enabled)
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

    group = CategoryGroup(household_id=household.id, name="Food", sort_order=0)
    session.add(group)
    await session.flush()
    cat = Category(group_id=group.id, name="Groceries", sort_order=0)
    session.add(cat)
    account = Account(
        household_id=household.id,
        name="Checking",
        account_type="checking",
        is_budget_account=True,
    )
    session.add(account)
    await session.flush()

    session.add(
        BudgetAssignment(
            household_id=household.id,
            category_id=cat.id,
            month=_current_month(),
            assigned_amount=budgeted,
        )
    )
    # Spending is a negative (outflow) transaction in the current month.
    session.add(
        Transaction(
            account_id=account.id,
            category_id=cat.id,
            date=date.today(),
            amount=-spent,
        )
    )
    await session.commit()
    return user, household, cat


@pytest.mark.asyncio
async def test_compute_budget_facts_shape_and_arithmetic(fixture):
    session, _engine = fixture
    _user, household, cat = await _seed_budget_fixture(session)

    from app.services.ai.budget import compute_budget_facts

    facts = await compute_budget_facts(session, household.id)

    assert facts["month"] == _current_month()
    assert facts["total_budgeted"] == 200.0
    assert facts["total_actual"] == 350.0

    cats = facts["categories"]
    assert len(cats) == 1
    row = cats[0]
    assert row["category_id"] == cat.id
    assert row["name"] == "Groceries"
    assert row["budgeted"] == 200.0
    assert row["actual"] == 350.0
    assert row["remaining"] == -150.0


@pytest.mark.asyncio
async def test_budget_facts_endpoint_returns_200_and_schema(fixture):
    session, _engine = fixture
    user, _household, cat = await _seed_budget_fixture(session)

    headers = {"Authorization": f"Bearer {_token_for(user.id)}"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/api/ai/facts/budget", headers=headers)

    assert r.status_code == 200, r.text
    data = r.json()
    assert data["month"] == _current_month()
    assert data["total_budgeted"] == 200.0
    assert data["total_actual"] == 350.0
    assert isinstance(data["categories"], list) and len(data["categories"]) == 1
    row = data["categories"][0]
    assert set(row.keys()) == {"category_id", "name", "budgeted", "actual", "remaining"}
    assert row["category_id"] == cat.id
    assert row["name"] == "Groceries"
    assert row["budgeted"] == 200.0
    assert row["actual"] == 350.0
    assert row["remaining"] == -150.0


@pytest.mark.asyncio
async def test_budget_facts_endpoint_requires_auth(fixture):
    _session, _engine = fixture
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/api/ai/facts/budget")
    assert r.status_code in (401, 403), r.text


@pytest.mark.asyncio
async def test_budget_facts_endpoint_403_when_ai_disabled(fixture):
    session, _engine = fixture
    user, _household, _cat = await _seed_budget_fixture(session, ai_enabled=False)

    headers = {"Authorization": f"Bearer {_token_for(user.id)}"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/api/ai/facts/budget", headers=headers)
    assert r.status_code == 403, r.text


async def _seed_goal_fixture(
    session: AsyncSession,
    *,
    ai_enabled: bool = True,
    name: str = "Vacation",
    target_amount: Decimal = Decimal("1000.00"),
    current_amount: Decimal = Decimal("250.00"),
    monthly_contribution: Decimal | None = Decimal("150.00"),
) -> tuple[User, Household, FinancialGoal]:
    """Seed a household with one (non-account-linked) savings goal with known
    arithmetic: months_remaining = ceil((1000 - 250) / 150) = 5."""
    household = Household(id=uuid.uuid4().hex, name="HH", ai_enabled=ai_enabled)
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

    goal = FinancialGoal(
        household_id=household.id,
        name=name,
        goal_type="savings",
        target_amount=target_amount,
        current_amount=current_amount,
        monthly_contribution=monthly_contribution,
    )
    session.add(goal)
    await session.commit()
    return user, household, goal


@pytest.mark.asyncio
async def test_compute_goal_facts_shape_and_arithmetic(fixture):
    session, _engine = fixture
    _user, household, goal = await _seed_goal_fixture(session)

    from app.api.routes.goals import compute_goal_facts

    facts = await compute_goal_facts(session, household.id)

    goals = facts["goals"]
    assert len(goals) == 1
    row = goals[0]
    assert set(row.keys()) == {
        "goal_id",
        "name",
        "target_amount",
        "current_amount",
        "monthly_contribution",
        "months_remaining",
    }
    assert row["goal_id"] == goal.id
    assert row["name"] == "Vacation"
    assert row["target_amount"] == 1000.0
    assert row["current_amount"] == 250.0
    assert row["monthly_contribution"] == 150.0
    assert row["months_remaining"] == 5


@pytest.mark.asyncio
async def test_goal_facts_endpoint_returns_200_and_schema(fixture):
    session, _engine = fixture
    user, _household, goal = await _seed_goal_fixture(session)

    headers = {"Authorization": f"Bearer {_token_for(user.id)}"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/api/ai/facts/goal", headers=headers)

    assert r.status_code == 200, r.text
    data = r.json()
    assert isinstance(data["goals"], list) and len(data["goals"]) == 1
    row = data["goals"][0]
    assert set(row.keys()) == {
        "goal_id",
        "name",
        "target_amount",
        "current_amount",
        "monthly_contribution",
        "months_remaining",
    }
    assert row["goal_id"] == goal.id
    assert row["name"] == "Vacation"
    assert row["target_amount"] == 1000.0
    assert row["current_amount"] == 250.0
    assert row["monthly_contribution"] == 150.0
    assert row["months_remaining"] == 5


@pytest.mark.asyncio
async def test_goal_facts_endpoint_is_household_scoped(fixture):
    session, _engine = fixture
    user, _household, caller_goal = await _seed_goal_fixture(session)
    # A goal in a different household must never appear in the caller's facts.
    _other_user, _other_hh, other_goal = await _seed_goal_fixture(
        session, name="Someone Else Goal"
    )

    headers = {"Authorization": f"Bearer {_token_for(user.id)}"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/api/ai/facts/goal", headers=headers)

    assert r.status_code == 200, r.text
    data = r.json()
    goal_ids = {g["goal_id"] for g in data["goals"]}
    assert caller_goal.id in goal_ids
    assert other_goal.id not in goal_ids
    assert len(data["goals"]) == 1
