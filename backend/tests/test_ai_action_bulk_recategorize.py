"""Tests for bulk_recategorize advisor action."""
from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import Account, Category, CategoryGroup, Household, Payee, Transaction
from app.services.ai.action import execute_parsed_action


@pytest_asyncio.fixture
async def db():
    engine = create_async_engine(
        "sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with maker() as session:
        yield session
    await engine.dispose()


async def seed(db: AsyncSession) -> tuple[str, str, str]:
    hh1 = Household(id="hh-1", name="One")
    hh2 = Household(id="hh-2", name="Two")
    acct1 = Account(
        id="a-1", household_id="hh-1", name="Checking", account_type="checking", is_budget_account=True
    )
    acct2 = Account(
        id="a-2", household_id="hh-2", name="Other", account_type="checking", is_budget_account=True
    )
    grp = CategoryGroup(id="g-1", household_id="hh-1", name="Fees")
    cat = Category(id="c-fees", group_id="g-1", name="Foreign Transaction Fees")
    payee = Payee(id="p-1", household_id="hh-1", name="Chase Foreign Fee")
    payee2 = Payee(id="p-2", household_id="hh-2", name="Chase Foreign Fee")
    db.add_all([hh1, hh2, acct1, acct2, grp, cat, payee, payee2])
    await db.flush()
    today = date.today()
    t1 = Transaction(
        id=str(uuid.uuid4()),
        account_id="a-1",
        payee_id="p-1",
        category_id=None,
        date=today,
        amount=Decimal("-4.50"),
    )
    t2 = Transaction(
        id=str(uuid.uuid4()),
        account_id="a-2",
        payee_id="p-2",
        category_id=None,
        date=today,
        amount=Decimal("-9.00"),
    )
    db.add_all([t1, t2])
    await db.commit()
    return t1.id, t2.id, cat.id


@pytest.mark.asyncio
async def test_reassigns_matching_transactions(db):
    t1_id, _, cat_id = await seed(db)
    out = await execute_parsed_action(
        db,
        "hh-1",
        "bulk_recategorize",
        {"payee_match": "foreign fee", "category_name": "Foreign Transaction Fees"},
    )
    assert out["success"] is True
    assert "1 transaction" in out["message"].lower()
    txn = (await db.execute(select(Transaction).where(Transaction.id == t1_id))).scalar_one()
    assert txn.category_id == cat_id


@pytest.mark.asyncio
async def test_never_touches_other_household(db):
    _, t2_id, _ = await seed(db)
    await execute_parsed_action(
        db,
        "hh-1",
        "bulk_recategorize",
        {"payee_match": "foreign fee", "category_name": "Foreign Transaction Fees"},
    )
    txn = (await db.execute(select(Transaction).where(Transaction.id == t2_id))).scalar_one()
    assert txn.category_id is None


@pytest.mark.asyncio
async def test_rejects_short_payee_match(db):
    await seed(db)
    out = await execute_parsed_action(
        db, "hh-1", "bulk_recategorize", {"payee_match": "ab", "category_name": "Foreign Transaction Fees"}
    )
    assert out["success"] is False


@pytest.mark.asyncio
async def test_fails_when_category_missing(db):
    await seed(db)
    out = await execute_parsed_action(
        db, "hh-1", "bulk_recategorize", {"payee_match": "foreign fee", "category_name": "Missing Cat"}
    )
    assert out["success"] is False
    assert "create it first" in out["message"].lower()
