"""Underpayment safe harbor.

Generally, penalty is avoided by paying the LESSER of 90% of this year's
tax or 100% of last year's -- 110% when last year's AGI exceeded
$150,000.

When prior-year data is missing the answer is "unknown", never "met".
Telling someone they are safe when we cannot know is the one outcome
worth avoiding at any cost.
"""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

from app.services.tax.inputs import SafeHarborResult

CENTS = Decimal("0.01")
ZERO = Decimal("0")
HIGH_INCOME_AGI_THRESHOLD = Decimal("150000")
CURRENT_YEAR_FRACTION = Decimal("0.90")
PRIOR_YEAR_FRACTION = Decimal("1.00")
PRIOR_YEAR_FRACTION_HIGH_INCOME = Decimal("1.10")


def _cents(value: Decimal) -> Decimal:
    return value.quantize(CENTS, rounding=ROUND_HALF_UP)


def evaluate_safe_harbor(
    total_liability: Decimal,
    projected_withholding: Decimal,
    prior_year_total_tax: Decimal | None,
    prior_year_agi: Decimal | None,
    remaining_periods: int,
) -> SafeHarborResult:
    if prior_year_total_tax is None:
        return SafeHarborResult(
            status="unknown",
            test_used="none",
            required_payment=None,
            projected_payment=_cents(projected_withholding),
            shortfall=None,
            per_period_to_close=None,
            reason=(
                "Enter prior year's total tax to check whether this year's "
                "withholding is high enough to avoid an underpayment penalty."
            ),
        )

    current_year_requirement = total_liability * CURRENT_YEAR_FRACTION

    high_income = prior_year_agi is not None and prior_year_agi > HIGH_INCOME_AGI_THRESHOLD
    prior_fraction = (
        PRIOR_YEAR_FRACTION_HIGH_INCOME if high_income else PRIOR_YEAR_FRACTION
    )
    prior_year_requirement = prior_year_total_tax * prior_fraction

    if current_year_requirement <= prior_year_requirement:
        required = current_year_requirement
        test_used = "90_percent_current"
    else:
        required = prior_year_requirement
        test_used = (
            "110_percent_prior" if high_income else "100_percent_prior"
        )

    required = _cents(required)
    projected = _cents(projected_withholding)
    shortfall = _cents(max(ZERO, required - projected))
    met = shortfall == ZERO

    if met:
        per_period = ZERO
        reason = (
            "Your projected withholding meets the safe harbor, so an "
            "underpayment penalty is not expected."
        )
    elif remaining_periods > 0:
        per_period = _cents(shortfall / Decimal(remaining_periods))
        reason = (
            f"You are ${shortfall} short of the safe harbor. Withholding "
            f"about ${per_period} more per paycheck for the rest of the "
            "year would close the gap."
        )
    else:
        per_period = None
        reason = (
            f"You are ${shortfall} short of the safe harbor and there are "
            "no pay periods left this year to close it through withholding."
        )

    return SafeHarborResult(
        status="met" if met else "not_met",
        test_used=test_used,
        required_payment=required,
        projected_payment=projected,
        shortfall=shortfall,
        per_period_to_close=per_period,
        reason=reason,
    )
