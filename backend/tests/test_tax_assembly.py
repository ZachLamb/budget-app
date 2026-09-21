"""DB -> TaxInputs assembly. Contains no tax math; it shapes rows."""
from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import select

from tests.test_categories_routes import fixture, _seed_household
from app.models import Household, Paystub, PriorYearReturn, TaxProfile
from app.services.tax_assembly import (
    build_tax_inputs,
    remaining_pay_periods,
)


@pytest.mark.parametrize(
    "frequency,last_pay,expected",
    [
        ("biweekly", date(2026, 9, 18), 7),    # 26/yr, ~7 left after 18 Sep
        ("semimonthly", date(2026, 9, 15), 7), # 24/yr
        ("monthly", date(2026, 9, 1), 3),      # 12/yr
        ("weekly", date(2026, 12, 25), 0),     # none left
    ],
)
def test_remaining_pay_periods(frequency, last_pay, expected):
    assert remaining_pay_periods(frequency, last_pay, 2026) == expected


def test_remaining_pay_periods_unknown_frequency_is_zero():
    assert remaining_pay_periods(None, date(2026, 9, 18), 2026) == 0
    assert remaining_pay_periods("fortnightly", date(2026, 9, 18), 2026) == 0


async def _seed_profile(session, hid: str, status: str = "single"):
    session.add(TaxProfile(
        id=str(uuid.uuid4()), household_id=hid, filing_status=status,
    ))
    await session.flush()


async def _seed_stub(session, hid: str, pay_date: date, **overrides):
    values = dict(
        gross=Decimal("6884.62"), gross_ytd=Decimal("124000.00"),
        pretax_401k=Decimal("0.00"), pretax_401k_ytd=Decimal("0.00"),
        pretax_hsa=Decimal("0.00"), pretax_hsa_ytd=Decimal("0.00"),
        pretax_other=Decimal("0.00"), pretax_other_ytd=Decimal("0.00"),
        federal_withheld=Decimal("1240.00"), federal_withheld_ytd=Decimal("22320.00"),
        state_withheld=Decimal("280.00"), state_withheld_ytd=Decimal("5040.00"),
        ss_withheld=Decimal("417.80"), ss_withheld_ytd=Decimal("7520.40"),
        medicare_withheld=Decimal("97.70"), medicare_withheld_ytd=Decimal("1758.60"),
    )
    values.update(overrides)
    session.add(Paystub(id=str(uuid.uuid4()), household_id=hid, pay_date=pay_date, **values))
    await session.flush()


@pytest.mark.asyncio
async def test_missing_everything_reports_what_is_needed(fixture):
    session, _ = fixture
    hid, _ = await _seed_household(session)
    result = await build_tax_inputs(session, hid, 2026)
    assert result.inputs is None
    assert "filing_status" in result.missing
    assert "paystub" in result.missing


@pytest.mark.asyncio
async def test_missing_paystub_alone_still_blocks_projection(fixture):
    session, _ = fixture
    hid, _ = await _seed_household(session)
    await _seed_profile(session, hid)
    result = await build_tax_inputs(session, hid, 2026)
    assert result.inputs is None
    assert "paystub" in result.missing
    # Reported alongside, so the setup checklist does not show the pay
    # schedule as done just because nothing else got far enough to check.
    assert "pay_frequency" in result.missing


@pytest.mark.asyncio
async def test_anchors_on_latest_stub_ytd_and_projects_forward(fixture):
    session, _ = fixture
    hid, _ = await _seed_household(session)
    household = await session.get(Household, hid)
    household.pay_frequency = "monthly"
    await _seed_profile(session, hid)
    # An older stub must be ignored in favour of the latest.
    await _seed_stub(session, hid, date(2026, 8, 1), gross_ytd=Decimal("110000.00"))
    await _seed_stub(session, hid, date(2026, 9, 1))
    await session.flush()

    result = await build_tax_inputs(session, hid, 2026)
    assert result.inputs is not None
    assert result.remaining_periods == 3
    assert result.inputs.wages_ytd == Decimal("124000.00")
    assert result.inputs.projected_remaining_wages == Decimal("20653.86")  # 6884.62 x 3
    assert result.inputs.federal_withheld_ytd == Decimal("22320.00")
    assert result.inputs.projected_remaining_withholding.federal == Decimal("3720.00")


@pytest.mark.asyncio
async def test_prior_year_carryforwards_are_wired_in(fixture):
    session, _ = fixture
    hid, _ = await _seed_household(session)
    household = await session.get(Household, hid)
    household.pay_frequency = "monthly"
    await _seed_profile(session, hid)
    await _seed_stub(session, hid, date(2026, 9, 1))
    session.add(PriorYearReturn(
        id=str(uuid.uuid4()), household_id=hid, year=2025,
        agi=Decimal("168000.00"), total_tax=Decimal("49310.60"),
    ))
    await session.flush()

    result = await build_tax_inputs(session, hid, 2026)
    assert result.inputs.prior_year_total_tax == Decimal("49310.60")
    assert result.inputs.prior_year_agi == Decimal("168000.00")
    assert "prior_year_return" not in result.missing


