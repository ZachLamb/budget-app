"""Model-level tests for the tax projection tables."""
from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import select

from tests.test_categories_routes import fixture, _seed_household
from app.models import (
    Category,
    CategoryGroup,
    Paystub,
    PriorYearReturn,
    TaxProfile,
)


@pytest.mark.asyncio
async def test_tax_profile_round_trips(fixture):
    session, _ = fixture
    hid, _ = await _seed_household(session)
    session.add(TaxProfile(
        id=str(uuid.uuid4()),
        household_id=hid,
        filing_status="single",
        walkthrough_answers={"married": False, "dependents": False},
    ))
    await session.flush()

    result = await session.execute(
        select(TaxProfile).where(TaxProfile.household_id == hid)
    )
    profile = result.scalar_one()
    assert profile.filing_status == "single"
    assert profile.walkthrough_answers["married"] is False
    assert profile.de_minimis_election is False


@pytest.mark.asyncio
async def test_tax_profile_has_no_manual_rate_columns(fixture):
    """The hand-entered marginal rates are gone -- they are now derived."""
    columns = set(TaxProfile.__table__.columns.keys())
    assert "marginal_federal_rate" not in columns
    assert "marginal_state_rate" not in columns
    assert "current_federal_withholding_per_period" not in columns
    assert "remaining_pay_periods_this_year" not in columns


@pytest.mark.asyncio
async def test_models_carry_no_sensitive_identifiers(fixture):
    """Privacy guard: nothing here should ever hold an SSN or employer."""
    for model in (TaxProfile, Paystub, PriorYearReturn):
        columns = set(model.__table__.columns.keys())
        for banned in ("ssn", "social_security_number", "employer",
                       "address", "document", "document_blob"):
            assert banned not in columns, f"{model.__name__} must not store {banned}"


@pytest.mark.asyncio
async def test_paystub_round_trips_with_ytd_columns(fixture):
    session, _ = fixture
    hid, _ = await _seed_household(session)
    session.add(Paystub(
        id=str(uuid.uuid4()),
        household_id=hid,
        pay_date=date(2026, 9, 15),
        gross=Decimal("6884.62"),
        pretax_401k=Decimal("904.00"),
        pretax_hsa=Decimal("160.00"),
        pretax_other=Decimal("120.00"),
        federal_withheld=Decimal("1240.00"),
        state_withheld=Decimal("280.00"),
        ss_withheld=Decimal("417.80"),
        medicare_withheld=Decimal("97.70"),
        gross_ytd=Decimal("124000.00"),
        pretax_401k_ytd=Decimal("16272.00"),
        pretax_hsa_ytd=Decimal("2880.00"),
        pretax_other_ytd=Decimal("2160.00"),
        federal_withheld_ytd=Decimal("22320.00"),
        state_withheld_ytd=Decimal("5040.00"),
        ss_withheld_ytd=Decimal("7520.40"),
        medicare_withheld_ytd=Decimal("1758.60"),
    ))
    await session.flush()

    result = await session.execute(
        select(Paystub).where(Paystub.household_id == hid)
    )
    stub = result.scalar_one()
    assert stub.gross_ytd == Decimal("124000.00")
    assert stub.pay_date == date(2026, 9, 15)


@pytest.mark.asyncio
async def test_prior_year_return_round_trips(fixture):
    session, _ = fixture
    hid, _ = await _seed_household(session)
    session.add(PriorYearReturn(
        id=str(uuid.uuid4()),
        household_id=hid,
        year=2025,
        filing_status="single",
        agi=Decimal("168000.00"),
        taxable_income=Decimal("153000.00"),
        total_tax=Decimal("49310.60"),
        total_withheld=Decimal("50000.00"),
        itemized=False,
        itemized_amount=Decimal("0.00"),
        schedule_e_net=Decimal("-4000.00"),
        passive_loss_carryforward=Decimal("4000.00"),
        capital_loss_carryforward=Decimal("0.00"),
        qbi_carryforward=Decimal("0.00"),
    ))
    await session.flush()

    result = await session.execute(
        select(PriorYearReturn).where(PriorYearReturn.household_id == hid)
    )
    prior = result.scalar_one()
    assert prior.total_tax == Decimal("49310.60")
    assert prior.passive_loss_carryforward == Decimal("4000.00")


@pytest.mark.asyncio
async def test_category_deduction_kind_defaults_to_personal_itemized(fixture):
    """Existing rows must keep their current meaning on migration."""
    session, _ = fixture
    hid, _ = await _seed_household(session)
    group = CategoryGroup(id=str(uuid.uuid4()), household_id=hid, name="Rental")
    session.add(group)
    await session.flush()
    category = Category(id=str(uuid.uuid4()), group_id=group.id, name="Cleaning")
    session.add(category)
    await session.flush()
    assert category.deduction_kind == "personal_itemized"
