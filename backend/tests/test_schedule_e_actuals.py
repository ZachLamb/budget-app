"""Schedule E built from the household's own transactions.

The engine has handled rental income, expenses and the passive activity
loss limitation since it was written, and none of it ran: the assembler
passed `schedule_e=None` because nothing in the data said which income
was rent.
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
from app.models import Account, Category, CategoryGroup, Household, Transaction
from app.services.tax.schedule_e_actuals import build_schedule_e

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


class Fixture:
    def __init__(self, session, hid, account_id):
        self.session = session
        self.hid = hid
        self.account_id = account_id

    async def category(self, name, *, income=False, rental_income=False,
                       business=False, pct="100"):
        group = CategoryGroup(
            id=str(uuid.uuid4()), household_id=self.hid, name=name,
            is_income=income, sort_order=0,
        )
        self.session.add(group)
        await self.session.flush()
        cat = Category(
            id=str(uuid.uuid4()), group_id=group.id, name=name, sort_order=0,
            rental_income=rental_income,
            deductible=business,
            deduction_kind="business_expense" if business else "personal_itemized",
            deduction_pct=D(pct),
        )
        self.session.add(cat)
        await self.session.flush()
        return cat

    async def txn(self, category_id, amount, day="2026-06-15", **kw):
        t = Transaction(
            id=str(uuid.uuid4()), account_id=self.account_id,
            date=date.fromisoformat(day), amount=D(amount),
            category_id=category_id, **kw,
        )
        self.session.add(t)
        await self.session.flush()
        return t


@pytest_asyncio.fixture()
async def fx(session):
    hid = str(uuid.uuid4())
    session.add(Household(id=hid, name="H"))
    await session.flush()
    acct = Account(
        id=str(uuid.uuid4()), household_id=hid, name="Chk", account_type="checking"
    )
    session.add(acct)
    await session.flush()
    return Fixture(session, hid, acct.id)


async def build(fx, year=2026, **kw):
    return await build_schedule_e(fx.session, fx.hid, year, **{
        "active_participation": True, **kw,
    })


class TestWhenThereIsNoRental:
    @pytest.mark.asyncio
    async def test_a_household_with_no_rental_categories_gets_nothing(self, fx):
        # None, not a net of zero: "no rental" and "a rental that netted
        # nothing" are different facts and the engine must tell them apart.
        await fx.category("Groceries")
        assert await build(fx) is None

    @pytest.mark.asyncio
    async def test_marked_categories_with_no_activity_still_report(self, fx):
        """Zero is the right answer once there IS a rental to report on."""
        await fx.category("Rent received", income=True, rental_income=True)
        actuals = await build(fx)
        assert actuals is not None
        assert actuals.result.net == D("0.00")
        # ...and `through` stays None, because nothing was recorded.
        assert actuals.through is None


class TestTheArithmetic:
    @pytest.mark.asyncio
    async def test_income_and_expenses_net_off(self, fx):
        rent = await fx.category("Rent", income=True, rental_income=True)
        clean = await fx.category("Cleaning", business=True)
        await fx.txn(rent.id, "12400.00", "2026-08-01")
        await fx.txn(clean.id, "-4100.00", "2026-08-15")

        a = await build(fx)
        assert a.gross_rental_income == D("12400.00")
        assert a.allowable_expenses == D("4100.00")
        assert a.result.net == D("8300.00")

    @pytest.mark.asyncio
    async def test_a_partial_deduction_percentage_is_honoured(self, fx):
        # A category used half for the rental and half personally.
        util = await fx.category("Utilities", business=True, pct="50")
        await fx.txn(util.id, "-1000.00")
        a = await build(fx)
        assert a.allowable_expenses == D("500.00")

    @pytest.mark.asyncio
    async def test_a_per_transaction_override_beats_the_category(self, fx):
        util = await fx.category("Utilities", business=True, pct="50")
        await fx.txn(util.id, "-1000.00", deduction_pct_override=D("100"))
        a = await build(fx)
        assert a.allowable_expenses == D("1000.00")

    @pytest.mark.asyncio
    async def test_a_refund_to_a_guest_nets_off_rather_than_adding(self, fx):
        # Summed, not abs()'d -- a negative row in an income category is
        # money going back out.
        rent = await fx.category("Rent", income=True, rental_income=True)
        await fx.txn(rent.id, "5000.00", "2026-06-01")
        await fx.txn(rent.id, "-800.00", "2026-06-20")
        a = await build(fx)
        assert a.gross_rental_income == D("4200.00")

    @pytest.mark.asyncio
    async def test_a_loss_comes_through_signed(self, fx):
        clean = await fx.category("Cleaning", business=True)
        await fx.txn(clean.id, "-5000.00")
        a = await build(fx)
        assert a.result.net == D("-5000.00")
        assert a.result.is_loss

    @pytest.mark.asyncio
    async def test_the_carry_in_is_passed_through(self, fx):
        await fx.category("Rent", income=True, rental_income=True)
        a = await build(fx, suspended_loss_carryin=D("3200.00"))
        assert a.result.suspended_loss_carryin == D("3200.00")


class TestWhatIsCounted:
    @pytest.mark.asyncio
    async def test_only_this_year(self, fx):
        rent = await fx.category("Rent", income=True, rental_income=True)
        await fx.txn(rent.id, "1000.00", "2026-06-01")
        await fx.txn(rent.id, "9999.00", "2025-06-01")
        a = await build(fx, year=2026)
        assert a.gross_rental_income == D("1000.00")

    @pytest.mark.asyncio
    async def test_a_split_parent_is_not_double_counted(self, fx):
        # Its children carry the real amounts; counting both doubles it.
        rent = await fx.category("Rent", income=True, rental_income=True)
        parent = await fx.txn(rent.id, "1000.00")
        await fx.txn(rent.id, "1000.00", parent_transaction_id=parent.id)
        a = await build(fx)
        assert a.gross_rental_income == D("1000.00")

    @pytest.mark.asyncio
    async def test_another_households_rental_is_not_counted(self, fx):
        rent = await fx.category("Rent", income=True, rental_income=True)
        await fx.txn(rent.id, "1000.00")

        other = Household(id=str(uuid.uuid4()), name="Theirs")
        fx.session.add(other)
        await fx.session.flush()
        their_acct = Account(
            id=str(uuid.uuid4()), household_id=other.id, name="T",
            account_type="checking",
        )
        fx.session.add(their_acct)
        await fx.session.flush()
        fx.session.add(Transaction(
            id=str(uuid.uuid4()), account_id=their_acct.id,
            date=date(2026, 6, 1), amount=D("50000.00"), category_id=rent.id,
        ))
        await fx.session.flush()

        a = await build(fx)
        assert a.gross_rental_income == D("1000.00")

    @pytest.mark.asyncio
    async def test_a_personal_deduction_is_not_a_rental_expense(self, fx):
        """Schedule A and Schedule E are worth very different amounts and
        must not be summed together."""
        rent = await fx.category("Rent", income=True, rental_income=True)
        await fx.txn(rent.id, "1000.00")
        charity = await fx.category("Charity")
        charity.deductible = True  # deductible, but personal_itemized
        await fx.session.flush()
        await fx.txn(charity.id, "-500.00")
        a = await build(fx)
        assert a.allowable_expenses == D("0.00")


class TestNotAnnualised:
    @pytest.mark.asyncio
    async def test_the_figure_is_what_was_recorded_not_a_full_year(self, fx):
        # A summer cabin earns most of its year in ten weeks. Scaling
        # three months to twelve invents a number and states it
        # confidently.
        rent = await fx.category("Rent", income=True, rental_income=True)
        for month in (6, 7, 8):
            await fx.txn(rent.id, "4000.00", f"2026-{month:02d}-01")
        a = await build(fx)
        assert a.gross_rental_income == D("12000.00")

    @pytest.mark.asyncio
    async def test_through_names_the_last_day_counted(self, fx):
        """What lets the page say how far these figures reach."""
        rent = await fx.category("Rent", income=True, rental_income=True)
        clean = await fx.category("Cleaning", business=True)
        await fx.txn(rent.id, "4000.00", "2026-07-04")
        await fx.txn(clean.id, "-200.00", "2026-09-12")
        await fx.txn(rent.id, "4000.00", "2026-08-01")
        a = await build(fx)
        assert a.through == date(2026, 9, 12)


# ── the marker has to survive the API, not just the database ──────────
#
# The model, the migration and the aggregation were all correct while the
# response schema simply did not carry `rental_income`. Every backend test
# passed; the toggle read back as off every time the page loaded. Nothing
# below touches the service -- it pins the field to the wire.

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
    hid, uid = str(uuid.uuid4()), str(uuid.uuid4())
    session.add(Household(id=hid, name="H"))
    await session.flush()
    session.add(User(
        id=uid, email=f"{uid}@t.io", name="T", password_hash=None,
        household_id=hid, role="owner", status="approved",
    ))
    group = CategoryGroup(
        id=str(uuid.uuid4()), household_id=hid, name="Income",
        is_income=True, sort_order=0,
    )
    session.add(group)
    await session.flush()
    cat = Category(
        id=str(uuid.uuid4()), group_id=group.id, name="Rent received", sort_order=0
    )
    session.add(cat)
    await session.commit()

    async def _override_get_db():
        yield session

    app.dependency_overrides[get_db] = _override_get_db
    prior = getattr(app.state, "rate_limit_store", None)
    app.state.rate_limit_store = InMemoryStore()
    expire = datetime.now(timezone.utc) + timedelta(minutes=30)
    token = jwt.encode(
        {"sub": uid, "exp": expire}, get_settings().secret_key, algorithm=ALGORITHM
    )
    try:
        yield {"Authorization": f"Bearer {token}"}, cat.id, session
    finally:
        app.dependency_overrides.pop(get_db, None)
        if prior is not None:
            app.state.rate_limit_store = prior


@pytest.mark.asyncio
async def test_the_rental_marker_round_trips_through_the_api(api):
    headers, cat_id, session = api
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        saved = await client.put(
            f"/api/categories/{cat_id}", headers=headers,
            json={"rental_income": True},
        )
        assert saved.status_code == 200, saved.text
        # Read back from the write itself...
        assert saved.json()["rental_income"] is True

        # ...and from the listing the page actually renders from.
        groups = await client.get("/api/categories/groups", headers=headers)
    cats = [c for g in groups.json() for c in g["categories"]]
    assert cats[0]["rental_income"] is True


@pytest.mark.asyncio
async def test_leaving_the_marker_out_of_an_update_does_not_clear_it(api):
    """The column is NOT NULL, and a partial update that renamed a
    category must not silently un-mark it."""
    headers, cat_id, session = api
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        await client.put(
            f"/api/categories/{cat_id}", headers=headers, json={"rental_income": True}
        )
        renamed = await client.put(
            f"/api/categories/{cat_id}", headers=headers, json={"name": "Rent"}
        )
    assert renamed.json()["rental_income"] is True


@pytest.mark.asyncio
async def test_a_new_category_is_not_rental_income_by_default(api):
    headers, _, _ = api
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        groups = await client.get("/api/categories/groups", headers=headers)
        gid = groups.json()[0]["id"]
        created = await client.post(
            "/api/categories", headers=headers,
            json={"group_id": gid, "name": "Interest"},
        )
    assert created.status_code in (200, 201), created.text
    assert created.json()["rental_income"] is False


# ── and it has to survive the projection route ────────────────────────
#
# The service was tested, the marker was tested on the wire, and the
# projection route still raised NameError the first time it met a
# household with a rental -- because no test had ever asked it for one.
# These call the endpoint the page calls.


async def _rental_household(session):
    hid, uid = str(uuid.uuid4()), str(uuid.uuid4())
    session.add(Household(id=hid, name="H"))
    await session.flush()
    session.add(User(
        id=uid, email=f"{uid}@t.io", name="T", password_hash=None,
        household_id=hid, role="owner", status="approved",
    ))
    acct = Account(
        id=str(uuid.uuid4()), household_id=hid, name="Chk", account_type="checking"
    )
    inc = CategoryGroup(
        id=str(uuid.uuid4()), household_id=hid, name="Income",
        is_income=True, sort_order=0,
    )
    exp = CategoryGroup(
        id=str(uuid.uuid4()), household_id=hid, name="Rental", sort_order=1
    )
    session.add_all([acct, inc, exp])
    await session.flush()
    rent = Category(
        id=str(uuid.uuid4()), group_id=inc.id, name="Rent received",
        sort_order=0, rental_income=True,
    )
    clean = Category(
        id=str(uuid.uuid4()), group_id=exp.id, name="Cleaning", sort_order=0,
        deductible=True, deduction_kind="business_expense",
        deduction_pct=Decimal("100"),
    )
    session.add_all([rent, clean])
    await session.flush()
    session.add(Transaction(
        id=str(uuid.uuid4()), account_id=acct.id, date=date(2026, 7, 12),
        amount=D("12400.00"), category_id=rent.id,
    ))
    session.add(Transaction(
        id=str(uuid.uuid4()), account_id=acct.id, date=date(2026, 9, 28),
        amount=D("-4100.00"), category_id=clean.id,
    ))
    await session.commit()

    expire = datetime.now(timezone.utc) + timedelta(minutes=30)
    token = jwt.encode(
        {"sub": uid, "exp": expire}, get_settings().secret_key, algorithm=ALGORITHM
    )
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture()
async def rental_api(session):
    headers = await _rental_household(session)

    async def _override_get_db():
        yield session

    app.dependency_overrides[get_db] = _override_get_db
    prior = getattr(app.state, "rate_limit_store", None)
    app.state.rate_limit_store = InMemoryStore()
    try:
        yield headers
    finally:
        app.dependency_overrides.pop(get_db, None)
        if prior is not None:
            app.state.rate_limit_store = prior


@pytest.mark.asyncio
async def test_the_projection_route_returns_rental_actuals(rental_api):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/tax/projection?year=2026", headers=rental_api)
    assert resp.status_code == 200, resp.text
    rental = resp.json()["rental"]
    assert rental is not None
    assert Decimal(rental["gross_rental_income"]) == D("12400.00")
    assert Decimal(rental["allowable_expenses"]) == D("4100.00")
    assert Decimal(rental["net"]) == D("8300.00")


@pytest.mark.asyncio
async def test_rental_figures_survive_an_unavailable_projection(rental_api):
    """This household has no filing status, state or paystub, so there is
    no estimate -- but the rental figures are its own transactions and
    are real either way. They used to be dropped behind the early return."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/tax/projection?year=2026", headers=rental_api)
    body = resp.json()
    assert body["available"] is False
    assert body["rental"] is not None
    assert body["rental"]["through"] == "2026-09-28"


