"""Shapes database rows into the engine's TaxInputs.

This is the ONLY module where persistence and the pure engine meet. It
contains no tax math -- it reads rows, projects the remainder of the
year from pay frequency, and hands the result to the engine.

When required data is missing it returns inputs=None with a populated
`missing` list, so the caller can say what it needs rather than
projecting from nothing. Never fabricate a zero.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Household, Paystub, PriorYearReturn, TaxProfile
from app.services.tax.inputs import TaxInputs, WithholdingBuckets
from app.services.tax.rates.registry import FilingStatus

CENTS = Decimal("0.01")
ZERO = Decimal("0.00")

# Pay periods in a full year, by the values Household.pay_frequency uses.
PERIODS_PER_YEAR: dict[str, int] = {
    "weekly": 52,
    "biweekly": 26,
    "semimonthly": 24,
    "monthly": 12,
}


def _cents(value: Decimal) -> Decimal:
    return value.quantize(CENTS, rounding=ROUND_HALF_UP)


@dataclass(frozen=True)
class AssemblyResult:
    inputs: TaxInputs | None
    remaining_periods: int
    missing: list[str]


def remaining_pay_periods(
    pay_frequency: str | None, last_pay_date: date, year: int
) -> int:
    """Whole pay periods left in `year` after `last_pay_date`.

    Returns 0 for an unknown or unset frequency rather than guessing --
    a wrong period count silently scales the whole projection.
    """
    periods = PERIODS_PER_YEAR.get(pay_frequency or "")
    if not periods:
        return 0
    year_end = date(year, 12, 31)
    if last_pay_date >= year_end:
        return 0
    days_left = (year_end - last_pay_date).days
    days_per_period = Decimal("365") / Decimal(periods)
    return int(Decimal(days_left) / days_per_period)


async def build_tax_inputs(
    db: AsyncSession, household_id: str, year: int
) -> AssemblyResult:
    missing: list[str] = []

    profile = (
        await db.execute(
            select(TaxProfile).where(TaxProfile.household_id == household_id)
        )
    ).scalar_one_or_none()
    if profile is None or not profile.filing_status:
        missing.append("filing_status")

    latest_stub = (
        await db.execute(
            select(Paystub)
            .where(Paystub.household_id == household_id)
            .order_by(Paystub.pay_date.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if latest_stub is None:
        missing.append("paystub")

    # Only check for prior_year_return if we have the critical blocking items.
    if profile is None or not profile.filing_status or latest_stub is None:
        return AssemblyResult(inputs=None, remaining_periods=0, missing=missing)

    prior = (
        await db.execute(
            select(PriorYearReturn)
            .where(
                PriorYearReturn.household_id == household_id,
                PriorYearReturn.year == year - 1,
            )
        )
    ).scalar_one_or_none()
    if prior is None or prior.total_tax is None:
        missing.append("prior_year_return")

    household = await db.get(Household, household_id)
    periods = remaining_pay_periods(
        household.pay_frequency if household else None,
        latest_stub.pay_date,
        year,
    )
    n = Decimal(periods)

    inputs = TaxInputs(
        filing_status=FilingStatus(profile.filing_status),
        wages_ytd=_cents(latest_stub.gross_ytd),
        projected_remaining_wages=_cents(latest_stub.gross * n),
        pretax_401k=_cents(latest_stub.pretax_401k_ytd + latest_stub.pretax_401k * n),
        pretax_hsa=_cents(latest_stub.pretax_hsa_ytd + latest_stub.pretax_hsa * n),
        pretax_other=_cents(latest_stub.pretax_other_ytd + latest_stub.pretax_other * n),
        federal_withheld_ytd=_cents(latest_stub.federal_withheld_ytd),
        state_withheld_ytd=_cents(latest_stub.state_withheld_ytd),
        ss_withheld_ytd=_cents(latest_stub.ss_withheld_ytd),
        medicare_withheld_ytd=_cents(latest_stub.medicare_withheld_ytd),
        projected_remaining_withholding=WithholdingBuckets(
            federal=_cents(latest_stub.federal_withheld * n),
            state=_cents(latest_stub.state_withheld * n),
            social_security=_cents(latest_stub.ss_withheld * n),
            medicare=_cents(latest_stub.medicare_withheld * n),
        ),
        # Deductions are wired in by the deductions task; a projection is
        # valid without them.
        itemized_deductions=ZERO,
        schedule_e=None,
        prior_year_total_tax=prior.total_tax if prior else None,
        prior_year_agi=prior.agi if prior else None,
    )
    return AssemblyResult(inputs=inputs, remaining_periods=periods, missing=missing)
