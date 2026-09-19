from pydantic import BaseModel
from decimal import Decimal
from typing import Optional


class DeductionLine(BaseModel):
    tax_line: str
    amount: Decimal
    deduction_kind: str = "personal_itemized"


class DeductionsSummaryResponse(BaseModel):
    year: int
    lines: list[DeductionLine]
    total: Decimal
    estimated_tax_savings: Optional[Decimal] = None
    suggested_withholding_reduction_per_period: Optional[Decimal] = None
    # Business expenses reduce income from the first dollar; personal
    # itemized deductions only matter above the standard deduction. They
    # are worth very different amounts and must be reported separately.
    business_total: Decimal = Decimal("0.00")
    personal_itemized_total: Decimal = Decimal("0.00")
    personal_itemized_value: Optional[Decimal] = None
    standard_deduction: Optional[Decimal] = None
