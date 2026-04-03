"""Resolve paycheck-anchored spend windows for observation-first budgeting.

Convention: ``pay_last_confirmed_date`` is the household's **last** payday (start of the
current spend cycle). The next pay date is computed by stepping forward from that anchor
by ``pay_frequency`` until the boundary is strictly after *today* (see ``resolve_pay_cycle``).
"""

from __future__ import annotations

import calendar
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Literal, Optional

PayFrequency = Literal["weekly", "biweekly", "monthly", "irregular"]

VALID_FREQUENCIES: frozenset[str] = frozenset({"weekly", "biweekly", "monthly", "irregular"})


def utc_today() -> date:
    """Calendar date in UTC (stable pay-cycle boundaries regardless of server local TZ)."""
    return datetime.now(timezone.utc).date()


@dataclass(frozen=True)
class PayCycleResolved:
    """Inclusive date_from / date_to for reports; next expected payday after the window."""

    date_from: date
    date_to: date
    next_pay_date: Optional[date]
    label: str
    is_fallback_30d: bool


def _add_months(d: date, months: int) -> date:
    m0 = d.month - 1 + months
    y = d.year + m0 // 12
    mo = m0 % 12 + 1
    last_day = calendar.monthrange(y, mo)[1]
    return date(y, mo, min(d.day, last_day))


def add_period(d: date, frequency: PayFrequency) -> date:
    if frequency == "weekly":
        return d + timedelta(days=7)
    if frequency == "biweekly":
        return d + timedelta(days=14)
    if frequency == "monthly":
        return _add_months(d, 1)
    raise ValueError(f"add_period not defined for frequency={frequency!r}")


def resolve_pay_cycle(
    today: date,
    pay_frequency: Optional[str],
    pay_last_confirmed_date: Optional[date],
) -> PayCycleResolved:
    """
    Compute the current spend window.

    - Uses pay_last_confirmed_date as the start anchor and steps forward by period until
      the next pay date is strictly after `today`.
    - irregular / missing data: last 30 days ending today (inclusive).
    """
    freq = (pay_frequency or "").strip().lower() if pay_frequency else None
    if (
        freq not in VALID_FREQUENCIES
        or freq == "irregular"
        or pay_last_confirmed_date is None
    ):
        return _fallback_30d(today)

    if pay_last_confirmed_date > today:
        return _fallback_30d(today)

    cycle_start = pay_last_confirmed_date
    next_pay = add_period(cycle_start, freq)  # type: ignore[arg-type]
    # Roll forward if we're past this pay boundary (user hasn't updated last pay in a while).
    while next_pay <= today:
        cycle_start = next_pay
        next_pay = add_period(cycle_start, freq)  # type: ignore[arg-type]

    end_inclusive = next_pay - timedelta(days=1)
    if end_inclusive < cycle_start:
        end_inclusive = next_pay

    # Label matches inclusive spend window (date_from … date_to), not the next pay date.
    label = f"{_fmt(cycle_start)} – {_fmt(end_inclusive)}"
    return PayCycleResolved(
        date_from=cycle_start,
        date_to=end_inclusive,
        next_pay_date=next_pay,
        label=label,
        is_fallback_30d=False,
    )


def _fallback_30d(today: date) -> PayCycleResolved:
    start = today - timedelta(days=29)
    return PayCycleResolved(
        date_from=start,
        date_to=today,
        next_pay_date=None,
        label="Last 30 days (set pay schedule in Settings for a paycheck-based view)",
        is_fallback_30d=True,
    )


def _fmt(d: date) -> str:
    return d.strftime("%b ") + str(d.day)
