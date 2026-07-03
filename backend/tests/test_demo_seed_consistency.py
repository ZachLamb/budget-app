"""Internal-consistency checks for the demo seed.

APR must be stored as a fraction (0.2199 = 21.99%) — the AccountUpdate
validator and the plan-page renderer (×100) both assume it.
"""
from __future__ import annotations

from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.demo_seed import seed_demo_data
from app.models import Account


@pytest.mark.asyncio
async def test_seeded_interest_rates_are_fractions():
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False)
    try:
        await seed_demo_data(Session)
        async with Session() as db:
            rates = (
                await db.execute(
                    select(Account.interest_rate).where(Account.interest_rate.isnot(None))
                )
            ).scalars().all()
            assert rates, "expected seeded debt accounts with an APR"
            for r in rates:
                assert Decimal("0") <= r <= Decimal("1"), f"APR {r} is not a fraction"
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_prior_month_charity_assignment_guarantees_carryover():
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False)
    try:
        await seed_demo_data(Session)
        async with Session() as db:
            from app.models import BudgetAssignment, Category
            rows = (
                await db.execute(
                    select(BudgetAssignment.month, BudgetAssignment.assigned_amount)
                    .join(Category, BudgetAssignment.category_id == Category.id)
                    .where(Category.name == "Charity")
                )
            ).all()
            by_month = dict(rows)
            months = sorted(by_month)
            assert len(months) == 3
            assert by_month[months[0]] == Decimal("50.00")
            assert by_month[months[1]] == Decimal("50.00")
            assert by_month[months[2]] == Decimal("25.00")
    finally:
        await engine.dispose()
