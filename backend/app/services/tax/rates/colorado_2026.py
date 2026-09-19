"""Colorado rates for tax year 2026.

Colorado applies a flat rate to FEDERAL TAXABLE INCOME after state
additions and subtractions -- so the federal standard deduction flows
through and there is no state bracket table or state standard deduction.

Source: Colorado Department of Revenue, Individual Income Tax Guide
https://tax.colorado.gov/individual-income-tax-guide
"""
from __future__ import annotations

from decimal import Decimal

from app.services.tax.rates.registry import StateRates

RATES = StateRates(
    code="CO",
    flat_rate=Decimal("0.044"),
    starts_from_federal_taxable_income=True,
)
