from pydantic import BaseModel, Field
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


class RecurringSuggestionResponse(BaseModel):
    dedupe_key: str
    payee_id: str
    payee_name: str
    suggested_amount: float
    suggested_frequency: str
    occurrence_count: int
    last_date: date
    suggested_next_date: date
    confidence: float
    category_id: Optional[str] = None
    account_id: Optional[str] = None


class RecurringSuggestionDismissBody(BaseModel):
    dedupe_key: str = Field(..., min_length=1, max_length=128)


class PriceChangeResponse(BaseModel):
    """A subscription whose latest charge stepped up from its established price."""

    payee_name: str
    previous_amount: float
    current_amount: float
    pct_change: float


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
