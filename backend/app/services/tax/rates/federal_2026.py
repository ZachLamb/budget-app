"""Federal rates for tax year 2026.

Source: IRS, "IRS releases tax inflation adjustments for tax year 2026,
including amendments from the One, Big, Beautiful Bill"
https://www.irs.gov/newsroom/irs-releases-tax-inflation-adjustments-for-tax-year-2026-including-amendments-from-the-one-big-beautiful-bill

Social Security wage base source: SSA Contribution and Benefit Base
https://www.ssa.gov/oact/cola/cbb.html

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

_SINGLE_BRACKETS = [
    Bracket(Decimal("12400"), Decimal("0.10")),
    Bracket(Decimal("50400"), Decimal("0.12")),
    Bracket(Decimal("105700"), Decimal("0.22")),
    Bracket(Decimal("201775"), Decimal("0.24")),
    Bracket(Decimal("256225"), Decimal("0.32")),
    Bracket(Decimal("640600"), Decimal("0.35")),
    Bracket(None, Decimal("0.37")),
]

# Phase 1 populates SINGLE only. Other statuses are structurally supported
# -- the shape is identical -- but must raise rather than return wrong
# numbers. Populate them by adding their sourced bracket lists here and
# extending SUPPORTED_STATUSES.
SUPPORTED_STATUSES = frozenset({FilingStatus.SINGLE})

RATES = FederalRates(
    brackets={FilingStatus.SINGLE: _SINGLE_BRACKETS},
    standard_deduction={
        FilingStatus.SINGLE: Decimal("16100"),
        FilingStatus.HEAD_OF_HOUSEHOLD: Decimal("24150"),
        FilingStatus.MARRIED_JOINT: Decimal("32200"),
    },
    social_security_wage_base=Decimal("184500"),
    social_security_rate=Decimal("0.062"),
    medicare_rate=Decimal("0.0145"),
    additional_medicare_threshold=Decimal("200000"),
    additional_medicare_rate=Decimal("0.009"),
)

PASSIVE_LOSS = PassiveLossRates(
    max_allowance=Decimal("25000"),
    phaseout_start=Decimal("100000"),
    phaseout_end=Decimal("150000"),
)
