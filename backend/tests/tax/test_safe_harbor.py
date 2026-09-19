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
    assert "last year" in result.reason.lower()


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


def test_agi_missing_but_90_percent_current_binds():
    """When AGI is missing but 90% of current is the binding test, we can give
    a definitive answer because 90% of current <= 100% of prior <= 110% of prior."""
    result = evaluate_safe_harbor(
        total_liability=Decimal("80000"),
        projected_withholding=Decimal("65000"),
        prior_year_total_tax=Decimal("75000"),
        prior_year_agi=None,
        remaining_periods=6,
    )
    # 90% of 80,000 = 72,000; 100% of 75,000 = 75,000
    # 72,000 < 75,000, so 90% binds regardless of multiplier
    assert result.test_used == "90_percent_current"
    assert result.required_payment == Decimal("72000.00")
    assert result.status == "not_met"
    assert result.shortfall == Decimal("7000.00")


def test_agi_missing_and_prior_test_would_bind():
    """When AGI is missing and the prior-year test would be binding, we cannot
    determine if 100% or 110% applies, so we ask for AGI."""
    result = evaluate_safe_harbor(
        total_liability=Decimal("100000"),
        projected_withholding=Decimal("50000"),
        prior_year_total_tax=Decimal("80000"),
        prior_year_agi=None,
        remaining_periods=6,
    )
    # 90% of 100,000 = 90,000; 100% of 80,000 = 80,000
    # 90,000 > 80,000, so the prior-year test would be binding
    # But we don't know if it should be 100% or 110%, so ask for AGI
    assert result.status == "unknown"
    assert result.test_used == "none"
    assert result.required_payment is None
    assert result.shortfall is None
    assert "agi" in result.reason.lower()


def test_regression_high_income_with_agi_present():
    """Regression: when AGI is present and high-income, ensure we use 110%."""
    result = evaluate_safe_harbor(
        total_liability=Decimal("60000"),
        projected_withholding=Decimal("52000"),
        prior_year_total_tax=Decimal("49310.60"),
        prior_year_agi=Decimal("200000"),
        remaining_periods=6,
    )
    # 90% of 60,000 = 54,000; 110% of 49,310.60 = 54,241.66
    # 54,000 < 54,241.66, so 90% binds anyway
    assert result.test_used == "90_percent_current"
    assert result.required_payment == Decimal("54000.00")
    assert result.status == "not_met"
