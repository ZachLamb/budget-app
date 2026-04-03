from decimal import Decimal
from datetime import date
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, extract, case, literal_column
from typing import Optional

from app.database import get_db
from app.api.deps import get_household_id
from app.models import Transaction, Account, Category, CategoryGroup, Payee, ImportBatch, AccountSnapshot
from app.utils import parse_month

router = APIRouter()


@router.get("/spending-by-category")
async def spending_by_category(
    month: Optional[str] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    query = (
        select(
            Category.id,
            Category.name.label("category_name"),
            CategoryGroup.name.label("group_name"),
            func.sum(Transaction.amount).label("total"),
        )
        .join(Account, Transaction.account_id == Account.id)
        .join(Category, Transaction.category_id == Category.id)
        .join(CategoryGroup, Category.group_id == CategoryGroup.id)
        .where(
            Account.household_id == household_id,
            Transaction.parent_transaction_id.is_(None),
            Transaction.category_id.isnot(None),
            CategoryGroup.is_income.is_(False),
        )
        .group_by(Category.id, Category.name, CategoryGroup.name)
        .order_by(func.sum(Transaction.amount))
    )

    if month:
        year, month_num = parse_month(month)
        query = query.where(
            extract("year", Transaction.date) == year,
            extract("month", Transaction.date) == month_num,
        )
    if date_from:
        query = query.where(Transaction.date >= date_from)
    if date_to:
        query = query.where(Transaction.date <= date_to)

    result = await db.execute(query)
    rows = result.all()

    return [
        {
            "category_id": r[0],
            "category_name": r[1],
            "group_name": r[2],
            "total": float(r[3] or 0),
        }
        for r in rows
    ]


@router.get("/spending-by-month")
async def spending_by_month(
    months: int = Query(6, ge=1, le=24),
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    # Use a single expression + literal format string. Repeating to_char(..., "YYYY-MM") with a
    # bound format made GROUP BY/ORDER BY disagree under asyncpg (distinct $1/$2 params → PG 42803).
    _month_fmt = literal_column("'YYYY-MM'")
    month_key = func.to_char(Transaction.date, _month_fmt)
    query = (
        select(
            month_key.label("month"),
            func.sum(
                case(
                    (Transaction.amount < 0, Transaction.amount),
                    else_=Decimal(0),
                )
            ).label("expenses"),
            func.sum(
                case(
                    (Transaction.amount > 0, Transaction.amount),
                    else_=Decimal(0),
                )
            ).label("income"),
        )
        .join(Account, Transaction.account_id == Account.id)
        .where(
            Account.household_id == household_id,
            Transaction.parent_transaction_id.is_(None),
        )
        .group_by(month_key)
        .order_by(month_key.desc())
        .limit(months)
    )

    result = await db.execute(query)
    rows = result.all()

    return [
        {
            "month": r[0],
            "expenses": float(r[1] or 0),
            "income": float(r[2] or 0),
            "net": float((r[2] or 0) + (r[1] or 0)),
        }
        for r in reversed(list(rows))
    ]


@router.get("/top-payees")
async def top_payees(
    month: Optional[str] = None,
    limit: int = Query(10, ge=1, le=50),
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    query = (
        select(
            Payee.name,
            func.sum(Transaction.amount).label("total"),
            func.count(Transaction.id).label("count"),
        )
        .join(Account, Transaction.account_id == Account.id)
        .join(Payee, Transaction.payee_id == Payee.id)
        .where(
            Account.household_id == household_id,
            Transaction.parent_transaction_id.is_(None),
            Transaction.amount < 0,
        )
        .group_by(Payee.name)
        .order_by(func.sum(Transaction.amount))
        .limit(limit)
    )

    if month:
        year, month_num = parse_month(month)
        query = query.where(
            extract("year", Transaction.date) == year,
            extract("month", Transaction.date) == month_num,
        )

    result = await db.execute(query)
    return [
        {"payee_name": r[0], "total": float(r[1] or 0), "count": r[2]}
        for r in result.all()
    ]


@router.get("/imports")
async def list_imports(
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ImportBatch, Account.name.label("account_name"))
        .join(Account, ImportBatch.account_id == Account.id)
        .where(Account.household_id == household_id)
        .order_by(ImportBatch.imported_at.desc())
        .limit(50)
    )
    rows = result.all()
    return [
        {
            "id": r[0].id,
            "account_name": r[1],
            "source": r[0].source,
            "filename": r[0].filename,
            "transaction_count": r[0].transaction_count,
            "imported_at": r[0].imported_at.isoformat(),
        }
        for r in rows
    ]


@router.get("/accounts/{account_id}/balance-history")
async def account_balance_history(
    account_id: str,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    acct_result = await db.execute(
        select(Account).where(Account.id == account_id, Account.household_id == household_id)
    )
    account = acct_result.scalar_one_or_none()
    if not account:
        return []

    if account.is_budget_account:
        query = (
            select(
                Transaction.date,
                func.sum(Transaction.amount).label("daily_change"),
            )
            .where(
                Transaction.account_id == account_id,
                Transaction.parent_transaction_id.is_(None),
            )
            .group_by(Transaction.date)
            .order_by(Transaction.date)
        )
        result = await db.execute(query)
        rows = result.all()

        running = Decimal(0)
        history = []
        for row in rows:
            running += row[1]
            history.append({"date": row[0].isoformat(), "balance": float(running)})
        return history
    else:
        result = await db.execute(
            select(AccountSnapshot)
            .where(AccountSnapshot.account_id == account_id)
            .order_by(AccountSnapshot.date)
        )
        return [
            {"date": s.date.isoformat(), "balance": float(s.balance)}
            for s in result.scalars().all()
        ]
