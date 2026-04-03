"""Unit tests for paycheck cycle resolution."""

from datetime import date

from app.services.pay_cycle import add_period, resolve_pay_cycle


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


def test_biweekly_on_pay_day_advances():
    r = resolve_pay_cycle(
        date(2026, 3, 29),
        "biweekly",
        date(2026, 3, 15),
    )
    assert r.date_from == date(2026, 3, 29)
    assert r.next_pay_date == date(2026, 4, 12)
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


def test_weekly():
    r = resolve_pay_cycle(
        date(2026, 3, 18),
        "weekly",
        date(2026, 3, 15),
    )
    assert r.date_from == date(2026, 3, 15)
    assert r.next_pay_date == date(2026, 3, 22)
