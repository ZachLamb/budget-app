from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import String, DateTime, Integer, ForeignKey, Index, Text, text
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class SyncLog(Base):
    __tablename__ = "sync_log"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    household_id: Mapped[str] = mapped_column(String(36), ForeignKey("households.id"), index=True)
    provider: Mapped[str] = mapped_column(String(20))  # simplefin, plaid
    status: Mapped[str] = mapped_column(String(20))  # success, partial, error, in_progress
    accounts_synced: Mapped[int] = mapped_column(Integer, default=0)
    transactions_imported: Mapped[int] = mapped_column(Integer, default=0)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        # At most ONE in-progress sync per household, enforced by the DB so
        # concurrent claimers (scheduler + manual trigger, or multi-replica
        # schedulers) can't both insert. See services.sync.claim.try_claim_sync.
        Index(
            "uq_sync_log_household_in_progress",
            "household_id",
            unique=True,
            postgresql_where=text("status = 'in_progress'"),
            sqlite_where=text("status = 'in_progress'"),
        ),
    )
