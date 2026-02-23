import uuid
from datetime import datetime, date, timezone
from decimal import Decimal
from typing import Optional
from sqlalchemy import String, DateTime, Date, Boolean, ForeignKey, Numeric
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class RecurringTransaction(Base):
    __tablename__ = "recurring_transactions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    household_id: Mapped[str] = mapped_column(String(36), ForeignKey("households.id"), index=True)
    payee_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("payees.id"), nullable=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    category_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("categories.id"), nullable=True)
    frequency: Mapped[str] = mapped_column(String(20))  # weekly, biweekly, monthly, quarterly, yearly
    next_date: Mapped[date] = mapped_column(Date)
    account_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("accounts.id"), nullable=True)
    is_subscription: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
