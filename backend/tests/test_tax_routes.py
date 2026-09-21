"""Household-scoped CRUD for the tax tables."""
from __future__ import annotations

import uuid
from decimal import Decimal

import pytest
from sqlalchemy import select

from tests.test_categories_routes import fixture, _seed_household, _client
from app.models import Paystub, PriorYearReturn, TaxProfile


def _stub_payload(**overrides):
    payload = {
        "pay_date": "2026-09-15",
        "gross": "6884.62",
        "pretax_401k": "904.00",
        "pretax_hsa": "160.00",
        "pretax_other": "0.00",
        "federal_withheld": "1240.00",
        "state_withheld": "280.00",
        "ss_withheld": "417.80",
        "medicare_withheld": "97.70",
        "gross_ytd": "124000.00",
        "pretax_401k_ytd": "16272.00",
        "pretax_hsa_ytd": "2880.00",
        "pretax_other_ytd": "0.00",
        "federal_withheld_ytd": "22320.00",
        "state_withheld_ytd": "5040.00",
        "ss_withheld_ytd": "7520.40",
        "medicare_withheld_ytd": "1758.60",
    }
    payload.update(overrides)
    return payload


@pytest.mark.asyncio
async def test_get_profile_returns_empty_shape_when_absent(fixture):
    session, _ = fixture
    _, headers = await _seed_household(session)
    async with _client() as client:
        response = await client.get("/api/tax/profile", headers=headers)
    assert response.status_code == 200
    assert response.json()["filing_status"] is None


@pytest.mark.asyncio
async def test_put_profile_upserts_and_stores_walkthrough_answers(fixture):
    session, _ = fixture
    hid, headers = await _seed_household(session)
    async with _client() as client:
        response = await client.put("/api/tax/profile", headers=headers, json={
            "filing_status": "single",
            "walkthrough_answers": {"married": False, "supports_dependent": False},
        })
    assert response.status_code == 200
    assert response.json()["filing_status"] == "single"

    result = await session.execute(select(TaxProfile).where(TaxProfile.household_id == hid))
    profile = result.scalar_one()
    assert profile.walkthrough_answers["married"] is False
    assert profile.walkthrough_completed_at is not None


@pytest.mark.asyncio
async def test_put_profile_rejects_unknown_filing_status(fixture):
    session, _ = fixture
    _, headers = await _seed_household(session)
    async with _client() as client:
        response = await client.put("/api/tax/profile", headers=headers, json={"filing_status": "bachelor"})
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_create_and_list_paystubs_newest_first(fixture):
    session, _ = fixture
    _, headers = await _seed_household(session)
    async with _client() as client:
        assert (await client.post("/api/tax/paystubs", headers=headers, json=_stub_payload())).status_code == 201
        assert (await client.post("/api/tax/paystubs", headers=headers, json=_stub_payload(
            pay_date="2026-09-30", gross_ytd="130884.62"
        ))).status_code == 201
        response = await client.get("/api/tax/paystubs", headers=headers)

    assert response.status_code == 200
    stubs = response.json()
    assert [s["pay_date"] for s in stubs] == ["2026-09-30", "2026-09-15"]


@pytest.mark.asyncio
async def test_duplicate_pay_date_is_rejected(fixture):
    session, _ = fixture
    _, headers = await _seed_household(session)
    async with _client() as client:
        assert (await client.post("/api/tax/paystubs", headers=headers, json=_stub_payload())).status_code == 201
        response = await client.post("/api/tax/paystubs", headers=headers, json=_stub_payload())
    assert response.status_code == 409


