"""Checking an account against a bank statement."""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import jwt
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.api.deps import ALGORITHM
from app.config import get_settings
from app.database import Base, get_db
from app.main import app
from app.middleware.rate_limit_store import InMemoryStore
from app.models import (
    Account,
    Category,
    CategoryGroup,
    Household,
    Payee,
    Reconciliation,
    Transaction,
    User,
)
from app.services.reconciliation import TxnRef, find_suggestions


# ── the search, on its own ────────────────────────────────────────────


def ref(amount: str, day: int = 1, name: str = "X") -> TxnRef:
    return TxnRef(
        transaction_id=f"t{day}-{amount}",
        # Wrapped: the callers only care that dates differ, and a
        # 200-row backlog runs past the end of the month.
        date=date(2026, 6, 1) + timedelta(days=day),
        payee_name=name,
        amount=Decimal(amount),
    )


class TestFindSuggestions:
    def test_a_balanced_account_needs_no_explanation(self):
        assert find_suggestions(Decimal("0"), [ref("-10")], []) == ()

    def test_finds_the_single_uncleared_transaction_that_explains_the_gap(self):
        # The overwhelmingly common cause: it just has not been ticked.
        out = find_suggestions(Decimal("-43.17"), [ref("-43.17"), ref("-9.00")], [])
        assert out[0].kind == "clear_one"
        assert out[0].transactions[0].amount == Decimal("-43.17")

    def test_finds_a_cleared_transaction_that_should_not_be(self):
        # An import duplicate, or something ticked before it settled.
        out = find_suggestions(Decimal("25.00"), [], [ref("-25.00")])
        assert out[0].kind == "unclear_one"

    def test_finds_a_pair_that_together_explain_it(self):
        out = find_suggestions(
            Decimal("-30.00"), [ref("-10.00", 1), ref("-20.00", 2), ref("-7.00", 3)], []
        )
        pair = next(s for s in out if s.kind == "clear_pair")
        assert sorted(t.amount for t in pair.transactions) == [
            Decimal("-20.00"),
            Decimal("-10.00"),
        ]

    def test_prefers_the_single_transaction_over_the_pair(self):
        # One tick beats two, and is more likely to be the real cause.
        out = find_suggestions(
            Decimal("-30.00"), [ref("-30.00", 1), ref("-10.00", 2), ref("-20.00", 3)], []
        )
        assert out[0].kind == "clear_one"

    def test_flags_the_transposition_signature_when_nothing_matches(self):
        # A difference divisible by 9 is what two swapped digits leave
        # behind. Nothing in the ledger will explain it, so say so.
        out = find_suggestions(Decimal("9.00"), [ref("-5.00")], [])
        assert len(out) == 1
        assert out[0].kind == "transposition"
        assert out[0].transactions == ()

    def test_does_not_cry_transposition_when_it_found_the_actual_cause(self):
        out = find_suggestions(Decimal("-9.00"), [ref("-9.00")], [])
        assert [s.kind for s in out] == ["clear_one"]

    def test_says_nothing_when_a_gap_has_no_clean_explanation(self):
        # Better silent than inventing a lead. 7.13 does not divide by 9
        # and nothing sums to it.
        assert find_suggestions(Decimal("7.13"), [ref("-5.00")], []) == ()

    def test_caps_how_many_leads_it_offers(self):
        # Five near-identical suggestions is a second list to search,
        # not a hint.
        uncleared = [ref("-5.00", d) for d in range(1, 12)]
        out = find_suggestions(Decimal("-5.00"), uncleared, [])
        assert len(out) <= 5

    def test_skips_the_pair_search_on_a_very_long_backlog(self):
        # O(n^2) on a request. A statement this far out of date is not
        # going to be fixed by a pair hint anyway.
        uncleared = [ref(f"-{d}.00", d) for d in range(1, 200)]
        out = find_suggestions(Decimal("-100000.00"), uncleared, [])
        assert all(s.kind != "clear_pair" for s in out)


# ── the route ─────────────────────────────────────────────────────────


def _token_for(user_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=30)
    return jwt.encode(
        {"sub": user_id, "exp": expire}, get_settings().secret_key, algorithm=ALGORITHM
    )


