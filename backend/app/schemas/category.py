from pydantic import BaseModel
from datetime import datetime, date
from decimal import Decimal
from typing import Optional


class CategoryGroupCreate(BaseModel):
    name: str
    sort_order: int = 0
    is_income: bool = False


class CategoryGroupUpdate(BaseModel):
    name: Optional[str] = None
    sort_order: Optional[int] = None
    is_income: Optional[bool] = None


class CategoryCreate(BaseModel):
    group_id: str
    name: str
    sort_order: int = 0
    goal_type: str = "none"
    goal_amount: Optional[Decimal] = None
    goal_target_date: Optional[date] = None


class CategoryUpdate(BaseModel):
    name: Optional[str] = None
    group_id: Optional[str] = None
    sort_order: Optional[int] = None
    goal_type: Optional[str] = None
    goal_amount: Optional[Decimal] = None
    goal_target_date: Optional[date] = None


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
