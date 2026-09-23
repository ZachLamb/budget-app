from pydantic import BaseModel
from datetime import date, datetime
from decimal import Decimal
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


class DuplicatePayeeMember(BaseModel):
    id: str
    name: str


class DuplicateClusterResponse(BaseModel):
    """A set of payees that normalize to the same merchant and can be merged."""

    normalized_key: str
    canonical_id: str
    canonical_name: str
    duplicate_ids: list[str]
    members: list[DuplicatePayeeMember]


class PayeeMergeRequest(BaseModel):
    """Fold ``source_ids`` into ``target_id``; sources are deleted afterward."""

    target_id: str
    source_ids: list[str]


class PayeeActivityResponse(BaseModel):
    """What a payee has actually done, for the payees list.

    A payee with no transactions reports zeroes and a null date rather
    than being left out: an unused payee is precisely the row someone
    came to the page to tidy up.
    """

    payee_id: str
    name: str
    transaction_count: int
    total_amount: Decimal
    last_date: Optional[date]
    top_category_id: Optional[str]
    top_category_name: Optional[str]
