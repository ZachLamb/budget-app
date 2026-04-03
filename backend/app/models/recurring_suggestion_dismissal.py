from __future__ import annotations

import uuid
from datetime import datetime, timezone
from sqlalchemy import String, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class RecurringSuggestionDismissal(Base):
    """Server-side 'don't suggest this payee+amount pattern again' for recurring detection."""

    __tablename__ = "recurring_suggestion_dismissals"
    __table_args__ = (
        UniqueConstraint("household_id", "dedupe_key", name="uq_recurring_suggestion_household_key"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    household_id: Mapped[str] = mapped_column(String(36), ForeignKey("households.id"), index=True)
    dedupe_key: Mapped[str] = mapped_column(String(128), index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