@pytest_asyncio.fixture()
async def fixture():
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False)
    session = Session()

    async def _override_get_db():
        yield session

    app.dependency_overrides[get_db] = _override_get_db
    prior = getattr(app.state, "rate_limit_store", None)
    app.state.rate_limit_store = InMemoryStore()
    try:
        yield session
    finally:
        app.dependency_overrides.pop(get_db, None)
        await session.close()
        await engine.dispose()
        if prior is not None:
            app.state.rate_limit_store = prior


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _seed(session):
    """An account with $1,000 cleared and one $50 outflow not yet cleared."""
    hid, uid = str(uuid.uuid4()), str(uuid.uuid4())
    session.add(Household(id=hid, name="H"))
    await session.flush()
    session.add(User(
        id=uid, email=f"{uid}@t.io", name="T", password_hash=None,
        household_id=hid, role="owner", status="approved",
    ))
    acct = Account(id=str(uuid.uuid4()), household_id=hid, name="Chk", account_type="checking")
    group = CategoryGroup(id=str(uuid.uuid4()), household_id=hid, name="G", sort_order=0)
    session.add_all([acct, group])
    await session.flush()
    cat = Category(id=str(uuid.uuid4()), group_id=group.id, name="Misc", sort_order=0)
    session.add(cat)

    session.add(Transaction(
        id=str(uuid.uuid4()), account_id=acct.id, date=date(2026, 6, 1),
        amount=Decimal("1000.00"), cleared=True, notes="Starting balance",
    ))
    uncleared_id = str(uuid.uuid4())
    session.add(Transaction(
        id=uncleared_id, account_id=acct.id, date=date(2026, 6, 10),
        amount=Decimal("-50.00"), cleared=False,
    ))
    await session.commit()
    return hid, {"Authorization": f"Bearer {_token_for(uid)}"}, acct.id, cat.id, uncleared_id


def _params(balance: str, day: int = 30):
    return {"statement_date": f"2026-06-{day:02d}", "statement_balance": balance}


@pytest.mark.asyncio
async def test_compares_only_cleared_transactions_against_the_statement(fixture):
    """A statement knows about what settled, not what you typed in."""
    session = fixture
    _, headers, acct_id, _, _ = await _seed(session)
    async with _client() as client:
        resp = await client.get(
            f"/api/accounts/{acct_id}/reconciliation",
            headers=headers,
            params=_params("1000.00"),
        )
    body = resp.json()
    assert Decimal(body["cleared_balance"]) == Decimal("1000.00")
    assert Decimal(body["difference"]) == Decimal("0.00")
    assert len(body["uncleared"]) == 1


@pytest.mark.asyncio
async def test_points_at_the_transaction_that_explains_the_gap(fixture):
    session = fixture
    _, headers, acct_id, _, uncleared_id = await _seed(session)
    async with _client() as client:
        resp = await client.get(
            f"/api/accounts/{acct_id}/reconciliation",
            headers=headers,
            params=_params("950.00"),
        )
    body = resp.json()
    assert Decimal(body["difference"]) == Decimal("-50.00")
    assert body["suggestions"][0]["kind"] == "clear_one"
    assert body["suggestions"][0]["transactions"][0]["transaction_id"] == uncleared_id


@pytest.mark.asyncio
async def test_never_reconciled_is_not_the_same_as_reconciled_to_nothing(fixture):
    session = fixture
    _, headers, acct_id, _, _ = await _seed(session)
    async with _client() as client:
        resp = await client.get(
            f"/api/accounts/{acct_id}/reconciliation",
            headers=headers, params=_params("1000.00"),
        )
    assert resp.json()["last_reconciled_on"] is None


@pytest.mark.asyncio
async def test_ignores_transactions_after_the_statement_date(fixture):
    """A statement cannot know about things that had not happened."""
    session = fixture
    _, headers, acct_id, _, _ = await _seed(session)
    acct = (await session.execute(select(Account))).scalars().first()
    session.add(Transaction(
        id=str(uuid.uuid4()), account_id=acct.id, date=date(2026, 7, 15),
        amount=Decimal("-999.00"), cleared=True,
    ))
    await session.commit()
    async with _client() as client:
        resp = await client.get(
            f"/api/accounts/{acct_id}/reconciliation",
            headers=headers, params=_params("1000.00"),
        )
    assert Decimal(resp.json()["difference"]) == Decimal("0.00")


@pytest.mark.asyncio
async def test_another_household_account_is_a_404(fixture):
    session = fixture
    _, headers, _, _, _ = await _seed(session)
    async with _client() as client:
        resp = await client.get(
            f"/api/accounts/{uuid.uuid4()}/reconciliation",
            headers=headers, params=_params("1.00"),
        )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_signing_off_locks_the_cleared_transactions(fixture):
    session = fixture
    _, headers, acct_id, _, uncleared_id = await _seed(session)
    async with _client() as client:
        resp = await client.post(
            f"/api/accounts/{acct_id}/reconcile",
            headers=headers,
            json={"statement_date": "2026-06-30", "statement_balance": "1000.00"},
        )
    assert resp.status_code == 201, resp.text
    assert resp.json()["transaction_count"] == 1

    rows = (await session.execute(select(Transaction))).scalars().all()
    by_id = {t.id: t for t in rows}
    assert by_id[uncleared_id].reconciled is False
    assert all(t.reconciled for t in rows if t.cleared)


