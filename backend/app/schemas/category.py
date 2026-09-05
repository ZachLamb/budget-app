from pydantic import BaseModel, Field, field_validator
from datetime import datetime, date
from decimal import Decimal
from typing import Optional


def clean_name(value: Optional[str]) -> Optional[str]:
    """Strip surrounding whitespace; reject names that are blank after stripping."""
    if value is None:
        return value
    value = value.strip()
    if not value:
        raise ValueError("name must not be blank")
    return value


def clean_pct(value: Optional[Decimal]) -> Optional[Decimal]:
    """Reject deduction percentages outside the valid 0-100 range."""
    if value is None:
        return value
    if value < 0 or value > 100:
        raise ValueError("deduction_pct must be between 0 and 100")
    return value


class CategoryGroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    sort_order: Optional[int] = None
    is_income: bool = False

    @field_validator("name")
    @classmethod
    def _validate_name(cls, v: str) -> str:
        return clean_name(v)


class CategoryGroupUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    sort_order: Optional[int] = None
    is_income: Optional[bool] = None

    @field_validator("name")
    @classmethod
    def _validate_name(cls, v: Optional[str]) -> Optional[str]:
        return clean_name(v)


class CategoryCreate(BaseModel):
    group_id: str
    name: str = Field(min_length=1, max_length=255)
    sort_order: Optional[int] = None
    goal_type: str = "none"
    goal_amount: Optional[Decimal] = None
    goal_target_date: Optional[date] = None
    deductible: bool = False
    deduction_pct: Decimal = Decimal("100.00")
    tax_line: Optional[str] = None

    @field_validator("name")
    @classmethod
    def _validate_name(cls, v: str) -> str:
        return clean_name(v)

    @field_validator("deduction_pct")
    @classmethod
    def _validate_deduction_pct(cls, v: Decimal) -> Decimal:
        return clean_pct(v)


class CategoryUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    group_id: Optional[str] = None
    sort_order: Optional[int] = None
    goal_type: Optional[str] = None
    goal_amount: Optional[Decimal] = None
    goal_target_date: Optional[date] = None
    deductible: Optional[bool] = None
    deduction_pct: Optional[Decimal] = None
    tax_line: Optional[str] = None

    @field_validator("name")
    @classmethod
    def _validate_name(cls, v: Optional[str]) -> Optional[str]:
        return clean_name(v)

    @field_validator("deduction_pct")
    @classmethod
    def _validate_deduction_pct(cls, v: Optional[Decimal]) -> Optional[Decimal]:
        return clean_pct(v)


class CategoryResponse(BaseModel):
    id: str
    group_id: str
    name: str
    sort_order: int
    goal_type: str
    goal_amount: Optional[Decimal]
    goal_target_date: Optional[date]
    deductible: bool
    deduction_pct: Decimal
    tax_line: Optional[str]
    created_at: datetime

    model_config = {"from_attributes": True}


class CategoryGroupResponse(BaseModel):
    id: str
    household_id: str
    name: str
    sort_order: int
    is_income: bool
    created_at: datetime
    categories: list[CategoryResponse] = []

    model_config = {"from_attributes": True}


class CategoryUsageResponse(BaseModel):
    transactions: int = 0
    budget_entries: int = 0
    rules: int = 0
    payees: int = 0
    recurring: int = 0


class GroupOrderUpdate(BaseModel):
    ordered_ids: list[str] = Field(min_length=1)


class CategoryOrderUpdate(BaseModel):
    group_id: str
    ordered_ids: list[str] = Field(min_length=1)
