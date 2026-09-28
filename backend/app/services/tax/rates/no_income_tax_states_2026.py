"""States that do not tax wage income, for tax year 2026.

A zero here is a fact about the state, not a missing figure -- which is
why these get real rate tables rather than being left unsupported. The
distinction matters: an unsupported state must refuse to produce a
number, while these states genuinely owe nothing on wages.

Source: Tax Foundation, "State Individual Income Tax Rates and Brackets"
https://taxfoundation.org/data/all/state/state-income-tax-rates/

New Hampshire repealed its interest and dividends tax effective
1 January 2025, so 2026 is its first full year with no individual income
tax of any kind. Tennessee's Hall tax was repealed earlier.

WASHINGTON CAVEAT: Washington levies no tax on wages, but does tax
long-term capital gains at 7% above a threshold. This engine models wages
and Schedule E rental income, neither of which that tax touches, so zero
is correct for what is computed here -- but it is not true that a
Washington filer owes no state tax under every circumstance.
"""
from __future__ import annotations

from decimal import Decimal

from app.services.tax.rates.registry import StateRates

# Alphabetical, so a missing one is easy to spot.
CODES = ("AK", "FL", "NH", "NV", "SD", "TN", "TX", "WA", "WY")

RATES: dict[str, StateRates] = {
    code: StateRates(
        code=code,
        flat_rate=Decimal("0"),
        starts_from_federal_taxable_income=True,
    )
    for code in CODES
}
