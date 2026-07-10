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


class CategoryGroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    sort_order: int = 0
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
    sort_order: int = 0
    goal_type: str = "none"
    goal_amount: Optional[Decimal] = None
    goal_target_date: Optional[date] = None

    @field_validator("name")
    @classmethod
    def _validate_name(cls, v: str) -> str:
        return clean_name(v)


class CategoryUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    group_id: Optional[str] = None
    sort_order: Optional[int] = None
    goal_type: Optional[str] = None
    goal_amount: Optional[Decimal] = None
    goal_target_date: Optional[date] = None

    @field_validator("name")
    @classmethod
    def _validate_name(cls, v: Optional[str]) -> Optional[str]:
        return clean_name(v)


class CategoryResponse(BaseModel):
    id: str
    group_id: str
    name: str
    sort_order: int
    goal_type: str
    goal_amount: Optional[Decimal]
    goal_target_date: Optional[date]
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
