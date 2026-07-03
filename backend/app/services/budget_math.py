"""Envelope-style budget rollover math (pure; no I/O).

Design: docs/superpowers/specs/2026-07-02-budget-rollover-design.md
- Unspent category balances carry forward month to month.
- Overspend is clamped to zero at each month boundary (YNAB-style); the
  clipped amount reduces Ready to Assign for every month AFTER it.
- The viewed month shows its own overspend as a negative available.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

ZERO = Decimal("0")


@dataclass
class CategoryMonthResult:
    carryover: Decimal
    assigned: Decimal
    activity: Decimal
    available: Decimal


@dataclass
class RolloverResult:
    categories: dict[str, CategoryMonthResult]
    ready_to_assign: Decimal
    total_carryover_in: Decimal
    overspend_deducted: Decimal


def compute_rollover(
    assigned: dict[tuple[str, str], Decimal],
    activity: dict[tuple[str, str], Decimal],
    income_category_ids: set[str],
    viewed_month: str,
) -> RolloverResult:
    months = sorted(
        {m for (_, m) in assigned} | {m for (_, m) in activity} | {viewed_month}
    )
    months = [m for m in months if m <= viewed_month]

    category_ids = {c for (c, _) in assigned} | {c for (c, _) in activity}
    envelope_ids = category_ids - income_category_ids

    carry: dict[str, Decimal] = {c: ZERO for c in envelope_ids}
    overspend_before_viewed = ZERO
    cum_income = ZERO
    cum_assigned = ZERO
    result: dict[str, CategoryMonthResult] = {}

    for m in months:
        for c in envelope_ids:
            a = assigned.get((c, m), ZERO)
            act = activity.get((c, m), ZERO)
            raw = carry[c] + a + act
            if m == viewed_month:
                result[c] = CategoryMonthResult(
                    carryover=carry[c], assigned=a, activity=act, available=raw
                )
            if raw < ZERO:
                if m < viewed_month:
                    overspend_before_viewed += -raw
                carry[c] = ZERO
            else:
                carry[c] = raw
        for c in income_category_ids:
            cum_income += activity.get((c, m), ZERO)
        # All assignment rows count — even categories later deleted — so
        # Ready to Assign never resurrects money that was assigned away.
        cum_assigned += sum(
            (assigned.get((c, m), ZERO) for c in category_ids), ZERO
        )

    return RolloverResult(
        categories=result,
        ready_to_assign=cum_income - cum_assigned - overspend_before_viewed,
        total_carryover_in=sum((r.carryover for r in result.values()), ZERO),
        overspend_deducted=overspend_before_viewed,
    )
