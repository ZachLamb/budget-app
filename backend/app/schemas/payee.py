from pydantic import BaseModel
from datetime import datetime
from typing import Optional


class PayeeCreate(BaseModel):
    name: str
    default_category_id: Optional[str] = None
    transfer_account_id: Optional[str] = None


class PayeeUpdate(BaseModel):
    name: Optional[str] = None
    default_category_id: Optional[str] = None
    transfer_account_id: Optional[str] = None


class PayeeResponse(BaseModel):
    id: str
    household_id: str
    name: str
    default_category_id: Optional[str]
    transfer_account_id: Optional[str]
    created_at: datetime

    model_config = {"from_attributes": True}
