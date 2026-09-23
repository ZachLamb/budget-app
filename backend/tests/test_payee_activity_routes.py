"""Route tests for /api/payees/activity and the delete guard.

The payees page was a list of names with nothing behind them. Activity is
what makes it worth opening: how much has gone to each merchant, how
often, and when it last happened -- scoped, like everything else, to the
caller's household.
"""
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
        {"sub": user_id, "exp": expire}, get_settings().secret_key, algorithm=ALGORITHM
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
        yield test_session
    finally:
        app.dependency_overrides.pop(get_db, None)
        await test_session.close()
        await engine.dispose()
        if prior_store is not None:
            app.state.rate_limit_store = prior_store


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _seed(session):
    hid, uid = str(uuid.uuid4()), str(uuid.uuid4())
    session.add(Household(id=hid, name="H"))
    session.add(User(
        id=uid, email=f"{uid}@t.io", name="T", password_hash=None,
        household_id=hid, role="owner", status="approved",
    ))
    acct = Account(id=str(uuid.uuid4()), household_id=hid, name="Checking", account_type="checking")
    group = CategoryGroup(id=str(uuid.uuid4()), household_id=hid, name="Personal", sort_order=0)
    session.add_all([acct, group])
    await session.flush()
    groceries = Category(id=str(uuid.uuid4()), group_id=group.id, name="Groceries", sort_order=0)
    dining = Category(id=str(uuid.uuid4()), group_id=group.id, name="Dining", sort_order=1)
    busy = Payee(id=str(uuid.uuid4()), household_id=hid, name="Busy Market")
    quiet = Payee(id=str(uuid.uuid4()), household_id=hid, name="Never Used")
    session.add_all([groceries, dining, busy, quiet])
    await session.flush()

    for d, amount, cat in [
        (date(2026, 3, 1), Decimal("-20.00"), groceries.id),
        (date(2026, 5, 4), Decimal("-30.50"), groceries.id),
        (date(2026, 7, 9), Decimal("-10.00"), dining.id),
    ]:
        session.add(Transaction(
            id=str(uuid.uuid4()), account_id=acct.id, date=d,
            payee_id=busy.id, amount=amount, category_id=cat,
        ))
    await session.commit()
    headers = {"Authorization": f"Bearer {_token_for(uid)}"}
    return hid, headers, acct.id, busy.id, quiet.id, groceries.id


@pytest.mark.asyncio
async def test_activity_totals_count_and_last_date(fixture):
    session = fixture
    _, headers, _, busy_id, quiet_id, groceries_id = await _seed(session)
    async with _client() as client:
        resp = await client.get("/api/payees/activity", headers=headers)
    assert resp.status_code == 200
    by_id = {row["payee_id"]: row for row in resp.json()}

    busy = by_id[busy_id]
    assert busy["transaction_count"] == 3
    assert Decimal(busy["total_amount"]) == Decimal("-60.50")
    assert busy["last_date"] == "2026-07-09"
    # Two of three land in Groceries, so that is where this payee usually goes.
    assert busy["top_category_id"] == groceries_id
    assert busy["top_category_name"] == "Groceries"


@pytest.mark.asyncio
async def test_activity_reports_unused_payees_as_zero_not_absent(fixture):
    """A payee with no transactions is a real row -- it is the one you may
    want to delete, so it must not silently drop out of the list."""
    session = fixture
    _, headers, _, _, quiet_id, _ = await _seed(session)
    async with _client() as client:
        resp = await client.get("/api/payees/activity", headers=headers)
    quiet = {r["payee_id"]: r for r in resp.json()}[quiet_id]
    assert quiet["transaction_count"] == 0
    assert Decimal(quiet["total_amount"]) == Decimal("0")
    assert quiet["last_date"] is None
    assert quiet["top_category_id"] is None


@pytest.mark.asyncio
async def test_activity_excludes_other_households(fixture):
    session = fixture
    _, headers, _, _, _, _ = await _seed(session)
    other_hid = str(uuid.uuid4())
    session.add(Household(id=other_hid, name="Other"))
    await session.flush()
    session.add(Payee(id=str(uuid.uuid4()), household_id=other_hid, name="Someone Else"))
    await session.commit()

    async with _client() as client:
        resp = await client.get("/api/payees/activity", headers=headers)
    assert "Someone Else" not in [r["name"] for r in resp.json()]


@pytest.mark.asyncio
async def test_activity_requires_auth(fixture):
    async with _client() as client:
        resp = await client.get("/api/payees/activity")
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_delete_refuses_a_payee_that_still_has_transactions(fixture):
    """Deleting one used to hit a foreign-key violation and surface as a 500
    with no explanation of what went wrong or what to do instead."""
    session = fixture
    _, headers, _, busy_id, _, _ = await _seed(session)
    async with _client() as client:
        resp = await client.delete(f"/api/payees/{busy_id}", headers=headers)
    assert resp.status_code == 409
    detail = resp.json()["detail"]
    assert "3" in detail
    assert "merge" in detail.lower()


@pytest.mark.asyncio
async def test_delete_refuses_a_payee_used_by_a_recurring_item(fixture):
    session = fixture
    hid, headers, acct_id, _, quiet_id, _ = await _seed(session)
    session.add(RecurringTransaction(
        id=str(uuid.uuid4()), household_id=hid, payee_id=quiet_id,
        amount=Decimal("-9.99"), frequency="monthly", next_date=date(2026, 10, 1),
        account_id=acct_id,
    ))
    await session.commit()
    async with _client() as client:
        resp = await client.delete(f"/api/payees/{quiet_id}", headers=headers)
    assert resp.status_code == 409
    assert "recurring" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_delete_still_removes_an_unused_payee(fixture):
    session = fixture
    _, headers, _, _, quiet_id, _ = await _seed(session)
    async with _client() as client:
        resp = await client.delete(f"/api/payees/{quiet_id}", headers=headers)
    assert resp.status_code == 204
