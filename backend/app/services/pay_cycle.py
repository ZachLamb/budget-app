"""Resolve paycheck-anchored spend windows for observation-first budgeting.

Convention: ``pay_last_confirmed_date`` is the household's **last** payday (start of the
current spend cycle). The next pay date is computed by stepping forward from that anchor
by ``pay_frequency`` until the boundary is strictly after *today* (see ``resolve_pay_cycle``).

``semimonthly`` supports two common US payroll conventions; the cadence is inferred from
the stored anchor day:

- **15th and last calendar day** — set the anchor to the 15th or the last day of a month.
- **1st and 15th** — set the anchor to the 1st of a month (the 15th-of-month pair is
  then implied). Users on a 1st-and-15th schedule should record the 1st as their last
  pay date; recording the 15th will fall back to the 15-and-last cadence.
"""

from __future__ import annotations

import calendar
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Literal, Optional

PayFrequency = Literal["weekly", "biweekly", "monthly", "semimonthly", "irregular"]

VALID_FREQUENCIES: frozenset[str] = frozenset(
    {"weekly", "biweekly", "monthly", "semimonthly", "irregular"}
)


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


def _last_calendar_day(y: int, month: int) -> int:
    return calendar.monthrange(y, month)[1]


def is_valid_semimonthly_anchor(d: date) -> bool:
    """Accepted semi-monthly anchor days: 1st, 15th, or the last calendar day."""
    return d.day == 1 or d.day == 15 or d.day == _last_calendar_day(d.year, d.month)


# Cadence identifiers are internal but public enough to appear in type annotations.
SemiMonthlyCadence = Literal["1-and-15", "15-and-last"]


def semimonthly_cadence_from_anchor(anchor: date) -> SemiMonthlyCadence:
    """Infer which semi-monthly cadence the anchor implies.

    Anchor on the 1st → 1-and-15 cadence (pays alternate 1st/15th).
    Anchor on the 15th or last-of-month → 15-and-last cadence.
    Day 15 is ambiguous on its own (could belong to either cadence), but
    the 15-and-last default preserves long-standing behavior; users on
    1-and-15 should record the 1st as their last pay date to get the
    correct cadence.
    """
    if anchor.day == 1:
        return "1-and-15"
    return "15-and-last"


def _add_semimonthly_period(d: date, cadence: SemiMonthlyCadence = "15-and-last") -> date:
    """Step forward one semi-monthly period using the given cadence."""
    if not is_valid_semimonthly_anchor(d):
        raise ValueError("semimonthly anchor must be the 1st, the 15th, or the last day of a month")
    if cadence == "1-and-15":
        if d.day == 1:
            return date(d.year, d.month, 15)
        # day 15 → day 1 of next month
        if d.month == 12:
            return date(d.year + 1, 1, 1)
        return date(d.year, d.month + 1, 1)
    # 15-and-last cadence (default)
    last = _last_calendar_day(d.year, d.month)
    if d.day == 15:
        return date(d.year, d.month, last)
    # Last day of month → next month's 15th
    if d.month == 12:
        return date(d.year + 1, 1, 15)
    return date(d.year, d.month + 1, 15)


def _add_months(d: date, months: int) -> date:
    m0 = d.month - 1 + months
    y = d.year + m0 // 12
    mo = m0 % 12 + 1
    last_day = calendar.monthrange(y, mo)[1]
    return date(y, mo, min(d.day, last_day))


def add_period(
    d: date,
    frequency: PayFrequency,
    *,
    semimonthly_cadence: SemiMonthlyCadence = "15-and-last",
) -> date:
    if frequency == "weekly":
        return d + timedelta(days=7)
    if frequency == "biweekly":
        return d + timedelta(days=14)
    if frequency == "monthly":
        return _add_months(d, 1)
    if frequency == "semimonthly":
        return _add_semimonthly_period(d, semimonthly_cadence)
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

    if freq == "semimonthly" and not is_valid_semimonthly_anchor(pay_last_confirmed_date):
        return _fallback_30d(today)

    # Pin the semi-monthly cadence from the original anchor so iterative
    # roll-forward keeps the same pattern (day 1 → 15 → day 1 … not
    # day 1 → 15 → last → 15 …).
    cadence: SemiMonthlyCadence = (
        semimonthly_cadence_from_anchor(pay_last_confirmed_date)
        if freq == "semimonthly"
        else "15-and-last"
    )
    cycle_start = pay_last_confirmed_date
    next_pay = add_period(cycle_start, freq, semimonthly_cadence=cadence)  # type: ignore[arg-type]
    # Roll forward if we're past this pay boundary (user hasn't updated last pay in a while).
    while next_pay <= today:
        cycle_start = next_pay
        next_pay = add_period(cycle_start, freq, semimonthly_cadence=cadence)  # type: ignore[arg-type]

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
