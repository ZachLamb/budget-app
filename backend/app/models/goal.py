from __future__ import annotations

import uuid
from datetime import datetime, date, timezone
from decimal import Decimal
from typing import Optional
from sqlalchemy import String, DateTime, Date, Boolean, ForeignKey, Numeric, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class FinancialGoal(Base):
    """A user-defined financial goal (e.g. pay off Visa, build emergency fund, save for vacation)."""
    __tablename__ = "financial_goals"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    household_id: Mapped[str] = mapped_column(String(36), ForeignKey("households.id"), index=True)

    # Goal metadata
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    goal_type: Mapped[str] = mapped_column(String(50))  # debt_payoff, savings, emergency_fund, custom

    # Amounts
    target_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    current_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"))
    monthly_contribution: Mapped[Optional[Decimal]] = mapped_column(Numeric(14, 2), nullable=True)

    # Timeline
    target_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    # Optional link to an account (e.g. link debt goal to credit card account)
    account_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("accounts.id"), nullable=True)

    # State
    is_completed: Mapped[bool] = mapped_column(Boolean, default=False)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    sort_order: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
