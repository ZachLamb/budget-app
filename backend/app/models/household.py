import uuid
from datetime import datetime, date, timezone
from decimal import Decimal
from typing import Optional, List
from sqlalchemy import String, DateTime, Date, Integer, Boolean, Numeric, SmallInteger
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

    pay_frequency: Mapped[Optional[str]] = mapped_column(String(20), nullable=True, default=None)
    pay_last_confirmed_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True, default=None)
    budget_framing: Mapped[str] = mapped_column(String(20), default="strict", server_default="strict")

    cycle_review_step: Mapped[int] = mapped_column(SmallInteger, default=0, server_default="0")
    cycle_review_cycle_start: Mapped[Optional[date]] = mapped_column(Date, nullable=True, default=None)

    users: Mapped[List["User"]] = relationship(back_populates="household")
