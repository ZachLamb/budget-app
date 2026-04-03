"""Regression: demo mode must allow certain mutations (dismiss suggestions, set pay schedule)."""

from app.middleware.demo_guard import _ALLOWED_PREFIXES


def test_demo_guard_allowlist_includes_recurring_dismiss_and_pay_schedule() -> None:
    assert "/api/recurring/suggestions/dismiss" in _ALLOWED_PREFIXES
    assert "/api/settings/pay-schedule" in _ALLOWED_PREFIXES
