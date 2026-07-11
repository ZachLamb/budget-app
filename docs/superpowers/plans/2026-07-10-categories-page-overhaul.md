# Categories Page Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the categories page's eight confirmed bugs and upgrade it with rename, move, income toggle, smart delete with consequences, usage counts, and drag-to-reorder.

**Architecture:** Backend first: validate input, add usage/reorder endpoints, and make deletes reference-aware (smart delete) in `backend/app/api/routes/categories.py` with a new pytest file. Frontend second: split the monolithic page into `page.tsx` + `group-item.tsx` + `category-item.tsx`, replace the fragile expand-state effect with a collapsed-ids hook, and layer on menus, usage display, and dnd-kit sorting.

**Tech Stack:** FastAPI + SQLAlchemy async + pytest (backend); Next.js 16 App Router, React 19, TanStack Query v5, shadcn/Radix, Tailwind, Vitest + Testing Library (frontend). New dependency (approved): `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`.

**Spec:** `docs/superpowers/specs/2026-07-10-categories-page-overhaul-design.md`

## Global Constraints

- Work on branch `feat/categories-page-improvements` (already created). Never commit to main.
- Backend tests: `cd backend && python -m pytest tests/test_categories_routes.py -v` (run from repo root paths below assume repo root `/Users/zach/Code/budget-app`).
- Frontend tests: `cd frontend && npx vitest run "src/app/(app)/categories"` — quote the glob; parens in the path.
- Commit after every task, conventional-commit style (`fix:`, `feat:`, `test:`), message body ends with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- `fallow` dead-code check only runs in the final CI gate (Task 14); intermediate tasks may add exports that are consumed by later tasks — that is expected.
- Reorder routes MUST be declared before the dynamic routes in the same file (`/groups/order` before `/groups/{group_id}`, `/order` before `/{category_id}`) or FastAPI will capture `"order"` as an id.
- Existing response shapes of `GET /categories/groups` must not change — other pages consume it via the `["categoryGroups"]` query key.
- Match neighboring code style; comments only for non-obvious constraints.

---

### Task 1: Backend name validation

**Files:**
- Modify: `backend/app/schemas/category.py`
- Test: `backend/tests/test_categories_routes.py` (create)

**Interfaces:**
- Consumes: existing routes in `backend/app/api/routes/categories.py` (unchanged this task).
- Produces: `clean_name(value: Optional[str]) -> Optional[str]` module-level helper in `app/schemas/category.py`; all four Create/Update schemas validate `name` (1–255 chars after strip). Test file scaffolding (`fixture`, `_token_for`, `_seed_household`, `_client`) reused by Tasks 2–6.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_categories_routes.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_categories_routes.py -v`
Expected: the four tests FAIL — blank/oversized names currently return 201/200, not 422.

- [ ] **Step 3: Implement validation**

Replace `backend/app/schemas/category.py` content for the four schemas (keep the Response classes untouched). Add imports and helper at top:

```python
from pydantic import BaseModel, Field, field_validator
from datetime import datetime, date
from decimal import Decimal
from typing import Optional


def clean_name(value: Optional[str]) -> Optional[str]:
    """Strip surrounding whitespace; reject names that are blank after stripping."""
    if value is None:
        return value
    value = value.strip()
    if not value:
        raise ValueError("name must not be blank")
    return value


class CategoryGroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    sort_order: int = 0
    is_income: bool = False

    @field_validator("name")
    @classmethod
    def _validate_name(cls, v: str) -> str:
        return clean_name(v)


class CategoryGroupUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    sort_order: Optional[int] = None
    is_income: Optional[bool] = None

    @field_validator("name")
    @classmethod
    def _validate_name(cls, v: Optional[str]) -> Optional[str]:
        return clean_name(v)


class CategoryCreate(BaseModel):
    group_id: str
    name: str = Field(min_length=1, max_length=255)
    sort_order: int = 0
    goal_type: str = "none"
    goal_amount: Optional[Decimal] = None
    goal_target_date: Optional[date] = None

    @field_validator("name")
    @classmethod
    def _validate_name(cls, v: str) -> str:
        return clean_name(v)


class CategoryUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    group_id: Optional[str] = None
    sort_order: Optional[int] = None
    goal_type: Optional[str] = None
    goal_amount: Optional[Decimal] = None
    goal_target_date: Optional[date] = None

    @field_validator("name")
    @classmethod
    def _validate_name(cls, v: Optional[str]) -> Optional[str]:
        return clean_name(v)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_categories_routes.py -v`
Expected: 4 passed.

- [ ] **Step 5: Regression-check the whole backend suite, then commit**

Run: `cd backend && python -m pytest tests/ -q`
Expected: all pass (other suites create categories with valid names).

```bash
git add backend/app/schemas/category.py backend/tests/test_categories_routes.py
git commit -m "fix(categories): validate names at the API boundary (1-255 chars, stripped)"
```

---

### Task 2: Stable sort_order on create + ordering tie-breaks

**Files:**
- Modify: `backend/app/schemas/category.py` (sort_order becomes Optional on the two Create schemas)
- Modify: `backend/app/api/routes/categories.py` (create routes, list route)
- Modify: `backend/app/models/category.py:22` (relationship order_by)
- Test: `backend/tests/test_categories_routes.py`

**Interfaces:**
- Consumes: Task 1 test scaffolding.
- Produces: creates without explicit `sort_order` get `max(sort_order) + 1` within household (groups) / group (categories); listings are ordered `(sort_order, created_at)`.

- [ ] **Step 1: Write the failing tests** (append to `test_categories_routes.py`)

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_categories_routes.py -v -k creation_order`
Expected: FAIL — every row currently gets `sort_order=0`.

- [ ] **Step 3: Implement**

In `backend/app/schemas/category.py`, change on **both** Create schemas:
`sort_order: int = 0` → `sort_order: Optional[int] = None`.

In `backend/app/api/routes/categories.py`, change the import line `from sqlalchemy import select` → `from sqlalchemy import select, func`, then update the two create routes:

```python
@router.post("/groups", response_model=CategoryGroupResponse, status_code=201)
async def create_category_group(
    data: CategoryGroupCreate,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    payload = data.model_dump()
    if payload.get("sort_order") is None:
        result = await db.execute(
            select(func.max(CategoryGroup.sort_order)).where(CategoryGroup.household_id == household_id)
        )
        max_sort = result.scalar()
        payload["sort_order"] = 0 if max_sort is None else max_sort + 1
    group = CategoryGroup(household_id=household_id, **payload)
    db.add(group)
    await db.flush()
    return CategoryGroupResponse.model_validate(group)
```

```python
@router.post("", response_model=CategoryResponse, status_code=201)
async def create_category(
    data: CategoryCreate,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CategoryGroup).where(CategoryGroup.id == data.group_id, CategoryGroup.household_id == household_id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Category group not found")

    payload = data.model_dump()
    if payload.get("sort_order") is None:
        result = await db.execute(
            select(func.max(Category.sort_order)).where(Category.group_id == data.group_id)
        )
        max_sort = result.scalar()
        payload["sort_order"] = 0 if max_sort is None else max_sort + 1
    category = Category(**payload)
    db.add(category)
    await db.flush()
    return CategoryResponse.model_validate(category)
```

In `list_category_groups`, change the order_by:
`.order_by(CategoryGroup.sort_order)` → `.order_by(CategoryGroup.sort_order, CategoryGroup.created_at)`.

In `backend/app/models/category.py:22`, change the relationship:
`order_by="Category.sort_order"` → `order_by="[Category.sort_order, Category.created_at]"`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_categories_routes.py -v`
Expected: all pass.

- [ ] **Step 5: Regression + commit**

Run: `cd backend && python -m pytest tests/ -q` — all pass.

```bash
git add backend/app/schemas/category.py backend/app/api/routes/categories.py backend/app/models/category.py backend/tests/test_categories_routes.py
git commit -m "fix(categories): stable creation order via max(sort_order)+1 and created_at tie-break"
```

---

### Task 3: Usage endpoint `GET /categories/usage`

**Files:**
- Modify: `backend/app/schemas/category.py` (add `CategoryUsageResponse`)
- Modify: `backend/app/api/routes/categories.py`
- Test: `backend/tests/test_categories_routes.py`

**Interfaces:**
- Consumes: models `Transaction`, `BudgetAssignment`, `AutoCategorizationRule`, `Payee`, `RecurringTransaction` from `app.models`.
- Produces: `CategoryUsageResponse(transactions, budget_entries, rules, payees, recurring — all int, default 0)`; route helper `async _usage_counts(db, category_ids: list[str]) -> dict[str, CategoryUsageResponse]` (reused by Tasks 4–5); `GET /api/categories/usage` → `dict[category_id, CategoryUsageResponse]` for the household.

- [ ] **Step 1: Write the failing tests** (append; also add the shared `_seed_catalog` helper)

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_categories_routes.py -v -k usage`
Expected: FAIL with 404 (route does not exist).

