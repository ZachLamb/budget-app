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


_MONEY_OPTIONAL = Field(default=None, ge=Decimal("0"), max_digits=14, decimal_places=2)


class PriorYearReturnUpdate(BaseModel):
    filing_status: Optional[str] = None
    # AGI can legitimately be negative -- a large rental or business loss
    # (e.g. this household's Airbnb) produces one. Do not add ge=0 here.
    agi: Optional[Decimal] = None
    taxable_income: Optional[Decimal] = _MONEY_OPTIONAL
    total_tax: Optional[Decimal] = _MONEY_OPTIONAL
    total_withheld: Optional[Decimal] = _MONEY_OPTIONAL
    itemized: bool = False
    itemized_amount: Optional[Decimal] = _MONEY_OPTIONAL
    # Signed by design: a rental/business loss on Schedule E is negative,
    # and that sign is the entire point of the field. Do not add ge=0 here.
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


class ExplainStepResponse(BaseModel):
    label: str
    amount: Decimal
    detail: str


class SafeHarborResponse(BaseModel):
    status: str
    test_used: str
    required_payment: Optional[Decimal] = None
    projected_payment: Optional[Decimal] = None
    shortfall: Optional[Decimal] = None
    per_period_to_close: Optional[Decimal] = None
    reason: str


class TaxProjectionResponse(BaseModel):
    agi: Decimal
    magi_for_pal: Decimal
    deduction_taken: Decimal
    deduction_kind: str
    standard_deduction: Decimal
    itemized_total: Decimal
    taxable_income: Decimal
    federal_income_tax: Decimal
    social_security_tax: Decimal
    medicare_tax: Decimal
    additional_medicare_tax: Decimal
    state_tax: Decimal
    total_liability: Decimal
    total_withheld_projected: Decimal
    refund_or_amount_due: Decimal
    effective_rate: Decimal
    schedule_e_allowed_loss: Decimal
    schedule_e_suspended_loss: Decimal
    safe_harbor: SafeHarborResponse
    explain: list[ExplainStepResponse]


class ProjectionEnvelope(BaseModel):
    """Never returns a fabricated projection. When inputs are incomplete,
    `available` is false and `missing` says what to enter."""
    year: int
    available: bool
    missing: list[str] = []
    remaining_pay_periods: int = 0
    projection: Optional[TaxProjectionResponse] = None


IMPACT_KINDS = {
    "extra_wages", "extra_pretax_401k", "extra_pretax_hsa",
    "extra_business_expense", "extra_itemized_deduction",
}


class ImpactRequest(BaseModel):
    year: int = Field(ge=2000, le=2100)
    kind: str
    amount: Decimal = Field(gt=Decimal("0"), max_digits=14, decimal_places=2)

    @field_validator("kind")
    @classmethod
    def _known_kind(cls, v: str) -> str:
        if v not in IMPACT_KINDS:
            raise ValueError(f"kind must be one of {sorted(IMPACT_KINDS)}")
        return v


class ImpactResponse(BaseModel):
    kind: str
    change_amount: Decimal
    amount_of_tax: Decimal      # positive = more tax, negative = less
    blended_rate_percent: Decimal
    note: str
