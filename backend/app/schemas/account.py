from pydantic import BaseModel
from datetime import datetime
from decimal import Decimal
from typing import Optional


class AccountCreate(BaseModel):
    name: str
    account_type: str
    institution: Optional[str] = None
    currency: str = "USD"
    is_budget_account: bool = True
    starting_balance: Decimal = Decimal("0.00")


class AccountUpdate(BaseModel):
    name: Optional[str] = None
    account_type: Optional[str] = None
    institution: Optional[str] = None
    is_budget_account: Optional[bool] = None
    closed_at: Optional[datetime] = None


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

    model_config = {"from_attributes": True}