@pytest.mark.asyncio
async def test_negative_gross_is_rejected(fixture):
    session, _ = fixture
    _, headers = await _seed_household(session)
    async with _client() as client:
        response = await client.post("/api/tax/paystubs", headers=headers, json=_stub_payload(gross="-100.00"))
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_ytd_going_backwards_is_rejected(fixture):
    """Spec degradation rule: a stub inconsistent with earlier ones is
    flagged rather than silently accepted. Year-to-date figures only ever
    increase; a decrease means a typo or the wrong year, and accepting it
    would quietly scale the whole projection."""
    session, _ = fixture
    _, headers = await _seed_household(session)
    async with _client() as client:
        assert (await client.post("/api/tax/paystubs", headers=headers, json=_stub_payload())).status_code == 201
        response = await client.post("/api/tax/paystubs", headers=headers, json=_stub_payload(
            pay_date="2026-09-30", gross_ytd="100000.00"
        ))
    assert response.status_code == 422
    assert "year-to-date" in response.text.lower()


@pytest.mark.asyncio
async def test_ytd_below_this_stubs_own_gross_is_rejected(fixture):
    session, _ = fixture
    _, headers = await _seed_household(session)
    async with _client() as client:
        response = await client.post("/api/tax/paystubs", headers=headers, json=_stub_payload(
            gross="6884.62", gross_ytd="1000.00"
        ))
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_cannot_delete_another_households_paystub(fixture):
    """Authorization guard: ownership is checked, not just authentication."""
    session, _ = fixture
    hid_a, headers_a = await _seed_household(session)
    hid_b, _ = await _seed_household(session)
    foreign = Paystub(
        id=str(uuid.uuid4()), household_id=hid_b,
        pay_date=__import__("datetime").date(2026, 9, 15),
        gross=Decimal("100.00"), gross_ytd=Decimal("100.00"),
    )
    session.add(foreign)
    await session.flush()

    async with _client() as client:
        response = await client.delete(f"/api/tax/paystubs/{foreign.id}", headers=headers_a)
    assert response.status_code == 404

    result = await session.execute(select(Paystub).where(Paystub.id == foreign.id))
    assert result.scalar_one_or_none() is not None, "must not delete across households"


@pytest.mark.asyncio
async def test_prior_year_upsert_round_trips(fixture):
    session, _ = fixture
    hid, headers = await _seed_household(session)
    async with _client() as client:
        response = await client.put("/api/tax/prior-year/2025", headers=headers, json={
            "filing_status": "single",
            "agi": "168000.00",
            "total_tax": "49310.60",
            "total_withheld": "50000.00",
            "itemized": False,
            "passive_loss_carryforward": "4000.00",
        })
        assert response.status_code == 200
        fetched = await client.get("/api/tax/prior-year/2025", headers=headers)

    assert fetched.json()["total_tax"] == "49310.60"
    result = await session.execute(
        select(PriorYearReturn).where(PriorYearReturn.household_id == hid)
    )
    assert result.scalar_one().year == 2025


@pytest.mark.asyncio
async def test_negative_total_tax_is_rejected(fixture):
    session, _ = fixture
    _, headers = await _seed_household(session)
    async with _client() as client:
        response = await client.put("/api/tax/prior-year/2025", headers=headers, json={
            "total_tax": "-100.00",
        })
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_negative_total_withheld_is_rejected(fixture):
    session, _ = fixture
    _, headers = await _seed_household(session)
    async with _client() as client:
        response = await client.put("/api/tax/prior-year/2025", headers=headers, json={
            "total_withheld": "-50.00",
        })
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_negative_agi_is_accepted_and_round_trips(fixture):
    """Regression guard: AGI can be negative (e.g. a large rental/business
    loss). Do not blanket-apply ge=0 across PriorYearReturnUpdate."""
    session, _ = fixture
    hid, headers = await _seed_household(session)
    async with _client() as client:
        response = await client.put("/api/tax/prior-year/2025", headers=headers, json={
            "agi": "-15000.00",
        })
        assert response.status_code == 200
        fetched = await client.get("/api/tax/prior-year/2025", headers=headers)

    assert fetched.json()["agi"] == "-15000.00"
    result = await session.execute(
        select(PriorYearReturn).where(PriorYearReturn.household_id == hid)
    )
    stored = result.scalar_one()
    assert stored.agi == Decimal("-15000.00")
    assert stored.agi < 0


