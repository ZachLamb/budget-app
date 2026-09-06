"""Tests for the deductions summary aggregation service and route."""
from __future__ import annotations

import uuid
from datetime import date as _date
from decimal import Decimal

import pytest

from tests.test_categories_routes import fixture, _seed_household, _client
from app.models import Account, Category, CategoryGroup, TaxSettings, Transaction
from app.services.deductions import compute_deductions_summary


async def _seed_deductible_category(session, hid: str, *, name: str, tax_line: str, pct: Decimal = Decimal("100.00")):
    group = CategoryGroup(id=str(uuid.uuid4()), household_id=hid, name="Rental")
    session.add(group)
    await session.flush()
    category = Category(
        id=str(uuid.uuid4()), group_id=group.id, name=name,
        deductible=True, deduction_pct=pct, tax_line=tax_line,
    )
    session.add(category)
    await session.flush()
    return category


async def _seed_txn(session, hid: str, category_id: str, amount: Decimal, txn_date: str, override=None):
    account = Account(id=str(uuid.uuid4()), household_id=hid, name="Checking", account_type="checking")
    session.add(account)
    await session.flush()
    txn = Transaction(
        id=str(uuid.uuid4()), account_id=account.id, date=_date.fromisoformat(txn_date), amount=amount,
        category_id=category_id, deduction_pct_override=override,
    )
    session.add(txn)
    await session.flush()
    return txn


@pytest.mark.asyncio
async def test_summary_groups_by_tax_line_and_applies_pct(fixture):
    session, _ = fixture
    hid, _ = await _seed_household(session)
    cat = await _seed_deductible_category(session, hid, name="Cleaning", tax_line="Schedule E — Cleaning", pct=Decimal("50.00"))
    await _seed_txn(session, hid, cat.id, Decimal("100.00"), "2026-03-01")
    await session.commit()

    summary = await compute_deductions_summary(session, hid, 2026)
    assert summary.total == Decimal("50.00")
    assert [line.model_dump() for line in summary.lines] == [{"tax_line": "Schedule E — Cleaning", "amount": Decimal("50.00")}]
    assert summary.estimated_tax_savings is None
    assert summary.suggested_withholding_reduction_per_period is None


@pytest.mark.asyncio
async def test_summary_override_beats_category_pct(fixture):
    session, _ = fixture
    hid, _ = await _seed_household(session)
    cat = await _seed_deductible_category(session, hid, name="Streaming", tax_line="Home office", pct=Decimal("100.00"))
    await _seed_txn(session, hid, cat.id, Decimal("20.00"), "2026-03-01", override=Decimal("20.00"))
    await session.commit()

    summary = await compute_deductions_summary(session, hid, 2026)
    assert summary.total == Decimal("4.00")  # 20% of 20.00


@pytest.mark.asyncio
async def test_summary_falls_back_to_category_name_when_tax_line_unset(fixture):
    session, _ = fixture
    hid, _ = await _seed_household(session)
    cat = await _seed_deductible_category(session, hid, name="Medical", tax_line=None)
    await _seed_txn(session, hid, cat.id, Decimal("10.00"), "2026-03-01")
    await session.commit()

    summary = await compute_deductions_summary(session, hid, 2026)
    assert [line.model_dump() for line in summary.lines] == [{"tax_line": "Medical", "amount": Decimal("10.00")}]


@pytest.mark.asyncio
async def test_summary_excludes_other_years(fixture):
    session, _ = fixture
    hid, _ = await _seed_household(session)
    cat = await _seed_deductible_category(session, hid, name="Cleaning", tax_line="Schedule E")
    await _seed_txn(session, hid, cat.id, Decimal("100.00"), "2025-12-31")
    await session.commit()

    summary = await compute_deductions_summary(session, hid, 2026)
    assert summary.total == Decimal("0.00")
    assert summary.lines == []


@pytest.mark.asyncio
async def test_savings_present_only_when_both_rates_set(fixture):
    session, _ = fixture
    hid, _ = await _seed_household(session)
    cat = await _seed_deductible_category(session, hid, name="Cleaning", tax_line="Schedule E")
    await _seed_txn(session, hid, cat.id, Decimal("1000.00"), "2026-03-01")
    session.add(TaxSettings(id=str(uuid.uuid4()), household_id=hid, marginal_federal_rate=Decimal("22.00")))
    await session.commit()

    # Only federal rate set — state rate missing — savings still omitted.
    summary = await compute_deductions_summary(session, hid, 2026)
    assert summary.estimated_tax_savings is None


@pytest.mark.asyncio
async def test_savings_and_nudge_present_when_fully_configured(fixture):
    session, _ = fixture
    hid, _ = await _seed_household(session)
    cat = await _seed_deductible_category(session, hid, name="Cleaning", tax_line="Schedule E")
    await _seed_txn(session, hid, cat.id, Decimal("1000.00"), "2026-03-01")
    session.add(TaxSettings(
        id=str(uuid.uuid4()), household_id=hid,
        marginal_federal_rate=Decimal("22.00"), marginal_state_rate=Decimal("4.40"),
        current_federal_withholding_per_period=Decimal("1191.80"),
        remaining_pay_periods_this_year=8,
    ))
    await session.commit()

    summary = await compute_deductions_summary(session, hid, 2026)
    assert summary.estimated_tax_savings == Decimal("264.00")  # 1000 * 26.4%
    assert summary.suggested_withholding_reduction_per_period == Decimal("33.00")  # 264 / 8


@pytest.mark.asyncio
async def test_nudge_omitted_when_zero_remaining_periods(fixture):
    session, _ = fixture
    hid, _ = await _seed_household(session)
    cat = await _seed_deductible_category(session, hid, name="Cleaning", tax_line="Schedule E")
    await _seed_txn(session, hid, cat.id, Decimal("1000.00"), "2026-03-01")
    session.add(TaxSettings(
        id=str(uuid.uuid4()), household_id=hid,
        marginal_federal_rate=Decimal("22.00"), marginal_state_rate=Decimal("4.40"),
        current_federal_withholding_per_period=Decimal("1191.80"),
        remaining_pay_periods_this_year=0,
    ))
    await session.commit()

    summary = await compute_deductions_summary(session, hid, 2026)
    assert summary.estimated_tax_savings == Decimal("264.00")
    assert summary.suggested_withholding_reduction_per_period is None


@pytest.mark.asyncio
async def test_summary_route_returns_200(fixture):
    session, _ = fixture
    hid, headers = await _seed_household(session)
    cat = await _seed_deductible_category(session, hid, name="Cleaning", tax_line="Schedule E")
    await _seed_txn(session, hid, cat.id, Decimal("100.00"), "2026-03-01")
    await session.commit()

    async with _client() as client:
        resp = await client.get("/api/deductions/summary?year=2026", headers=headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["year"] == 2026
        assert float(body["total"]) == 100.0
        assert "estimated_tax_savings" not in body or body["estimated_tax_savings"] is None