@pytest.mark.asyncio
async def test_refuses_to_sign_off_an_account_that_does_not_balance(fixture):
    """A record saying the account agreed with the bank when it did not
    is worse than having no record."""
    session = fixture
    _, headers, acct_id, _, _ = await _seed(session)
    async with _client() as client:
        resp = await client.post(
            f"/api/accounts/{acct_id}/reconcile",
            headers=headers,
            json={"statement_date": "2026-06-30", "statement_balance": "950.00"},
        )
    assert resp.status_code == 409
    assert "-50" in resp.json()["detail"]
    assert (await session.execute(select(Reconciliation))).scalars().all() == []


@pytest.mark.asyncio
async def test_a_gap_can_be_accepted_deliberately_and_is_recorded_as_one(fixture):
    session = fixture
    _, headers, acct_id, _, _ = await _seed(session)
    async with _client() as client:
        resp = await client.post(
            f"/api/accounts/{acct_id}/reconcile",
            headers=headers,
            json={
                "statement_date": "2026-06-30",
                "statement_balance": "950.00",
                "allow_difference": True,
            },
        )
    assert resp.status_code == 201
    # The record says it did not balance, rather than quietly reading as
    # a clean reconciliation.
    assert Decimal(resp.json()["difference"]) == Decimal("-50.00")


@pytest.mark.asyncio
async def test_a_balancing_entry_closes_the_gap_and_says_it_did(fixture):
    session = fixture
    _, headers, acct_id, cat_id, _ = await _seed(session)
    async with _client() as client:
        resp = await client.post(
            f"/api/accounts/{acct_id}/reconcile",
            headers=headers,
            json={
                "statement_date": "2026-06-30",
                "statement_balance": "950.00",
                "create_adjustment": True,
                "adjustment_category_id": cat_id,
            },
        )
    body = resp.json()
    assert resp.status_code == 201, resp.text
    assert Decimal(body["difference"]) == Decimal("0.00")
    # ...but the record carries how it got there.
    assert body["adjustment_transaction_id"] is not None

    adj = (await session.execute(
        select(Transaction).where(Transaction.id == body["adjustment_transaction_id"])
    )).scalar_one()
    assert adj.amount == Decimal("-50.00")
    assert adj.cleared is True and adj.reconciled is True
    assert "statement" in (adj.notes or "")


@pytest.mark.asyncio
async def test_a_balancing_entry_cannot_borrow_another_household_category(fixture):
    session = fixture
    _, headers, acct_id, _, _ = await _seed(session)
    async with _client() as client:
        resp = await client.post(
            f"/api/accounts/{acct_id}/reconcile",
            headers=headers,
            json={
                "statement_date": "2026-06-30",
                "statement_balance": "950.00",
                "create_adjustment": True,
                "adjustment_category_id": str(uuid.uuid4()),
            },
        )
    assert resp.status_code in (400, 404)


@pytest.mark.asyncio
async def test_balancing_entries_share_one_named_payee(fixture):
    """Scattered blank rows nobody can account for is the failure mode."""
    session = fixture
    _, headers, acct_id, cat_id, _ = await _seed(session)
    async with _client() as client:
        for day, bal in (("2026-06-30", "950.00"), ("2026-07-31", "900.00")):
            await client.post(
                f"/api/accounts/{acct_id}/reconcile",
                headers=headers,
                json={
                    "statement_date": day, "statement_balance": bal,
                    "create_adjustment": True, "adjustment_category_id": cat_id,
                },
            )
    payees = (await session.execute(
        select(Payee).where(Payee.name == "Balance adjustment")
    )).scalars().all()
    assert len(payees) == 1


@pytest.mark.asyncio
async def test_history_says_when_the_account_last_agreed_with_the_bank(fixture):
    session = fixture
    _, headers, acct_id, _, _ = await _seed(session)
    async with _client() as client:
        await client.post(
            f"/api/accounts/{acct_id}/reconcile",
            headers=headers,
            json={"statement_date": "2026-06-30", "statement_balance": "1000.00"},
        )
        history = await client.get(
            f"/api/accounts/{acct_id}/reconciliations", headers=headers
        )
        view = await client.get(
            f"/api/accounts/{acct_id}/reconciliation",
            headers=headers, params=_params("1000.00", 30),
        )
    assert len(history.json()) == 1
    assert view.json()["last_reconciled_on"] == "2026-06-30"


@pytest.mark.asyncio
async def test_history_from_another_household_is_a_404(fixture):
    session = fixture
    _, headers, _, _, _ = await _seed(session)
    async with _client() as client:
        resp = await client.get(
            f"/api/accounts/{uuid.uuid4()}/reconciliations", headers=headers
        )
    assert resp.status_code == 404
