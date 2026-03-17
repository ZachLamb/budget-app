from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Literal, Optional
from pydantic import BaseModel, Field, field_validator

GoalType = Literal["debt_payoff", "savings", "emergency_fund", "custom"]


class GoalCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = Field(default=None, max_length=2000)
    goal_type: GoalType
    target_amount: Decimal = Field(..., gt=Decimal("0"))
    current_amount: Decimal = Field(default=Decimal("0.00"), ge=Decimal("0"))
    monthly_contribution: Optional[Decimal] = Field(default=None, ge=Decimal("0"))
    target_date: Optional[date] = None
    account_id: Optional[str] = None
    sort_order: int = 0

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("Name is required")
        return trimmed


class GoalUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    description: Optional[str] = Field(default=None, max_length=2000)
    goal_type: Optional[GoalType] = None
    target_amount: Optional[Decimal] = Field(default=None, gt=Decimal("0"))
    current_amount: Optional[Decimal] = Field(default=None, ge=Decimal("0"))
    monthly_contribution: Optional[Decimal] = Field(default=None, ge=Decimal("0"))
    target_date: Optional[date] = None
    account_id: Optional[str] = None
    is_completed: Optional[bool] = None
    sort_order: Optional[int] = None

    @field_validator("name")
    @classmethod
    def validate_optional_name(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("Name is required")
        return trimmed


class GoalResponse(BaseModel):
    id: str
    household_id: str
    name: str
    description: Optional[str]
    goal_type: str
    target_amount: Decimal
    current_amount: Decimal
    monthly_contribution: Optional[Decimal]
    target_date: Optional[date]
    account_id: Optional[str]
    account_name: Optional[str] = None
    is_completed: bool
    completed_at: Optional[datetime]
    sort_order: int
    created_at: datetime

    # Computed fields
    progress_pct: float = 0.0
    months_remaining: Optional[int] = None

    model_config = {"from_attributes": True}
