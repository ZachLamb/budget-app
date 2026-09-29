"""The goals API, end to end.

This file used to be three empty stubs behind a module-level skip. They
were not covering anything, and unskipped they would have passed without
asserting anything at all -- including the one whose name promised that a
goal cannot be linked to another household's account.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import jwt
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.api.deps import ALGORITHM
from app.config import get_settings
from app.database import Base, get_db
from app.main import app
from app.middleware.rate_limit_store import InMemoryStore
from app.models import Account, FinancialGoal, Household, User


def _token_for(user_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=30)
    return jwt.encode(
        {"sub": user_id, "exp": expire}, get_settings().secret_key, algorithm=ALGORITHM
    )


@pytest_asyncio.fixture()
async def session():
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False)
    s = Session()

    async def _override_get_db():
        yield s

    app.dependency_overrides[get_db] = _override_get_db
    prior = getattr(app.state, "rate_limit_store", None)
    app.state.rate_limit_store = InMemoryStore()
    try:
        yield s
    finally:
        app.dependency_overrides.pop(get_db, None)
        await s.close()
        await engine.dispose()
        if prior is not None:
            app.state.rate_limit_store = prior


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _household(session, name="H"):
    """A household with a user, an account, and a bearer token."""
    hid, uid = str(uuid.uuid4()), str(uuid.uuid4())
    session.add(Household(id=hid, name=name))
    await session.flush()
    session.add(User(
        id=uid, email=f"{uid}@t.io", name="T", password_hash=None,
        household_id=hid, role="owner", status="approved",
    ))
    acct = Account(
        id=str(uuid.uuid4()), household_id=hid, name=f"{name} Savings",
        account_type="savings",
    )
    session.add(acct)
    await session.commit()
    return hid, {"Authorization": f"Bearer {_token_for(uid)}"}, acct.id


GOAL = {
    "name": "Emergency fund",
    "goal_type": "emergency_fund",
    "target_amount": "10000.00",
    "current_amount": "2500.00",
    "monthly_contribution": "500.00",
}


@pytest.mark.asyncio
async def test_create_goal_returns_bounded_progress(session):
    _, headers, _ = await _household(session)
    async with _client() as client:
        resp = await client.post("/api/goals", headers=headers, json=GOAL)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["name"] == "Emergency fund"
    # 2,500 of 10,000.
    assert body["progress_pct"] == pytest.approx(25.0)
    # 7,500 left at 500 a month.
    assert body["months_remaining"] == 15


@pytest.mark.asyncio
async def test_progress_is_capped_rather_than_reported_above_100(session):
    """An over-funded goal is 100% done, not 250% done -- the number is
    rendered as a bar."""
    _, headers, _ = await _household(session)
    async with _client() as client:
        resp = await client.post(
            "/api/goals",
            headers=headers,
            json={**GOAL, "current_amount": "25000.00"},
        )
    assert resp.json()["progress_pct"] <= 100.0


@pytest.mark.asyncio
async def test_a_goal_with_no_contribution_has_no_finish_date(session):
    """Not zero months. Nothing is being put in, so there is no answer --
    reporting 0 would read as "already done"."""
    _, headers, _ = await _household(session)
    async with _client() as client:
        resp = await client.post(
            "/api/goals",
            headers=headers,
            json={**GOAL, "monthly_contribution": None},
        )
    assert resp.json()["months_remaining"] is None


@pytest.mark.asyncio
async def test_a_goal_can_be_linked_to_your_own_account(session):
    _, headers, acct_id = await _household(session)
    async with _client() as client:
        resp = await client.post(
            "/api/goals", headers=headers, json={**GOAL, "account_id": acct_id}
        )
    assert resp.status_code == 201
    assert resp.json()["account_id"] == acct_id
    assert resp.json()["account_name"] == "H Savings"


@pytest.mark.asyncio
async def test_create_rejects_an_account_from_another_household(session):
    """The check this file was always supposed to make."""
    _, headers, _ = await _household(session, "Mine")
    _, _, their_acct = await _household(session, "Theirs")
    async with _client() as client:
        resp = await client.post(
            "/api/goals", headers=headers, json={**GOAL, "account_id": their_acct}
        )
    assert resp.status_code == 404
    # ...and nothing was written on the way to finding out.
    assert (await session.execute(select(FinancialGoal))).scalars().all() == []


@pytest.mark.asyncio
async def test_update_rejects_an_account_from_another_household(session):
    _, headers, _ = await _household(session, "Mine")
    _, _, their_acct = await _household(session, "Theirs")
    async with _client() as client:
        created = await client.post("/api/goals", headers=headers, json=GOAL)
        goal_id = created.json()["id"]
        resp = await client.put(
            f"/api/goals/{goal_id}", headers=headers, json={"account_id": their_acct}
        )
    assert resp.status_code == 404

    goal = (await session.execute(select(FinancialGoal))).scalar_one()
    assert goal.account_id is None


@pytest.mark.asyncio
async def test_update_changes_what_was_sent_and_leaves_the_rest(session):
    _, headers, _ = await _household(session)
    async with _client() as client:
        created = await client.post("/api/goals", headers=headers, json=GOAL)
        goal_id = created.json()["id"]
        resp = await client.put(
            f"/api/goals/{goal_id}",
            headers=headers,
            json={"current_amount": "5000.00"},
        )
    body = resp.json()
    assert body["current_amount"] == "5000.00"
    assert body["name"] == "Emergency fund"
    assert body["progress_pct"] == pytest.approx(50.0)


@pytest.mark.asyncio
async def test_another_households_goal_cannot_be_updated(session):
    _, mine, _ = await _household(session, "Mine")
    _, theirs, _ = await _household(session, "Theirs")
    async with _client() as client:
        created = await client.post("/api/goals", headers=theirs, json=GOAL)
        resp = await client.put(
            f"/api/goals/{created.json()['id']}",
            headers=mine,
            json={"name": "Renamed by a stranger"},
        )
    assert resp.status_code == 404
    goal = (await session.execute(select(FinancialGoal))).scalar_one()
    assert goal.name == "Emergency fund"


@pytest.mark.asyncio
async def test_delete_removes_it_from_the_list(session):
    _, headers, _ = await _household(session)
    async with _client() as client:
        created = await client.post("/api/goals", headers=headers, json=GOAL)
        goal_id = created.json()["id"]
        deleted = await client.delete(f"/api/goals/{goal_id}", headers=headers)
        listed = await client.get("/api/goals", headers=headers)
    assert deleted.status_code == 204
    assert [g["id"] for g in listed.json()] == []


@pytest.mark.asyncio
async def test_another_households_goal_cannot_be_deleted(session):
    _, mine, _ = await _household(session, "Mine")
    _, theirs, _ = await _household(session, "Theirs")
    async with _client() as client:
        created = await client.post("/api/goals", headers=theirs, json=GOAL)
        resp = await client.delete(f"/api/goals/{created.json()['id']}", headers=mine)
    assert resp.status_code == 404
    assert (await session.execute(select(FinancialGoal))).scalars().all() != []


@pytest.mark.asyncio
async def test_the_list_only_shows_your_own_goals(session):
    _, mine, _ = await _household(session, "Mine")
    _, theirs, _ = await _household(session, "Theirs")
    async with _client() as client:
        await client.post("/api/goals", headers=mine, json={**GOAL, "name": "Mine"})
        await client.post("/api/goals", headers=theirs, json={**GOAL, "name": "Theirs"})
        listed = await client.get("/api/goals", headers=mine)
    assert [g["name"] for g in listed.json()] == ["Mine"]


@pytest.mark.asyncio
async def test_a_target_of_zero_is_refused_rather_than_dividing_by_it(session):
    _, headers, _ = await _household(session)
    async with _client() as client:
        resp = await client.post(
            "/api/goals", headers=headers, json={**GOAL, "target_amount": "0"}
        )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_a_blank_name_is_refused(session):
    _, headers, _ = await _household(session)
    async with _client() as client:
        resp = await client.post(
            "/api/goals", headers=headers, json={**GOAL, "name": "   "}
        )
    assert resp.status_code == 422
