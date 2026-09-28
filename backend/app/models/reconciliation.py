from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Optional

from sqlalchemy import String, DateTime, Date, ForeignKey, Numeric, Index, Integer
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Reconciliation(Base):
    """One statement, balanced and signed off.

    Kept as history rather than a live session. What matters later is
    "when did this account last agree with the bank, and against what
    figure" -- the answer to "is the balance on my screen trustworthy".
    A half-finished reconciliation is just a set of cleared flags, which
    the transactions already carry.
    """

    __tablename__ = "reconciliations"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    account_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("accounts.id"), index=True
    )
    statement_date: Mapped[date] = mapped_column(Date)
    statement_balance: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    #: What the app computed from cleared transactions at the moment of
    #: sign-off. Stored rather than recomputed, because recomputing it
    #: later gives a different answer once transactions are edited -- and
    #: the question this record answers is what was true that day.
    cleared_balance: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    #: Zero on a clean reconciliation. Non-zero means it was signed off
    #: with a known gap, which is a thing people legitimately do and
    #: should be able to see they did.
    difference: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    transaction_count: Mapped[int] = mapped_column(Integer, default=0)
    #: Set when the gap was closed with a balancing entry rather than by
    #: finding the missing transaction, so a later reader can tell the
    #: difference between "it balanced" and "it was made to balance".
    adjustment_transaction_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("transactions.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    __table_args__ = (
        Index("ix_reconciliations_account_date", "account_id", "statement_date"),
    )
