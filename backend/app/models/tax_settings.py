from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional
from sqlalchemy import String, DateTime, Integer, ForeignKey, Numeric
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class TaxSettings(Base):
    """Manually entered tax-rate and withholding inputs, one row per household.

    Used only to compute a rough estimated-tax-savings and withholding nudge
    on the deductions summary — never used for IRS bracket math or filing
    guidance (see docs/superpowers/specs/2026-09-05-tax-deductions-design.md).
    """
    __tablename__ = "tax_settings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    household_id: Mapped[str] = mapped_column(String(36), ForeignKey("households.id"), unique=True, index=True)
    marginal_federal_rate: Mapped[Optional[Decimal]] = mapped_column(Numeric(5, 2), nullable=True, default=None)
    marginal_state_rate: Mapped[Optional[Decimal]] = mapped_column(Numeric(5, 2), nullable=True, default=None)
    current_federal_withholding_per_period: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2), nullable=True, default=None)
    remaining_pay_periods_this_year: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
