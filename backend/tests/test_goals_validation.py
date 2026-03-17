from __future__ import annotations

from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.schemas.goal import GoalCreate, GoalUpdate


def test_goal_create_requires_positive_target_amount() -> None:
    with pytest.raises(ValidationError):
        GoalCreate(
            name="Emergency Fund",
            goal_type="savings",
            target_amount=Decimal("0.00"),
            current_amount=Decimal("0.00"),
        )


def test_goal_create_rejects_negative_amounts() -> None:
    with pytest.raises(ValidationError):
        GoalCreate(
            name="Pay off card",
            goal_type="debt_payoff",
            target_amount=Decimal("1000.00"),
            current_amount=Decimal("-1.00"),
        )

    with pytest.raises(ValidationError):
        GoalCreate(
            name="Pay off card",
            goal_type="debt_payoff",
            target_amount=Decimal("1000.00"),
            current_amount=Decimal("0.00"),
            monthly_contribution=Decimal("-10.00"),
        )


def test_goal_create_rejects_invalid_goal_type() -> None:
    with pytest.raises(ValidationError):
        GoalCreate(
            name="Vacation",
            goal_type="random_type",
            target_amount=Decimal("2500.00"),
            current_amount=Decimal("0.00"),
        )


def test_goal_name_is_trimmed_and_non_empty() -> None:
    model = GoalCreate(
        name="  Emergency Fund  ",
        goal_type="emergency_fund",
        target_amount=Decimal("5000.00"),
        current_amount=Decimal("0.00"),
    )
    assert model.name == "Emergency Fund"

    with pytest.raises(ValidationError):
        GoalCreate(
            name="   ",
            goal_type="savings",
            target_amount=Decimal("100.00"),
            current_amount=Decimal("0.00"),
        )


def test_goal_update_validates_optional_fields() -> None:
    with pytest.raises(ValidationError):
        GoalUpdate(target_amount=Decimal("-1.00"))
    with pytest.raises(ValidationError):
        GoalUpdate(monthly_contribution=Decimal("-1.00"))
    with pytest.raises(ValidationError):
        GoalUpdate(name="   ")
