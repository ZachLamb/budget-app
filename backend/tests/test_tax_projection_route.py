"""Projection and impact endpoints."""
from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

import pytest

from sqlalchemy import select

from tests.test_categories_routes import fixture, _seed_household, _client
from app.models import Household, Paystub, PriorYearReturn, TaxProfile


async def _seed_ready_household(session, *, gross_ytd="179000.00"):
    hid, headers = await _seed_household(session)
    household = await session.get(Household, hid)
    household.pay_frequency = "monthly"
    session.add(TaxProfile(id=str(uuid.uuid4()), household_id=hid, filing_status="single", state="CO"))
    # A December stub leaves zero periods, so YTD is the whole year.
    session.add(Paystub(
        id=str(uuid.uuid4()), household_id=hid, pay_date=date(2026, 12, 31),
        gross=Decimal("0.00"), gross_ytd=Decimal(gross_ytd),
    ))
    await session.flush()
    return hid, headers


@pytest.mark.asyncio
async def test_projection_unavailable_lists_what_is_missing(fixture):
    session, _ = fixture
    hid, headers = await _seed_household(session)
    async with _client() as client:
        response = await client.get("/api/tax/projection", params={"year": 2026}, headers=headers)
    assert response.status_code == 200
    body = response.json()
    assert body["available"] is False
    assert "filing_status" in body["missing"]
    assert "paystub" in body["missing"]
    assert body.get("projection") is None


@pytest.mark.asyncio
async def test_projection_matches_the_engine(fixture):
    session, _ = fixture
    hid, headers = await _seed_ready_household(session)
    async with _client() as client:
        response = await client.get("/api/tax/projection", params={"year": 2026}, headers=headers)

    assert response.status_code == 200
    body = response.json()
    assert body["available"] is True
    p = body["projection"]
    assert p["taxable_income"] == "162900.00"
    assert p["total_liability"] == "52555.10"
    assert p["safe_harbor"]["status"] == "unknown"
    assert len(p["explain"]) > 0


@pytest.mark.asyncio
async def test_safe_harbor_becomes_known_once_prior_year_exists(fixture):
    session, _ = fixture
    hid, headers = await _seed_ready_household(session)
    session.add(PriorYearReturn(
        id=str(uuid.uuid4()), household_id=hid, year=2025,
        agi=Decimal("168000.00"), total_tax=Decimal("49310.60"),
    ))
    await session.flush()

    async with _client() as client:
        response = await client.get("/api/tax/projection", params={"year": 2026}, headers=headers)
    assert response.json()["projection"]["safe_harbor"]["status"] in {"met", "not_met"}


@pytest.mark.asyncio
async def test_unsupported_year_is_rejected_not_approximated(fixture):
    session, _ = fixture
    hid, headers = await _seed_ready_household(session)
    async with _client() as client:
        response = await client.get("/api/tax/projection", params={"year": 2019}, headers=headers)
    assert response.status_code == 422
    assert "2019" in response.text


@pytest.mark.asyncio
async def test_impact_endpoint_returns_dollars(fixture):
    session, _ = fixture
    hid, headers = await _seed_ready_household(session)
    async with _client() as client:
        response = await client.post("/api/tax/impact", headers=headers, json={
            "year": 2026, "kind": "extra_wages", "amount": "1000.00",
        })
    assert response.status_code == 200
    body = response.json()
    assert body["amount_of_tax"] == "360.50"
    assert body["change_amount"] == "1000.00"


@pytest.mark.asyncio
async def test_impact_of_a_personal_deduction_below_the_standard_is_zero(fixture):
    """The correctness fix, asserted end to end."""
    session, _ = fixture
    hid, headers = await _seed_ready_household(session)
    async with _client() as client:
        response = await client.post("/api/tax/impact", headers=headers, json={
            "year": 2026, "kind": "extra_itemized_deduction", "amount": "5000.00",
        })
    assert response.json()["amount_of_tax"] == "0.00"


