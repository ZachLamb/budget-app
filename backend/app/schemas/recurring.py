from pydantic import BaseModel
from datetime import datetime, date
from decimal import Decimal
from typing import Optional


class RecurringCreate(BaseModel):
    payee_id: Optional[str] = None
    amount: Decimal
    category_id: Optional[str] = None
    frequency: str  # weekly, biweekly, monthly, quarterly, yearly
    next_date: date
    account_id: Optional[str] = None
    is_subscription: bool = False


class RecurringUpdate(BaseModel):
    payee_id: Optional[str] = None
    amount: Optional[Decimal] = None
    category_id: Optional[str] = None
    frequency: Optional[str] = None
    next_date: Optional[date] = None
    account_id: Optional[str] = None
    is_subscription: Optional[bool] = None


class RecurringResponse(BaseModel):
    id: str
    household_id: str
    payee_id: Optional[str]
    payee_name: Optional[str] = None
    amount: Decimal
    category_id: Optional[str]
    category_name: Optional[str] = None
    frequency: str
    next_date: date
    account_id: Optional[str]
    account_name: Optional[str] = None
    is_subscription: bool
    created_at: datetime

    model_config = {"from_attributes": True}
