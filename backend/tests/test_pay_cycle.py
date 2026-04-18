"""Unit tests for paycheck cycle resolution."""

from datetime import date

from app.services.pay_cycle import (
    add_period,
    is_valid_semimonthly_anchor,
    resolve_pay_cycle,
    utc_today,
)


def test_biweekly_mid_cycle():
    r = resolve_pay_cycle(
        date(2026, 3, 20),
        "biweekly",
        date(2026, 3, 15),
    )
    assert r.date_from == date(2026, 3, 15)
    assert r.next_pay_date == date(2026, 3, 29)
    assert r.date_to == date(2026, 3, 28)
    assert not r.is_fallback_30d
    assert r.label == "Mar 15 – Mar 28"


def test_biweekly_on_pay_day_advances():
    r = resolve_pay_cycle(
        date(2026, 3, 29),
        "biweekly",
        date(2026, 3, 15),
    )
    assert r.date_from == date(2026, 3, 29)
    assert r.next_pay_date == date(2026, 4, 12)
    assert r.date_to == date(2026, 4, 11)
    assert r.label == "Mar 29 – Apr 11"
    assert not r.is_fallback_30d


def test_roll_forward_many_periods():
    r = resolve_pay_cycle(
        date(2026, 10, 1),
        "biweekly",
        date(2026, 3, 15),
    )
    assert r.date_from == date(2026, 9, 27)
    assert r.next_pay_date == date(2026, 10, 11)
    assert not r.is_fallback_30d


def test_irregular_fallback():
    r = resolve_pay_cycle(date(2026, 3, 20), "irregular", date(2026, 3, 15))
    assert r.is_fallback_30d
    assert r.date_to == date(2026, 3, 20)
    assert r.next_pay_date is None


def test_missing_schedule_fallback():
    r = resolve_pay_cycle(date(2026, 3, 20), None, None)
    assert r.is_fallback_30d


def test_future_last_pay_fallback():
    r = resolve_pay_cycle(date(2026, 3, 20), "biweekly", date(2026, 4, 1))
    assert r.is_fallback_30d


def test_monthly_add_period():
    assert add_period(date(2026, 1, 31), "monthly") == date(2026, 2, 28)
    assert add_period(date(2024, 1, 31), "monthly") == date(2024, 2, 29)


def test_semimonthly_add_period_15_to_month_end():
    assert add_period(date(2026, 1, 15), "semimonthly") == date(2026, 1, 31)
    assert add_period(date(2026, 2, 15), "semimonthly") == date(2026, 2, 28)


def test_semimonthly_add_period_month_end_to_next_15():
    assert add_period(date(2026, 1, 31), "semimonthly") == date(2026, 2, 15)
    assert add_period(date(2026, 12, 31), "semimonthly") == date(2027, 1, 15)


def test_semimonthly_leap_february():
    assert add_period(date(2024, 2, 15), "semimonthly") == date(2024, 2, 29)
    assert add_period(date(2024, 2, 29), "semimonthly") == date(2024, 3, 15)


def test_is_valid_semimonthly_anchor():
    assert is_valid_semimonthly_anchor(date(2026, 3, 15))
    assert is_valid_semimonthly_anchor(date(2026, 3, 31))
    assert is_valid_semimonthly_anchor(date(2026, 2, 28))
    # 1-and-15 cadence — the 1st of any month is a valid anchor
    assert is_valid_semimonthly_anchor(date(2026, 3, 1))
    assert is_valid_semimonthly_anchor(date(2026, 12, 1))
    assert not is_valid_semimonthly_anchor(date(2026, 3, 20))


def test_semimonthly_day_one_anchor_steps_to_fifteenth():
    """1-and-15 cadence: last pay on day 1 → next pay is the 15th of the same month."""
    r = resolve_pay_cycle(
        date(2026, 3, 8),  # between day 1 and day 15
        "semimonthly",
        date(2026, 3, 1),
    )
    assert r.date_from == date(2026, 3, 1)
    assert r.next_pay_date == date(2026, 3, 15)
    assert r.date_to == date(2026, 3, 14)
    assert not r.is_fallback_30d


def test_semimonthly_day_one_rolls_forward_across_month_boundary():
    """Past day 15: cycle advances to 15 → first-of-next-month."""
    r = resolve_pay_cycle(
        date(2026, 3, 20),
        "semimonthly",
        date(2026, 3, 1),
    )
    # From anchor day-1, add_period → day 15; still before today, add_period
    # → day 1 of next month (the return to the 1-and-15 cadence). Cycle
    # start is day 15, next pay is April 1.
    assert r.date_from == date(2026, 3, 15)
    assert r.next_pay_date == date(2026, 4, 1)
    assert r.date_to == date(2026, 3, 31)


def test_semimonthly_mid_cycle():
    r = resolve_pay_cycle(
        date(2026, 1, 20),
        "semimonthly",
        date(2026, 1, 15),
    )
    assert r.date_from == date(2026, 1, 15)
    assert r.next_pay_date == date(2026, 1, 31)
    assert r.date_to == date(2026, 1, 30)
    assert not r.is_fallback_30d


def test_semimonthly_on_pay_day_advances():
    r = resolve_pay_cycle(
        date(2026, 1, 31),
        "semimonthly",
        date(2026, 1, 15),
    )
    assert r.date_from == date(2026, 1, 31)
    assert r.next_pay_date == date(2026, 2, 15)
    assert r.date_to == date(2026, 2, 14)


def test_semimonthly_invalid_anchor_fallback():
    r = resolve_pay_cycle(
        date(2026, 1, 20),
        "semimonthly",
        date(2026, 1, 10),
    )
    assert r.is_fallback_30d


def test_weekly():
    r = resolve_pay_cycle(
        date(2026, 3, 18),
        "weekly",
        date(2026, 3, 15),
    )
    assert r.date_from == date(2026, 3, 15)
    assert r.next_pay_date == date(2026, 3, 22)
    assert r.date_to == date(2026, 3, 21)
    assert r.label == "Mar 15 – Mar 21"


def test_utc_today_returns_date():
    assert isinstance(utc_today(), date)
