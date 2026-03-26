from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import String, DateTime, Text, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class FsaReviewItem(Base):
    """Tracks FSA reimbursement claim status for individual transactions."""
    __tablename__ = "fsa_review_items"
    __table_args__ = (
        UniqueConstraint("household_id", "transaction_id", name="uq_fsa_household_txn"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    household_id: Mapped[str] = mapped_column(String(36), ForeignKey("households.id"), index=True)
    transaction_id: Mapped[str] = mapped_column(String(36), ForeignKey("transactions.id"), index=True)
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending | claimed | dismissed
    fsa_category: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    confidence: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
