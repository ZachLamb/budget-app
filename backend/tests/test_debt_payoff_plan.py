"""Tests for the debt payoff plan simulator.

Covers the ``POST /api/debt/payoff-plan`` route, specifically that freed
minimums from paid-off debts roll into the extra pool for the priority debt.

Uses the in-memory SQLite + dependency_overrides pattern from
``test_facts_endpoints.py`` so the suite runs without a real DB.
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
from app.models import Account, Household, Transaction, User


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


async def _seed_user(db):
    """Household + approved user; returns (household_id, token, headers)."""
    hid = str(uuid.uuid4())
    uid = str(uuid.uuid4())
    db.add(Household(id=hid, name="H"))
    db.add(User(id=uid, email=f"{uid}@t.io", name="T", password_hash=None,
                household_id=hid, role="owner", status="approved"))
    await db.commit()
    return hid, {"Authorization": f"Bearer {_token_for(uid)}"}


async def _seed_debt(db, hid, name, balance, apr, min_payment):
    """A credit account whose balance comes from one seeded charge."""
    aid = str(uuid.uuid4())
    db.add(Account(id=aid, household_id=hid, name=name, account_type="credit",
                   is_budget_account=True,
                   interest_rate=Decimal(apr), minimum_payment=Decimal(min_payment)))
    await db.flush()
    db.add(Transaction(account_id=aid, date=date.today(), amount=-Decimal(balance),
                       cleared=True))
    await db.commit()
    return aid


@pytest.mark.asyncio
async def test_freed_minimum_from_later_debt_rolls_to_priority_debt(fixture):
    session, _ = fixture
    hid, headers = await _seed_user(session)
    # Avalanche order: A (30% APR) before B (0% APR).
    # B pays off in month 1 (min 200 >= balance 200, no interest); from month 2 its
    # freed $200 minimum must join A's payment: 100 (min) + 200 (freed) = 300.
    # Note: APR=0 is used so B's $200 min payment exactly covers the $200 balance
    # in month 1 with no residual (non-zero APR would leave a small tail balance).
    a_id = await _seed_debt(session, hid, "A", "5000", "0.30", "100")
    await _seed_debt(session, hid, "B", "200", "0.00", "200")

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/api/debt/payoff-plan",
                                 json={"strategy": "avalanche", "extra_monthly": 0},
                                 headers=headers)
    assert resp.status_code == 200
    debt_a = next(d for d in resp.json()["debts"] if d["account_id"] == a_id)
    # Month 2 payment on A includes B's freed $200 minimum.
    assert Decimal(str(debt_a["schedule"][1]["payment"])) == Decimal("300.00")


@pytest.mark.asyncio
async def test_non_amortizing_debt_reports_no_payoff(fixture):
    session, _ = fixture
    hid, headers = await _seed_user(session)
    # 60% APR on $10k → $500/month interest; $25 minimum never amortizes.
    await _seed_debt(session, hid, "Trap", "10000", "0.60", "25")

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/api/debt/payoff-plan",
                                 json={"strategy": "avalanche", "extra_monthly": 0},
                                 headers=headers)
    assert resp.status_code == 200
    debt = resp.json()["debts"][0]
    assert debt["months_to_payoff"] is None
    assert debt["payoff_date"] is None
