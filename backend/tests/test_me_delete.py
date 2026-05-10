"""Tests for DELETE /api/me.

Same in-memory SQLite + dependency_overrides pattern as test_me_export.py.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from jose import jwt
from sqlalchemy import select
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
    RecurringTransaction,
    Transaction,
    User,
    WebAuthnCredential,
)


_CONFIRM = "delete my account and all data"


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


async def _make_household(session: AsyncSession, name: str = "HH") -> Household:
    h = Household(id=uuid.uuid4().hex, name=name)
    session.add(h)
    await session.flush()
    return h


async def _make_user(
    session: AsyncSession,
    *,
    email: str,
    household: Household,
    name: str = "Test",
) -> User:
    u = User(
        id=uuid.uuid4().hex,
        email=email,
        name=name,
        password_hash=None,
        household_id=household.id,
        role="owner",
    )
    session.add(u)
    await session.flush()
    return u


@pytest.mark.asyncio
async def test_delete_requires_auth(fixture):
    _session, _engine = fixture
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.request("DELETE", "/api/me", json={"confirm": _CONFIRM})
    assert r.status_code in (401, 403), r.text


@pytest.mark.asyncio
async def test_delete_rejects_wrong_confirm(fixture):
    session, _engine = fixture
    hh = await _make_household(session)
    user = await _make_user(session, email="x@example.com", household=hh)
    await session.commit()

    headers = {"Authorization": f"Bearer {_token_for(user.id)}"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.request(
            "DELETE",
            "/api/me",
            headers=headers,
            json={"confirm": "delete me"},
        )
    assert r.status_code == 400, r.text

    # User is still there.
    res = await session.execute(select(User).where(User.id == user.id))
    assert res.scalar_one_or_none() is not None


@pytest.mark.asyncio
async def test_delete_succeeds_solo_user_wipes_household(fixture):
    session, _engine = fixture
    hh = await _make_household(session, name="Solo")
    user = await _make_user(session, email="solo@example.com", household=hh)

    # Seed a representative slice of household data.
    group = CategoryGroup(household_id=hh.id, name="G", sort_order=0)
    session.add(group)
    await session.flush()
    cat = Category(group_id=group.id, name="C", sort_order=0)
    session.add(cat)
    payee = Payee(household_id=hh.id, name="P")
    session.add(payee)
    account = Account(household_id=hh.id, name="A", account_type="checking")
    session.add(account)
    await session.flush()
    txn = Transaction(account_id=account.id, date=datetime(2026, 5, 1).date(), amount=-1)
    session.add(txn)
    budget = BudgetAssignment(
        household_id=hh.id, category_id=cat.id, month="2026-05", assigned_amount=100
    )
    session.add(budget)
    rule = AutoCategorizationRule(
        household_id=hh.id,
        priority=0,
        match_field="payee",
        match_type="exact",
        match_value="P",
        category_id=cat.id,
    )
    session.add(rule)
    goal = FinancialGoal(
        household_id=hh.id, name="g", goal_type="savings", target_amount=1000
    )
    session.add(goal)
    rec = RecurringTransaction(
        household_id=hh.id, amount=10, frequency="monthly", next_date=datetime(2026, 6, 1).date()
    )
    session.add(rec)
    consent = LlmConsent(user_id=user.id, feature="explain_charge", tier=4)
    session.add(consent)
    audit = LlmAudit(
        user_id=user.id, feature="explain_charge", tier=4, status=200,
    )
    session.add(audit)
    cred = WebAuthnCredential(
        user_id=user.id,
        credential_id=b"cred-id",
        public_key=b"pk",
    )
    session.add(cred)
    await session.commit()

    headers = {"Authorization": f"Bearer {_token_for(user.id)}"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.request(
            "DELETE",
            "/api/me",
            headers=headers,
            json={"confirm": _CONFIRM},
        )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body == {
        "ok": True,
        "deleted_user_id": user.id,
        "household_deleted": True,
    }

    # Check downstream state on the same session.
    assert (await session.execute(select(User).where(User.id == user.id))).scalar_one_or_none() is None
    assert (await session.execute(select(LlmConsent).where(LlmConsent.user_id == user.id))).scalar_one_or_none() is None
    assert (await session.execute(select(LlmAudit).where(LlmAudit.user_id == user.id))).scalar_one_or_none() is None
    assert (await session.execute(select(WebAuthnCredential).where(WebAuthnCredential.user_id == user.id))).scalar_one_or_none() is None
    assert (await session.execute(select(Household).where(Household.id == hh.id))).scalar_one_or_none() is None
    assert (await session.execute(select(Account).where(Account.household_id == hh.id))).scalar_one_or_none() is None
    assert (await session.execute(select(Transaction).where(Transaction.account_id == account.id))).scalar_one_or_none() is None
    assert (await session.execute(select(CategoryGroup).where(CategoryGroup.household_id == hh.id))).scalar_one_or_none() is None
    assert (await session.execute(select(Category).where(Category.group_id == group.id))).scalar_one_or_none() is None
    assert (await session.execute(select(Payee).where(Payee.household_id == hh.id))).scalar_one_or_none() is None
    assert (await session.execute(select(BudgetAssignment).where(BudgetAssignment.household_id == hh.id))).scalar_one_or_none() is None
    assert (await session.execute(select(AutoCategorizationRule).where(AutoCategorizationRule.household_id == hh.id))).scalar_one_or_none() is None
    assert (await session.execute(select(FinancialGoal).where(FinancialGoal.household_id == hh.id))).scalar_one_or_none() is None
    assert (await session.execute(select(RecurringTransaction).where(RecurringTransaction.household_id == hh.id))).scalar_one_or_none() is None


@pytest.mark.asyncio
async def test_delete_keeps_household_when_other_user_remains(fixture):
    session, _engine = fixture
    hh = await _make_household(session, name="Pair")
    user_a = await _make_user(session, email="a@example.com", household=hh)
    user_b = await _make_user(session, email="b@example.com", household=hh)

    # Seed shared data (owned by household).
    account = Account(household_id=hh.id, name="Shared", account_type="checking")
    session.add(account)
    await session.flush()
    txn = Transaction(
        account_id=account.id, date=datetime(2026, 5, 1).date(), amount=-5
    )
    session.add(txn)

    # Per-user data for user_a (must go away) and user_b (must remain).
    consent_a = LlmConsent(user_id=user_a.id, feature="explain_charge", tier=4)
    consent_b = LlmConsent(user_id=user_b.id, feature="explain_charge", tier=4)
    session.add_all([consent_a, consent_b])
    audit_a = LlmAudit(user_id=user_a.id, feature="explain_charge", tier=4, status=200)
    audit_b = LlmAudit(user_id=user_b.id, feature="explain_charge", tier=4, status=200)
    session.add_all([audit_a, audit_b])
    await session.commit()

    headers = {"Authorization": f"Bearer {_token_for(user_a.id)}"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.request(
            "DELETE",
            "/api/me",
            headers=headers,
            json={"confirm": _CONFIRM},
        )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["deleted_user_id"] == user_a.id
    assert body["household_deleted"] is False

    # User A and her per-user data: gone.
    assert (await session.execute(select(User).where(User.id == user_a.id))).scalar_one_or_none() is None
    assert (await session.execute(select(LlmConsent).where(LlmConsent.user_id == user_a.id))).scalar_one_or_none() is None
    assert (await session.execute(select(LlmAudit).where(LlmAudit.user_id == user_a.id))).scalar_one_or_none() is None

    # User B and household-shared data: still there.
    assert (await session.execute(select(User).where(User.id == user_b.id))).scalar_one_or_none() is not None
    assert (await session.execute(select(LlmConsent).where(LlmConsent.user_id == user_b.id))).scalar_one_or_none() is not None
    assert (await session.execute(select(LlmAudit).where(LlmAudit.user_id == user_b.id))).scalar_one_or_none() is not None
    assert (await session.execute(select(Household).where(Household.id == hh.id))).scalar_one_or_none() is not None
    assert (await session.execute(select(Account).where(Account.id == account.id))).scalar_one_or_none() is not None
    assert (await session.execute(select(Transaction).where(Transaction.id == txn.id))).scalar_one_or_none() is not None


@pytest.mark.asyncio
async def test_delete_rate_limit_429_after_3(fixture):
    session, _engine = fixture
    hh = await _make_household(session)
    user = await _make_user(session, email="rl@example.com", household=hh)
    await session.commit()

    # Rate limit check runs BEFORE the confirm check, so 3 wrong-confirm
    # attempts each consume a budget slot (returning 400). The 4th attempt
    # — even with the correct confirm — must 429.
    headers = {"Authorization": f"Bearer {_token_for(user.id)}"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        for i in range(3):
            r = await client.request(
                "DELETE",
                "/api/me",
                headers=headers,
                json={"confirm": "wrong"},
            )
            assert r.status_code == 400, f"call {i + 1}: {r.text}"
        # 4th attempt — even with the correct confirm — must 429.
        r = await client.request(
            "DELETE",
            "/api/me",
            headers=headers,
            json={"confirm": _CONFIRM},
        )
        assert r.status_code == 429, r.text

    # User must NOT have been deleted by a 429'd request.
    res = await session.execute(select(User).where(User.id == user.id))
    assert res.scalar_one_or_none() is not None
