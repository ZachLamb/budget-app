"""Regression: spending-by-month must use one month_key expression for PG + asyncpg."""

from __future__ import annotations

from decimal import Decimal

from sqlalchemy import MetaData, Table, Column, String, Date, Numeric, case, func, literal_column, select
from sqlalchemy.dialects import postgresql


def test_spending_by_month_sql_uses_literal_format_not_duplicate_bindparams() -> None:
    m = MetaData()
    accounts = Table(
        "accounts",
        m,
        Column("id", String(36)),
        Column("household_id", String(36)),
    )
    transactions = Table(
        "transactions",
        m,
        Column("date", Date),
        Column("amount", Numeric(14, 2)),
        Column("account_id", String(36)),
        Column("parent_transaction_id", String(36)),
    )
    T, A = transactions, accounts
    _month_fmt = literal_column("'YYYY-MM'")
    month_key = func.to_char(T.c.date, _month_fmt)
    q = (
        select(
            month_key.label("month"),
            func.sum(case((T.c.amount < 0, T.c.amount), else_=Decimal(0))).label("expenses"),
            func.sum(case((T.c.amount > 0, T.c.amount), else_=Decimal(0))).label("income"),
        )
        .join(A, T.c.account_id == A.c.id)
        .where(A.c.household_id == "h", T.c.parent_transaction_id.is_(None))
        .group_by(month_key)
        .order_by(month_key.desc())
        .limit(6)
    )
    sql = str(q.compile(dialect=postgresql.dialect()))
    assert "to_char(transactions.date, 'YYYY-MM')" in sql
    assert sql.count("to_char(transactions.date, 'YYYY-MM')") == 3
