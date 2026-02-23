import uuid
from datetime import datetime, timezone
from sqlalchemy import String, DateTime, Boolean, Integer, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class AutoCategorizationRule(Base):
    __tablename__ = "auto_categorization_rules"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    household_id: Mapped[str] = mapped_column(String(36), ForeignKey("households.id"), index=True)
    priority: Mapped[int] = mapped_column(Integer, default=0)
    match_field: Mapped[str] = mapped_column(String(20))  # payee, amount, notes
    match_type: Mapped[str] = mapped_column(String(20))  # contains, exact, regex
    match_value: Mapped[str] = mapped_column(String(500))
    category_id: Mapped[str] = mapped_column(String(36), ForeignKey("categories.id"))
    source: Mapped[str] = mapped_column(String(20), default="manual")  # manual, llm_suggested, auto_detected
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("ix_rules_household_priority", "household_id", "priority"),
    )
