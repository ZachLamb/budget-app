from pydantic import BaseModel
from decimal import Decimal
from typing import Optional


class DeductionLine(BaseModel):
    tax_line: str
    amount: Decimal

    def __eq__(self, other):
        if isinstance(other, dict):
            return {"tax_line": self.tax_line, "amount": self.amount} == other
        return super().__eq__(other)


class DeductionsSummaryResponse(BaseModel):
    year: int
    lines: list[DeductionLine]
    total: Decimal
    estimated_tax_savings: Optional[Decimal] = None
    suggested_withholding_reduction_per_period: Optional[Decimal] = None
