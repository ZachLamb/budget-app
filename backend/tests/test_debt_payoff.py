"""Debt payoff simulation math (avalanche/snowball).

Locks in same-month reallocation: when a debt pays off mid-month, its unused
minimum-payment surplus must roll to the next active debt in the SAME month
(not sit idle until next month), and any surplus arising after the last
active debt in the pass is applied to the first still-active debt. Also
guards the existing next-month freed-minimum behavior.
"""
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
from app.models import Account, Household, Transaction


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest_asyncio.fixture()
async def env():
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False)
    session = Session()

    async def _override_get_db():
        yield session

    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_household_id] = lambda: "hh-1"
    prior_store = getattr(app.state, "rate_limit_store", None)
    app.state.rate_limit_store = InMemoryStore()
    session.add(Household(id="hh-1", name="Test"))
    await session.commit()
    try:
        yield session, _client()
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_household_id, None)
        await session.close()
        await engine.dispose()
        if prior_store is not None:
            app.state.rate_limit_store = prior_store


async def seed_debt(db, *, id: str, name: str, balance: str, apr: str | None, min_payment: str):
    # is_budget_account=True so _compute_balances derives the balance from the
    # seeded transaction (tracking accounts use AccountSnapshot instead).
    db.add(Account(
        id=id,
        household_id="hh-1",
        name=name,
        account_type="loan",
        is_budget_account=True,
        interest_rate=Decimal(apr) if apr is not None else None,
        minimum_payment=Decimal(min_payment),
    ))
    db.add(Transaction(
        id=str(uuid.uuid4()),
        account_id=id,
        date=date(2026, 1, 1),
        amount=Decimal(balance) * -1,
    ))
    await db.commit()


def schedule_for(body: dict, account_id: str) -> list[dict]:
    entry = next((d for d in body["debts"] if d["account_id"] == account_id), None)
    assert entry is not None, f"account {account_id} missing from plan: {body['debts']}"
    return entry["schedule"]


@pytest.mark.asyncio
async def test_surplus_rolls_to_next_debt_same_month(env):
    """Debt A pays off mid-month with 20 of its 50 minimum unused; that 20
    must reach debt B in the SAME month, not evaporate."""
    db, client = env
    await seed_debt(db, id="a", name="Small", balance="30", apr="0", min_payment="50")
    await seed_debt(db, id="b", name="Big", balance="1000", apr="0", min_payment="25")

    r = await client.post("/api/debt/payoff-plan", json={"strategy": "snowball", "extra_monthly": "0"})
    assert r.status_code == 200
    body = r.json()

    a_m1 = schedule_for(body, "a")[0]
    assert Decimal(a_m1["payment"]) == Decimal("30")  # capped at balance
    b_m1 = schedule_for(body, "b")[0]
    # 25 minimum + 20 surplus rolled from A in the same month.
    assert Decimal(b_m1["payment"]) == Decimal("45")
    assert Decimal(b_m1["balance"]) == Decimal("955")


@pytest.mark.asyncio
async def test_trailing_surplus_applies_to_earlier_active_debt(env):
    """Avalanche order puts the big debt first; the small debt's payoff
    surplus arises after the pass — it must still be applied to the big
    debt within the same month (second pass), not dropped."""
    db, client = env
    await seed_debt(db, id="b", name="Card", balance="1000", apr="0.20", min_payment="25")
    await seed_debt(db, id="a", name="Tiny", balance="10", apr="0.05", min_payment="50")

    r = await client.post("/api/debt/payoff-plan", json={"strategy": "avalanche", "extra_monthly": "0"})
    assert r.status_code == 200
    body = r.json()

    a_m1 = schedule_for(body, "a")[0]
    # interest 10 * 0.05/12 = 0.04; payoff payment = 10.04; surplus = 39.96
    assert Decimal(a_m1["payment"]) == Decimal("10.04")
    assert Decimal(a_m1["balance"]) == Decimal("0")

    b_m1 = schedule_for(body, "b")[0]
    # interest 16.67; min 25 (principal 8.33) + 39.96 surplus applied in the
    # same month → balance 1000 - 8.33 - 39.96 = 951.71, payment 64.96.
    assert Decimal(b_m1["payment"]) == Decimal("64.96")
    assert Decimal(b_m1["balance"]) == Decimal("951.71")


@pytest.mark.asyncio
async def test_freed_minimum_joins_pool_next_month(env):
    """Existing behavior guard: a debt that pays off exactly (no surplus)
    frees its minimum for the following month's pool."""
    db, client = env
    await seed_debt(db, id="a", name="Small", balance="50", apr="0", min_payment="50")
    await seed_debt(db, id="b", name="Big", balance="500", apr="0", min_payment="25")

    r = await client.post("/api/debt/payoff-plan", json={"strategy": "snowball", "extra_monthly": "0"})
    assert r.status_code == 200
    body = r.json()

    b_sched = schedule_for(body, "b")
    assert Decimal(b_sched[0]["payment"]) == Decimal("25")   # month 1: A absorbs its own minimum
    assert Decimal(b_sched[1]["payment"]) == Decimal("75")   # month 2: A's freed 50 joins
    assert body["total_months"] >= 2
