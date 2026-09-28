"""Bulk transaction edits, and seeing what a rule would do first."""
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
    AutoCategorizationRule,
    Category,
    CategoryGroup,
    Household,
    Payee,
    Transaction,
    User,
)


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
    hid, uid = str(uuid.uuid4()), str(uuid.uuid4())
    session.add(Household(id=hid, name="H"))
    await session.flush()
    session.add(User(
        id=uid, email=f"{uid}@t.io", name="T", password_hash=None,
        household_id=hid, role="owner", status="approved",
    ))
    acct = Account(id=str(uuid.uuid4()), household_id=hid, name="Chk", account_type="checking")
    group = CategoryGroup(id=str(uuid.uuid4()), household_id=hid, name="Personal", sort_order=0)
    payee = Payee(id=str(uuid.uuid4()), household_id=hid, name="Blue Bottle Coffee")
    session.add_all([acct, group, payee])
    await session.flush()
    cat = Category(id=str(uuid.uuid4()), group_id=group.id, name="Coffee", sort_order=0)
    session.add(cat)
    await session.flush()

    ids = []
    for day in range(1, 6):
        t = Transaction(
            id=str(uuid.uuid4()), account_id=acct.id, date=date(2026, 6, day),
            payee_id=payee.id, amount=Decimal("-4.50"),
        )
        session.add(t)
        ids.append(t.id)
    await session.commit()
    headers = {"Authorization": f"Bearer {_token_for(uid)}"}
    return hid, headers, ids, cat.id, payee.id


# ── rule preview ──────────────────────────────────────────────────────


async def _add_rule(session, hid: str, category_id: str, value: str = "blue bottle"):
    rule = AutoCategorizationRule(
        id=str(uuid.uuid4()), household_id=hid, match_field="payee",
        match_type="contains", match_value=value, category_id=category_id,
        priority=1, enabled=True,
    )
    session.add(rule)
    await session.commit()
    return rule.id


@pytest.mark.asyncio
async def test_preview_counts_matches_without_categorizing_anything(fixture):
    """The whole point: find out first, decide second."""
    session = fixture
    hid, headers, ids, cat_id, _ = await _seed(session)
    await _add_rule(session, hid, cat_id)

    async with _client() as client:
        resp = await client.get("/api/rules/preview", headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 5
    assert body["sample"][0]["payee_name"] == "Blue Bottle Coffee"
    # It says what it matched against, so a surprising match is explicable.
    assert "Blue Bottle" in body["sample"][0]["matched_on"]

    # Nothing was written.
    still_uncategorized = (
        await session.execute(
            select(Transaction).where(Transaction.category_id.is_(None))
        )
    ).scalars().all()
    assert len(still_uncategorized) == 5


@pytest.mark.asyncio
async def test_preview_samples_rather_than_returning_everything(fixture):
    session = fixture
    hid, headers, ids, cat_id, payee_id = await _seed(session)
    acct = (await session.execute(select(Account))).scalars().first()
    for day in range(1, 21):
        session.add(Transaction(
            id=str(uuid.uuid4()), account_id=acct.id, date=date(2026, 7, day),
            payee_id=payee_id, amount=Decimal("-4.50"),
        ))
    await session.commit()
    await _add_rule(session, hid, cat_id)

    async with _client() as client:
        resp = await client.get("/api/rules/preview", headers=headers)
    body = resp.json()
    assert body["total"] == 25
    assert len(body["sample"]) == 10


@pytest.mark.asyncio
async def test_a_rule_can_be_previewed_and_applied_on_its_own(fixture):
    """It used to be every rule or none."""
    session = fixture
    hid, headers, ids, cat_id, _ = await _seed(session)
    rule_id = await _add_rule(session, hid, cat_id)

    async with _client() as client:
        preview = await client.get(f"/api/rules/{rule_id}/preview", headers=headers)
        assert preview.json()["total"] == 5
        applied = await client.post(f"/api/rules/{rule_id}/apply", headers=headers)

    assert applied.status_code == 200
    assert applied.json()["categorized"] == 5
    left = (
        await session.execute(select(Transaction).where(Transaction.category_id.is_(None)))
    ).scalars().all()
    assert left == []


@pytest.mark.asyncio
async def test_previewing_a_rule_from_another_household_is_a_404(fixture):
    session = fixture
    hid, headers, _, cat_id, _ = await _seed(session)
    async with _client() as client:
        resp = await client.get(f"/api/rules/{uuid.uuid4()}/preview", headers=headers)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_rules_never_touch_a_category_a_person_chose(fixture):
    """Only uncategorized rows are in scope, which is what makes running
    rules safe to do at any time."""
    session = fixture
    hid, headers, ids, cat_id, _ = await _seed(session)
    chosen = (await session.execute(select(Transaction).where(Transaction.id == ids[0]))).scalar_one()
    other = Category(
        id=str(uuid.uuid4()),
        group_id=(await session.execute(select(CategoryGroup))).scalars().first().id,
        name="Groceries", sort_order=1,
    )
    session.add(other)
    await session.flush()
    chosen.category_id = other.id
    await session.commit()
    await _add_rule(session, hid, cat_id)

    async with _client() as client:
        preview = await client.get("/api/rules/preview", headers=headers)
    assert preview.json()["total"] == 4

    await session.refresh(chosen)
    assert chosen.category_id == other.id


# ── bulk edit ─────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_bulk_sets_a_category_on_many_rows(fixture):
    session = fixture
    _, headers, ids, cat_id, _ = await _seed(session)
    async with _client() as client:
        resp = await client.patch(
            "/api/transactions/bulk",
            headers=headers,
            json={"transaction_ids": ids, "category_id": cat_id},
        )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"updated": 5, "skipped": 0}