@pytest.mark.asyncio
async def test_prior_year_absence_is_reported_but_not_blocking(fixture):
    session, _ = fixture
    hid, _ = await _seed_household(session)
    household = await session.get(Household, hid)
    household.pay_frequency = "monthly"
    await _seed_profile(session, hid)
    await _seed_stub(session, hid, date(2026, 9, 1))
    await session.flush()

    result = await build_tax_inputs(session, hid, 2026)
    assert result.inputs is not None, "projection still works without prior year"
    assert "prior_year_return" in result.missing
    assert result.inputs.prior_year_total_tax is None


@pytest.mark.asyncio
async def test_unset_pay_frequency_is_reported_not_silently_zero(fixture):
    """A household with no pay schedule must not get a confident full-year number.

    Without a frequency the remainder of the year projects to zero wages,
    which understates the tax bill by the whole rest of the year -- $15k on
    a September paystub. The projection is still worth showing, so this is
    reported rather than blocking, but it must be reported.
    """
    session, _ = fixture
    hid, _ = await _seed_household(session)
    household = await session.get(Household, hid)
    household.pay_frequency = None
    await _seed_profile(session, hid)
    await _seed_stub(session, hid, date(2026, 9, 1))
    await session.flush()

    result = await build_tax_inputs(session, hid, 2026)
    assert result.inputs is not None, "a partial projection is still useful"
    assert result.remaining_periods == 0
    assert "pay_frequency" in result.missing
    assert result.inputs.projected_remaining_wages == Decimal("0.00")


@pytest.mark.asyncio
async def test_irregular_pay_frequency_is_reported_too(fixture):
    """`irregular` is a valid setting the projection cannot use."""
    session, _ = fixture
    hid, _ = await _seed_household(session)
    household = await session.get(Household, hid)
    household.pay_frequency = "irregular"
    await _seed_profile(session, hid)
    await _seed_stub(session, hid, date(2026, 9, 1))
    await session.flush()

    result = await build_tax_inputs(session, hid, 2026)
    assert "pay_frequency" in result.missing


@pytest.mark.asyncio
async def test_a_finished_year_does_not_report_pay_frequency(fixture):
    """December's stub leaves no year to project, so zero periods is correct."""
    session, _ = fixture
    hid, _ = await _seed_household(session)
    household = await session.get(Household, hid)
    household.pay_frequency = "biweekly"
    await _seed_profile(session, hid)
    await _seed_stub(session, hid, date(2026, 12, 31))
    await session.flush()

    result = await build_tax_inputs(session, hid, 2026)
    assert result.remaining_periods == 0
    assert "pay_frequency" not in result.missing


@pytest.mark.asyncio
async def test_a_known_frequency_is_never_reported_missing(fixture):
    session, _ = fixture
    hid, _ = await _seed_household(session)
    household = await session.get(Household, hid)
    household.pay_frequency = "biweekly"
    await _seed_profile(session, hid)
    await _seed_stub(session, hid, date(2026, 9, 1))
    await session.flush()

    result = await build_tax_inputs(session, hid, 2026)
    assert result.remaining_periods > 0
    assert "pay_frequency" not in result.missing


@pytest.mark.asyncio
async def test_no_withholding_entered_is_reported_not_taken_as_zero(fixture):
    """Leaving the withheld boxes blank is not the same as saying nothing
    was withheld. Taken as zero it produces "you owe $32,727" on a normal
    salary -- alarming, and not something the user ever told us.
    """
    session, _ = fixture
    hid, _ = await _seed_household(session)
    household = await session.get(Household, hid)
    household.pay_frequency = "biweekly"
    await _seed_profile(session, hid)
    await _seed_stub(
        session, hid, date(2026, 9, 1),
        federal_withheld=Decimal("0.00"), federal_withheld_ytd=Decimal("0.00"),
        state_withheld=Decimal("0.00"), state_withheld_ytd=Decimal("0.00"),
        ss_withheld=Decimal("0.00"), ss_withheld_ytd=Decimal("0.00"),
        medicare_withheld=Decimal("0.00"), medicare_withheld_ytd=Decimal("0.00"),
    )
    await session.flush()

    result = await build_tax_inputs(session, hid, 2026)
    assert result.inputs is not None, "the tax figures themselves are still sound"
    assert "withholding" in result.missing


@pytest.mark.asyncio
async def test_any_withholding_at_all_is_enough_to_stay_quiet(fixture):
    session, _ = fixture
    hid, _ = await _seed_household(session)
    household = await session.get(Household, hid)
    household.pay_frequency = "biweekly"
    await _seed_profile(session, hid)
    await _seed_stub(session, hid, date(2026, 9, 1), medicare_withheld_ytd=Decimal("1758.60"))
    await session.flush()

    result = await build_tax_inputs(session, hid, 2026)
    assert "withholding" not in result.missing
