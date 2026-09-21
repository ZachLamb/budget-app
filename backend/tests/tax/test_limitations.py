"""Passive activity loss limitation.

Expected values are derived directly from IRS Pub 925: allowance is
$25,000, reduced by 50% of MAGI over $100,000, zero at $150,000.
"""
from __future__ import annotations

from decimal import Decimal

import pytest

from app.services.tax.engine import project
from app.services.tax.inputs import ScheduleEResult, TaxInputs, WithholdingBuckets
from app.services.tax.limitations import allowed_rental_loss
from app.services.tax.rates.registry import FilingStatus, get_rates

RATES = get_rates(2026)
PAL = RATES.passive_loss
LOSS = Decimal("-18000")


@pytest.mark.parametrize(
    "magi,expected_allowed,expected_suspended",
    [
        (Decimal("85000"), Decimal("18000"), Decimal("0")),
        (Decimal("100000"), Decimal("18000"), Decimal("0")),
        (Decimal("105000"), Decimal("18000"), Decimal("0")),
        (Decimal("120000"), Decimal("15000"), Decimal("3000")),
        (Decimal("140000"), Decimal("5000"), Decimal("13000")),
        (Decimal("150000"), Decimal("0"), Decimal("18000")),
        (Decimal("179000"), Decimal("0"), Decimal("18000")),
    ],
)
def test_allowance_phases_out_between_100k_and_150k(
    magi, expected_allowed, expected_suspended
):
    result = allowed_rental_loss(magi, LOSS, True, PAL)
    assert result.allowed == expected_allowed
    assert result.suspended == expected_suspended


def test_no_active_participation_means_no_allowance():
    result = allowed_rental_loss(Decimal("50000"), LOSS, False, PAL)
    assert result.allowed == Decimal("0")
    assert result.suspended == Decimal("18000")


def test_rental_income_is_not_limited():
    """Only LOSSES are limited. Income passes through untouched."""
    result = allowed_rental_loss(Decimal("179000"), Decimal("12000"), True, PAL)
    assert result.allowed == Decimal("12000")
    assert result.suspended == Decimal("0")


def test_magi_excludes_the_passive_loss_itself():
    """IRS Pub 925 regression guard. Using AGI-after-loss would give an
    $18,000 allowance here instead of the correct $15,000, and would
    create an apparent circularity that does not exist."""
    magi_correct = Decimal("120000")
    magi_wrong = magi_correct + LOSS  # 102,000 -- what AGI-after-loss gives

    assert allowed_rental_loss(magi_correct, LOSS, True, PAL).allowed == Decimal("15000")
    assert allowed_rental_loss(magi_wrong, LOSS, True, PAL).allowed == Decimal("18000")


def _inputs_with_rental_loss(wages: Decimal) -> TaxInputs:
    return TaxInputs(
        filing_status=FilingStatus.SINGLE,
        wages_ytd=wages,
        projected_remaining_wages=Decimal("0"),
        pretax_401k=Decimal("0"),
        pretax_hsa=Decimal("0"),
        pretax_other=Decimal("0"),
        federal_withheld_ytd=Decimal("0"),
        state_withheld_ytd=Decimal("0"),
        ss_withheld_ytd=Decimal("0"),
        medicare_withheld_ytd=Decimal("0"),
        projected_remaining_withholding=WithholdingBuckets.zero(),
        itemized_deductions=Decimal("0"),
        schedule_e=ScheduleEResult(
            gross_rental_income=Decimal("30000"),
            allowable_expenses=Decimal("48000"),
            net=LOSS,
            active_participation=True,
            suspended_loss_carryin=Decimal("0"),
        ),
        prior_year_total_tax=None,
        prior_year_agi=None,
    )


def test_engine_applies_the_limit_rather_than_passing_the_loss_through():
    """At $160k wages the whole loss suspends, so AGI must equal wages."""
    p = project(_inputs_with_rental_loss(Decimal("160000")), RATES)
    assert p.schedule_e_allowed_loss == Decimal("0.00")
    assert p.schedule_e_suspended_loss == Decimal("18000.00")
    assert p.agi == Decimal("160000.00")


def test_engine_allows_the_full_loss_below_the_phaseout():
    p = project(_inputs_with_rental_loss(Decimal("85000")), RATES)
    assert p.schedule_e_allowed_loss == Decimal("18000.00")
    assert p.agi == Decimal("67000.00")


def test_magi_for_pal_is_reported_and_excludes_the_loss():
    p = project(_inputs_with_rental_loss(Decimal("120000")), RATES)
    assert p.magi_for_pal == Decimal("120000.00")
    assert p.schedule_e_allowed_loss == Decimal("15000.00")
    assert p.schedule_e_suspended_loss == Decimal("3000.00")
    assert p.agi == Decimal("105000.00")
