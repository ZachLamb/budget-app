"""Tests for the deductions summary aggregation service and route."""
from __future__ import annotations

import uuid
from datetime import date as _date
from decimal import Decimal

import pytest

from tests.test_categories_routes import fixture, _seed_household, _client
from app.models import Account, Category, CategoryGroup, Household, Paystub, TaxProfile, Transaction
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


async def _seed_tax_ready(session, hid: str, *, gross_ytd="179000.00"):
    """A household the engine can actually project: filing status plus a
    December paystub, so YTD is the whole year and no projection is needed."""
    household = await session.get(Household, hid)
    household.pay_frequency = "monthly"
    session.add(TaxProfile(id=str(uuid.uuid4()), household_id=hid, filing_status="single"))
    session.add(Paystub(
        id=str(uuid.uuid4()), household_id=hid, pay_date=_date(2026, 12, 31),
        gross=Decimal("0.00"), gross_ytd=Decimal(gross_ytd),
    ))
    await session.flush()


@pytest.mark.asyncio
async def test_summary_groups_by_tax_line_and_applies_pct(fixture):
    session, _ = fixture
    hid, _ = await _seed_household(session)
    cat = await _seed_deductible_category(session, hid, name="Cleaning", tax_line="Schedule E — Cleaning", pct=Decimal("50.00"))
    await _seed_txn(session, hid, cat.id, Decimal("-100.00"), "2026-03-01")
    await session.commit()

    summary = await compute_deductions_summary(session, hid, 2026)
    assert summary.total == Decimal("50.00")
    assert [line.model_dump() for line in summary.lines] == [
        {"tax_line": "Schedule E — Cleaning", "amount": Decimal("50.00"), "deduction_kind": "personal_itemized"}
    ]
    assert summary.estimated_tax_savings is None
    assert summary.suggested_withholding_reduction_per_period is None


@pytest.mark.asyncio
async def test_summary_override_beats_category_pct(fixture):
    session, _ = fixture
    hid, _ = await _seed_household(session)
    cat = await _seed_deductible_category(session, hid, name="Streaming", tax_line="Home office", pct=Decimal("100.00"))
    await _seed_txn(session, hid, cat.id, Decimal("-20.00"), "2026-03-01", override=Decimal("20.00"))
    await session.commit()

    summary = await compute_deductions_summary(session, hid, 2026)
    assert summary.total == Decimal("4.00")  # 20% of 20.00


@pytest.mark.asyncio
async def test_summary_falls_back_to_category_name_when_tax_line_unset(fixture):
    session, _ = fixture
    hid, _ = await _seed_household(session)
    cat = await _seed_deductible_category(session, hid, name="Medical", tax_line=None)
    await _seed_txn(session, hid, cat.id, Decimal("-10.00"), "2026-03-01")
    await session.commit()

    summary = await compute_deductions_summary(session, hid, 2026)
    assert [line.model_dump() for line in summary.lines] == [
        {"tax_line": "Medical", "amount": Decimal("10.00"), "deduction_kind": "personal_itemized"}
    ]


@pytest.mark.asyncio
async def test_summary_excludes_other_years(fixture):
    session, _ = fixture
    hid, _ = await _seed_household(session)
    cat = await _seed_deductible_category(session, hid, name="Cleaning", tax_line="Schedule E")
    await _seed_txn(session, hid, cat.id, Decimal("-100.00"), "2025-12-31")
    await session.commit()

    summary = await compute_deductions_summary(session, hid, 2026)
    assert summary.total == Decimal("0.00")
    assert summary.lines == []


@pytest.mark.asyncio
async def test_savings_is_none_without_a_projection(fixture):
    """No profile or paystub -> genuinely unknown, not a fabricated zero."""
    session, _ = fixture
    hid, _ = await _seed_household(session)
    cat = await _seed_deductible_category(
        session, hid, name="Cleaning", tax_line="Schedule E - Cleaning"
    )
    await _seed_txn(session, hid, cat.id, Decimal("-500.00"), "2026-03-01")

    summary = await compute_deductions_summary(session, hid, 2026)
    assert summary.total == Decimal("500.00")
    assert summary.estimated_tax_savings is None
    assert summary.suggested_withholding_reduction_per_period is None


@pytest.mark.asyncio
async def test_personal_itemized_below_standard_deduction_is_worth_zero(fixture):
    """THE correctness fix. The old flat-rate code reported ~$1,320 here."""
    session, _ = fixture
    hid, _ = await _seed_household(session)
    await _seed_tax_ready(session, hid)
    cat = await _seed_deductible_category(
        session, hid, name="Medical", tax_line="Schedule A - Medical"
    )
    cat.deduction_kind = "personal_itemized"
    await _seed_txn(session, hid, cat.id, Decimal("-5000.00"), "2026-03-01")
    await session.flush()

    summary = await compute_deductions_summary(session, hid, 2026)
    assert summary.personal_itemized_total == Decimal("5000.00")
    assert summary.personal_itemized_value == Decimal("0.00")
    assert summary.estimated_tax_savings == Decimal("0.00")
    assert summary.standard_deduction == Decimal("16100.00")


