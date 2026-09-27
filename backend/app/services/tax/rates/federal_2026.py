"""Federal rates for tax year 2026.

Source: IRS, "IRS releases tax inflation adjustments for tax year 2026,
including amendments from the One, Big, Beautiful Bill"
https://www.irs.gov/newsroom/irs-releases-tax-inflation-adjustments-for-tax-year-2026-including-amendments-from-the-one-big-beautiful-bill

Social Security wage base source: SSA Contribution and Benefit Base
https://www.ssa.gov/oact/cola/cbb.html

Bracket tables source: Rev. Proc. 2025-32, section 4.01, tables 1 to 4
https://www.irs.gov/pub/irs-drop/rp-25-32.pdf

Additional Medicare Tax thresholds source: IRS, "Questions and answers
for the Additional Medicare Tax"
https://www.irs.gov/businesses/small-businesses-self-employed/questions-and-answers-for-the-additional-medicare-tax

Passive activity loss allowance source: IRS Publication 925
https://www.irs.gov/publications/p925

NOTE: 2026 incorporates One Big Beautiful Bill amendments. Do not derive
a later year's figures from these by inflation-adjusting them; add a new
module with its own sourced values.
"""
from __future__ import annotations

from decimal import Decimal

from app.services.tax.rates.registry import (
    Bracket,
    FederalRates,
    FilingStatus,
    PassiveLossRates,
)

# Rev. Proc. 2025-32 section 4.01, table 3 (section 1(j)(2)(C)).
_SINGLE_BRACKETS = [
    Bracket(Decimal("12400"), Decimal("0.10")),
    Bracket(Decimal("50400"), Decimal("0.12")),
    Bracket(Decimal("105700"), Decimal("0.22")),
    Bracket(Decimal("201775"), Decimal("0.24")),
    Bracket(Decimal("256225"), Decimal("0.32")),
    Bracket(Decimal("640600"), Decimal("0.35")),
    Bracket(None, Decimal("0.37")),
]

# Table 1 (section 1(j)(2)(A)). Its heading is "Married Individuals Filing
# Joint Returns AND SURVIVING SPOUSES", which is why the two statuses
# share this list rather than one being an approximation of the other.
_MARRIED_JOINT_BRACKETS = [
    Bracket(Decimal("24800"), Decimal("0.10")),
    Bracket(Decimal("100800"), Decimal("0.12")),
    Bracket(Decimal("211400"), Decimal("0.22")),
    Bracket(Decimal("403550"), Decimal("0.24")),
    Bracket(Decimal("512450"), Decimal("0.32")),
    Bracket(Decimal("768700"), Decimal("0.35")),
    Bracket(None, Decimal("0.37")),
]

# Table 2 (section 1(j)(2)(B)). Note the 24% and 32% ceilings are 201,750
# and 256,200 -- $25 below the single filer's, not equal to them. Close
# enough to look like a typo, and wrong enough to matter.
_HEAD_OF_HOUSEHOLD_BRACKETS = [
    Bracket(Decimal("17700"), Decimal("0.10")),
    Bracket(Decimal("67450"), Decimal("0.12")),
    Bracket(Decimal("105700"), Decimal("0.22")),
    Bracket(Decimal("201750"), Decimal("0.24")),
    Bracket(Decimal("256200"), Decimal("0.32")),
    Bracket(Decimal("640600"), Decimal("0.35")),
    Bracket(None, Decimal("0.37")),
]

# Table 4 (section 1(j)(2)(D)). Identical to a single filer's except the
# top bracket, which starts at 384,350 -- half the joint figure, not the
# single one.
_MARRIED_SEPARATE_BRACKETS = [
    Bracket(Decimal("12400"), Decimal("0.10")),
    Bracket(Decimal("50400"), Decimal("0.12")),
    Bracket(Decimal("105700"), Decimal("0.22")),
    Bracket(Decimal("201775"), Decimal("0.24")),
    Bracket(Decimal("256225"), Decimal("0.32")),
    Bracket(Decimal("384350"), Decimal("0.35")),
    Bracket(None, Decimal("0.37")),
]

SUPPORTED_STATUSES = frozenset(
    {
        FilingStatus.SINGLE,
        FilingStatus.MARRIED_JOINT,
        FilingStatus.MARRIED_SEPARATE,
        FilingStatus.HEAD_OF_HOUSEHOLD,
        FilingStatus.QUALIFYING_SURVIVING_SPOUSE,
    }
)

RATES = FederalRates(
    brackets={
        FilingStatus.SINGLE: _SINGLE_BRACKETS,
        FilingStatus.MARRIED_JOINT: _MARRIED_JOINT_BRACKETS,
        FilingStatus.QUALIFYING_SURVIVING_SPOUSE: _MARRIED_JOINT_BRACKETS,
        FilingStatus.MARRIED_SEPARATE: _MARRIED_SEPARATE_BRACKETS,
        FilingStatus.HEAD_OF_HOUSEHOLD: _HEAD_OF_HOUSEHOLD_BRACKETS,
    },
    standard_deduction={
        FilingStatus.SINGLE: Decimal("16100"),
        FilingStatus.MARRIED_SEPARATE: Decimal("16100"),
        FilingStatus.HEAD_OF_HOUSEHOLD: Decimal("24150"),
        FilingStatus.MARRIED_JOINT: Decimal("32200"),
        FilingStatus.QUALIFYING_SURVIVING_SPOUSE: Decimal("32200"),
    },
    social_security_wage_base=Decimal("184500"),
    social_security_rate=Decimal("0.062"),
    # Statutory, not inflation-adjusted: 250,000 jointly, 125,000 filing
    # separately, 200,000 otherwise.
    additional_medicare_threshold={
        FilingStatus.SINGLE: Decimal("200000"),
        FilingStatus.MARRIED_JOINT: Decimal("250000"),
        FilingStatus.MARRIED_SEPARATE: Decimal("125000"),
        FilingStatus.HEAD_OF_HOUSEHOLD: Decimal("200000"),
        FilingStatus.QUALIFYING_SURVIVING_SPOUSE: Decimal("200000"),
    },
    medicare_rate=Decimal("0.0145"),
    additional_medicare_rate=Decimal("0.009"),
)

PASSIVE_LOSS = PassiveLossRates(
    max_allowance=Decimal("25000"),
    phaseout_start=Decimal("100000"),
    phaseout_end=Decimal("150000"),
)
