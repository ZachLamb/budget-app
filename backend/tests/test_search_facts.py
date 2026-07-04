"""Deterministic question-aware fact search (model-free).

compute_search_facts matches categories and payees by ILIKE against extracted
terms and returns SQL-computed spend sums — the LLM never does arithmetic.
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
from app.models import Account, Category, CategoryGroup, Household, Payee, Transaction
from app.services.ai.search import compute_search_facts, extract_terms


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


async def seed(db):
    # Category has no household_id column directly — it is scoped via its
    # CategoryGroup (see app/models/category.py + app/services/ai/budget.py).
    hh = Household(id="hh-1", name="Test")
    other = Household(id="hh-2", name="Other")
    acct = Account(id="a-1", household_id="hh-1", name="Checking", account_type="checking", is_budget_account=True)
    acct2 = Account(id="a-2", household_id="hh-2", name="Other", account_type="checking", is_budget_account=True)
    grp = CategoryGroup(id="g-1", household_id="hh-1", name="Fees")
    cat = Category(id="c-1", group_id="g-1", name="Foreign Transaction Fees")
    payee = Payee(id="p-1", household_id="hh-1", name="Chase Fee")
    db.add_all([hh, other, acct, acct2, grp, cat, payee])
    today = date.today()
    db.add_all([
        Transaction(id=str(uuid.uuid4()), account_id="a-1", category_id="c-1",
                    payee_id="p-1", date=today.replace(day=1), amount=Decimal("-4.50")),
        Transaction(id=str(uuid.uuid4()), account_id="a-1", category_id="c-1",
                    payee_id="p-1", date=today.replace(day=2), amount=Decimal("-3.25")),
        # Different household — must never appear.
        Transaction(id=str(uuid.uuid4()), account_id="a-2", category_id=None,
                    date=today.replace(day=1), amount=Decimal("-99.00")),
    ])
    await db.commit()


def test_extract_terms_drops_stopwords_and_short_words():
    terms = extract_terms('For all "Foreign Transaction Fees", how much this month?')
    assert "foreign transaction fees" in terms
    assert "for" not in terms and "all" not in terms
    assert len(terms) <= 6


@pytest.mark.asyncio
async def test_matches_category_and_sums_this_month(db):
    await seed(db)
    out = await compute_search_facts(db, "hh-1", "sum my Foreign Transaction Fees from the past month")
    cats = [m for m in out["matches"] if m["kind"] == "category"]
    assert cats and cats[0]["name"] == "Foreign Transaction Fees"
    assert cats[0]["this_month"] == pytest.approx(7.75)
    assert cats[0]["txn_count"] == 2


@pytest.mark.asyncio
async def test_never_leaks_other_household(db):
    await seed(db)
    out = await compute_search_facts(db, "hh-2", "foreign transaction fees")
    assert all(m["this_month"] != pytest.approx(7.75) for m in out["matches"])


@pytest.mark.asyncio
async def test_no_terms_returns_empty(db):
    await seed(db)
    out = await compute_search_facts(db, "hh-1", "so is it ok??")
    assert out["matches"] == []
