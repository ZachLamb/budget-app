import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional, List
from sqlalchemy import String, DateTime, Integer, Boolean, Numeric
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class Household(Base):
    __tablename__ = "households"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    simplefin_access_url: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True, default=None)
    sync_interval_hours: Mapped[int] = mapped_column(Integer, default=4)
    ai_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    debt_strategy: Mapped[Optional[str]] = mapped_column(String(20), nullable=True, default=None)
    debt_extra_monthly: Mapped[Optional[Decimal]] = mapped_column(Numeric(14, 2), nullable=True, default=None)

    users: Mapped[List["User"]] = relationship(back_populates="household")
