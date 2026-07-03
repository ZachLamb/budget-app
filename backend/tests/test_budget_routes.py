"""Route tests for envelope budget rollover in GET /budget/month/{month}."""
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
    BudgetAssignment,
    Category,
    CategoryGroup,
    Household,
    Transaction,
    User,
)

PREV = "2026-05"
CUR = "2026-06"


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


def _cat(body: dict, name: str) -> dict:
    for group in body["groups"]:
        for cat in group["categories"]:
            if cat["category_name"] == name:
                return cat
    raise AssertionError(f"category {name!r} not found")


async def _seed_budget_household(session):
    hid = str(uuid.uuid4())
    uid = str(uuid.uuid4())
    account_id = str(uuid.uuid4())
    session.add(Household(id=hid, name="H"))
    session.add(User(
        id=uid, email=f"{uid}@t.io", name="T", password_hash=None,
        household_id=hid, role="owner", status="approved",
    ))
    session.add(Account(
        id=account_id, household_id=hid, name="Checking",
        account_type="checking", is_budget_account=True,
    ))

    income_group = CategoryGroup(
        id=str(uuid.uuid4()), household_id=hid, name="Income",
        sort_order=0, is_income=True,
    )
    expense_group = CategoryGroup(
        id=str(uuid.uuid4()), household_id=hid, name="Everyday",
        sort_order=1, is_income=False,
    )
    session.add(income_group)
    session.add(expense_group)
    await session.flush()

    salary = Category(id=str(uuid.uuid4()), group_id=income_group.id, name="Salary", sort_order=0)
    groceries = Category(id=str(uuid.uuid4()), group_id=expense_group.id, name="Groceries", sort_order=0)
    dining = Category(id=str(uuid.uuid4()), group_id=expense_group.id, name="Dining", sort_order=1)
    session.add_all([salary, groceries, dining])
    await session.flush()

    for month, groc_amt, dine_amt in [
        (PREV, Decimal("400"), Decimal("150")),
        (CUR, Decimal("400"), Decimal("150")),
    ]:
        session.add(BudgetAssignment(
            household_id=hid, category_id=groceries.id,
            month=month, assigned_amount=groc_amt,
        ))
        session.add(BudgetAssignment(
            household_id=hid, category_id=dining.id,
            month=month, assigned_amount=dine_amt,
        ))

    session.add(Transaction(
        account_id=account_id, category_id=groceries.id,
        date=date(2026, 5, 10), amount=Decimal("-375"),
    ))
    session.add(Transaction(
        account_id=account_id, category_id=dining.id,
        date=date(2026, 5, 15), amount=Decimal("-190"),
    ))
    session.add(Transaction(
        account_id=account_id, category_id=salary.id,
        date=date(2026, 5, 1), amount=Decimal("1000"),
    ))
    session.add(Transaction(
        account_id=account_id, category_id=salary.id,
        date=date(2026, 6, 1), amount=Decimal("1000"),
    ))
    await session.commit()
    headers = {"Authorization": f"Bearer {_token_for(uid)}"}
    return hid, headers, groceries.id, dining.id


@pytest.mark.asyncio
async def test_month_view_includes_carryover_and_rta(fixture):
    session, _ = fixture
    _, headers, _, _ = await _seed_budget_household(session)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get(f"/api/budget/month/{CUR}", headers=headers)
    assert resp.status_code == 200
    body = resp.json()

    groc = _cat(body, "Groceries")
    assert Decimal(str(groc["carryover"])) == Decimal("25")
    assert Decimal(str(groc["available"])) == Decimal("425")

    dine = _cat(body, "Dining")
    assert Decimal(str(dine["carryover"])) == Decimal("0")

    assert Decimal(str(body["overspend_deducted"])) == Decimal("40")
    assert Decimal(str(body["ready_to_assign"])) == Decimal("860")
    assert Decimal(str(body["total_carryover_in"])) == Decimal("25")


@pytest.mark.asyncio
async def test_assign_upsert_roundtrip(fixture):
    session, _ = fixture
    _, headers, groceries_id, _ = await _seed_budget_household(session)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        first = await client.put("/api/budget/assign", headers=headers, json={
            "category_id": groceries_id, "month": CUR, "assigned_amount": "500",
        })
        assert first.status_code == 200
        second = await client.put("/api/budget/assign", headers=headers, json={
            "category_id": groceries_id, "month": CUR, "assigned_amount": "550",
        })
        assert second.status_code == 200
        assert second.json()["id"] == first.json()["id"]
        assert Decimal(str(second.json()["assigned_amount"])) == Decimal("550")


@pytest.mark.asyncio
async def test_budget_month_isolated_per_household(fixture):
    session, _ = fixture
    _, headers_a, _, _ = await _seed_budget_household(session)

    hid_b = str(uuid.uuid4())
    uid_b = str(uuid.uuid4())
    session.add(Household(id=hid_b, name="B"))
    session.add(User(
        id=uid_b, email=f"{uid_b}@t.io", name="B", password_hash=None,
        household_id=hid_b, role="owner", status="approved",
    ))
    await session.commit()
    headers_b = {"Authorization": f"Bearer {_token_for(uid_b)}"}

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp_a = await client.get(f"/api/budget/month/{CUR}", headers=headers_a)
        resp_b = await client.get(f"/api/budget/month/{CUR}", headers=headers_b)
    assert resp_a.status_code == 200
    assert resp_b.status_code == 200
    assert Decimal(str(resp_a.json()["total_carryover_in"])) == Decimal("25")
    body_b = resp_b.json()
    assert Decimal(str(body_b["total_carryover_in"])) == Decimal("0")
    assert Decimal(str(body_b["ready_to_assign"])) == Decimal("0")
