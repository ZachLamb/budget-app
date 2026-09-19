"""Safe harbor must never report 'met' on missing data."""
from __future__ import annotations

from decimal import Decimal

from app.services.tax.safe_harbor import evaluate_safe_harbor


def test_unknown_when_prior_year_is_missing():
    result = evaluate_safe_harbor(
        total_liability=Decimal("52555.10"),
        projected_withholding=Decimal("40000"),
        prior_year_total_tax=None,
        prior_year_agi=None,
        remaining_periods=6,
    )
    assert result.status == "unknown"
    assert result.test_used == "none"
    assert result.shortfall is None
    assert "prior" in result.reason.lower()


def test_high_income_uses_110_percent_of_prior_year_as_the_alternative():
    result = evaluate_safe_harbor(
        total_liability=Decimal("60000"),
        projected_withholding=Decimal("52000"),
        prior_year_total_tax=Decimal("49310.60"),
        prior_year_agi=Decimal("170000"),
        remaining_periods=6,
    )
    # lesser of 90% of 60,000 = 54,000, and 110% of 49,310.60 = 54,241.66
    assert result.test_used == "90_percent_current"
    assert result.required_payment == Decimal("54000.00")
    assert result.status == "not_met"
    assert result.shortfall == Decimal("2000.00")
    assert result.per_period_to_close == Decimal("333.33")


def test_100_percent_of_prior_year_wins_when_it_is_the_lesser():
    result = evaluate_safe_harbor(
        total_liability=Decimal("60000"),
        projected_withholding=Decimal("40000"),
        prior_year_total_tax=Decimal("38000"),
        prior_year_agi=Decimal("120000"),
        remaining_periods=4,
    )
    # lesser of 90% of 60,000 = 54,000, and 100% of 38,000 = 38,000
    assert result.test_used == "100_percent_prior"
    assert result.required_payment == Decimal("38000.00")
    assert result.status == "met"
    assert result.shortfall == Decimal("0.00")
    assert result.per_period_to_close == Decimal("0.00")


def test_met_when_withholding_exceeds_the_requirement():
    result = evaluate_safe_harbor(
        total_liability=Decimal("52555.10"),
        projected_withholding=Decimal("52000"),
        prior_year_total_tax=Decimal("49310.60"),
        prior_year_agi=Decimal("170000"),
        remaining_periods=6,
    )
    # lesser of 47,299.59 and 54,241.66 -> 47,299.59; 52,000 clears it
    assert result.status == "met"
    assert result.test_used == "90_percent_current"


def test_zero_remaining_periods_does_not_divide_by_zero():
    result = evaluate_safe_harbor(
        total_liability=Decimal("60000"),
        projected_withholding=Decimal("10000"),
        prior_year_total_tax=Decimal("38000"),
        prior_year_agi=Decimal("120000"),
        remaining_periods=0,
    )
    assert result.status == "not_met"
    assert result.per_period_to_close is None
