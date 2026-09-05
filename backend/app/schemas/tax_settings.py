from pydantic import BaseModel, field_validator
from decimal import Decimal
from typing import Optional


def _clean_rate(value: Optional[Decimal]) -> Optional[Decimal]:
    if value is None:
        return value
    if value < 0 or value > 100:
        raise ValueError("rate must be between 0 and 100")
    return value


class TaxSettingsUpdate(BaseModel):
    marginal_federal_rate: Optional[Decimal] = None
    marginal_state_rate: Optional[Decimal] = None
    current_federal_withholding_per_period: Optional[Decimal] = None
    remaining_pay_periods_this_year: Optional[int] = None

    @field_validator("marginal_federal_rate", "marginal_state_rate")
    @classmethod
    def _validate_rate(cls, v: Optional[Decimal]) -> Optional[Decimal]:
        return _clean_rate(v)

    @field_validator("remaining_pay_periods_this_year")
    @classmethod
    def _validate_periods(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and v < 0:
            raise ValueError("remaining_pay_periods_this_year must not be negative")
        return v


class TaxSettingsResponse(BaseModel):
    marginal_federal_rate: Optional[Decimal]
    marginal_state_rate: Optional[Decimal]
    current_federal_withholding_per_period: Optional[Decimal]
    remaining_pay_periods_this_year: Optional[int]

    model_config = {"from_attributes": True}
