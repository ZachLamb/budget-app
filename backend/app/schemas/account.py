from typing import Literal, Optional

from pydantic import BaseModel, Field
from datetime import datetime
from decimal import Decimal

ACCOUNT_TYPES = Literal["checking", "savings", "credit", "loan", "investment", "cash", "other"]


class AccountCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    account_type: ACCOUNT_TYPES
    institution: Optional[str] = Field(None, max_length=200)
    currency: str = "USD"
    is_budget_account: bool = True
    starting_balance: Decimal = Decimal("0.00")
    interest_rate: Optional[Decimal] = None    # APR e.g. 0.2499 for 24.99%
    minimum_payment: Optional[Decimal] = None


class AccountUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=200)
    account_type: Optional[ACCOUNT_TYPES] = None
    institution: Optional[str] = None
    is_budget_account: Optional[bool] = None
    closed_at: Optional[datetime] = None
    interest_rate: Optional[Decimal] = None
    minimum_payment: Optional[Decimal] = None
    sync_enabled: Optional[bool] = None


class AccountResponse(BaseModel):
    id: str
    household_id: str
    name: str
    account_type: str
    institution: Optional[str]
    currency: str
    is_budget_account: bool
    simplefin_id: Optional[str]
    closed_at: Optional[datetime]
    created_at: datetime
    balance: Decimal = Decimal("0.00")
    interest_rate: Optional[Decimal] = None
    minimum_payment: Optional[Decimal] = None
    sync_enabled: bool = True
    last_synced_at: Optional[datetime] = None
    available_balance: Optional[Decimal] = None

    model_config = {"from_attributes": True}