- [ ] **Step 3: Implement**

Add to `backend/app/schemas/category.py` (after the Update schemas):

```python
class CategoryUsageResponse(BaseModel):
    transactions: int = 0
    budget_entries: int = 0
    rules: int = 0
    payees: int = 0
    recurring: int = 0
```

In `backend/app/api/routes/categories.py`, extend imports:

```python
from app.models import (
    AutoCategorizationRule,
    BudgetAssignment,
    Category,
    CategoryGroup,
    Payee,
    RecurringTransaction,
    Transaction,
)
from app.schemas.category import (
    CategoryGroupCreate, CategoryGroupUpdate, CategoryGroupResponse,
    CategoryCreate, CategoryUpdate, CategoryResponse, CategoryUsageResponse,
)
```

Add the helper and route **directly after `list_category_groups`** (usage is a static path; keep all static paths above dynamic ones):

```python
async def _usage_counts(db: AsyncSession, category_ids: list[str]) -> dict[str, CategoryUsageResponse]:
    """Per-category reference counts across everything that points at a category."""
    usage = {cid: CategoryUsageResponse() for cid in category_ids}
    if not category_ids:
        return usage
    sources = (
        ("transactions", Transaction.category_id),
        ("budget_entries", BudgetAssignment.category_id),
        ("rules", AutoCategorizationRule.category_id),
        ("payees", Payee.default_category_id),
        ("recurring", RecurringTransaction.category_id),
    )
    for field, column in sources:
        result = await db.execute(
            select(column, func.count()).where(column.in_(category_ids)).group_by(column)
        )
        for cid, count in result.all():
            setattr(usage[cid], field, count)
    return usage


@router.get("/usage", response_model=dict[str, CategoryUsageResponse])
async def category_usage(
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Category.id)
        .join(CategoryGroup, Category.group_id == CategoryGroup.id)
        .where(CategoryGroup.household_id == household_id)
    )
    return await _usage_counts(db, [row[0] for row in result.all()])
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_categories_routes.py -v`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas/category.py backend/app/api/routes/categories.py backend/tests/test_categories_routes.py
git commit -m "feat(categories): add GET /categories/usage with per-category reference counts"
```

---

### Task 4: Smart delete for categories

**Files:**
- Modify: `backend/app/api/routes/categories.py` (delete_category)
- Test: `backend/tests/test_categories_routes.py`

**Interfaces:**
- Consumes: `_usage_counts` from Task 3.
- Produces: `_blocker_phrases(usage: CategoryUsageResponse) -> list[str]` (reused by Task 5). DELETE semantics: 409 when referenced by budget entries/rules/payee defaults/recurring; otherwise transactions are SET NULL and the row is deleted (204).

- [ ] **Step 1: Write the failing tests** (append)

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_categories_routes.py -v -k delete_category`
Expected: blocked-by-rule FAILS (delete currently attempts and 500s or wrongly succeeds); uncategorize FAILS.

- [ ] **Step 3: Implement**

In `backend/app/api/routes/categories.py`, change the sqlalchemy import to
`from sqlalchemy import select, func, update as sql_update`, add near `_usage_counts`:

```python
_BLOCKER_LABELS = (
    ("budget_entries", "budget entry", "budget entries"),
    ("rules", "rule", "rules"),
    ("payees", "payee default", "payee defaults"),
    ("recurring", "recurring item", "recurring items"),
)


def _blocker_phrases(usage: CategoryUsageResponse) -> list[str]:
    phrases = []
    for field, singular, plural in _BLOCKER_LABELS:
        count = getattr(usage, field)
        if count:
            phrases.append(f"{count} {singular if count == 1 else plural}")
    return phrases
```

Replace the body of `delete_category` (after the existing fetch + 404 guard):

```python
@router.delete("/{category_id}", status_code=204)
async def delete_category(
    category_id: str,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Category)
        .join(CategoryGroup, Category.group_id == CategoryGroup.id)
        .where(Category.id == category_id, CategoryGroup.household_id == household_id)
    )
    category = result.scalar_one_or_none()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")
    usage = (await _usage_counts(db, [category_id]))[category_id]
    phrases = _blocker_phrases(usage)
    if phrases:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot delete '{category.name}': used by {' and '.join(phrases)}. Remove those first.",
        )
    # Transactions may reference the category; uncategorize them instead of failing.
    await db.execute(
        sql_update(Transaction).where(Transaction.category_id == category_id).values(category_id=None)
    )
    await db.delete(category)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_categories_routes.py -v`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/routes/categories.py backend/tests/test_categories_routes.py
git commit -m "fix(categories): smart category delete — 409 on hard references, uncategorize transactions"
```

---

### Task 5: Smart delete for groups

**Files:**
- Modify: `backend/app/api/routes/categories.py` (delete_category_group)
- Test: `backend/tests/test_categories_routes.py`

**Interfaces:**
- Consumes: `_usage_counts`, `_blocker_phrases` (Tasks 3–4).
- Produces: group DELETE is all-or-nothing: 409 naming blocked child categories, else child transactions nulled, categories and group deleted (204). Fixes the original "group delete 500s" bug.

- [ ] **Step 1: Write the failing tests** (append)

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_categories_routes.py -v -k delete_group`
Expected: FAIL — first test errors (IntegrityError/500), second returns 500 not 409.

- [ ] **Step 3: Implement**

Replace `delete_category_group`:

```python
@router.delete("/groups/{group_id}", status_code=204)
async def delete_category_group(
    group_id: str,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CategoryGroup).where(CategoryGroup.id == group_id, CategoryGroup.household_id == household_id)
    )
    group = result.scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=404, detail="Category group not found")

    result = await db.execute(select(Category).where(Category.group_id == group_id))
    categories = result.scalars().all()
    usage = await _usage_counts(db, [c.id for c in categories])
    blocked = []
    for category in categories:
        phrases = _blocker_phrases(usage[category.id])
        if phrases:
            blocked.append(f"'{category.name}' is used by {' and '.join(phrases)}")
    if blocked:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot delete group '{group.name}': {'; '.join(blocked)}. Remove those first.",
        )
    category_ids = [c.id for c in categories]
    if category_ids:
        await db.execute(
            sql_update(Transaction).where(Transaction.category_id.in_(category_ids)).values(category_id=None)
        )
        for category in categories:
            await db.delete(category)
    await db.delete(group)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_categories_routes.py -v`
Expected: all pass.

- [ ] **Step 5: Regression + commit**

Run: `cd backend && python -m pytest tests/ -q` — all pass.

```bash
git add backend/app/api/routes/categories.py backend/tests/test_categories_routes.py
git commit -m "fix(categories): group delete no longer 500s — all-or-nothing smart delete"
```

---

### Task 6: Reorder endpoints

**Files:**
- Modify: `backend/app/schemas/category.py` (add `GroupOrderUpdate`, `CategoryOrderUpdate`)
- Modify: `backend/app/api/routes/categories.py`
- Test: `backend/tests/test_categories_routes.py`

**Interfaces:**
- Produces: `PUT /api/categories/groups/order` `{ordered_ids: string[]}` and `PUT /api/categories/order` `{group_id, ordered_ids}` — both 204, both require the ids to be exactly the household's/group's full set. Frontend (Task 12) calls these.

- [ ] **Step 1: Write the failing tests** (append)

