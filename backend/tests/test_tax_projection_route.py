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
    session.add(TaxProfile(id=str(uuid.uuid4()), household_id=hid, filing_status="single"))
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
async def test_unsupported_filing_status_does_not_take_down_the_page(fixture):
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
    assert body["supported_filing_statuses"] == ["single"]
