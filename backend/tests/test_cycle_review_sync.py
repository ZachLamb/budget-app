"""Cycle review anchor resets when pay window changes."""

from datetime import date

from app.api.routes.settings import _sync_cycle_review_anchor
from app.services.pay_cycle import PayCycleResolved


def test_sync_resets_when_cycle_start_changes():
    class H:
        cycle_review_cycle_start = date(2026, 1, 1)
        cycle_review_step = 2

    h = H()
    c = PayCycleResolved(
        date_from=date(2026, 2, 1),
        date_to=date(2026, 2, 14),
        next_pay_date=date(2026, 2, 15),
        label="",
        is_fallback_30d=False,
    )
    assert _sync_cycle_review_anchor(h, c) is True
    assert h.cycle_review_cycle_start == date(2026, 2, 1)
    assert h.cycle_review_step == 0


def test_sync_noop_when_same_cycle():
    class H:
        cycle_review_cycle_start = date(2026, 2, 1)
        cycle_review_step = 1

    h = H()
    c = PayCycleResolved(
        date_from=date(2026, 2, 1),
        date_to=date(2026, 2, 14),
        next_pay_date=date(2026, 2, 15),
        label="",
        is_fallback_30d=False,
    )
    assert _sync_cycle_review_anchor(h, c) is False
    assert h.cycle_review_step == 1
