from __future__ import annotations

import uuid
from datetime import datetime, date, timezone
from decimal import Decimal
from typing import Optional
from sqlalchemy import String, DateTime, Date, Boolean, ForeignKey, Numeric, Text, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class Transaction(Base):
    __tablename__ = "transactions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    account_id: Mapped[str] = mapped_column(String(36), ForeignKey("accounts.id"), index=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    payee_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("payees.id"), nullable=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    category_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("categories.id"), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    cleared: Mapped[bool] = mapped_column(Boolean, default=False)
    reconciled: Mapped[bool] = mapped_column(Boolean, default=False)
    is_split: Mapped[bool] = mapped_column(Boolean, default=False)
    parent_transaction_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("transactions.id"), nullable=True)
    transfer_pair_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    import_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("import_batches.id"), nullable=True)
    simplefin_transaction_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    account: Mapped["Account"] = relationship(back_populates="transactions")
    sub_transactions: Mapped[list["Transaction"]] = relationship(
        back_populates="parent_transaction",
        foreign_keys="Transaction.parent_transaction_id",
    )
    parent_transaction: Mapped[Optional["Transaction"]] = relationship(
        back_populates="sub_transactions",
        remote_side="Transaction.id",
        foreign_keys="Transaction.parent_transaction_id",
    )

    __table_args__ = (
        Index("ix_transactions_account_date", "account_id", "date"),
        Index("ix_transactions_category", "category_id"),
        Index("ix_transactions_simplefin_id", "simplefin_transaction_id", unique=True),
        Index("ix_transactions_parent", "parent_transaction_id"),
        Index("ix_transactions_transfer_pair", "transfer_pair_id"),
    )