@pytest.mark.asyncio
async def test_impact_rejects_an_unknown_kind(fixture):
    session, _ = fixture
    hid, headers = await _seed_ready_household(session)
    async with _client() as client:
        response = await client.post("/api/tax/impact", headers=headers, json={
            "year": 2026, "kind": "buy_a_boat", "amount": "1000.00",
        })
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_unsupported_filing_status_does_not_take_down_the_page(fixture, monkeypatch):
    """Saving "married" used to 422 and replace the whole Taxes page with
    "married_joint is not populated for 2026 ... add its sourced rate table",
    leaving a Retry button that could never succeed. The status is still a
    fact about the user, so it saves -- the page just has to say why there
    is no estimate instead of breaking.
    """
    session, _ = fixture
    hid, headers = await _seed_ready_household(session)
    profile = (await session.execute(
        select(TaxProfile).where(TaxProfile.household_id == hid)
    )).scalar_one()
    profile.filing_status = "married_joint"
    await session.flush()

    # Every 2026 status is populated now, so narrow the supported set to
    # make one unsupported again. `get_rates` reads this at call time, so
    # patching it reaches the route however it imported the function. The
    # degraded path still matters: it is what the first unsourced year hits.
    from app.services.tax.rates import federal_2026
    from app.services.tax.rates.registry import FilingStatus

    monkeypatch.setattr(
        federal_2026, "SUPPORTED_STATUSES", frozenset({FilingStatus.SINGLE})
    )

    async with _client() as client:
        response = await client.get("/api/tax/projection", params={"year": 2026}, headers=headers)

    assert response.status_code == 200
    body = response.json()
    assert body["available"] is False
    assert "unsupported_filing_status" in body["missing"]
    assert body.get("projection") is None


@pytest.mark.asyncio
async def test_envelope_names_the_statuses_it_can_actually_compute(fixture):
    """The walkthrough needs this to warn before saving a status that
    cannot produce an estimate."""
    session, _ = fixture
    hid, headers = await _seed_ready_household(session)
    async with _client() as client:
        response = await client.get("/api/tax/projection", params={"year": 2026}, headers=headers)
    body = response.json()
    assert sorted(body["supported_filing_statuses"]) == [
        "head_of_household",
        "married_joint",
        "married_separate",
        "qualifying_surviving_spouse",
        "single",
    ]


@pytest.mark.asyncio
async def test_a_profile_with_no_state_reports_it_rather_than_assuming_colorado(fixture):
    """The projection used to apply Colorado's 4.4% to everybody.

    A filer in Texas saw a state tax line for a state that has none, and
    nothing said the figure was assumed. An unknown state is now a gap in
    the answer, like an unknown filing status.
    """
    session, _ = fixture
    hid, headers = await _seed_ready_household(session)
    profile = (await session.execute(
        select(TaxProfile).where(TaxProfile.household_id == hid)
    )).scalar_one()
    profile.state = None
    await session.flush()

    async with _client() as client:
        response = await client.get("/api/tax/projection", params={"year": 2026}, headers=headers)

    assert response.status_code == 200
    body = response.json()
    assert body["available"] is False
    assert "state" in body["missing"]
    assert body.get("projection") is None


@pytest.mark.asyncio
async def test_a_state_with_no_rate_table_degrades_instead_of_erroring(fixture):
    session, _ = fixture
    hid, headers = await _seed_ready_household(session)
    profile = (await session.execute(
        select(TaxProfile).where(TaxProfile.household_id == hid)
    )).scalar_one()
    profile.state = "NY"
    await session.flush()

    async with _client() as client:
        response = await client.get("/api/tax/projection", params={"year": 2026}, headers=headers)

    assert response.status_code == 200
    body = response.json()
    assert body["available"] is False
    assert "unsupported_state" in body["missing"]


@pytest.mark.asyncio
async def test_a_no_income_tax_state_gets_a_projection_with_zero_state_tax(fixture):
    """Texas owes nothing to the state, and that is an answer worth
    showing -- not a reason to withhold the whole estimate."""
    session, _ = fixture
    hid, headers = await _seed_ready_household(session)
    profile = (await session.execute(
        select(TaxProfile).where(TaxProfile.household_id == hid)
    )).scalar_one()
    profile.state = "TX"
    await session.flush()

    async with _client() as client:
        response = await client.get("/api/tax/projection", params={"year": 2026}, headers=headers)

    body = response.json()
    assert body["available"] is True
    assert body["projection"]["state_tax"] == "0.00"
    # The federal side is untouched by the state having no tax.
    assert body["projection"]["taxable_income"] == "162900.00"
