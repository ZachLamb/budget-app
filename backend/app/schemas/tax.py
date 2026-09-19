"""Request and response models for the tax routes.

Validation happens here, at the boundary, so the service layer can trust
its inputs. Amounts are non-negative; filing status is a closed set.
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

_MONEY = Field(default=Decimal("0.00"), ge=Decimal("0"), max_digits=14, decimal_places=2)
_MONEY_REQUIRED = Field(ge=Decimal("0"), max_digits=14, decimal_places=2)
_VALID_STATUSES = {
    "single", "married_joint", "married_separate",
    "head_of_household", "qualifying_surviving_spouse",
}


class TaxProfileUpdate(BaseModel):
    filing_status: Optional[str] = None
    walkthrough_answers: Optional[dict[str, Any]] = None
    de_minimis_election: Optional[bool] = None

    @field_validator("filing_status")
    @classmethod
    def _known_status(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in _VALID_STATUSES:
            raise ValueError(f"filing_status must be one of {sorted(_VALID_STATUSES)}")
        return v


class TaxProfileResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    filing_status: Optional[str] = None
    walkthrough_answers: Optional[dict[str, Any]] = None
    walkthrough_completed_at: Optional[datetime] = None
    de_minimis_election: bool = False


class PaystubCreate(BaseModel):
    pay_date: date
    gross: Decimal = _MONEY_REQUIRED
    pretax_401k: Decimal = _MONEY
    pretax_hsa: Decimal = _MONEY
    pretax_other: Decimal = _MONEY
    federal_withheld: Decimal = _MONEY
    state_withheld: Decimal = _MONEY
    ss_withheld: Decimal = _MONEY
    medicare_withheld: Decimal = _MONEY
    gross_ytd: Decimal = _MONEY_REQUIRED
    pretax_401k_ytd: Decimal = _MONEY
    pretax_hsa_ytd: Decimal = _MONEY
    pretax_other_ytd: Decimal = _MONEY
    federal_withheld_ytd: Decimal = _MONEY
    state_withheld_ytd: Decimal = _MONEY
    ss_withheld_ytd: Decimal = _MONEY
    medicare_withheld_ytd: Decimal = _MONEY

    @field_validator("pay_date")
    @classmethod
    def _sane_year(cls, v: date) -> date:
        if not (2000 <= v.year <= 2100):
            raise ValueError("pay_date year must be between 2000 and 2100")
        return v


class PaystubResponse(PaystubCreate):
    model_config = ConfigDict(from_attributes=True)

    id: str


class PriorYearReturnUpdate(BaseModel):
    filing_status: Optional[str] = None
    agi: Optional[Decimal] = None
    taxable_income: Optional[Decimal] = None
    total_tax: Optional[Decimal] = None
    total_withheld: Optional[Decimal] = None
    itemized: bool = False
    itemized_amount: Optional[Decimal] = None
    schedule_e_net: Optional[Decimal] = None
    passive_loss_carryforward: Decimal = _MONEY
    capital_loss_carryforward: Decimal = _MONEY
    qbi_carryforward: Decimal = _MONEY

    @field_validator("filing_status")
    @classmethod
    def _known_status(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in _VALID_STATUSES:
            raise ValueError(f"filing_status must be one of {sorted(_VALID_STATUSES)}")
        return v


class PriorYearReturnResponse(PriorYearReturnUpdate):
    model_config = ConfigDict(from_attributes=True)

    year: int
