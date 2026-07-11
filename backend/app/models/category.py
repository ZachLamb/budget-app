from __future__ import annotations

import uuid
from datetime import datetime, date, timezone
from decimal import Decimal
from typing import Optional
from sqlalchemy import String, DateTime, Date, Boolean, Integer, ForeignKey, Numeric, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class CategoryGroup(Base):
    __tablename__ = "category_groups"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    household_id: Mapped[str] = mapped_column(String(36), ForeignKey("households.id"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_income: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    categories: Mapped[list["Category"]] = relationship(back_populates="group", order_by="[Category.sort_order, Category.created_at]")

    __table_args__ = (
        Index("ix_category_groups_household_sort", "household_id", "sort_order"),
    )


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    group_id: Mapped[str] = mapped_column(String(36), ForeignKey("category_groups.id"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    goal_type: Mapped[str] = mapped_column(String(30), default="none")  # none, monthly_spending, savings_target, target_by_date
    goal_amount: Mapped[Optional[Decimal]] = mapped_column(Numeric(14, 2), nullable=True)
    goal_target_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    group: Mapped["CategoryGroup"] = relationship(back_populates="categories")
