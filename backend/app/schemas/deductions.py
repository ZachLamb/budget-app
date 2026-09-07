from pydantic import BaseModel
from decimal import Decimal
from typing import Optional


class DeductionLine(BaseModel):
    tax_line: str
    amount: Decimal


class DeductionsSummaryResponse(BaseModel):
    year: int
    lines: list[DeductionLine]
    total: Decimal
    estimated_tax_savings: Optional[Decimal] = None
    suggested_withholding_reduction_per_period: Optional[Decimal] = None
