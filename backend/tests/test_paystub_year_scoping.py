"""A projection must be built from the year it is projecting.

The assembler took the most recent paystub in the household, whatever
year it belonged to, and projected the remainder of the REQUESTED year
forward from its date. Open the app in January, before the first stub of
the new year, and the 2026 estimate was built from a full year of 2025
year-to-date wages plus twenty-six more biweekly periods on top -- about
twice the real income, presented with no caveat.

It happens to everyone, every January.
"""
from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import Household, Paystub, TaxProfile
from app.services.tax_assembly import build_tax_inputs

D = Decimal


@pytest_asyncio.fixture()
async def session():
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False)
    s = Session()
    try:
        yield s
    finally:
        await s.close()
        await engine.dispose()


async def _household(session, *, frequency="biweekly"):
    hid = str(uuid.uuid4())
    session.add(Household(id=hid, name="H", pay_frequency=frequency))
    await session.flush()
    session.add(TaxProfile(
        id=str(uuid.uuid4()), household_id=hid,
        filing_status="single", state="CO",
    ))
    await session.commit()
    return hid


async def _stub(session, hid, *, pay_date, gross="3000.00", gross_ytd="78000.00"):
    session.add(Paystub(
        id=str(uuid.uuid4()), household_id=hid,
        pay_date=date.fromisoformat(pay_date),
        gross=D(gross), gross_ytd=D(gross_ytd),
        federal_withheld=D("400.00"), federal_withheld_ytd=D("10400.00"),
        state_withheld=D("120.00"), state_withheld_ytd=D("3120.00"),
        ss_withheld=D("186.00"), ss_withheld_ytd=D("4836.00"),
        medicare_withheld=D("43.50"), medicare_withheld_ytd=D("1131.00"),
    ))
    await session.commit()


@pytest.mark.asyncio
async def test_last_years_final_stub_does_not_become_this_years_estimate(session):
    """The bug, stated as the number it produced.

    A 31 Dec 2025 stub carries a full year of 2025 wages in its YTD
    columns. Used for 2026 it contributed all of them as 2026 earnings
    AND projected twenty-six more periods on top.
    """
    hid = await _household(session)
    await _stub(session, hid, pay_date="2025-12-31", gross_ytd="78000.00")

    result = await build_tax_inputs(session, hid, 2026)

    assert result.inputs is None, (
        "A 2025 paystub cannot describe 2026. The projection must report "
        "that it has no paystub for the year rather than reusing last "
        f"year's: it produced wages of {result.inputs.total_wages if result.inputs else None}."
    )
    assert "paystub" in result.missing


@pytest.mark.asyncio
async def test_this_years_stub_is_used_normally(session):
    hid = await _household(session)
    await _stub(session, hid, pay_date="2026-06-30", gross_ytd="39000.00")

    result = await build_tax_inputs(session, hid, 2026)

    assert result.inputs is not None
    assert result.inputs.wages_ytd == D("39000.00")
    assert result.remaining_periods > 0


@pytest.mark.asyncio
async def test_the_latest_stub_within_the_year_still_wins(session):
    """Year scoping must not break the ordinary case: the engine anchors
    on the most recent stub because its YTD columns are the furthest
    along."""
    hid = await _household(session)
    await _stub(session, hid, pay_date="2026-03-31", gross_ytd="18000.00")
    await _stub(session, hid, pay_date="2026-09-30", gross_ytd="54000.00")

    result = await build_tax_inputs(session, hid, 2026)

    assert result.inputs.wages_ytd == D("54000.00")


@pytest.mark.asyncio
async def test_a_stub_from_a_later_year_is_not_used_either(session):
    """The same mistake in the other direction. Asking for last year's
    figures must not reach forward into this year's stubs."""
    hid = await _household(session)
    await _stub(session, hid, pay_date="2026-09-30", gross_ytd="54000.00")

    result = await build_tax_inputs(session, hid, 2025)

    assert result.inputs is None
    assert "paystub" in result.missing


@pytest.mark.asyncio
async def test_an_old_stub_does_not_mask_a_current_one(session):
    hid = await _household(session)
    await _stub(session, hid, pay_date="2025-12-31", gross_ytd="78000.00")
    await _stub(session, hid, pay_date="2026-02-13", gross_ytd="6000.00")

    result = await build_tax_inputs(session, hid, 2026)

    assert result.inputs.wages_ytd == D("6000.00")


# ── a year filled from a W-2 ──────────────────────────────────────────
#
# A W-2 is a year-to-date snapshot taken on 31 December, which is exactly
# what a Paystub row holds -- so reading one needs no new storage and no
# new engine path. What it does need is for the figures a W-2 implies to
# reach the engine as the right numbers, and that turns on one derived
# value: gross pay, which a W-2 does not print.


@pytest.mark.asyncio
async def test_a_year_end_entry_projects_nothing_further(session):
    """31 December leaves no periods to project, so the whole estimate
    rests on the year-to-date columns -- which is what makes a W-2, with
    no per-check figure anywhere on it, usable at all."""
    hid = await _household(session)
    await _stub(session, hid, pay_date="2026-12-31", gross="0.00", gross_ytd="96000.00")

    result = await build_tax_inputs(session, hid, 2026)

    assert result.remaining_periods == 0
    assert result.inputs.projected_remaining_wages == D("0.00")
    assert result.inputs.total_wages == D("96000.00")
    # And it is NOT reported as an unprojected partial year: the year is
    # complete, so there is nothing missing to warn about.
    assert "pay_frequency" not in result.missing