@pytest.mark.asyncio
async def test_a_household_with_no_rental_gets_no_rental_block(api):
    """Absent, not a block of zeroes -- the card must stay off the page."""
    headers, _, _ = api
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/tax/projection?year=2026", headers=headers)
    assert resp.json()["rental"] is None


@pytest.mark.asyncio
async def test_expenses_without_an_income_marker_are_flagged_as_half_set_up(fx):
    """Marking the rental's expenses and forgetting its income is a
    common half-finished setup. It otherwise shows "$0.00 income" beside
    real expenses, which reads as a bug rather than a missing marker."""
    clean = await fx.category("Cleaning", business=True)
    await fx.txn(clean.id, "-2100.50")
    a = await build(fx)
    assert a.has_income_category is False
    assert a.result.net == D("-2100.50")


@pytest.mark.asyncio
async def test_a_marked_income_category_clears_the_flag(fx):
    await fx.category("Rent", income=True, rental_income=True)
    clean = await fx.category("Cleaning", business=True)
    await fx.txn(clean.id, "-100.00")
    a = await build(fx)
    assert a.has_income_category is True


@pytest.mark.asyncio
async def test_the_app_says_which_years_it_can_work_out(api):
    """Rate tables are added one year at a time, by hand. The UI has to
    be able to stop offering a year before someone enters a whole W-2
    against it and finds there is no estimate at the end."""
    headers, _, _ = api
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/tax/years", headers=headers)
    assert resp.status_code == 200
    years = resp.json()["supported"]
    assert years == sorted(years), "should come back in order"
    assert 2026 in years


@pytest.mark.asyncio
async def test_every_year_it_offers_can_actually_be_projected(api):
    """The list and the engine must not drift: a year named here that
    `get_rates` refuses is worse than not naming it."""
    from app.services.tax.rates.registry import get_rates, supported_statuses

    headers, _, _ = api
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/tax/years", headers=headers)

    for year in resp.json()["supported"]:
        assert supported_statuses(year), f"{year} has no filing statuses"
        assert get_rates(year, "CO").year == year
