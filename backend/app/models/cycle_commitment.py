from __future__ import annotations

import uuid
from datetime import datetime, date, timezone
from typing import Any, Optional

from sqlalchemy import String, DateTime, Date, ForeignKey, Index, JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class CycleCommitment(Base):
    """A short-lived intent for the current pay cycle (observe → decide flow)."""

    __tablename__ = "cycle_commitments"
    __table_args__ = (
        Index("ix_cycle_commitments_household_cycle", "household_id", "cycle_start_date"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    household_id: Mapped[str] = mapped_column(String(36), ForeignKey("households.id"), index=True)
    cycle_start_date: Mapped[date] = mapped_column(Date)
    cycle_end_date: Mapped[date] = mapped_column(Date)
    title: Mapped[str] = mapped_column(String(300))
    kind: Mapped[str] = mapped_column(String(20))
    payload: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="active")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
