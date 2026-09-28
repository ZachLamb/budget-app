"""Quarterly estimated payments from a safe-harbor shortfall."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from app.services.tax.quarterly import due_dates, quarterly_plan


def test_due_dates_are_the_four_statutory_ones():
    dates = due_dates(2026)
    assert dates == [
        date(2026, 4, 15),
        date(2026, 6, 15),
        date(2026, 9, 15),
        date(2027, 1, 15),
    ]


def test_a_weekend_due_date_moves_to_the_monday():
    # 15 April 2028 is a Saturday; 15 January 2028 likewise.
    dates = due_dates(2028)
    assert dates[0] == date(2028, 4, 17)
    assert dates[0].strftime("%A") == "Monday"
    assert dates[3] == date(2029, 1, 15)


def test_the_four_instalments_sum_to_the_shortfall_exactly():
    """Rounding must not lose or invent a cent: the last one absorbs it."""
    plan = quarterly_plan(Decimal("1000.01"), 2026, date(2026, 1, 1))
    assert sum(i.amount for i in plan.installments) == Decimal("1000.01")
    assert plan.total == Decimal("1000.01")


def test_dates_already_gone_are_marked_rather_than_folded_forward():
    """Loading a missed instalment onto the remaining dates would hide
    that it is late, and late is what triggers the penalty."""
    plan = quarterly_plan(Decimal("4000"), 2026, date(2026, 9, 28))
    assert plan.periods_past == 3
    assert [i.status for i in plan.installments] == [
        "paid_or_past",
        "paid_or_past",
        "paid_or_past",
        "due_next",
    ]
    # Each instalment keeps its own quarter's amount.
    assert all(i.amount == Decimal("1000.00") for i in plan.installments)


def test_the_next_one_due_is_singled_out():
    plan = quarterly_plan(Decimal("4000"), 2026, date(2026, 5, 1))
    assert plan.periods_past == 1
    assert [i.status for i in plan.installments] == [
        "paid_or_past",
        "due_next",
        "upcoming",
        "upcoming",
    ]


def test_nothing_owed_says_so_rather_than_listing_four_zeroes():
    plan = quarterly_plan(Decimal("0"), 2026, date(2026, 1, 1))
    assert plan.installments == []
    assert plan.total == Decimal("0.00")
    assert "no estimated payments are needed" in plan.reason


def test_an_unknown_shortfall_is_not_reported_as_nothing_owed():
    """None and zero are the same number on screen and completely
    different answers. One means "you are fine", the other means "we
    cannot tell yet"."""
    plan = quarterly_plan(None, 2026, date(2026, 1, 1))
    assert plan.installments == []
    assert plan.total is None
    assert "last year's return" in plan.reason


@pytest.mark.parametrize("today", [date(2026, 1, 1), date(2027, 6, 1)])
def test_a_date_outside_the_year_still_produces_a_coherent_plan(today):
    plan = quarterly_plan(Decimal("400"), 2026, today)
    assert plan.periods_past in (0, 4)
    assert sum(i.amount for i in plan.installments) == Decimal("400.00")
