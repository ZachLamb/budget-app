"""Route tests for /api/tax-settings: get/put, household scoping, partial updates."""
from __future__ import annotations

import pytest
from sqlalchemy import select

from tests.test_categories_routes import fixture, _seed_household, _client
from app.models import TaxSettings


@pytest.mark.asyncio
async def test_get_tax_settings_defaults_to_empty(fixture):
    session, _ = fixture
    _, headers = await _seed_household(session)
    async with _client() as client:
        resp = await client.get("/api/tax-settings", headers=headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["marginal_federal_rate"] is None
        assert body["marginal_state_rate"] is None
        assert body["current_federal_withholding_per_period"] is None
        assert body["remaining_pay_periods_this_year"] is None


@pytest.mark.asyncio
async def test_get_tax_settings_does_not_insert_a_row(fixture):
    """GET must be side-effect-free: no row should exist after a GET on a
    household that has never called PUT."""
    session, _ = fixture
    hid, headers = await _seed_household(session)
    async with _client() as client:
        resp = await client.get("/api/tax-settings", headers=headers)
        assert resp.status_code == 200

    result = await session.execute(select(TaxSettings).where(TaxSettings.household_id == hid))
    assert result.scalar_one_or_none() is None


@pytest.mark.asyncio
async def test_put_tax_settings_upserts_and_partial_updates(fixture):
    session, _ = fixture
    _, headers = await _seed_household(session)
    async with _client() as client:
        first = await client.put(
            "/api/tax-settings",
            headers=headers,
            json={"marginal_federal_rate": 22, "marginal_state_rate": 4.4},
        )
        assert first.status_code == 200
        assert float(first.json()["marginal_federal_rate"]) == 22.0

        second = await client.put(
            "/api/tax-settings",
            headers=headers,
            json={"current_federal_withholding_per_period": 1191.80, "remaining_pay_periods_this_year": 8},
        )
        assert second.status_code == 200
        body = second.json()
        # Fields sent earlier must persist; PUT is a merge, not a replace.
        assert float(body["marginal_federal_rate"]) == 22.0
        assert float(body["current_federal_withholding_per_period"]) == 1191.80
        assert body["remaining_pay_periods_this_year"] == 8


@pytest.mark.asyncio
async def test_tax_settings_scoped_per_household(fixture):
    session, _ = fixture
    _, headers_a = await _seed_household(session)
    _, headers_b = await _seed_household(session)
    async with _client() as client:
        await client.put("/api/tax-settings", headers=headers_a, json={"marginal_federal_rate": 22})
        resp_b = await client.get("/api/tax-settings", headers=headers_b)
        assert resp_b.json()["marginal_federal_rate"] is None