@pytest.mark.asyncio
async def test_business_expense_is_worth_money_from_the_first_dollar(fixture):
    """Same dollars as the test above, valued through Schedule E.

    Income here is deliberately kept under the $100,000 passive-loss
    phase-out (IRS Pub 925): ExtraBusinessExpense models this as a rental
    loss with no offsetting rental income, and at the $179,000 wage level
    used by _seed_tax_ready's default (well past the $150,000 phase-out
    end), the correct answer is that the entire loss is SUSPENDED and
    this year's benefit is genuinely $0 -- a case the engine gets right
    and this test must not contradict."""
    session, _ = fixture
    hid, _ = await _seed_household(session)
    await _seed_tax_ready(session, hid, gross_ytd="80000.00")
    cat = await _seed_deductible_category(
        session, hid, name="Cleaning", tax_line="Schedule E - Cleaning"
    )
    cat.deduction_kind = "business_expense"
    await _seed_txn(session, hid, cat.id, Decimal("-5000.00"), "2026-03-01")
    await session.flush()

    summary = await compute_deductions_summary(session, hid, 2026)
    assert summary.business_total == Decimal("5000.00")
    assert summary.estimated_tax_savings > Decimal("0")


@pytest.mark.asyncio
async def test_the_two_kinds_are_reported_separately(fixture):
    session, _ = fixture
    hid, _ = await _seed_household(session)
    await _seed_tax_ready(session, hid)
    business = await _seed_deductible_category(
        session, hid, name="Cleaning", tax_line="Schedule E - Cleaning"
    )
    business.deduction_kind = "business_expense"
    personal = await _seed_deductible_category(
        session, hid, name="Medical", tax_line="Schedule A - Medical"
    )
    personal.deduction_kind = "personal_itemized"
    await _seed_txn(session, hid, business.id, Decimal("-3000.00"), "2026-03-01")
    await _seed_txn(session, hid, personal.id, Decimal("-2000.00"), "2026-04-01")
    await session.flush()

    summary = await compute_deductions_summary(session, hid, 2026)
    assert summary.business_total == Decimal("3000.00")
    assert summary.personal_itemized_total == Decimal("2000.00")
    assert summary.total == Decimal("5000.00")


@pytest.mark.asyncio
async def test_response_keeps_its_existing_shape(fixture):
    """The current page reads these fields; they must not disappear."""
    session, _ = fixture
    hid, _ = await _seed_household(session)
    summary = await compute_deductions_summary(session, hid, 2026)
    for field in ("year", "lines", "total", "estimated_tax_savings",
                  "suggested_withholding_reduction_per_period"):
        assert hasattr(summary, field)


@pytest.mark.asyncio
async def test_summary_nets_out_refunds_in_a_deductible_category(fixture):
    """Spec: negative transaction amounts (refunds/credits) net out normally,
    no special-casing. An expense (-185) and a partial refund (+50, e.g. a
    returned item) in the same deductible category should net to a $135
    deduction, not $185 with the refund ignored."""
    session, _ = fixture
    hid, _ = await _seed_household(session)
    cat = await _seed_deductible_category(session, hid, name="Cleaning", tax_line="Schedule E")
    await _seed_txn(session, hid, cat.id, Decimal("-185.00"), "2026-03-01")
    await _seed_txn(session, hid, cat.id, Decimal("50.00"), "2026-03-05")
    await session.commit()

    summary = await compute_deductions_summary(session, hid, 2026)
    assert summary.total == Decimal("135.00")


@pytest.mark.asyncio
async def test_summary_route_returns_200(fixture):
    session, _ = fixture
    hid, headers = await _seed_household(session)
    cat = await _seed_deductible_category(session, hid, name="Cleaning", tax_line="Schedule E")
    await _seed_txn(session, hid, cat.id, Decimal("-100.00"), "2026-03-01")
    await session.commit()

    async with _client() as client:
        resp = await client.get("/api/deductions/summary?year=2026", headers=headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["year"] == 2026
        assert float(body["total"]) == 100.0
        assert "estimated_tax_savings" not in body or body["estimated_tax_savings"] is None


@pytest.mark.asyncio
async def test_summary_scoped_per_household(fixture):
    """A deductible transaction in household A must not appear in household
    B's summary — scoping must hold through both CategoryGroup and Account."""
    session, _ = fixture
    hid_a, headers_a = await _seed_household(session)
    hid_b, headers_b = await _seed_household(session)
    cat = await _seed_deductible_category(session, hid_a, name="Cleaning", tax_line="Schedule E")
    await _seed_txn(session, hid_a, cat.id, Decimal("-500.00"), "2026-03-01")
    await session.commit()

    async with _client() as client:
        resp_a = await client.get("/api/deductions/summary?year=2026", headers=headers_a)
        resp_b = await client.get("/api/deductions/summary?year=2026", headers=headers_b)

    assert float(resp_a.json()["total"]) == 500.0
    body_b = resp_b.json()
    assert float(body_b["total"]) == 0.0
    assert body_b["lines"] == []


@pytest.mark.asyncio
async def test_summary_route_rejects_out_of_range_year(fixture):
    session, _ = fixture
    _, headers = await _seed_household(session)
    async with _client() as client:
        too_low = await client.get("/api/deductions/summary?year=1999", headers=headers)
        assert too_low.status_code == 422
        too_high = await client.get("/api/deductions/summary?year=2101", headers=headers)
        assert too_high.status_code == 422