@pytest.mark.asyncio
async def test_bulk_is_not_swallowed_by_the_id_route(fixture):
    """`/bulk` sits where a transaction id goes. It resolves as the bulk
    route because nothing else answers PATCH here -- worth pinning, since
    adding PATCH /{transaction_id} later would silently break it."""
    session = fixture
    _, headers, ids, cat_id, _ = await _seed(session)
    async with _client() as client:
        resp = await client.patch(
            "/api/transactions/bulk",
            headers=headers,
            json={"transaction_ids": ids[:1], "category_id": cat_id},
        )
    assert resp.status_code == 200
    assert resp.json()["updated"] == 1


@pytest.mark.asyncio
async def test_bulk_skips_ids_from_another_household_rather_than_touching_them(fixture):
    session = fixture
    _, headers, ids, cat_id, _ = await _seed(session)
    stranger = str(uuid.uuid4())
    async with _client() as client:
        resp = await client.patch(
            "/api/transactions/bulk",
            headers=headers,
            json={"transaction_ids": [*ids, stranger], "category_id": cat_id},
        )
    body = resp.json()
    assert body["updated"] == 5
    assert body["skipped"] == 1


@pytest.mark.asyncio
async def test_bulk_refuses_a_category_from_another_household(fixture):
    session = fixture
    _, headers, ids, _, _ = await _seed(session)
    async with _client() as client:
        resp = await client.patch(
            "/api/transactions/bulk",
            headers=headers,
            json={"transaction_ids": ids, "category_id": str(uuid.uuid4())},
        )
    assert resp.status_code in (400, 404)


@pytest.mark.asyncio
async def test_bulk_can_clear_a_category_explicitly(fixture):
    """`category_id: null` cannot mean "clear it" -- it is
    indistinguishable from not sending the field -- so clearing is its
    own flag."""
    session = fixture
    _, headers, ids, cat_id, _ = await _seed(session)
    async with _client() as client:
        await client.patch(
            "/api/transactions/bulk", headers=headers,
            json={"transaction_ids": ids, "category_id": cat_id},
        )
        resp = await client.patch(
            "/api/transactions/bulk", headers=headers,
            json={"transaction_ids": ids, "clear_category": True},
        )
    assert resp.json()["updated"] == 5
    left = (
        await session.execute(select(Transaction).where(Transaction.category_id.is_(None)))
    ).scalars().all()
    assert len(left) == 5


@pytest.mark.asyncio
async def test_bulk_rejects_a_call_that_changes_nothing(fixture):
    session = fixture
    _, headers, ids, _, _ = await _seed(session)
    async with _client() as client:
        resp = await client.patch(
            "/api/transactions/bulk", headers=headers,
            json={"transaction_ids": ids},
        )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_bulk_caps_how_many_ids_one_call_may_carry(fixture):
    session = fixture
    _, headers, _, cat_id, _ = await _seed(session)
    async with _client() as client:
        resp = await client.patch(
            "/api/transactions/bulk", headers=headers,
            json={
                "transaction_ids": [str(uuid.uuid4()) for _ in range(501)],
                "category_id": cat_id,
            },
        )
    assert resp.status_code == 422


# ── previewing a rule that does not exist yet ─────────────────────────


@pytest.mark.asyncio
async def test_candidate_preview_matches_without_creating_a_rule(fixture):
    """The editor asks 'would this pattern work' before there is a rule."""
    session = fixture
    _, headers, _, _, _ = await _seed(session)
    async with _client() as client:
        resp = await client.post(
            "/api/rules/preview",
            headers=headers,
            json={"match_field": "payee", "match_type": "contains", "match_value": "blue"},
        )
    assert resp.status_code == 200, resp.text
    assert resp.json()["total"] == 5

    rules = (await session.execute(select(AutoCategorizationRule))).scalars().all()
    assert rules == []


