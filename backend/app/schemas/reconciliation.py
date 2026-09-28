from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, Field


class TxnRefResponse(BaseModel):
    transaction_id: str
    date: date
    payee_name: Optional[str] = None
    amount: Decimal

    model_config = {"from_attributes": True}


class SuggestionResponse(BaseModel):
    """A concrete thing that would close the gap, and why it might."""

    kind: str
    explanation: str
    transactions: list[TxnRefResponse] = []

    model_config = {"from_attributes": True}


class ReconciliationViewResponse(BaseModel):
    account_id: str
    statement_date: date
    statement_balance: Decimal
    cleared_balance: Decimal
    difference: Decimal
    cleared_count: int
    uncleared: list[TxnRefResponse]
    #: None means this account has never been reconciled, which is a
    #: different thing from having been reconciled to zero.
    last_reconciled_on: Optional[date] = None
    suggestions: list[SuggestionResponse]
    reconciled_count: int

    model_config = {"from_attributes": True}


class ReconcileRequest(BaseModel):
    statement_date: date
    statement_balance: Decimal = Field(..., max_digits=14, decimal_places=2)
    #: Sign off despite a gap. Off by default: balancing is the point,
    #: and a reconciliation that silently tolerated a difference would
    #: make the record worthless.
    allow_difference: bool = False
    #: Close the gap with a balancing entry instead of finding the cause.
    #: Legitimate for old accounts nobody will reconstruct, but it is a
    #: real transaction and it says what it is.
    create_adjustment: bool = False
    adjustment_category_id: Optional[str] = None


class ReconciliationResponse(BaseModel):
    id: str
    account_id: str
    statement_date: date
    statement_balance: Decimal
    cleared_balance: Decimal
    difference: Decimal
    transaction_count: int
    adjustment_transaction_id: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}