```python
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
async def test_reorder_categories_foreign_group_404(fixture):
    session, _ = fixture
    hid_a, _ = await _seed_household(session)
    group, cat_a, cat_b = await _seed_catalog(session, hid_a)
    _, headers_b = await _seed_household(session)
    async with _client() as client:
        resp = await client.put("/api/categories/order", headers=headers_b,
                                json={"group_id": group.id, "ordered_ids": [cat_b.id, cat_a.id]})
    assert resp.status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_categories_routes.py -v -k reorder`
Expected: FAIL — `/groups/order` currently matches `/groups/{group_id}` → 404 "Category group not found", `/order` matches `/{category_id}` → 404/405.

- [ ] **Step 3: Implement**

Add to `backend/app/schemas/category.py`:

```python
class GroupOrderUpdate(BaseModel):
    ordered_ids: list[str] = Field(min_length=1)


class CategoryOrderUpdate(BaseModel):
    group_id: str
    ordered_ids: list[str] = Field(min_length=1)
```

Import both in the routes file. Add these routes **immediately after the `/usage` route and before any `/{...}` route** (FastAPI matches in declaration order — this is load-bearing):

```python
@router.put("/groups/order", status_code=204)
async def reorder_groups(
    data: GroupOrderUpdate,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(CategoryGroup).where(CategoryGroup.household_id == household_id))
    groups = {g.id: g for g in result.scalars().all()}
    if sorted(data.ordered_ids) != sorted(groups):
        raise HTTPException(status_code=400, detail="ordered_ids must contain every group id exactly once")
    for index, gid in enumerate(data.ordered_ids):
        groups[gid].sort_order = index


@router.put("/order", status_code=204)
async def reorder_categories(
    data: CategoryOrderUpdate,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CategoryGroup).where(CategoryGroup.id == data.group_id, CategoryGroup.household_id == household_id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Category group not found")
    result = await db.execute(select(Category).where(Category.group_id == data.group_id))
    categories = {c.id: c for c in result.scalars().all()}
    if sorted(data.ordered_ids) != sorted(categories):
        raise HTTPException(status_code=400, detail="ordered_ids must contain every category id in the group exactly once")
    for index, cid in enumerate(data.ordered_ids):
        categories[cid].sort_order = index
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_categories_routes.py -v`
Expected: all pass.

- [ ] **Step 5: Full backend regression + commit**

Run: `cd backend && python -m pytest tests/ -q` — all pass.

```bash
git add backend/app/schemas/category.py backend/app/api/routes/categories.py backend/tests/test_categories_routes.py
git commit -m "feat(categories): reorder endpoints for groups and categories"
```

---

### Task 7: Frontend API layer + delete-consequence helpers

**Files:**
- Modify: `frontend/src/lib/api/categories.ts`
- Create: `frontend/src/app/(app)/categories/delete-consequences.ts`
- Test: `frontend/src/app/(app)/categories/delete-consequences.test.ts`

**Interfaces:**
- Produces:
  - `CategoryUsage` interface `{transactions, budget_entries, rules, payees, recurring: number}`; `CategoryUsageMap = Record<string, CategoryUsage>`.
  - `categoriesApi.usage(): Promise<CategoryUsageMap>`, `categoriesApi.reorderGroups(ordered_ids: string[])`, `categoriesApi.reorderCategories(group_id: string, ordered_ids: string[])`; `updateGroup` gains `is_income` in its Partial.
  - `describeCategoryDelete(usage: CategoryUsage | undefined): DeleteConsequence` and `describeGroupDelete(group: CategoryGroup | undefined, usageMap: CategoryUsageMap | undefined): DeleteConsequence` where `DeleteConsequence = { blocked: boolean; message: string }`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/app/(app)/categories/delete-consequences.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { describeCategoryDelete, describeGroupDelete } from "./delete-consequences";
import type { CategoryGroup, CategoryUsage } from "@/lib/api/categories";

const usage = (over: Partial<CategoryUsage> = {}): CategoryUsage => ({
  transactions: 0, budget_entries: 0, rules: 0, payees: 0, recurring: 0, ...over,
});

const cat = (id: string, name: string) => ({
  id, group_id: "g1", name, sort_order: 0, goal_type: "none",
  goal_amount: null, goal_target_date: null, created_at: "2026-01-01T00:00:00Z",
});

const group = (categories: ReturnType<typeof cat>[]): CategoryGroup => ({
  id: "g1", household_id: "h1", name: "Everyday", sort_order: 0,
  is_income: false, created_at: "2026-01-01T00:00:00Z", categories,
});

describe("describeCategoryDelete", () => {
  it("is generic when usage is unknown", () => {
    const c = describeCategoryDelete(undefined);
    expect(c.blocked).toBe(false);
    expect(c.message).toMatch(/permanently delete/i);
  });
  it("warns how many transactions become uncategorized", () => {
    const c = describeCategoryDelete(usage({ transactions: 12 }));
    expect(c.blocked).toBe(false);
    expect(c.message).toContain("12 transactions will become uncategorized");
  });
  it("uses singular for one transaction", () => {
    expect(describeCategoryDelete(usage({ transactions: 1 })).message)
      .toContain("1 transaction will become uncategorized");
  });
  it("blocks on rules and payee defaults, listing both", () => {
    const c = describeCategoryDelete(usage({ rules: 2, payees: 1 }));
    expect(c.blocked).toBe(true);
    expect(c.message).toContain("2 rules");
    expect(c.message).toContain("1 payee default");
  });
});

