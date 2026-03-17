from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from types import SimpleNamespace

from app.api.routes.goals import _compute_goal_metrics, _derive_linked_current_amount


def test_debt_payoff_uses_amount_paid_from_negative_balance() -> None:
    goal = SimpleNamespace(goal_type="debt_payoff", target_amount=Decimal("5000.00"))
    current_amount = _derive_linked_current_amount(goal, "credit", Decimal("-5000.00"))
    progress_pct, months_remaining = _compute_goal_metrics(
        target_amount=goal.target_amount,
        current_amount=current_amount,
        monthly_contribution=Decimal("250.00"),
        target_date=None,
    )
    assert current_amount == Decimal("0.00")
    assert progress_pct == 0.0
    assert months_remaining == 20


def test_debt_payoff_clamps_when_overpaid() -> None:
    goal = SimpleNamespace(goal_type="debt_payoff", target_amount=Decimal("5000.00"))
    # Positive live balance means debt is overpaid / no debt left.
    current_amount = _derive_linked_current_amount(goal, "loan", Decimal("250.00"))
    progress_pct, months_remaining = _compute_goal_metrics(
        target_amount=goal.target_amount,
        current_amount=current_amount,
        monthly_contribution=Decimal("100.00"),
        target_date=None,
    )
    assert current_amount == Decimal("5250.00")
    assert progress_pct == 100.0
    assert months_remaining == 0


def test_non_debt_goal_keeps_live_balance_behavior() -> None:
    goal = SimpleNamespace(goal_type="savings", target_amount=Decimal("1000.00"))
    current_amount = _derive_linked_current_amount(goal, "savings", Decimal("300.00"))
    progress_pct, _ = _compute_goal_metrics(
        target_amount=goal.target_amount,
        current_amount=current_amount,
        monthly_contribution=None,
        target_date=None,
    )
    assert current_amount == Decimal("300.00")
    assert progress_pct == 30.0


def test_goal_metrics_never_go_negative_or_above_100() -> None:
    low_progress, _ = _compute_goal_metrics(
        target_amount=Decimal("100.00"),
        current_amount=Decimal("-50.00"),
        monthly_contribution=None,
        target_date=None,
    )
    high_progress, _ = _compute_goal_metrics(
        target_amount=Decimal("100.00"),
        current_amount=Decimal("200.00"),
        monthly_contribution=None,
        target_date=None,
    )
    assert low_progress == 0.0
    assert high_progress == 100.0


def test_months_remaining_handles_past_target_date() -> None:
    _, months_remaining = _compute_goal_metrics(
        target_amount=Decimal("1000.00"),
        current_amount=Decimal("250.00"),
        monthly_contribution=None,
        target_date=date.today() - timedelta(days=1),
    )
    assert months_remaining == 0
