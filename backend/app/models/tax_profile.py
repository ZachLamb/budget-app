"""Persistence for the tax projection engine.

PRIVACY: these tables hold no SSN, no employer, no address, and no
document blobs. Prior-year returns are read for a defined field list and
the source PDF is never persisted. If a field is not consumed by the
engine, it does not belong here.
"""
from __future__ import annotations

import uuid
from datetime import date as _date, datetime, timezone
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import (
    JSON, Boolean, Date, DateTime, ForeignKey, Index, Integer, Numeric, String,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

_MONEY = Numeric(14, 2)


class TaxProfile(Base):
    """Replaces TaxSettings. The hand-entered marginal rate columns are
    gone -- those numbers are now computed by the engine."""
    __tablename__ = "tax_profiles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    household_id: Mapped[str] = mapped_column(String(36), ForeignKey("households.id"), unique=True, index=True)
    # Nullable on arrival: rows migrated from tax_settings have no status,
    # and the Taxes page prompts for the walkthrough.
    filing_status: Mapped[Optional[str]] = mapped_column(String(40), nullable=True, default=None)
    # The walkthrough's ANSWERS, not just its conclusion -- so next year it
    # can ask "is this still true?" and a surprising number can be traced
    # back to the answer that caused it.
    walkthrough_answers: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True, default=None)
    walkthrough_completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True, default=None)
    de_minimis_election: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class Paystub(Base):
    """One entered paystub. The engine anchors on the LATEST stub's YTD
    columns and projects the remainder of the year forward, so a mid-year
    raise self-corrects at the next entry."""
    __tablename__ = "paystubs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    household_id: Mapped[str] = mapped_column(String(36), ForeignKey("households.id"), index=True)
    pay_date: Mapped[_date] = mapped_column(Date)

    gross: Mapped[Decimal] = mapped_column(_MONEY)
    pretax_401k: Mapped[Decimal] = mapped_column(_MONEY, default=Decimal("0.00"))
    pretax_hsa: Mapped[Decimal] = mapped_column(_MONEY, default=Decimal("0.00"))
    pretax_other: Mapped[Decimal] = mapped_column(_MONEY, default=Decimal("0.00"))
    federal_withheld: Mapped[Decimal] = mapped_column(_MONEY, default=Decimal("0.00"))
    state_withheld: Mapped[Decimal] = mapped_column(_MONEY, default=Decimal("0.00"))
    ss_withheld: Mapped[Decimal] = mapped_column(_MONEY, default=Decimal("0.00"))
    medicare_withheld: Mapped[Decimal] = mapped_column(_MONEY, default=Decimal("0.00"))

    gross_ytd: Mapped[Decimal] = mapped_column(_MONEY)
    pretax_401k_ytd: Mapped[Decimal] = mapped_column(_MONEY, default=Decimal("0.00"))
    pretax_hsa_ytd: Mapped[Decimal] = mapped_column(_MONEY, default=Decimal("0.00"))
    pretax_other_ytd: Mapped[Decimal] = mapped_column(_MONEY, default=Decimal("0.00"))
    federal_withheld_ytd: Mapped[Decimal] = mapped_column(_MONEY, default=Decimal("0.00"))
    state_withheld_ytd: Mapped[Decimal] = mapped_column(_MONEY, default=Decimal("0.00"))
    ss_withheld_ytd: Mapped[Decimal] = mapped_column(_MONEY, default=Decimal("0.00"))
    medicare_withheld_ytd: Mapped[Decimal] = mapped_column(_MONEY, default=Decimal("0.00"))

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("uq_paystubs_household_pay_date", "household_id", "pay_date", unique=True),
    )


class PriorYearReturn(Base):
    """Fields extracted from a filed return. `total_tax` is Form 1040 line
    24 and drives the safe-harbor check; the carryforwards are values the
    user would never think to type from memory."""
    __tablename__ = "prior_year_returns"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    household_id: Mapped[str] = mapped_column(String(36), ForeignKey("households.id"), index=True)
    year: Mapped[int] = mapped_column(Integer)
    filing_status: Mapped[Optional[str]] = mapped_column(String(40), nullable=True, default=None)

    agi: Mapped[Optional[Decimal]] = mapped_column(_MONEY, nullable=True, default=None)
    taxable_income: Mapped[Optional[Decimal]] = mapped_column(_MONEY, nullable=True, default=None)
    total_tax: Mapped[Optional[Decimal]] = mapped_column(_MONEY, nullable=True, default=None)
    total_withheld: Mapped[Optional[Decimal]] = mapped_column(_MONEY, nullable=True, default=None)
    itemized: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    itemized_amount: Mapped[Optional[Decimal]] = mapped_column(_MONEY, nullable=True, default=None)
    schedule_e_net: Mapped[Optional[Decimal]] = mapped_column(_MONEY, nullable=True, default=None)
    passive_loss_carryforward: Mapped[Decimal] = mapped_column(_MONEY, default=Decimal("0.00"), server_default="0.00")
    capital_loss_carryforward: Mapped[Decimal] = mapped_column(_MONEY, default=Decimal("0.00"), server_default="0.00")
    qbi_carryforward: Mapped[Decimal] = mapped_column(_MONEY, default=Decimal("0.00"), server_default="0.00")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("uq_prior_year_returns_household_year", "household_id", "year", unique=True),
    )
