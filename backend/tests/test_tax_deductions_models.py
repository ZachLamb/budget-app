"""Model-level tests for the tax deductions columns on Category/Transaction.

The TaxSettings round-trip test that used to live here is gone -- that
model was removed by the tax-projection-engine migration; TaxProfile's
round-trip is covered by tests/test_tax_models.py instead."""
from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool
from sqlalchemy import select

from app.database import Base
from app.models import Category, CategoryGroup, Household, Transaction, Account, User


@pytest_asyncio.fixture()
async def db_session():
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False)
    session = Session()
    try:
        yield session
    finally:
        await session.close()
        await engine.dispose()


@pytest.mark.asyncio
async def test_category_deduction_defaults(db_session):
    household = Household(id=str(uuid.uuid4()), name="H")
    db_session.add(household)
    await db_session.flush()
    group = CategoryGroup(id=str(uuid.uuid4()), household_id=household.id, name="Rental")
    db_session.add(group)
    await db_session.flush()
    category = Category(id=str(uuid.uuid4()), group_id=group.id, name="Cleaning")
    db_session.add(category)
    await db_session.commit()

    result = await db_session.execute(select(Category).where(Category.id == category.id))
    saved = result.scalar_one()
    assert saved.deductible is False
    assert saved.deduction_pct == Decimal("100.00")
    assert saved.tax_line is None


@pytest.mark.asyncio
async def test_transaction_deduction_override_nullable(db_session):
    household = Household(id=str(uuid.uuid4()), name="H")
    db_session.add(household)
    await db_session.flush()
    account = Account(id=str(uuid.uuid4()), household_id=household.id, name="Checking", account_type="checking")
    db_session.add(account)
    await db_session.flush()
    txn = Transaction(id=str(uuid.uuid4()), account_id=account.id, date=date(2026, 1, 1), amount=Decimal("10.00"))
    db_session.add(txn)
    await db_session.commit()

    result = await db_session.execute(select(Transaction).where(Transaction.id == txn.id))
    saved = result.scalar_one()
    assert saved.deduction_pct_override is None