@pytest.mark.asyncio
async def test_the_w2_derived_gross_reaches_the_engine_as_the_printed_boxes(session):
    """The justification for deriving gross at all.

    A W-2 prints box 1 (85,000) and box 5 (93,000) but not gross pay. The
    reader derives 96,000 from box 5 plus the HSA -- which is lower than
    true gross, because health premiums appear nowhere on the form. That
    understatement must not reach the tax figures, and it does not: the
    engine subtracts the deferrals back off and lands exactly on the two
    boxes the form actually prints.
    """
    hid = await _household(session)
    session.add(Paystub(
        id=str(uuid.uuid4()), household_id=hid,
        pay_date=date(2026, 12, 31),
        gross=D("0.00"), gross_ytd=D("96000.00"),
        pretax_401k=D("0.00"), pretax_401k_ytd=D("8000.00"),
        pretax_hsa=D("0.00"), pretax_hsa_ytd=D("3000.00"),
        federal_withheld=D("0.00"), federal_withheld_ytd=D("12000.00"),
        state_withheld=D("0.00"), state_withheld_ytd=D("4092.00"),
        ss_withheld=D("0.00"), ss_withheld_ytd=D("5766.00"),
        medicare_withheld=D("0.00"), medicare_withheld_ytd=D("1348.50"),
    ))
    await session.commit()

    inputs = (await build_tax_inputs(session, hid, 2026)).inputs

    # What the engine works FICA from: gross - HSA - other.
    fica_wages = inputs.total_wages - inputs.pretax_hsa - inputs.pretax_other
    assert fica_wages == D("93000.00"), "should land on W-2 box 5"

    # And income tax from: that, less the 401(k).
    assert fica_wages - inputs.pretax_401k == D("85000.00"), "should land on box 1"


# ── the same missing year filter, in the guard that accepts them ──────


import jwt
from datetime import datetime, timedelta, timezone
from httpx import ASGITransport, AsyncClient

from app.api.deps import ALGORITHM
from app.config import get_settings
from app.database import get_db
from app.main import app
from app.middleware.rate_limit_store import InMemoryStore
from app.models import User


@pytest_asyncio.fixture()
async def api(session):
    hid = await _household(session)
    uid = str(uuid.uuid4())
    session.add(User(
        id=uid, email=f"{uid}@t.io", name="T", password_hash=None,
        household_id=hid, role="owner", status="approved",
    ))
    await session.commit()

    async def _override_get_db():
        yield session

    app.dependency_overrides[get_db] = _override_get_db
    prior_store = getattr(app.state, "rate_limit_store", None)
    app.state.rate_limit_store = InMemoryStore()
    expire = datetime.now(timezone.utc) + timedelta(minutes=30)
    token = jwt.encode(
        {"sub": uid, "exp": expire}, get_settings().secret_key, algorithm=ALGORITHM
    )
    try:
        yield {"Authorization": f"Bearer {token}"}, hid, session
    finally:
        app.dependency_overrides.pop(get_db, None)
        if prior_store is not None:
            app.state.rate_limit_store = prior_store


def _payload(pay_date: str, gross: str, gross_ytd: str) -> dict:
    return {
        "pay_date": pay_date,
        "gross": gross,
        "gross_ytd": gross_ytd,
        "federal_withheld_ytd": "100.00",
    }


@pytest.mark.asyncio
async def test_the_first_paystub_of_a_new_year_is_accepted(api):
    """Year-to-date totals reset on 1 January.

    The guard that stops them going backwards compared against the most
    recent stub of ANY year, so every January the first stub of the new
    year -- a small year-to-date figure -- was refused for being lower
    than last December's. The one entry everybody makes, every year.
    """
    headers, hid, session = api
    await _stub(session, hid, pay_date="2025-12-31", gross_ytd="124000.00")

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/api/tax/paystubs",
            headers=headers,
            json=_payload("2026-01-15", "3000.00", "3000.00"),
        )
    assert resp.status_code == 201, resp.text


@pytest.mark.asyncio
async def test_going_backwards_within_a_year_is_still_refused(api):
    """The guard's actual job: a typo or the wrong year-to-date column."""
    headers, hid, session = api
    await _stub(session, hid, pay_date="2026-06-30", gross_ytd="39000.00")

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/api/tax/paystubs",
            headers=headers,
            json=_payload("2026-07-15", "3000.00", "9000.00"),
        )
    assert resp.status_code == 422
    assert "only go up" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_a_rejected_year_end_entry_says_why_a_w2_disagrees(api):
    """Otherwise it is a dead end: the gross a W-2 implies cannot be
    corrected from the form, because the figure it is missing -- pre-tax
    health cover -- is not printed anywhere on one."""
    headers, hid, session = api
    await _stub(session, hid, pay_date="2026-11-30", gross_ytd="100000.00")

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/api/tax/paystubs",
            headers=headers,
            json=_payload("2026-12-31", "0.00", "96000.00"),
        )
    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert "came from a W-2" in detail
    assert "health cover" in detail


@pytest.mark.asyncio
async def test_an_ordinary_rejection_does_not_mention_w2s(api):
    """The hint is for the case it explains, not a paragraph on every
    typo."""
    headers, hid, session = api
    await _stub(session, hid, pay_date="2026-06-30", gross_ytd="39000.00")

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/api/tax/paystubs",
            headers=headers,
            json=_payload("2026-07-15", "3000.00", "9000.00"),
        )
    assert "W-2" not in resp.json()["detail"]
