from __future__ import annotations

import uuid
from datetime import datetime, date, timezone
from decimal import Decimal
from typing import Optional
from sqlalchemy import String, DateTime, Date, Boolean, ForeignKey, Numeric, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    household_id: Mapped[str] = mapped_column(String(36), ForeignKey("households.id"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    account_type: Mapped[str] = mapped_column(String(50))  # checking, savings, credit, loan, investment, property
    institution: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    currency: Mapped[str] = mapped_column(String(3), default="USD")
    is_budget_account: Mapped[bool] = mapped_column(Boolean, default=True)
    simplefin_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, unique=True)
    closed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    transactions: Mapped[list["Transaction"]] = relationship(back_populates="account")
    snapshots: Mapped[list["AccountSnapshot"]] = relationship(back_populates="account", order_by="AccountSnapshot.date.desc()")

    __table_args__ = (
        Index("ix_accounts_household_type", "household_id", "account_type"),
    )


class AccountSnapshot(Base):
    __tablename__ = "account_snapshots"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    account_id: Mapped[str] = mapped_column(String(36), ForeignKey("accounts.id"), index=True)
    date: Mapped[date] = mapped_column(Date)
    balance: Mapped[Decimal] = mapped_column(Numeric(14, 2))

    account: Mapped["Account"] = relationship(back_populates="snapshots")

    __table_args__ = (
        Index("ix_account_snapshots_account_date", "account_id", "date", unique=True),
    )
