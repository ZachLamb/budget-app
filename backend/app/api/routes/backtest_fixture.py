"""Writing the back-test fixture from documents the user has read.

The back-test compares the engine against a real filed return. Its input
file is gitignored by design and has always had to be typed by hand,
which is why the gate has been skipping since it was written.

This endpoint lets the reader on the Taxes page fill it in instead. It is
a development tool and nothing else:

- It refuses outright if any production marker is set.
- It writes exactly one path, computed from this file's own location.
- It never returns the file's contents, and never logs the figures. They
  describe a real person's finances.
"""
from __future__ import annotations

import json
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from app.api.deps import get_household_id
from app.config import _looks_like_production

router = APIRouter()

# Computed from this module, never from a request. Nothing a caller sends
# can influence which file is written.
FIXTURE_PATH = (
    Path(__file__).resolve().parents[3] / "tests" / "backtest" / "returns.local.json"
)

_MONEY = Field(default=None, max_length=24)


class BacktestReturn(BaseModel):
    """One filed return, in the shape tests/backtest/README.md documents."""

    year: int = Field(..., ge=2000, le=2100)
    filing_status: str = Field(..., max_length=40)
    wages: Optional[str] = _MONEY
    pretax_401k: Optional[str] = _MONEY
    pretax_hsa: Optional[str] = _MONEY
    pretax_other: Optional[str] = _MONEY
    federal_withheld: Optional[str] = _MONEY
    state_withheld: Optional[str] = _MONEY
    ss_withheld: Optional[str] = _MONEY
    medicare_withheld: Optional[str] = _MONEY
    itemized_deductions: Optional[str] = _MONEY
    actual_taxable_income: Optional[str] = _MONEY
    actual_federal_income_tax: Optional[str] = _MONEY
    actual_state_tax: Optional[str] = _MONEY
    actual_ss_tax: Optional[str] = _MONEY
    actual_medicare_tax: Optional[str] = _MONEY

    @field_validator(
        "wages", "pretax_401k", "pretax_hsa", "pretax_other", "federal_withheld",
        "state_withheld", "ss_withheld", "medicare_withheld", "itemized_deductions",
        "actual_taxable_income", "actual_federal_income_tax", "actual_state_tax",
        "actual_ss_tax", "actual_medicare_tax",
    )
    @classmethod
    def _decimal_string(cls, v: Optional[str]) -> Optional[str]:
        # The fixture holds money as strings so Decimal reads them exactly.
        # Anything that is not a number would reach the test file as-is.
        if v is None:
            return v
        try:
            Decimal(v)
        except (InvalidOperation, ValueError):
            raise ValueError("must be a decimal string, e.g. \"154692.00\"")
        return v


class BacktestFixtureRequest(BaseModel):
    returns: list[BacktestReturn] = Field(..., min_length=1, max_length=20)


@router.post("/backtest-fixture", status_code=204)
async def write_backtest_fixture(
    body: BacktestFixtureRequest,
    household_id: str = Depends(get_household_id),
) -> None:
    """Write `returns.local.json` for the back-test. Development only."""
    if _looks_like_production():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Not found.",
        )

    # A record with no expected figure would pass the gate on nothing.
    compared = (
        "actual_taxable_income", "actual_federal_income_tax",
        "actual_state_tax", "actual_ss_tax", "actual_medicare_tax",
    )
    for index, record in enumerate(body.returns):
        if not any(getattr(record, name) is not None for name in compared):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Return {index + 1} has no expected figure to compare. "
                    "Give at least one, or the back-test passes on nothing."
                ),
            )

    payload = {
        "returns": [
            {k: v for k, v in record.model_dump().items() if v is not None}
            for record in body.returns
        ]
    }
    FIXTURE_PATH.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE_PATH.write_text(json.dumps(payload, indent=2) + "\n")
