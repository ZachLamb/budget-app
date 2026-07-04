"""Tests for create_category advisor action."""
from __future__ import annotations

import uuid

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import Category, CategoryGroup, Household
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


async def seed_household(db: AsyncSession) -> None:
    db.add(Household(id="hh-1", name="Test"))
    await db.commit()


async def seed_household_with_category(db: AsyncSession, name: str) -> None:
    db.add(Household(id="hh-1", name="Test"))
    await db.flush()
    grp = CategoryGroup(id="g-1", household_id="hh-1", name="Fees")
    db.add(grp)
    await db.flush()
    db.add(Category(id="c-1", group_id="g-1", name=name))
    await db.commit()


@pytest.mark.asyncio
async def test_creates_category_and_default_group(db):
    await seed_household(db)
    out = await execute_parsed_action(
        db, "hh-1", "create_category", {"name": "Foreign Transaction Fees"}
    )
    assert out["success"] is True
    row = (
        await db.execute(
            select(Category)
            .join(CategoryGroup, Category.group_id == CategoryGroup.id)
            .where(CategoryGroup.household_id == "hh-1")
            .where(Category.name == "Foreign Transaction Fees")
        )
    ).scalar_one()
    assert row is not None


@pytest.mark.asyncio
async def test_existing_category_is_idempotent(db):
    await seed_household_with_category(db, "Foreign Transaction Fees")
    out = await execute_parsed_action(
        db, "hh-1", "create_category", {"name": "foreign transaction fees"}
    )
    assert out["success"] is True
    assert "already" in out["message"].lower()


@pytest.mark.asyncio
async def test_rejects_blank_name(db):
    await seed_household(db)
    out = await execute_parsed_action(db, "hh-1", "create_category", {"name": "  "})
    assert out["success"] is False