@pytest.mark.asyncio
async def test_negative_schedule_e_net_is_accepted_and_round_trips(fixture):
    """Regression guard: schedule_e_net is signed by design (a rental loss
    is negative). Do not blanket-apply ge=0 across PriorYearReturnUpdate."""
    session, _ = fixture
    hid, headers = await _seed_household(session)
    async with _client() as client:
        response = await client.put("/api/tax/prior-year/2025", headers=headers, json={
            "schedule_e_net": "-8200.00",
        })
        assert response.status_code == 200
        fetched = await client.get("/api/tax/prior-year/2025", headers=headers)

    assert fetched.json()["schedule_e_net"] == "-8200.00"
    result = await session.execute(
        select(PriorYearReturn).where(PriorYearReturn.household_id == hid)
    )
    stored = result.scalar_one()
    assert stored.schedule_e_net == Decimal("-8200.00")
    assert stored.schedule_e_net < 0


@pytest.mark.asyncio
async def test_a_paystub_can_be_corrected_without_retyping_it(fixture):
    """A typo in one of sixteen figures should not cost the other fifteen.

    Deleting and re-entering was the only way to fix a mistyped YTD figure,
    and re-entering is where the next typo comes from.
    """
    session, _ = fixture
    _, headers = await _seed_household(session)
    async with _client() as client:
        created = await client.post("/api/tax/paystubs", headers=headers, json=_stub_payload())
        stub_id = created.json()["id"]

        response = await client.put(
            f"/api/tax/paystubs/{stub_id}",
            headers=headers,
            json=_stub_payload(gross_ytd="125000.00"),
        )
        assert response.status_code == 200
        assert response.json()["gross_ytd"] == "125000.00"
        assert response.json()["id"] == stub_id

        listed = await client.get("/api/tax/paystubs", headers=headers)
    assert len(listed.json()) == 1, "editing must not leave a second copy"


@pytest.mark.asyncio
async def test_editing_applies_the_same_sanity_checks_as_creating(fixture):
    session, _ = fixture
    _, headers = await _seed_household(session)
    async with _client() as client:
        created = await client.post("/api/tax/paystubs", headers=headers, json=_stub_payload())
        stub_id = created.json()["id"]
        response = await client.put(
            f"/api/tax/paystubs/{stub_id}",
            headers=headers,
            json=_stub_payload(gross="9000.00", gross_ytd="100.00"),
        )
    assert response.status_code == 422
    assert "year-to-date" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_editing_does_not_collide_with_its_own_pay_date(fixture):
    """The duplicate-date check must ignore the row being edited."""
    session, _ = fixture
    _, headers = await _seed_household(session)
    async with _client() as client:
        created = await client.post("/api/tax/paystubs", headers=headers, json=_stub_payload())
        stub_id = created.json()["id"]
        response = await client.put(
            f"/api/tax/paystubs/{stub_id}",
            headers=headers,
            json=_stub_payload(federal_withheld="1300.00"),
        )
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_editing_still_rejects_a_date_another_paystub_owns(fixture):
    session, _ = fixture
    _, headers = await _seed_household(session)
    async with _client() as client:
        await client.post("/api/tax/paystubs", headers=headers, json=_stub_payload())
        second = await client.post("/api/tax/paystubs", headers=headers, json=_stub_payload(
            pay_date="2026-09-30", gross_ytd="130884.62"
        ))
        response = await client.put(
            f"/api/tax/paystubs/{second.json()['id']}",
            headers=headers,
            json=_stub_payload(pay_date="2026-09-15", gross_ytd="130884.62"),
        )
    assert response.status_code == 409


@pytest.mark.asyncio
async def test_cannot_edit_another_households_paystub(fixture):
    session, _ = fixture
    _, headers_a = await _seed_household(session)
    _, headers_b = await _seed_household(session)
    async with _client() as client:
        created = await client.post("/api/tax/paystubs", headers=headers_a, json=_stub_payload())
        response = await client.put(
            f"/api/tax/paystubs/{created.json()['id']}",
            headers=headers_b,
            json=_stub_payload(gross_ytd="125000.00"),
        )
    assert response.status_code == 404
