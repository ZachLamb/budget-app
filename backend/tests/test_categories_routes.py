"""Route tests for /api/categories: validation, ordering, usage, smart delete, reorder."""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest
import pytest_asyncio
import jwt
from httpx import ASGITransport, AsyncClient
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
    BudgetAssignment,
    Category,
    CategoryGroup,
    Household,
    Payee,
    RecurringTransaction,
    Transaction,
    User,
)


def _token_for(user_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=30)
    return jwt.encode(
        {"sub": user_id, "exp": expire},
        get_settings().secret_key,
        algorithm=ALGORITHM,
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
    test_session = Session()

    async def _override_get_db():
        yield test_session

    app.dependency_overrides[get_db] = _override_get_db
    prior_store = getattr(app.state, "rate_limit_store", None)
    app.state.rate_limit_store = InMemoryStore()
    try:
        yield test_session, engine
    finally:
        app.dependency_overrides.pop(get_db, None)
        await test_session.close()
        await engine.dispose()
        if prior_store is not None:
            app.state.rate_limit_store = prior_store


async def _seed_household(session) -> tuple[str, dict]:
    hid = str(uuid.uuid4())
    uid = str(uuid.uuid4())
    session.add(Household(id=hid, name="H"))
    session.add(User(
        id=uid, email=f"{uid}@t.io", name="T", password_hash=None,
        household_id=hid, role="owner", status="approved",
    ))
    await session.commit()
    return hid, {"Authorization": f"Bearer {_token_for(uid)}"}


async def _seed_catalog(session, hid: str):
    """One expense group with two categories, committed."""
    group = CategoryGroup(id=str(uuid.uuid4()), household_id=hid, name="Everyday", sort_order=0)
    session.add(group)
    await session.flush()
    cat_a = Category(id=str(uuid.uuid4()), group_id=group.id, name="Groceries", sort_order=0)
    cat_b = Category(id=str(uuid.uuid4()), group_id=group.id, name="Dining", sort_order=1)
    session.add_all([cat_a, cat_b])
    await session.commit()
    return group, cat_a, cat_b


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.mark.asyncio
async def test_group_name_blank_or_whitespace_rejected(fixture):
    session, _ = fixture
    _, headers = await _seed_household(session)
    async with _client() as client:
        for bad in ("", "   "):
            resp = await client.post("/api/categories/groups", headers=headers, json={"name": bad})
            assert resp.status_code == 422, f"expected 422 for name {bad!r}"


@pytest.mark.asyncio
async def test_group_name_too_long_rejected(fixture):
    session, _ = fixture
    _, headers = await _seed_household(session)
    async with _client() as client:
        resp = await client.post("/api/categories/groups", headers=headers, json={"name": "x" * 256})
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_group_name_whitespace_stripped(fixture):
    session, _ = fixture
    _, headers = await _seed_household(session)
    async with _client() as client:
        resp = await client.post("/api/categories/groups", headers=headers, json={"name": "  Bills  "})
    assert resp.status_code == 201
    assert resp.json()["name"] == "Bills"


@pytest.mark.asyncio
async def test_category_name_validation(fixture):
    session, _ = fixture
    _, headers = await _seed_household(session)
    async with _client() as client:
        grp = await client.post("/api/categories/groups", headers=headers, json={"name": "Everyday"})
        gid = grp.json()["id"]
        blank = await client.post("/api/categories", headers=headers, json={"group_id": gid, "name": "  "})
        assert blank.status_code == 422
        ok = await client.post("/api/categories", headers=headers, json={"group_id": gid, "name": " Groceries "})
        assert ok.status_code == 201
        assert ok.json()["name"] == "Groceries"
        update = await client.put(f"/api/categories/{ok.json()['id']}", headers=headers, json={"name": ""})
        assert update.status_code == 422


@pytest.mark.asyncio
async def test_new_groups_append_in_creation_order(fixture):
    session, _ = fixture
    _, headers = await _seed_household(session)
    async with _client() as client:
        for name in ("Alpha", "Beta", "Gamma"):
            resp = await client.post("/api/categories/groups", headers=headers, json={"name": name})
            assert resp.status_code == 201
        listing = await client.get("/api/categories/groups", headers=headers)
    body = listing.json()
    assert [g["name"] for g in body] == ["Alpha", "Beta", "Gamma"]
    assert [g["sort_order"] for g in body] == [0, 1, 2]


@pytest.mark.asyncio
async def test_new_categories_append_in_creation_order(fixture):
    session, _ = fixture
    _, headers = await _seed_household(session)
    async with _client() as client:
        grp = await client.post("/api/categories/groups", headers=headers, json={"name": "Everyday"})
        gid = grp.json()["id"]
        for name in ("Groceries", "Dining", "Fun"):
            resp = await client.post("/api/categories", headers=headers, json={"group_id": gid, "name": name})
            assert resp.status_code == 201
        listing = await client.get("/api/categories/groups", headers=headers)
    cats = listing.json()[0]["categories"]
    assert [c["name"] for c in cats] == ["Groceries", "Dining", "Fun"]
    assert [c["sort_order"] for c in cats] == [0, 1, 2]


@pytest.mark.asyncio
async def test_usage_counts_by_category(fixture):
    session, _ = fixture
    hid, headers = await _seed_household(session)
    group, cat_a, cat_b = await _seed_catalog(session, hid)
    account = Account(
        id=str(uuid.uuid4()), household_id=hid, name="Checking",
        account_type="checking", is_budget_account=True,
    )
    session.add(account)
    session.add(Transaction(account_id=account.id, category_id=cat_a.id, date=date(2026, 7, 1), amount=Decimal("-10")))
    session.add(Transaction(account_id=account.id, category_id=cat_a.id, date=date(2026, 7, 2), amount=Decimal("-20")))
    session.add(BudgetAssignment(household_id=hid, category_id=cat_a.id, month="2026-07", assigned_amount=Decimal("100")))
    session.add(AutoCategorizationRule(
        household_id=hid, match_field="payee", match_type="contains", match_value="mart", category_id=cat_b.id,
    ))
    session.add(Payee(household_id=hid, name="Safeway", default_category_id=cat_a.id))
    session.add(RecurringTransaction(
        household_id=hid, amount=Decimal("-15"), category_id=cat_b.id,
        frequency="monthly", next_date=date(2026, 8, 1),
    ))
    await session.commit()

    async with _client() as client:
        resp = await client.get("/api/categories/usage", headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body[cat_a.id] == {"transactions": 2, "budget_entries": 1, "rules": 0, "payees": 1, "recurring": 0}
    assert body[cat_b.id] == {"transactions": 0, "budget_entries": 0, "rules": 1, "payees": 0, "recurring": 1}


@pytest.mark.asyncio
async def test_usage_isolated_per_household(fixture):
    session, _ = fixture
    hid_a, _ = await _seed_household(session)
    await _seed_catalog(session, hid_a)
    _, headers_b = await _seed_household(session)
    async with _client() as client:
        resp = await client.get("/api/categories/usage", headers=headers_b)
    assert resp.status_code == 200
    assert resp.json() == {}


@pytest.mark.asyncio
async def test_delete_category_blocked_by_rule(fixture):
    session, _ = fixture
    hid, headers = await _seed_household(session)
    _, cat_a, _ = await _seed_catalog(session, hid)
    session.add(AutoCategorizationRule(
        household_id=hid, match_field="payee", match_type="contains", match_value="x", category_id=cat_a.id,
    ))
    await session.commit()
    async with _client() as client:
        resp = await client.delete(f"/api/categories/{cat_a.id}", headers=headers)
        assert resp.status_code == 409
        assert "1 rule" in resp.json()["detail"]
        listing = await client.get("/api/categories/groups", headers=headers)
    names = [c["name"] for g in listing.json() for c in g["categories"]]
    assert "Groceries" in names  # still there


@pytest.mark.asyncio
async def test_delete_category_uncategorizes_transactions(fixture):
    session, _ = fixture
    hid, headers = await _seed_household(session)
    _, cat_a, _ = await _seed_catalog(session, hid)
    account = Account(
        id=str(uuid.uuid4()), household_id=hid, name="Checking",
        account_type="checking", is_budget_account=True,
    )
    session.add(account)
    txn = Transaction(account_id=account.id, category_id=cat_a.id, date=date(2026, 7, 1), amount=Decimal("-10"))
    session.add(txn)
    await session.commit()
    async with _client() as client:
        resp = await client.delete(f"/api/categories/{cat_a.id}", headers=headers)
    assert resp.status_code == 204
    await session.refresh(txn)
    assert txn.category_id is None


@pytest.mark.asyncio
async def test_delete_category_cross_household_404(fixture):
    session, _ = fixture
    hid_a, _ = await _seed_household(session)
    _, cat_a, _ = await _seed_catalog(session, hid_a)
    _, headers_b = await _seed_household(session)
    async with _client() as client:
        resp = await client.delete(f"/api/categories/{cat_a.id}", headers=headers_b)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_group_with_categories_succeeds(fixture):
    """Regression: this 500'd before — no cascade rules on the FK."""
    session, _ = fixture
    hid, headers = await _seed_household(session)
    group, cat_a, _ = await _seed_catalog(session, hid)
    account = Account(
        id=str(uuid.uuid4()), household_id=hid, name="Checking",
        account_type="checking", is_budget_account=True,
    )
    session.add(account)
    txn = Transaction(account_id=account.id, category_id=cat_a.id, date=date(2026, 7, 1), amount=Decimal("-10"))
    session.add(txn)
    await session.commit()
    async with _client() as client:
        resp = await client.delete(f"/api/categories/groups/{group.id}", headers=headers)
        assert resp.status_code == 204
        listing = await client.get("/api/categories/groups", headers=headers)
    assert listing.json() == []
    await session.refresh(txn)
    assert txn.category_id is None


@pytest.mark.asyncio
async def test_delete_group_blocked_by_child_usage(fixture):
    session, _ = fixture
    hid, headers = await _seed_household(session)
    group, cat_a, _ = await _seed_catalog(session, hid)
    session.add(BudgetAssignment(household_id=hid, category_id=cat_a.id, month="2026-07", assigned_amount=Decimal("50")))
    await session.commit()
    async with _client() as client:
        resp = await client.delete(f"/api/categories/groups/{group.id}", headers=headers)
        assert resp.status_code == 409
        assert "Groceries" in resp.json()["detail"]
        listing = await client.get("/api/categories/groups", headers=headers)
    assert len(listing.json()) == 1  # nothing deleted


@pytest.mark.asyncio
async def test_reorder_groups(fixture):
    session, _ = fixture
    _, headers = await _seed_household(session)
    async with _client() as client:
        ids = []
        for name in ("Alpha", "Beta", "Gamma"):
            resp = await client.post("/api/categories/groups", headers=headers, json={"name": name})
            ids.append(resp.json()["id"])
        resp = await client.put("/api/categories/groups/order", headers=headers,
                                json={"ordered_ids": list(reversed(ids))})
        assert resp.status_code == 204
        listing = await client.get("/api/categories/groups", headers=headers)
    assert [g["name"] for g in listing.json()] == ["Gamma", "Beta", "Alpha"]


@pytest.mark.asyncio
async def test_reorder_groups_requires_full_set(fixture):
    session, _ = fixture
    _, headers = await _seed_household(session)
    async with _client() as client:
        a = (await client.post("/api/categories/groups", headers=headers, json={"name": "A"})).json()["id"]
        await client.post("/api/categories/groups", headers=headers, json={"name": "B"})
        partial = await client.put("/api/categories/groups/order", headers=headers, json={"ordered_ids": [a]})
        assert partial.status_code == 400
        dupes = await client.put("/api/categories/groups/order", headers=headers, json={"ordered_ids": [a, a]})
        assert dupes.status_code == 400


@pytest.mark.asyncio
async def test_reorder_categories_within_group(fixture):
    session, _ = fixture
    _, headers = await _seed_household(session)
    async with _client() as client:
        gid = (await client.post("/api/categories/groups", headers=headers, json={"name": "G"})).json()["id"]
        ids = []
        for name in ("One", "Two"):
            resp = await client.post("/api/categories", headers=headers, json={"group_id": gid, "name": name})
            ids.append(resp.json()["id"])
        resp = await client.put("/api/categories/order", headers=headers,
                                json={"group_id": gid, "ordered_ids": list(reversed(ids))})
        assert resp.status_code == 204
        listing = await client.get("/api/categories/groups", headers=headers)
    assert [c["name"] for c in listing.json()[0]["categories"]] == ["Two", "One"]


@pytest.mark.asyncio
async def test_delete_group_cross_household_404(fixture):
    session, _ = fixture
    hid_a, headers_a = await _seed_household(session)
    group, _, _ = await _seed_catalog(session, hid_a)
    _, headers_b = await _seed_household(session)
    async with _client() as client:
        resp = await client.delete(f"/api/categories/groups/{group.id}", headers=headers_b)
        assert resp.status_code == 404
        listing = await client.get("/api/categories/groups", headers=headers_a)
    assert any(g["id"] == group.id for g in listing.json())


@pytest.mark.asyncio
async def test_reorder_categories_foreign_group_404(fixture):
    session, _ = fixture
    hid_a, _ = await _seed_household(session)
    group, cat_a, cat_b = await _seed_catalog(session, hid_a)
    _, headers_b = await _seed_household(session)
    async with _client() as client:
        resp = await client.put("/api/categories/order", headers=headers_b,
                                json={"group_id": group.id, "ordered_ids": [cat_b.id, cat_a.id]})
    assert resp.status_code == 404