@pytest.mark.asyncio
async def test_candidate_preview_reports_a_pattern_that_catches_nothing(fixture):
    session = fixture
    _, headers, _, _, _ = await _seed(session)
    async with _client() as client:
        resp = await client.post(
            "/api/rules/preview",
            headers=headers,
            json={"match_field": "payee", "match_type": "contains", "match_value": "starbucks"},
        )
    assert resp.json() == {"total": 0, "sample": []}


@pytest.mark.asyncio
async def test_candidate_preview_never_reaches_another_household(fixture):
    """`.*` is the pattern that would expose everyone if scoping were wrong."""
    session = fixture
    _, headers, _, _, _ = await _seed(session)
    other_hh = Household(id=str(uuid.uuid4()), name="Someone else")
    session.add(other_hh)
    await session.flush()
    other_acct = Account(
        id=str(uuid.uuid4()), household_id=other_hh.id, name="Theirs",
        account_type="checking",
    )
    session.add(other_acct)
    await session.flush()
    session.add(Transaction(
        id=str(uuid.uuid4()), account_id=other_acct.id,
        date=date(2026, 6, 1), amount=Decimal("-100"),
    ))
    await session.commit()

    async with _client() as client:
        resp = await client.post(
            "/api/rules/preview", headers=headers,
            json={"match_field": "notes", "match_type": "regex", "match_value": ".*"},
        )
    # Five of ours, none of theirs.
    assert resp.json()["total"] == 5


# ── patterns that cannot work, or cannot stop ─────────────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize("pattern", ["(a+)+$", "(a*)*", "(?:ab+)*", r"(\d+|x)+"])
async def test_a_rule_that_could_run_forever_is_refused(fixture, pattern):
    """Nested quantifiers backtrack exponentially, and `re` has no timeout,
    so the only defence is not to store them."""
    session = fixture
    _, headers, _, cat_id, _ = await _seed(session)
    async with _client() as client:
        resp = await client.post(
            "/api/rules", headers=headers,
            json={
                "match_field": "payee", "match_type": "regex",
                "match_value": pattern, "category_id": cat_id,
            },
        )
    assert resp.status_code == 422
    assert "nested" in resp.text.lower() or "repeats" in resp.text.lower()


@pytest.mark.asyncio
async def test_a_regex_that_does_not_compile_is_refused_at_write_time(fixture):
    """The matcher skips an uncompilable pattern, so without this the rule
    sits there switched on, matching nothing, reporting nothing."""
    session = fixture
    _, headers, _, cat_id, _ = await _seed(session)
    async with _client() as client:
        resp = await client.post(
            "/api/rules", headers=headers,
            json={
                "match_field": "payee", "match_type": "regex",
                "match_value": "[unterminated", "category_id": cat_id,
            },
        )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_switching_an_existing_rule_to_regex_revalidates_the_pattern(fixture):
    """The schema only sees the fields that arrive. Changing just the type
    has to be checked against the value already stored."""
    session = fixture
    hid, headers, _, cat_id, _ = await _seed(session)
    rule_id = await _add_rule(session, hid, cat_id, value="(a+)+$")

    async with _client() as client:
        resp = await client.put(
            f"/api/rules/{rule_id}", headers=headers, json={"match_type": "regex"}
        )
    assert resp.status_code == 422

    await session.refresh(
        (await session.execute(
            select(AutoCategorizationRule).where(AutoCategorizationRule.id == rule_id)
        )).scalar_one()
    )
    stored = (await session.execute(
        select(AutoCategorizationRule).where(AutoCategorizationRule.id == rule_id)
    )).scalar_one()
    assert stored.match_type == "contains"


@pytest.mark.asyncio
async def test_an_unknown_match_field_is_refused_rather_than_silently_inert(fixture):
    session = fixture
    _, headers, _, cat_id, _ = await _seed(session)
    async with _client() as client:
        resp = await client.post(
            "/api/rules", headers=headers,
            json={
                "match_field": "memo", "match_type": "contains",
                "match_value": "x", "category_id": cat_id,
            },
        )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_an_overlong_match_value_is_refused(fixture):
    session = fixture
    _, headers, _, cat_id, _ = await _seed(session)
    async with _client() as client:
        resp = await client.post(
            "/api/rules", headers=headers,
            json={
                "match_field": "payee", "match_type": "contains",
                "match_value": "x" * 201, "category_id": cat_id,
            },
        )
    assert resp.status_code == 422