describe("describeGroupDelete", () => {
  it("is generic without usage data", () => {
    const c = describeGroupDelete(group([cat("c1", "Groceries")]), undefined);
    expect(c.blocked).toBe(false);
  });
  it("sums transactions across child categories", () => {
    const c = describeGroupDelete(group([cat("c1", "A"), cat("c2", "B")]), {
      c1: usage({ transactions: 3 }), c2: usage({ transactions: 4 }),
    });
    expect(c.blocked).toBe(false);
    expect(c.message).toContain("7 transactions will become uncategorized");
  });
  it("blocks and names the blocked category", () => {
    const c = describeGroupDelete(group([cat("c1", "Groceries")]), {
      c1: usage({ budget_entries: 1 }),
    });
    expect(c.blocked).toBe(true);
    expect(c.message).toContain("'Groceries'");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run "src/app/(app)/categories"`
Expected: FAIL — module `./delete-consequences` not found.

- [ ] **Step 3: Implement**

In `frontend/src/lib/api/categories.ts`, add after the `CategoryGroup` interface:

```ts
export interface CategoryUsage {
  transactions: number;
  budget_entries: number;
  rules: number;
  payees: number;
  recurring: number;
}

export type CategoryUsageMap = Record<string, CategoryUsage>;
```

Change `updateGroup`'s data type to `Partial<{ name: string; sort_order: number; is_income: boolean }>` and add to `categoriesApi`:

```ts
  usage: () => api.get<CategoryUsageMap>("/categories/usage").then((r) => r.data),
  reorderGroups: (ordered_ids: string[]) => api.put("/categories/groups/order", { ordered_ids }),
  reorderCategories: (group_id: string, ordered_ids: string[]) =>
    api.put("/categories/order", { group_id, ordered_ids }),
```

Create `frontend/src/app/(app)/categories/delete-consequences.ts`:

```ts
import type { CategoryGroup, CategoryUsage, CategoryUsageMap } from "@/lib/api/categories";

export interface DeleteConsequence {
  blocked: boolean;
  message: string;
}

const BLOCKERS: Array<[keyof CategoryUsage, string, string]> = [
  ["budget_entries", "budget entry", "budget entries"],
  ["rules", "rule", "rules"],
  ["payees", "payee default", "payee defaults"],
  ["recurring", "recurring item", "recurring items"],
];

function blockerPhrases(usage: CategoryUsage): string[] {
  return BLOCKERS.flatMap(([key, singular, plural]) => {
    const count = usage[key];
    return count > 0 ? [`${count} ${count === 1 ? singular : plural}`] : [];
  });
}

function txPhrase(count: number): string {
  return `${count} transaction${count === 1 ? "" : "s"} will become uncategorized.`;
}

export function describeCategoryDelete(usage: CategoryUsage | undefined): DeleteConsequence {
  if (usage) {
    const phrases = blockerPhrases(usage);
    if (phrases.length > 0) {
      return {
        blocked: true,
        message: `Can't delete this category yet — it's used by ${phrases.join(" and ")}. Remove those first.`,
      };
    }
    if (usage.transactions > 0) {
      return { blocked: false, message: `This will permanently delete this category. ${txPhrase(usage.transactions)}` };
    }
  }
  return { blocked: false, message: "This will permanently delete this category." };
}

export function describeGroupDelete(
  group: CategoryGroup | undefined,
  usageMap: CategoryUsageMap | undefined,
): DeleteConsequence {
  const base = "This will permanently delete this group and all its categories.";
  if (!group || !usageMap) return { blocked: false, message: base };
  const blockedNames = group.categories
    .filter((cat) => usageMap[cat.id] && blockerPhrases(usageMap[cat.id]).length > 0)
    .map((cat) => `'${cat.name}'`);
  if (blockedNames.length > 0) {
    return {
      blocked: true,
      message:
        `Can't delete this group yet — ${blockedNames.join(", ")} ` +
        `${blockedNames.length === 1 ? "is" : "are"} still used by budgets, rules, payees, or recurring items. Remove those first.`,
    };
  }
  const transactions = group.categories.reduce((sum, cat) => sum + (usageMap[cat.id]?.transactions ?? 0), 0);
  if (transactions > 0) return { blocked: false, message: `${base} ${txPhrase(transactions)}` };
  return { blocked: false, message: base };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run "src/app/(app)/categories"`
Expected: all pass. Also run `cd frontend && npm run lint` — clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/api/categories.ts "frontend/src/app/(app)/categories/delete-consequences.ts" "frontend/src/app/(app)/categories/delete-consequences.test.ts"
git commit -m "feat(categories): usage/reorder API bindings and delete-consequence messages"
```

---

### Task 8: Collapsed-groups hook (fixes expand-state reset bug)

**Files:**
- Create: `frontend/src/app/(app)/categories/use-collapsed-groups.ts`
- Test: `frontend/src/app/(app)/categories/use-collapsed-groups.test.ts`

**Interfaces:**
- Produces: `useCollapsedGroups(): { isExpanded(id): boolean; toggle(id): void; collapseAll(ids: string[]): void; expandAll(): void }`. Stores **collapsed** ids in localStorage key `categories_collapsed_groups` — groups are expanded by default, so new groups start expanded and refetches can never clobber state (root cause of bug #3).

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/app/(app)/categories/use-collapsed-groups.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useCollapsedGroups } from "./use-collapsed-groups";

const KEY = "categories_collapsed_groups";

beforeEach(() => window.localStorage.clear());

describe("useCollapsedGroups", () => {
  it("expands unknown groups by default", () => {
    const { result } = renderHook(() => useCollapsedGroups());
    expect(result.current.isExpanded("never-seen")).toBe(true);
  });

  it("toggle collapses, persists, and toggles back", () => {
    const { result } = renderHook(() => useCollapsedGroups());
    act(() => result.current.toggle("g1"));
    expect(result.current.isExpanded("g1")).toBe(false);
    expect(JSON.parse(window.localStorage.getItem(KEY)!)).toContain("g1");
    act(() => result.current.toggle("g1"));
    expect(result.current.isExpanded("g1")).toBe(true);
  });

  it("restores collapsed state from storage", () => {
    window.localStorage.setItem(KEY, JSON.stringify(["g2"]));
    const { result } = renderHook(() => useCollapsedGroups());
    expect(result.current.isExpanded("g2")).toBe(false);
    expect(result.current.isExpanded("g1")).toBe(true);
  });

  it("survives corrupted storage", () => {
    window.localStorage.setItem(KEY, "not-json{");
    const { result } = renderHook(() => useCollapsedGroups());
    expect(result.current.isExpanded("g1")).toBe(true);
  });

  it("collapseAll and expandAll", () => {
    const { result } = renderHook(() => useCollapsedGroups());
    act(() => result.current.collapseAll(["a", "b"]));
    expect(result.current.isExpanded("a")).toBe(false);
    expect(result.current.isExpanded("b")).toBe(false);
    act(() => result.current.expandAll());
    expect(result.current.isExpanded("a")).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run "src/app/(app)/categories"`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `frontend/src/app/(app)/categories/use-collapsed-groups.ts`:

```ts
"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "categories_collapsed_groups";

function readStored(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

/**
 * Stores which groups are COLLAPSED (not expanded): groups are expanded by
 * default, so newly created groups start open and data refetches can never
 * clobber the user's state.
 */
export function useCollapsedGroups() {
  const [collapsed, setCollapsed] = useState<Set<string>>(readStored);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...collapsed]));
    } catch {
      // Storage unavailable (private mode/quota); in-memory state still works.
    }
  }, [collapsed]);

  const isExpanded = useCallback((id: string) => !collapsed.has(id), [collapsed]);

  const toggle = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const collapseAll = useCallback((ids: string[]) => setCollapsed(new Set(ids)), []);
  const expandAll = useCallback(() => setCollapsed(new Set()), []);

  return { isExpanded, toggle, collapseAll, expandAll };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run "src/app/(app)/categories"`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add "frontend/src/app/(app)/categories/use-collapsed-groups.ts" "frontend/src/app/(app)/categories/use-collapsed-groups.test.ts"
git commit -m "fix(categories): collapsed-ids hook replaces reset-prone expand effect"
```

---

### Task 9: Component split + mutation/a11y bug fixes

**Files:**
- Create: `frontend/src/app/(app)/categories/group-item.tsx`
- Create: `frontend/src/app/(app)/categories/category-item.tsx`
- Modify: `frontend/src/app/(app)/categories/page.tsx` (full rewrite)
- Test: `frontend/src/app/(app)/categories/group-item.test.tsx`

**Interfaces:**
- Consumes: `useCollapsedGroups` (Task 8).
- Produces:
  - `GroupItem({ group, expanded, onToggle, onRequestDelete, onRequestDeleteCategory })` — owns the add-category mutation.
  - `CategoryItem({ category, onRequestDelete })` (extended in Tasks 10–12).
  - Fixes bugs #2 (silent delete), #3 (expand reset), #4 (double submit), #5 (lost input), #6 (a11y).

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/app/(app)/categories/group-item.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GroupItem } from "./group-item";
import { categoriesApi, type CategoryGroup } from "@/lib/api/categories";

vi.mock("@/lib/api/categories", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/categories")>();
  return {
    ...actual,
    categoriesApi: { ...actual.categoriesApi, create: vi.fn() },
  };
});

const group: CategoryGroup = {
  id: "g1", household_id: "h1", name: "Everyday", sort_order: 0,
  is_income: false, created_at: "2026-01-01T00:00:00Z",
  categories: [{
    id: "c1", group_id: "g1", name: "Groceries", sort_order: 0,
    goal_type: "none", goal_amount: null, goal_target_date: null,
    created_at: "2026-01-01T00:00:00Z",
  }],
};

function renderGroup(over: Partial<Parameters<typeof GroupItem>[0]> = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <GroupItem
        group={group}
        expanded
        onToggle={() => {}}
        onRequestDelete={() => {}}
        onRequestDeleteCategory={() => {}}
        {...over}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.mocked(categoriesApi.create).mockReset());

describe("GroupItem", () => {
  it("marks the header toggle with aria-expanded and hides categories when collapsed", () => {
    renderGroup({ expanded: false });
    // ^Everyday: the delete/add buttons' aria-labels also contain the group
    // name but start with "Delete"/"Add", so anchor to the toggle only.
    const toggle = screen.getByRole("button", { name: /^Everyday/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Groceries")).not.toBeInTheDocument();
  });

  it("does not submit a whitespace-only category name", () => {
    renderGroup();
    const input = screen.getByPlaceholderText("Add category...");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(categoriesApi.create).not.toHaveBeenCalled();
  });

  it("keeps the typed name when the create request fails", async () => {
    vi.mocked(categoriesApi.create).mockRejectedValue(new Error("boom"));
    renderGroup();
    const input = screen.getByPlaceholderText("Add category...");
    fireEvent.change(input, { target: { value: "Coffee" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(categoriesApi.create).toHaveBeenCalledOnce());
    expect((input as HTMLInputElement).value).toBe("Coffee");
  });

  it("clears the input only after a successful create", async () => {
    vi.mocked(categoriesApi.create).mockResolvedValue({
      id: "c2", group_id: "g1", name: "Coffee", sort_order: 1,
      goal_type: "none", goal_amount: null, goal_target_date: null,
      created_at: "2026-01-01T00:00:00Z",
    });
    renderGroup();
    const input = screen.getByPlaceholderText("Add category...");
    fireEvent.change(input, { target: { value: "Coffee" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect((input as HTMLInputElement).value).toBe(""));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run "src/app/(app)/categories"`
Expected: FAIL — `./group-item` not found.

- [ ] **Step 3: Implement the three files**

Create `frontend/src/app/(app)/categories/category-item.tsx`:

```tsx
"use client";

import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import type { Category } from "@/lib/api/categories";

export function CategoryItem({
  category,
  onRequestDelete,
}: {
  category: Category;
  onRequestDelete: (id: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded px-3 py-1.5 hover:bg-muted">
      <span className="text-sm">{category.name}</span>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 text-muted-foreground hover:text-destructive"
        aria-label={`Delete category ${category.name}`}
        onClick={() => onRequestDelete(category.id)}
      >
        <Trash2 className="h-3 w-3" />
      </Button>
    </div>
  );
}
```

Create `frontend/src/app/(app)/categories/group-item.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { categoriesApi, type CategoryGroup } from "@/lib/api/categories";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { appToast } from "@/lib/app-toast";
import { toastApiError } from "@/lib/toast-error";
import { CategoryItem } from "./category-item";

export function GroupItem({
  group,
  expanded,
  onToggle,
  onRequestDelete,
  onRequestDeleteCategory,
}: {
  group: CategoryGroup;
  expanded: boolean;
  onToggle: () => void;
  onRequestDelete: () => void;
  onRequestDeleteCategory: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const [newCat, setNewCat] = useState("");

  const createCatMutation = useMutation({
    mutationFn: categoriesApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categoryGroups"] });
      appToast.success("Category created");
      setNewCat("");
    },
    onError: (e) => toastApiError("Failed to create category", e),
  });

  const submitNewCat = () => {
    const name = newCat.trim();
    if (!name || createCatMutation.isPending) return;
    createCatMutation.mutate({ group_id: group.id, name });
  };

  return (
    <div className="rounded-lg border">
      <div className="flex items-center justify-between p-3 hover:bg-accent/50">
        <button
          type="button"
          className="flex flex-1 items-center gap-2 text-left"
          aria-expanded={expanded}
          onClick={onToggle}
        >
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <span className="font-medium">{group.name}</span>
          {group.is_income && <Badge variant="outline" className="text-xs">Income</Badge>}
          <span className="text-xs text-muted-foreground">
            {group.categories.length} {group.categories.length === 1 ? "category" : "categories"}
          </span>
        </button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-destructive"
          aria-label={`Delete group ${group.name}`}
          onClick={onRequestDelete}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
      {expanded && (
        <div className="space-y-1 border-t px-3 pb-3 pt-2">
          {group.categories.length === 0 && (
            <p className="px-3 py-1.5 text-sm text-muted-foreground">No categories yet.</p>
          )}
          {group.categories.map((cat) => (
            <CategoryItem key={cat.id} category={cat} onRequestDelete={onRequestDeleteCategory} />
          ))}
          <div className="flex items-center gap-2 pt-1">
            <Input
              className="h-8 text-sm"
              placeholder="Add category..."
              value={newCat}
              onChange={(e) => setNewCat(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitNewCat();
              }}
            />
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              aria-label={`Add category to ${group.name}`}
              disabled={!newCat.trim() || createCatMutation.isPending}
              onClick={submitNewCat}
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
```

Replace `frontend/src/app/(app)/categories/page.tsx` entirely:

```tsx
"use client";

import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { categoriesApi, type CategoryGroup } from "@/lib/api/categories";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus } from "lucide-react";
import { appToast } from "@/lib/app-toast";
import { useIsClient } from "@/lib/hooks";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PageHeader, QueryState, inlineErrorQueryMeta } from "@/components/page";
import { SkeletonTable } from "@/components/skeleton-table";
import { toastApiError } from "@/lib/toast-error";
import { GroupItem } from "./group-item";
import { useCollapsedGroups } from "./use-collapsed-groups";

function CategoriesContent() {
  const [deleteGroupId, setDeleteGroupId] = useState<string | null>(null);
  const [deleteCatId, setDeleteCatId] = useState<string | null>(null);
  const [newGroup, setNewGroup] = useState("");

  const queryClient = useQueryClient();
  const isClient = useIsClient();
  const groupInputRef = useRef<HTMLInputElement>(null);
  const { isExpanded, toggle } = useCollapsedGroups();

  const { data: groups = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ["categoryGroups"],
    queryFn: categoriesApi.listGroups,
    enabled: isClient,
    meta: inlineErrorQueryMeta,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["categoryGroups"] });
    queryClient.invalidateQueries({ queryKey: ["categoryUsage"] });
  };

  const createGroupMutation = useMutation({
    mutationFn: categoriesApi.createGroup,
    onSuccess: () => {
      invalidate();
      appToast.success("Group created");
      setNewGroup("");
    },
    onError: (e) => toastApiError("Failed to create group", e),
  });

  const deleteGroupMutation = useMutation({
    mutationFn: categoriesApi.deleteGroup,
    onSuccess: () => {
      invalidate();
      appToast.success("Group deleted");
    },
    onError: (e) => toastApiError("Failed to delete group", e),
  });

  const deleteCatMutation = useMutation({
    mutationFn: categoriesApi.delete,
    onSuccess: () => {
      invalidate();
      appToast.success("Category deleted");
    },
    onError: (e) => toastApiError("Failed to delete category", e),
  });

  const submitNewGroup = () => {
    const name = newGroup.trim();
    if (!name || createGroupMutation.isPending) return;
    createGroupMutation.mutate({ name });
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Categories" description="Organize income and spending with groups and categories." />

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Input
              ref={groupInputRef}
              placeholder="New category group..."
              value={newGroup}
              onChange={(e) => setNewGroup(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitNewGroup();
              }}
            />
            <Button
              size="sm"
              aria-label="Create group"
              disabled={!newGroup.trim() || createGroupMutation.isPending}
              onClick={submitNewGroup}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <QueryState
            isLoading={isLoading && !groups.length}
            isError={isError}
            error={error}
            onRetry={() => refetch()}
            isEmpty={!isLoading && groups.length === 0}
            emptyTitle="No category groups yet"
            emptyDescription="Create a group above to start organizing transactions."
            emptyAction={
              <Button type="button" variant="outline" size="sm" onClick={() => groupInputRef.current?.focus()}>
                Name your first group
              </Button>
            }
            loadingFallback={<SkeletonTable rows={4} columns={2} />}
          >
            {groups.map((group: CategoryGroup) => (
              <GroupItem
                key={group.id}
                group={group}
                expanded={isExpanded(group.id)}
                onToggle={() => toggle(group.id)}
                onRequestDelete={() => setDeleteGroupId(group.id)}
                onRequestDeleteCategory={setDeleteCatId}
              />
            ))}
          </QueryState>
        </CardContent>
      </Card>
      <ConfirmDialog
        open={!!deleteGroupId}
        onOpenChange={(open) => { if (!open) setDeleteGroupId(null); }}
        title="Delete Category Group"
        description="This will permanently delete this group and all its categories."
        onConfirm={() => { if (deleteGroupId) deleteGroupMutation.mutate(deleteGroupId); }}
      />
      <ConfirmDialog
        open={!!deleteCatId}
        onOpenChange={(open) => { if (!open) setDeleteCatId(null); }}
        title="Delete Category"
        description="This will permanently delete this category."
        onConfirm={() => { if (deleteCatId) deleteCatMutation.mutate(deleteCatId); }}
      />
    </div>
  );
}

export default function CategoriesPage() {
  return <CategoriesContent />;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run "src/app/(app)/categories"` — all pass.
Run: `cd frontend && npm run lint` — clean.
Run: `cd frontend && npm run test:run` — full suite passes (nothing else imports this page).

- [ ] **Step 5: Commit**

```bash
git add "frontend/src/app/(app)/categories/"
git commit -m "fix(categories): silent deletes, double-submit, lost input, expand reset, a11y"
```

---

### Task 10: Row menus — rename, income toggle, move to group

**Files:**
- Modify: `frontend/src/app/(app)/categories/category-item.tsx` (full rewrite below)
- Modify: `frontend/src/app/(app)/categories/group-item.tsx`
- Modify: `frontend/src/app/(app)/categories/page.tsx` (pass `groups` down)
- Test: `frontend/src/app/(app)/categories/category-item.test.tsx`

**Interfaces:**
- Consumes: `categoriesApi.update(id, {name?|group_id?})`, `categoriesApi.updateGroup(id, {name?|is_income?})` (Task 7 types).
- Produces: `CategoryItem({ category, groups, onRequestDelete })`; `GroupItem` gains a `groups: CategoryGroup[]` prop and passes it through. Both rows get a `⋯` DropdownMenu; rename is inline (Enter commits, Escape cancels, blur commits — same pattern as the budget page's assigned-cell editor).

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/app/(app)/categories/category-item.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CategoryItem } from "./category-item";
import { categoriesApi, type Category, type CategoryGroup } from "@/lib/api/categories";

vi.mock("@/lib/api/categories", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/categories")>();
  return {
    ...actual,
    categoriesApi: { ...actual.categoriesApi, update: vi.fn() },
  };
});

// Radix menus need pointer-capture APIs that jsdom lacks.
beforeAll(() => {
  Object.assign(window.HTMLElement.prototype, {
    hasPointerCapture: () => false,
    setPointerCapture: () => {},
    releasePointerCapture: () => {},
  });
});

const category: Category = {
  id: "c1", group_id: "g1", name: "Groceries", sort_order: 0,
  goal_type: "none", goal_amount: null, goal_target_date: null,
  created_at: "2026-01-01T00:00:00Z",
};

const groups: CategoryGroup[] = [
  { id: "g1", household_id: "h1", name: "Everyday", sort_order: 0, is_income: false, created_at: "2026-01-01T00:00:00Z", categories: [category] },
  { id: "g2", household_id: "h1", name: "Bills", sort_order: 1, is_income: false, created_at: "2026-01-01T00:00:00Z", categories: [] },
];

function renderItem(onRequestDelete = vi.fn()) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <CategoryItem category={category} groups={groups} onRequestDelete={onRequestDelete} />
    </QueryClientProvider>,
  );
  return { onRequestDelete };
}

async function openMenu() {
  const trigger = screen.getByRole("button", { name: /Category actions for Groceries/ });
  fireEvent.pointerDown(trigger);
  fireEvent.click(trigger);
  await screen.findByRole("menu");
}

beforeEach(() => vi.mocked(categoriesApi.update).mockReset());

describe("CategoryItem", () => {
  it("renames inline via the menu and commits on Enter", async () => {
    vi.mocked(categoriesApi.update).mockResolvedValue({ ...category, name: "Food" });
    renderItem();
    await openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const input = await screen.findByRole("textbox", { name: /Rename category Groceries/ });
    fireEvent.change(input, { target: { value: "Food" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(categoriesApi.update).toHaveBeenCalledWith("c1", { name: "Food" }),
    );
  });

  it("cancels rename on Escape without calling the API", async () => {
    renderItem();
    await openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const input = await screen.findByRole("textbox", { name: /Rename category Groceries/ });
    fireEvent.change(input, { target: { value: "Nope" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(categoriesApi.update).not.toHaveBeenCalled();
    expect(screen.getByText("Groceries")).toBeInTheDocument();
  });

  it("offers Move to for other groups only", async () => {
    renderItem();
    await openMenu();
    expect(screen.getByText("Move to")).toBeInTheDocument();
  });

  it("delete menu item defers to onRequestDelete", async () => {
    const { onRequestDelete } = renderItem();
    await openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(onRequestDelete).toHaveBeenCalledWith("c1");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run "src/app/(app)/categories"`
Expected: FAIL — `CategoryItem` doesn't accept `groups`, has no menu.
(If the Radix menu does not open with `pointerDown` + `click` on your Radix version, open it with `fireEvent.keyDown(trigger, { key: "Enter" })` instead — adjust the helper, not the component.)

- [ ] **Step 3: Implement**

Replace `frontend/src/app/(app)/categories/category-item.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { categoriesApi, type Category, type CategoryGroup } from "@/lib/api/categories";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal } from "lucide-react";
import { appToast } from "@/lib/app-toast";
import { toastApiError } from "@/lib/toast-error";

export function CategoryItem({
  category,
  groups,
  onRequestDelete,
}: {
  category: Category;
  groups: CategoryGroup[];
  onRequestDelete: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(category.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [renaming]);

  const updateMutation = useMutation({
    mutationFn: (data: Partial<{ name: string; group_id: string }>) =>
      categoriesApi.update(category.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categoryGroups"] });
      appToast.success("Category updated");
      setRenaming(false);
    },
    onError: (e) => toastApiError("Failed to update category", e),
  });

  const commitRename = () => {
    const name = draft.trim();
    if (!name || name === category.name) {
      setRenaming(false);
      setDraft(category.name);
      return;
    }
    if (!updateMutation.isPending) updateMutation.mutate({ name });
  };

  const otherGroups = groups.filter((g) => g.id !== category.group_id);

  return (
    <div className="flex items-center justify-between gap-2 rounded px-3 py-1.5 hover:bg-muted">
      {renaming ? (
        <Input
          ref={inputRef}
          className="h-7 text-sm"
          value={draft}
          aria-label={`Rename category ${category.name}`}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") {
              setRenaming(false);
              setDraft(category.name);
            }
          }}
        />
      ) : (
        <span className="text-sm">{category.name}</span>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground"
            aria-label={`Category actions for ${category.name}`}
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() => {
              setDraft(category.name);
              setRenaming(true);
            }}
          >
            Rename
          </DropdownMenuItem>
          {otherGroups.length > 0 && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Move to</DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent>
                  {otherGroups.map((g) => (
                    <DropdownMenuItem key={g.id} onSelect={() => updateMutation.mutate({ group_id: g.id })}>
                      {g.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={() => onRequestDelete(category.id)}
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
```

In `frontend/src/app/(app)/categories/group-item.tsx`:

1. Add prop `groups: CategoryGroup[]` (after `group`) and pass `groups={groups}` to each `CategoryItem`.
2. Add group rename + income toggle. Add imports (`useEffect`, `useRef`, DropdownMenu parts as in CategoryItem, `MoreHorizontal`), state, and mutation inside the component:

```tsx
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(group.name);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renaming]);

  const updateGroupMutation = useMutation({
    mutationFn: (data: Partial<{ name: string; is_income: boolean }>) =>
      categoriesApi.updateGroup(group.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categoryGroups"] });
      appToast.success("Group updated");
      setRenaming(false);
    },
    onError: (e) => toastApiError("Failed to update group", e),
  });

  const commitRename = () => {
    const name = draft.trim();
    if (!name || name === group.name) {
      setRenaming(false);
      setDraft(group.name);
      return;
    }
    if (!updateGroupMutation.isPending) updateGroupMutation.mutate({ name });
  };
```

3. In the header JSX, when `renaming`, render the rename `Input` (aria-label `` `Rename group ${group.name}` ``, same onBlur/onKeyDown pattern as CategoryItem) **in place of the toggle button**; otherwise render the toggle button as before.
4. Replace the trash `Button` with a `⋯` menu (trigger aria-label `` `Group actions for ${group.name}` ``):

```tsx
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground"
              aria-label={`Group actions for ${group.name}`}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() => {
                setDraft(group.name);
                setRenaming(true);
              }}
            >
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => updateGroupMutation.mutate({ is_income: !group.is_income })}>
              {group.is_income ? "Mark as spending" : "Mark as income"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={onRequestDelete}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
```

Remove the now-unused `Trash2` import from both files.

In `page.tsx`, pass `groups={groups}` to `GroupItem`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run "src/app/(app)/categories"` — all pass (Task 9's GroupItem tests need `groups={[group]}` added to the render helper — update them).
Run: `cd frontend && npm run lint` — clean.

- [ ] **Step 5: Commit**

```bash
git add "frontend/src/app/(app)/categories/"
git commit -m "feat(categories): row menus with inline rename, income toggle, move-to-group"
```

---

### Task 11: Usage display + consequence-aware delete dialogs

**Files:**
- Modify: `frontend/src/components/confirm-dialog.tsx` (add `confirmDisabled`)
- Modify: `frontend/src/app/(app)/categories/page.tsx`
- Modify: `frontend/src/app/(app)/categories/group-item.tsx`, `category-item.tsx` (usage prop)
- Test: `frontend/src/app/(app)/categories/category-item.test.tsx`

**Interfaces:**
- Consumes: `categoriesApi.usage`, `describeCategoryDelete`, `describeGroupDelete` (Task 7).
- Produces: `ConfirmDialog` accepts optional `confirmDisabled?: boolean`; `CategoryItem` accepts optional `usage?: CategoryUsage` and renders a muted "N txns" hint; `GroupItem` accepts optional `usage?: CategoryUsageMap` and passes per-category usage down.

- [ ] **Step 1: Write the failing test** (append to `category-item.test.tsx`)

```tsx
  it("shows a muted transaction-count hint", () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={qc}>
        <CategoryItem
          category={category}
          groups={groups}
          usage={{ transactions: 14, budget_entries: 0, rules: 0, payees: 0, recurring: 0 }}
          onRequestDelete={vi.fn()}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByText("14 txns")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run "src/app/(app)/categories"`
Expected: FAIL — no `usage` prop, no hint.

- [ ] **Step 3: Implement**

`frontend/src/components/confirm-dialog.tsx`: add `confirmDisabled?: boolean;` to the props interface (after `closeOnConfirm`), destructure with default `confirmDisabled = false`, and change the action button to `disabled={loading || confirmDisabled}`. Nothing else changes; existing callers are unaffected.

`category-item.tsx`: add `usage?: CategoryUsage` to props (`import type { CategoryUsage }`), and render the hint next to the name (inside the non-renaming branch):

```tsx
      ) : (
        <span className="flex items-baseline gap-2 text-sm">
          {category.name}
          {usage && usage.transactions > 0 && (
            <span className="text-xs text-muted-foreground">
              {usage.transactions} txn{usage.transactions === 1 ? "" : "s"}
            </span>
          )}
        </span>
      )}
```

`group-item.tsx`: add `usage?: CategoryUsageMap` prop (`import type { CategoryUsageMap }`) and pass `usage={usage?.[cat.id]}` to each `CategoryItem`.

`page.tsx`: add the usage query and consequence-driven dialogs:

```tsx
import { describeCategoryDelete, describeGroupDelete } from "./delete-consequences";
```

```tsx
  const { data: usage } = useQuery({
    queryKey: ["categoryUsage"],
    queryFn: categoriesApi.usage,
    enabled: isClient,
  });
```

Before the return statement:

```tsx
  const groupPendingDelete = groups.find((g) => g.id === deleteGroupId);
  const groupConsequence = describeGroupDelete(groupPendingDelete, usage);
  const catConsequence = describeCategoryDelete(deleteCatId ? usage?.[deleteCatId] : undefined);
```

Pass `usage={usage}` to `GroupItem`, and update the dialogs:

```tsx
      <ConfirmDialog
        open={!!deleteGroupId}
        onOpenChange={(open) => { if (!open) setDeleteGroupId(null); }}
        title="Delete Category Group"
        description={groupConsequence.message}
        confirmDisabled={groupConsequence.blocked}
        onConfirm={() => { if (deleteGroupId) deleteGroupMutation.mutate(deleteGroupId); }}
      />
      <ConfirmDialog
        open={!!deleteCatId}
        onOpenChange={(open) => { if (!open) setDeleteCatId(null); }}
        title="Delete Category"
        description={catConsequence.message}
        confirmDisabled={catConsequence.blocked}
        onConfirm={() => { if (deleteCatId) deleteCatMutation.mutate(deleteCatId); }}
      />
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run "src/app/(app)/categories"` — all pass.
Run: `cd frontend && npm run test:run` — full suite passes (confirm-dialog change is additive).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/confirm-dialog.tsx "frontend/src/app/(app)/categories/"
git commit -m "feat(categories): usage hints and consequence-aware delete confirmations"
```

---

### Task 12: Drag-to-reorder with dnd-kit

**Files:**
- Modify: `frontend/package.json` (+ lockfile, via npm install)
- Create: `frontend/src/app/(app)/categories/reorder.ts`
- Test: `frontend/src/app/(app)/categories/reorder.test.ts`
- Modify: `frontend/src/app/(app)/categories/page.tsx`, `group-item.tsx`, `category-item.tsx`
- Modify: `frontend/src/app/(app)/categories/group-item.test.tsx`, `category-item.test.tsx` (wrap renders in DndContext)

**Interfaces:**
- Consumes: `categoriesApi.reorderGroups`, `categoriesApi.reorderCategories` (Task 7).
- Produces: `moveGroup(groups, activeId, overId): CategoryGroup[] | null` and `moveCategory(groups, groupId, activeId, overId): CategoryGroup[] | null` (null = no-op, e.g. cross-group drag). Groups sortable; categories sortable within their own group; optimistic cache update, server truth restored via invalidate on settle.

- [ ] **Step 1: Install the dependency**

```bash
cd frontend && npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

Verify `package.json` gained the three deps and `package-lock.json` updated (commit both at the end of this task).

- [ ] **Step 2: Write the failing tests**

Create `frontend/src/app/(app)/categories/reorder.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { moveGroup, moveCategory } from "./reorder";
import type { CategoryGroup } from "@/lib/api/categories";

const cat = (id: string, group_id: string) => ({
  id, group_id, name: id, sort_order: 0, goal_type: "none",
  goal_amount: null, goal_target_date: null, created_at: "2026-01-01T00:00:00Z",
});

const grp = (id: string, catIds: string[] = []): CategoryGroup => ({
  id, household_id: "h1", name: id, sort_order: 0, is_income: false,
  created_at: "2026-01-01T00:00:00Z", categories: catIds.map((c) => cat(c, id)),
});

describe("moveGroup", () => {
  it("moves a group to the target position", () => {
    const next = moveGroup([grp("a"), grp("b"), grp("c")], "c", "a");
    expect(next!.map((g) => g.id)).toEqual(["c", "a", "b"]);
  });
  it("returns null for unknown ids or same position", () => {
    const groups = [grp("a"), grp("b")];
    expect(moveGroup(groups, "zzz", "a")).toBeNull();
    expect(moveGroup(groups, "a", "a")).toBeNull();
  });
});

describe("moveCategory", () => {
  it("reorders within the group without touching others", () => {
    const groups = [grp("g1", ["x", "y", "z"]), grp("g2", ["q"])];
    const next = moveCategory(groups, "g1", "z", "x");
    expect(next![0].categories.map((c) => c.id)).toEqual(["z", "x", "y"]);
    expect(next![1]).toBe(groups[1]);
  });
  it("returns null when the target is not in the group (cross-group drag)", () => {
    const groups = [grp("g1", ["x"]), grp("g2", ["q"])];
    expect(moveCategory(groups, "g1", "x", "q")).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd frontend && npx vitest run "src/app/(app)/categories"`
Expected: FAIL — `./reorder` not found.

- [ ] **Step 4: Implement `reorder.ts`**

```ts
import { arrayMove } from "@dnd-kit/sortable";
import type { CategoryGroup } from "@/lib/api/categories";

/** Returns the reordered group list, or null when the drag is a no-op. */
export function moveGroup(
  groups: CategoryGroup[],
  activeId: string,
  overId: string,
): CategoryGroup[] | null {
  const from = groups.findIndex((g) => g.id === activeId);
  const to = groups.findIndex((g) => g.id === overId);
  if (from < 0 || to < 0 || from === to) return null;
  return arrayMove(groups, from, to);
}

/** Reorders a category within its group; null for cross-group or unknown ids. */
export function moveCategory(
  groups: CategoryGroup[],
  groupId: string,
  activeId: string,
  overId: string,
): CategoryGroup[] | null {
  const groupIndex = groups.findIndex((g) => g.id === groupId);
  if (groupIndex < 0) return null;
  const cats = groups[groupIndex].categories;
  const from = cats.findIndex((c) => c.id === activeId);
  const to = cats.findIndex((c) => c.id === overId);
  if (from < 0 || to < 0 || from === to) return null;
  const next = [...groups];
  next[groupIndex] = { ...groups[groupIndex], categories: arrayMove(cats, from, to) };
  return next;
}
```

Run: `cd frontend && npx vitest run "src/app/(app)/categories"` — reorder tests pass.

- [ ] **Step 5: Wire dnd into the components**

`page.tsx` — add imports:

```tsx
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { moveGroup, moveCategory } from "./reorder";
```

Inside `CategoriesContent`:

```tsx
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const reorderGroupsMutation = useMutation({
    mutationFn: categoriesApi.reorderGroups,
    onError: (e) => toastApiError("Failed to reorder groups", e),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["categoryGroups"] }),
  });

  const reorderCatsMutation = useMutation({
    mutationFn: ({ group_id, ordered_ids }: { group_id: string; ordered_ids: string[] }) =>
      categoriesApi.reorderCategories(group_id, ordered_ids),
    onError: (e) => toastApiError("Failed to reorder categories", e),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["categoryGroups"] }),
  });

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const data = active.data.current as
      | { type: "group" }
      | { type: "category"; groupId: string }
      | undefined;
    if (!data) return;
    if (data.type === "group") {
      const next = moveGroup(groups, String(active.id), String(over.id));
      if (!next) return;
      queryClient.setQueryData(["categoryGroups"], next);
      reorderGroupsMutation.mutate(next.map((g) => g.id));
    } else {
      const next = moveCategory(groups, data.groupId, String(active.id), String(over.id));
      if (!next) return;
      queryClient.setQueryData(["categoryGroups"], next);
      const target = next.find((g) => g.id === data.groupId);
      if (target) {
        reorderCatsMutation.mutate({
          group_id: data.groupId,
          ordered_ids: target.categories.map((c) => c.id),
        });
      }
    }
  };
```

Wrap the group list (inside `QueryState`):

```tsx
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={groups.map((g) => g.id)} strategy={verticalListSortingStrategy}>
                {groups.map((group: CategoryGroup) => (
                  <GroupItem ... unchanged props ... />
                ))}
              </SortableContext>
            </DndContext>
```

`group-item.tsx` — add:

```tsx
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
```

```tsx
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: group.id,
    data: { type: "group" },
  });
```

Root div becomes:

```tsx
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("rounded-lg border bg-background", isDragging && "opacity-70")}
    >
```

Add the drag handle as the first element in the header row (before the toggle button):

```tsx
        <button
          type="button"
          className="cursor-grab touch-none p-1 text-muted-foreground"
          aria-label={`Reorder group ${group.name}`}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
```

Wrap the category list in a per-group sortable context:

```tsx
          <SortableContext items={group.categories.map((c) => c.id)} strategy={verticalListSortingStrategy}>
            {group.categories.map((cat) => (
              <CategoryItem key={cat.id} category={cat} groups={groups} usage={usage?.[cat.id]} onRequestDelete={onRequestDeleteCategory} />
            ))}
          </SortableContext>
```

`category-item.tsx` — same pattern: `useSortable({ id: category.id, data: { type: "category", groupId: category.group_id } })`, `ref={setNodeRef}` + transform/transition style + `isDragging && "opacity-70"` on the root div, and a `GripVertical` handle button (aria-label `` `Reorder category ${category.name}` ``, class `cursor-grab touch-none p-0.5 text-muted-foreground`) as the first child.

Update both component test files: wrap the rendered tree in `<DndContext>` (import from `@dnd-kit/core`) inside the QueryClientProvider — `useSortable` requires it.

- [ ] **Step 6: Run tests, lint, commit**

Run: `cd frontend && npx vitest run "src/app/(app)/categories"` — all pass.
Run: `cd frontend && npm run lint` — clean.

```bash
git add frontend/package.json frontend/package-lock.json "frontend/src/app/(app)/categories/"
git commit -m "feat(categories): drag-to-reorder groups and categories via dnd-kit"
```

---

### Task 13: Header controls — expand/collapse all, income checkbox

**Files:**
- Modify: `frontend/src/app/(app)/categories/page.tsx`

**Interfaces:**
- Consumes: `collapseAll`/`expandAll` from `useCollapsedGroups` (Task 8); `createGroup`'s existing `is_income` parameter.

- [ ] **Step 1: Implement**

In `page.tsx`, destructure the full hook: `const { isExpanded, toggle, collapseAll, expandAll } = useCollapsedGroups();` and add state `const [newGroupIncome, setNewGroupIncome] = useState(false);`.

Change `submitNewGroup` to `createGroupMutation.mutate({ name, is_income: newGroupIncome });` and add `setNewGroupIncome(false);` next to `setNewGroup("");` in `onSuccess`.

Add the toggle-all control to the page header:

```tsx
  const anyCollapsed = groups.some((g) => !isExpanded(g.id));
```

```tsx
      <PageHeader
        title="Categories"
        description="Organize income and spending with groups and categories."
        actions={
          <Button
            variant="outline"
            size="sm"
            disabled={groups.length === 0}
            onClick={() => (anyCollapsed ? expandAll() : collapseAll(groups.map((g) => g.id)))}
          >
            {anyCollapsed ? "Expand all" : "Collapse all"}
          </Button>
        }
      />
```

Add the income checkbox between the Input and the + Button in the quick-add row:

```tsx
            <label className="flex items-center gap-1.5 whitespace-nowrap text-sm text-muted-foreground">
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={newGroupIncome}
                onChange={(e) => setNewGroupIncome(e.target.checked)}
              />
              Income
            </label>
```

- [ ] **Step 2: Verify**

Run: `cd frontend && npx vitest run "src/app/(app)/categories"` — all pass.
Run: `cd frontend && npm run lint` — clean.
(If `PageHeader` should reject an `actions` prop, check `frontend/src/components/page/page-header.tsx` — the payees page already passes `actions`, so it exists.)

- [ ] **Step 3: Commit**

```bash
git add "frontend/src/app/(app)/categories/page.tsx"
git commit -m "feat(categories): expand/collapse all and income-group quick-add"
```

---

### Task 14: Full CI gate + manual walkthrough

**Files:**
- None new; fix whatever the gate finds.

- [ ] **Step 1: Run the full CI gate**

Run from repo root: `./scripts/ci-local.sh`
Expected: backend pytest, frontend lint, Vitest, fallow dead-code, and build all pass. Fix any findings (likely candidates: unused imports, fallow flags on helpers if a task was skipped) and re-run until green.

- [ ] **Step 2: Manual walkthrough**

Start the app (backend: `docker compose up` or `cd backend && uvicorn app.main:app --reload`; frontend: `cd frontend && npm run dev`), open `http://localhost:3000/categories`, and verify:

1. Create a group; create a second with the Income checkbox → badge shows; both append at the bottom in creation order.
2. Press Enter twice fast on group create → only one group.
3. Add categories; typing whitespace only → button disabled, Enter no-ops.
4. Collapse a group, add a category in another group → collapsed group stays collapsed; reload the page → still collapsed.
5. Rename a group and a category (Enter commits, Escape cancels).
6. Mark a group as income/spending via the menu.
7. Move a category to another group via Move to ▸.
8. Drag-reorder groups and categories; reload → order persists.
9. Delete a category with transactions → dialog says "N transactions will become uncategorized"; confirm → gone; check the transactions page shows them uncategorized.
10. Try deleting a category referenced by a rule or budget entry → confirm button disabled with a clear reason; the backend 409 path can be checked with curl if desired.
11. Delete a group with unused categories → works (this 500'd before).
12. Keyboard-only: tab to a group header → Enter toggles; drag handles respond to keyboard (space to lift, arrows to move — dnd-kit default).

- [ ] **Step 3: Commit any fixes**

```bash
git add -u
git commit -m "chore(categories): CI-gate and walkthrough fixes"
```

(Skip the commit if there was nothing to fix.)
