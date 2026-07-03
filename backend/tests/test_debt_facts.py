"""Tests for the deterministic (model-free) per-account debt facts service.

Covers ``app.services.ai.debt_facts.compute_debt_facts`` — the grounding layer
for the rate-suggestion pipeline. No LLM is involved. These assert the
``has_apr`` / ``has_min_payment`` flags, the debt-account filter (mirrors
``app.api.routes.debt.list_debt_accounts``), and household scoping.

Uses an in-memory SQLite engine with self-contained debt-account factory
helpers, since the shared facts fixtures only seed budget accounts.
"""
from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import Account, Household, Transaction


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
    test_session = Session()
    try:
        yield test_session
    finally:
        await test_session.close()
        await engine.dispose()


async def _seed_household(session: AsyncSession, *, ai_enabled: bool = True) -> Household:
    household = Household(id=uuid.uuid4().hex, name="HH", ai_enabled=ai_enabled)
    session.add(household)
    await session.flush()
    return household


async def _add_debt_account(
    session: AsyncSession,
    household: Household,
    *,
    name: str,
    account_type: str = "credit",
    interest_rate: Decimal | None = None,
    minimum_payment: Decimal | None = None,
    balance: Decimal = Decimal("-500.00"),
) -> Account:
    """Add a debt (credit/loan) account whose balance is grounded by a single
    transaction so ``_compute_balances`` returns a deterministic value."""
    account = Account(
        household_id=household.id,
        name=name,
        account_type=account_type,
        is_budget_account=True,
        interest_rate=interest_rate,
        minimum_payment=minimum_payment,
    )
    session.add(account)
    await session.flush()
    session.add(
        Transaction(account_id=account.id, category_id=None, date=date.today(), amount=balance)
    )
    return account


@pytest.mark.asyncio
async def test_flags_missing_and_populated_fields(session):
    """An account missing both fields reports both flags False; a fully
    populated account reports both True, with the actual current values."""
    from app.services.ai.debt_facts import compute_debt_facts

    household = await _seed_household(session)
    missing = await _add_debt_account(session, household, name="Store Card")
    full = await _add_debt_account(
        session,
        household,
        name="Auto Loan",
        account_type="loan",
        interest_rate=Decimal("0.2299"),
        minimum_payment=Decimal("150.00"),
        balance=Decimal("-1200.00"),
    )
    await session.commit()

    result = await compute_debt_facts(session, household.id)
    by_id = {a["account_id"]: a for a in result["accounts"]}

    miss = by_id[missing.id]
    assert miss["has_apr"] is False
    assert miss["has_min_payment"] is False
    assert miss["current_apr"] is None
    assert miss["current_min_payment"] is None

    pop = by_id[full.id]
    assert pop["has_apr"] is True
    assert pop["has_min_payment"] is True
    assert pop["current_apr"] == 0.2299
    assert pop["current_min_payment"] == 150.0


@pytest.mark.asyncio
async def test_row_shape_and_balance(session):
    """Each row carries exactly the DebtFacts account keys with float balance."""
    from app.services.ai.debt_facts import compute_debt_facts

    household = await _seed_household(session)
    acct = await _add_debt_account(
        session, household, name="Visa", balance=Decimal("-750.00")
    )
    await session.commit()

    result = await compute_debt_facts(session, household.id)
    assert list(result.keys()) == ["accounts"]
    assert len(result["accounts"]) == 1
    row = result["accounts"][0]
    assert set(row.keys()) == {
        "account_id",
        "name",
        "type",
        "balance",
        "has_apr",
        "has_min_payment",
        "current_apr",
        "current_min_payment",
    }
    assert row["account_id"] == acct.id
    assert row["name"] == "Visa"
    assert row["type"] == "credit"
    assert isinstance(row["balance"], float)
    assert row["balance"] == -750.0


@pytest.mark.asyncio
async def test_excludes_non_debt_and_closed_accounts(session):
    """Only open credit/loan accounts are returned (mirrors list_debt_accounts):
    checking/savings and closed debt accounts are excluded."""
    from datetime import datetime, timezone

    from app.services.ai.debt_facts import compute_debt_facts

    household = await _seed_household(session)
    credit = await _add_debt_account(session, household, name="Credit", account_type="credit")
    await _add_debt_account(session, household, name="Cash", account_type="checking")
    await _add_debt_account(session, household, name="Nest Egg", account_type="savings")
    closed = await _add_debt_account(session, household, name="Old Loan", account_type="loan")
    closed.closed_at = datetime.now(timezone.utc)
    await session.commit()

    result = await compute_debt_facts(session, household.id)
    returned = {a["account_id"] for a in result["accounts"]}
    assert returned == {credit.id}


@pytest.mark.asyncio
async def test_household_scoped(session):
    """A debt account in another household never appears in the caller's facts."""
    from app.services.ai.debt_facts import compute_debt_facts

    household = await _seed_household(session)
    mine = await _add_debt_account(session, household, name="Mine")
    other_hh = await _seed_household(session)
    theirs = await _add_debt_account(session, other_hh, name="Theirs")
    await session.commit()

    result = await compute_debt_facts(session, household.id)
    returned = {a["account_id"] for a in result["accounts"]}
    assert mine.id in returned
    assert theirs.id not in returned
