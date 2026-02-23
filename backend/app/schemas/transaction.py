from pydantic import BaseModel
from datetime import datetime, date
from decimal import Decimal
from typing import Optional


class TransactionCreate(BaseModel):
    account_id: str
    date: date
    payee_name: Optional[str] = None
    payee_id: Optional[str] = None
    amount: Decimal
    category_id: Optional[str] = None
    notes: Optional[str] = None
    cleared: bool = False


class TransactionUpdate(BaseModel):
    date: Optional[date] = None
    payee_id: Optional[str] = None
    amount: Optional[Decimal] = None
    category_id: Optional[str] = None
    notes: Optional[str] = None
    cleared: Optional[bool] = None
    reconciled: Optional[bool] = None


class TransactionResponse(BaseModel):
    id: str
    account_id: str
    date: date
    payee_id: Optional[str]
    payee_name: Optional[str] = None
    amount: Decimal
    category_id: Optional[str]
    category_name: Optional[str] = None
    notes: Optional[str]
    cleared: bool
    reconciled: bool
    is_split: bool
    parent_transaction_id: Optional[str]
    transfer_pair_id: Optional[str]
    import_id: Optional[str]
    created_at: datetime

    model_config = {"from_attributes": True}


class TransactionListResponse(BaseModel):
    transactions: list[TransactionResponse]
    total: int
    page: int
    page_size: int
