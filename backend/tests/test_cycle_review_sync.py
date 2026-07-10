"""Cycle review anchor resets signals when pay window changes."""

from datetime import date

from app.api.routes.settings import _sync_cycle_review_anchor
from app.services.pay_cycle import PayCycleResolved


def _cycle(start: date) -> PayCycleResolved:
    return PayCycleResolved(
        date_from=start,
        date_to=date(2026, 2, 14),
        next_pay_date=date(2026, 2, 15),
        label="",
        is_fallback_30d=False,
    )


def test_sync_resets_signals_when_cycle_start_changes():
    class H:
        cycle_review_cycle_start = date(2026, 1, 1)
        cycle_observed_at = date(2026, 1, 3)
        cycle_diagnosed_at = date(2026, 1, 5)
        cycle_decide_ack = True

    h = H()
    assert _sync_cycle_review_anchor(h, _cycle(date(2026, 2, 1))) is True
    assert h.cycle_review_cycle_start == date(2026, 2, 1)
    assert h.cycle_observed_at is None
    assert h.cycle_diagnosed_at is None
    assert h.cycle_decide_ack is False


def test_sync_noop_when_same_cycle():
    class H:
        cycle_review_cycle_start = date(2026, 2, 1)
        cycle_observed_at = date(2026, 2, 2)
        cycle_diagnosed_at = None
        cycle_decide_ack = True

    h = H()
    assert _sync_cycle_review_anchor(h, _cycle(date(2026, 2, 1))) is False
    assert h.cycle_observed_at == date(2026, 2, 2)
    assert h.cycle_decide_ack is True
