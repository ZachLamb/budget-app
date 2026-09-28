"""Turning a safe-harbor shortfall into quarterly estimated payments.

Pure: no session, no clock of its own -- today is passed in, the way the
engine takes its rates.

The rule that shapes everything here is that WITHHOLDING COUNTS AS PAID
EVENLY across the year, whenever it actually happened, while an estimated
payment counts on the date it is made. That asymmetry is why someone who
reaches September having paid nothing cannot fix it by sending four
cheques now -- the first two instalments are already late -- but can
still fix it by raising withholding for the rest of the year.

Saying "pay a quarter of this four times" to someone in September would
be wrong in a way that costs them a penalty, so past due dates are marked
rather than quietly folded into the remaining ones.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal

CENTS = Decimal("0.01")
ZERO = Decimal("0.00")

# Month and day of the four instalments. The fourth belongs to January of
# the following year.
_DUE = ((4, 15), (6, 15), (9, 15), (1, 15))


def _cents(value: Decimal) -> Decimal:
    return value.quantize(CENTS, rounding=ROUND_HALF_UP)


def due_dates(year: int) -> list[date]:
    """The four instalment dates for a calendar-year filer.

    A date landing on a Saturday or Sunday moves to the Monday. A federal
    holiday can push it further -- Emancipation Day routinely moves the
    April date -- and that is not modelled here, so treat these as the
    earliest the payment is due rather than the last word.
    """
    out: list[date] = []
    for index, (month, day) in enumerate(_DUE):
        due = date(year + 1 if index == 3 else year, month, day)
        if due.weekday() >= 5:  # Saturday or Sunday
            due += timedelta(days=7 - due.weekday())
        out.append(due)
    return out


@dataclass(frozen=True)
class Installment:
    number: int
    due_date: date
    amount: Decimal
    status: Literal["paid_or_past", "due_next", "upcoming"]


@dataclass(frozen=True)
class QuarterlyPlan:
    """What to send and when, or why that cannot be said."""

    installments: list[Installment]
    total: Decimal | None
    #: Instalment dates already gone by. Those cannot be made on time.
    periods_past: int
    #: Set when no figure can be given; the caller shows this instead.
    reason: str | None = None


def quarterly_plan(
    shortfall: Decimal | None,
    year: int,
    today: date,
) -> QuarterlyPlan:
    """Split a safe-harbor shortfall across the instalments that remain.

    `shortfall` is what the engine says is still owed beyond expected
    withholding. None means the engine could not work it out -- which is
    not the same as nothing being owed, and must not be shown as zero.
    """
    dates = due_dates(year)
    past = sum(1 for d in dates if d < today)

    if shortfall is None:
        return QuarterlyPlan(
            installments=[],
            total=None,
            periods_past=past,
            reason=(
                "There is no figure for this yet — it needs last year's "
                "return to measure against."
            ),
        )

    if shortfall <= ZERO:
        return QuarterlyPlan(
            installments=[],
            total=ZERO,
            periods_past=past,
            reason=(
                "Withholding alone is expected to meet the safe harbor, so "
                "no estimated payments are needed."
            ),
        )

    # Spread over every instalment, including the ones already gone: those
    # amounts were due then, and pretending otherwise by loading them onto
    # the remaining dates would hide that they are late.
    each = _cents(shortfall / Decimal(len(dates)))
    installments: list[Installment] = []
    running = ZERO
    for index, due in enumerate(dates):
        # The last instalment absorbs the rounding so the four sum exactly.
        amount = _cents(shortfall - running) if index == len(dates) - 1 else each
        running += amount
        if due < today:
            status: Literal["paid_or_past", "due_next", "upcoming"] = "paid_or_past"
        elif index == past:
            status = "due_next"
        else:
            status = "upcoming"
        installments.append(
            Installment(number=index + 1, due_date=due, amount=amount, status=status)
        )

    return QuarterlyPlan(
        installments=installments,
        total=_cents(shortfall),
        periods_past=past,
    )
