from __future__ import annotations

import uuid
from decimal import Decimal
from sqlalchemy import String, ForeignKey, Numeric, Index
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class BudgetAssignment(Base):
    __tablename__ = "budget_assignments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    household_id: Mapped[str] = mapped_column(String(36), ForeignKey("households.id"), index=True)
    category_id: Mapped[str] = mapped_column(String(36), ForeignKey("categories.id"))
    month: Mapped[str] = mapped_column(String(7))  # YYYY-MM
    assigned_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0)

    __table_args__ = (
        Index("ix_budget_household_month", "household_id", "month"),
        Index("ix_budget_category_month", "category_id", "month", unique=True),
    )
