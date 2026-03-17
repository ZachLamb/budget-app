from __future__ import annotations

from typing import Optional

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


def parse_month(month: str) -> tuple[int, int]:
    """Parse YYYY-MM string, returning (year, month_num). Raises HTTPException on invalid input."""
    try:
        parts = month.split("-")
        if len(parts) != 2:
            raise ValueError
        year, month_num = int(parts[0]), int(parts[1])
        if month_num < 1 or month_num > 12:
            raise ValueError
        return year, month_num
    except (ValueError, IndexError):
        raise HTTPException(status_code=400, detail="Invalid month format. Use YYYY-MM.")


def escape_like(value: str) -> str:
    """Escape SQL LIKE special characters so they are matched literally."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


async def validate_category_ownership(
    db: AsyncSession, category_id: Optional[str], household_id: str
) -> None:
    """Raise 404 if category_id does not belong to the household."""
    if not category_id:
        return
    from app.models import Category, CategoryGroup

    result = await db.execute(
        select(Category.id)
        .join(CategoryGroup, Category.group_id == CategoryGroup.id)
        .where(Category.id == category_id, CategoryGroup.household_id == household_id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Category not found")


async def validate_payee_ownership(
    db: AsyncSession, payee_id: Optional[str], household_id: str
) -> None:
    """Raise 404 if payee_id does not belong to the household."""
    if not payee_id:
        return
    from app.models import Payee

    result = await db.execute(
        select(Payee.id).where(Payee.id == payee_id, Payee.household_id == household_id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Payee not found")


async def validate_account_ownership(
    db: AsyncSession, account_id: Optional[str], household_id: str
) -> None:
    """Raise 404 if account_id does not belong to the household."""
    if not account_id:
        return
    from app.models import Account

    result = await db.execute(
        select(Account.id).where(Account.id == account_id, Account.household_id == household_id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Account not found")
