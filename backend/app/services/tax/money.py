"""Formatting for money that appears inside engine prose.

Every figure the Taxes page renders as a number is formatted by the
frontend. The `detail` sentences are the exception: they arrive as
finished text, so a raw Decimal interpolated into one shows up as
"184500.00" beside a neighbouring "$184,500.00" and reads like a bug.
"""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

CENTS = Decimal("0.01")


def money(value: Decimal) -> str:
    """Format a Decimal for prose: `$1,234.56`, negatives as `-$1,234.56`."""
    amount = value.quantize(CENTS, rounding=ROUND_HALF_UP)
    sign = "-" if amount < 0 else ""
    return f"{sign}${abs(amount):,.2f}"


def percent(rate: Decimal) -> str:
    """Format a rate as a percentage without trailing zeros: `4.4%`."""
    scaled = (rate * 100).normalize()
    # normalize() turns 4.40 into 4.4 but 100 into 1E+2; expand that back.
    if scaled == scaled.to_integral_value():
        scaled = scaled.quantize(Decimal("1"))
    return f"{scaled}%"
