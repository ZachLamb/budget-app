# Tax Deductions Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let households flag categories (and individual transactions) as tax-deductible with a percentage, then see a running deductions summary with an optional estimated-tax-savings and withholding nudge, all driven by manually entered rate settings.

**Architecture:** Additive columns on the existing `Category` and `Transaction` tables plus one new `TaxSettings` table (one row per household); a new read-only aggregation endpoint (`GET /deductions/summary`); a new frontend page that reuses the existing category-modal and settings-card patterns already in the codebase.

**Tech Stack:** FastAPI + SQLAlchemy (async) + Alembic on the backend; Next.js App Router + TanStack Query + shadcn/ui components on the frontend; pytest (backend) and Vitest (frontend) for tests.

**Spec:** `docs/superpowers/specs/2026-09-05-tax-deductions-design.md`

## Global Constraints

- All new DB fields are nullable / have safe defaults — no backfill migration needed, matches the pattern in `alembic/versions/0011_prefer_local_server.py`.
- Every mutating route must scope queries through `household_id` (see `get_household_id` in `app/api/deps.py`) — no cross-household leakage.
- No IRS bracket tables or filing-status logic — all rates are manually entered (spec: "Out of Scope").
- `estimated_tax_savings` and `suggested_withholding_reduction_per_period` must be **omitted from the response**, not zeroed, when their inputs are incomplete.
- Frontend must reuse `Household.pay_frequency` for display — do not add a duplicate pay-frequency field to `TaxSettings`.
- Follow the CLAUDE.md pre-PR gate: `cd backend && pytest -q` and `cd frontend && npm run lint && npm test -- --run && npm run build` must pass before considering any task's tests "done" doesn't require a full build per task, but the final task must run both.

---

### Task 1: Migration + models — `Category`, `Transaction`, `TaxSettings`

**Files:**
- Modify: `backend/app/models/category.py`
- Modify: `backend/app/models/transaction.py`
- Create: `backend/app/models/tax_settings.py`
- Modify: `backend/app/models/__init__.py`
- Create: `backend/alembic/versions/0012_tax_deductions.py`
- Test: `backend/tests/test_tax_deductions_models.py`

**Interfaces:**
- Produces: `Category.deductible: bool`, `Category.deduction_pct: Decimal`, `Category.tax_line: Optional[str]`; `Transaction.deduction_pct_override: Optional[Decimal]`; `TaxSettings` model with `id, household_id, marginal_federal_rate, marginal_state_rate, current_federal_withholding_per_period, remaining_pay_periods_this_year`.

- [ ] **Step 1: Write the failing model test**

```python
# backend/tests/test_tax_deductions_models.py
"""Model-level tests for the tax deductions columns and TaxSettings table."""
from __future__ import annotations

import uuid
from decimal import Decimal

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool
from sqlalchemy import select

from app.database import Base
from app.models import Category, CategoryGroup, Household, TaxSettings, Transaction, Account, User


@pytest_asyncio.fixture()
async def db_session():
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False)
    session = Session()
    try:
        yield session
    finally:
        await session.close()
        await engine.dispose()


@pytest.mark.asyncio
async def test_category_deduction_defaults(db_session):
    household = Household(id=str(uuid.uuid4()), name="H")
    db_session.add(household)
    await db_session.flush()
    group = CategoryGroup(id=str(uuid.uuid4()), household_id=household.id, name="Rental")
    db_session.add(group)
    await db_session.flush()
    category = Category(id=str(uuid.uuid4()), group_id=group.id, name="Cleaning")
    db_session.add(category)
    await db_session.commit()

    result = await db_session.execute(select(Category).where(Category.id == category.id))
    saved = result.scalar_one()
    assert saved.deductible is False
    assert saved.deduction_pct == Decimal("100.00")
    assert saved.tax_line is None


@pytest.mark.asyncio
async def test_transaction_deduction_override_nullable(db_session):
    household = Household(id=str(uuid.uuid4()), name="H")
    db_session.add(household)
    await db_session.flush()
    account = Account(id=str(uuid.uuid4()), household_id=household.id, name="Checking", account_type="checking")
    db_session.add(account)
    await db_session.flush()
    txn = Transaction(id=str(uuid.uuid4()), account_id=account.id, date="2026-01-01", amount=Decimal("10.00"))
    db_session.add(txn)
    await db_session.commit()

    result = await db_session.execute(select(Transaction).where(Transaction.id == txn.id))
    saved = result.scalar_one()
    assert saved.deduction_pct_override is None


@pytest.mark.asyncio
async def test_tax_settings_one_row_per_household(db_session):
    household = Household(id=str(uuid.uuid4()), name="H")
    db_session.add(household)
    await db_session.flush()
    settings = TaxSettings(id=str(uuid.uuid4()), household_id=household.id)
    db_session.add(settings)
    await db_session.commit()

    result = await db_session.execute(select(TaxSettings).where(TaxSettings.household_id == household.id))
    saved = result.scalar_one()
    assert saved.marginal_federal_rate is None
    assert saved.marginal_state_rate is None
    assert saved.current_federal_withholding_per_period is None
    assert saved.remaining_pay_periods_this_year is None
```

Check `Account` model's required fields first (`account_type` etc.) — read `backend/app/models/account.py` if the test above fails on a missing/extra column, and adjust the fixture to match the real constructor.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_tax_deductions_models.py -v`
Expected: FAIL — `ImportError: cannot import name 'TaxSettings'` and/or `AttributeError: 'Category' object has no attribute 'deductible'`.

- [ ] **Step 3: Add columns to `Category`**

In `backend/app/models/category.py`, inside the `Category` class, add after `goal_target_date`:

```python
    deductible: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    deduction_pct: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("100.00"), server_default="100.00")
    tax_line: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, default=None)
```

- [ ] **Step 4: Add column to `Transaction`**

In `backend/app/models/transaction.py`, inside the `Transaction` class, add after `notes`:

```python
    deduction_pct_override: Mapped[Optional[Decimal]] = mapped_column(Numeric(5, 2), nullable=True, default=None)
```

- [ ] **Step 5: Create the `TaxSettings` model**

```python
# backend/app/models/tax_settings.py
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional
from sqlalchemy import String, DateTime, Integer, ForeignKey, Numeric
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class TaxSettings(Base):
    """Manually entered tax-rate and withholding inputs, one row per household.

    Used only to compute a rough estimated-tax-savings and withholding nudge
    on the deductions summary — never used for IRS bracket math or filing
    guidance (see docs/superpowers/specs/2026-09-05-tax-deductions-design.md).
    """
    __tablename__ = "tax_settings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    household_id: Mapped[str] = mapped_column(String(36), ForeignKey("households.id"), unique=True, index=True)
    marginal_federal_rate: Mapped[Optional[Decimal]] = mapped_column(Numeric(5, 2), nullable=True, default=None)
    marginal_state_rate: Mapped[Optional[Decimal]] = mapped_column(Numeric(5, 2), nullable=True, default=None)
    current_federal_withholding_per_period: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2), nullable=True, default=None)
    remaining_pay_periods_this_year: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
```

- [ ] **Step 6: Register `TaxSettings` in `app/models/__init__.py`**

Add `from app.models.tax_settings import TaxSettings` near the other model imports, and add `"TaxSettings"` to `__all__`.

- [ ] **Step 7: Run test to verify it passes**

Run: `cd backend && pytest tests/test_tax_deductions_models.py -v`
Expected: PASS (3 tests).

- [ ] **Step 8: Write the Alembic migration**

```python
# backend/alembic/versions/0012_tax_deductions.py
"""tax deductions: category/transaction deduction fields + tax_settings table

Revision ID: 0012_tax_deductions
Revises: 0011_prefer_local_server
Create Date: 2026-09-05

Adds deductible/deduction_pct/tax_line to categories, deduction_pct_override
to transactions, and a new tax_settings table holding manually entered
rate/withholding inputs (one row per household). All nullable or defaulted —
no backfill required.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0012_tax_deductions"
down_revision = "0011_prefer_local_server"
branch_labels = None
depends_on = None


def _columns(table: str) -> set[str]:
    bind = op.get_bind()
    return {c["name"] for c in inspect(bind).get_columns(table)}


def _tables() -> set[str]:
    bind = op.get_bind()
    return set(inspect(bind).get_table_names())


def upgrade() -> None:
    cat_cols = _columns("categories")
    if "deductible" not in cat_cols:
        op.add_column("categories", sa.Column("deductible", sa.Boolean(), nullable=False, server_default="0"))
    if "deduction_pct" not in cat_cols:
        op.add_column("categories", sa.Column("deduction_pct", sa.Numeric(5, 2), nullable=False, server_default="100.00"))
    if "tax_line" not in cat_cols:
        op.add_column("categories", sa.Column("tax_line", sa.String(255), nullable=True))

    txn_cols = _columns("transactions")
    if "deduction_pct_override" not in txn_cols:
        op.add_column("transactions", sa.Column("deduction_pct_override", sa.Numeric(5, 2), nullable=True))

    if "tax_settings" not in _tables():
        op.create_table(
            "tax_settings",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("household_id", sa.String(36), sa.ForeignKey("households.id"), nullable=False, unique=True),
            sa.Column("marginal_federal_rate", sa.Numeric(5, 2), nullable=True),
            sa.Column("marginal_state_rate", sa.Numeric(5, 2), nullable=True),
            sa.Column("current_federal_withholding_per_period", sa.Numeric(10, 2), nullable=True),
            sa.Column("remaining_pay_periods_this_year", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        )
        op.create_index("ix_tax_settings_household_id", "tax_settings", ["household_id"])


def downgrade() -> None:
    if "tax_settings" in _tables():
        op.drop_index("ix_tax_settings_household_id", table_name="tax_settings")
        op.drop_table("tax_settings")
    txn_cols = _columns("transactions")
    if "deduction_pct_override" in txn_cols:
        op.drop_column("transactions", "deduction_pct_override")
    cat_cols = _columns("categories")
    if "tax_line" in cat_cols:
        op.drop_column("categories", "tax_line")
    if "deduction_pct" in cat_cols:
        op.drop_column("categories", "deduction_pct")
    if "deductible" in cat_cols:
        op.drop_column("categories", "deductible")
```

- [ ] **Step 9: Run the migration against a scratch DB to confirm it applies cleanly**

Run: `cd backend && alembic upgrade head && alembic downgrade -1 && alembic upgrade head`
Expected: all three commands exit 0 with no errors.

- [ ] **Step 10: Commit**

```bash
cd backend
git add app/models/category.py app/models/transaction.py app/models/tax_settings.py app/models/__init__.py alembic/versions/0012_tax_deductions.py tests/test_tax_deductions_models.py
git commit -m "feat: add tax deduction fields to Category/Transaction and TaxSettings table"
```

---

### Task 2: Category and Transaction schema/route updates

**Files:**
- Modify: `backend/app/schemas/category.py`
- Modify: `backend/app/api/routes/categories.py`
- Modify: `backend/app/schemas/transaction.py`
- Modify: `backend/app/api/routes/transactions.py`
- Test: `backend/tests/test_categories_routes.py` (append)
- Test: `backend/tests/test_transactions_deduction_override.py` (new)

**Interfaces:**
- Consumes: `Category.deductible/deduction_pct/tax_line`, `Transaction.deduction_pct_override` from Task 1.
- Produces: `CategoryCreate/CategoryUpdate/CategoryResponse` carrying the three new fields; `TransactionUpdate/TransactionResponse` carrying `deduction_pct_override`.

- [ ] **Step 1: Write the failing category route test**

Append to `backend/tests/test_categories_routes.py` (reuse the existing `fixture` and `_seed_household` helpers already defined in that file):

```python
@pytest.mark.asyncio
async def test_category_deduction_fields_roundtrip(fixture):
    session, _ = fixture
    _, headers = await _seed_household(session)
    async with _client() as client:
        grp = await client.post("/api/categories/groups", headers=headers, json={"name": "Rental"})
        gid = grp.json()["id"]
        create = await client.post(
            "/api/categories",
            headers=headers,
            json={"group_id": gid, "name": "Cleaning"},
        )
        cid = create.json()["id"]
        assert create.json()["deductible"] is False
        assert create.json()["deduction_pct"] == "100.00" or float(create.json()["deduction_pct"]) == 100.0
        assert create.json()["tax_line"] is None

        update = await client.put(
            f"/api/categories/{cid}",
            headers=headers,
            json={"deductible": True, "deduction_pct": 80, "tax_line": "Schedule E — Cleaning"},
        )
        assert update.status_code == 200
        body = update.json()
        assert body["deductible"] is True
        assert float(body["deduction_pct"]) == 80.0
        assert body["tax_line"] == "Schedule E — Cleaning"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_categories_routes.py::test_category_deduction_fields_roundtrip -v`
Expected: FAIL — response body has no `deductible` key (schema doesn't expose it yet).

- [ ] **Step 3: Extend category schemas**

In `backend/app/schemas/category.py`, add to `CategoryCreate`:

```python
    deductible: bool = False
    deduction_pct: Decimal = Decimal("100.00")
    tax_line: Optional[str] = None
```

Add to `CategoryUpdate`:

```python
    deductible: Optional[bool] = None
    deduction_pct: Optional[Decimal] = None
    tax_line: Optional[str] = None
```

Add to `CategoryResponse`:

```python
    deductible: bool
    deduction_pct: Decimal
    tax_line: Optional[str]
```

Add a validator to reject out-of-range percentages, next to `clean_name`:

```python
def clean_pct(value: Optional[Decimal]) -> Optional[Decimal]:
    if value is None:
        return value
    if value < 0 or value > 100:
        raise ValueError("deduction_pct must be between 0 and 100")
    return value
```

and wire it into both `CategoryCreate` and `CategoryUpdate` with `@field_validator("deduction_pct")`.

- [ ] **Step 4: No route changes needed for categories**

`create_category` and `update_category` already do `payload = data.model_dump()` / `data.model_dump(exclude_unset=True)` and `setattr` each field generically — the new fields flow through automatically. Confirm this by reading `backend/app/api/routes/categories.py:` the `create_category` and `update_category` functions; no edit required here.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && pytest tests/test_categories_routes.py::test_category_deduction_fields_roundtrip -v`
Expected: PASS.

- [ ] **Step 6: Write the failing transaction override test**

```python
# backend/tests/test_transactions_deduction_override.py
"""Route test: transaction-level deduction_pct_override."""
from __future__ import annotations

import pytest

from tests.test_categories_routes import fixture, _seed_household, _seed_catalog, _client  # reuse fixtures
from app.models import Account, Transaction
import uuid
from decimal import Decimal


@pytest.mark.asyncio
async def test_transaction_deduction_override_roundtrip(fixture):
    session, _ = fixture
    hid, headers = await _seed_household(session)
    _, cat_a, _ = await _seed_catalog(session, hid)
    account = Account(id=str(uuid.uuid4()), household_id=hid, name="Checking", account_type="checking")
    session.add(account)
    await session.flush()
    txn = Transaction(id=str(uuid.uuid4()), account_id=account.id, date="2026-01-01", amount=Decimal("50.00"), category_id=cat_a.id)
    session.add(txn)
    await session.commit()

    async with _client() as client:
        resp = await client.put(
            f"/api/transactions/{txn.id}",
            headers=headers,
            json={"deduction_pct_override": 50},
        )
        assert resp.status_code == 200
        assert float(resp.json()["deduction_pct_override"]) == 50.0
```

Read `backend/app/models/account.py` first to confirm the exact required/optional fields for `Account(...)` above (e.g. whether `account_type` is the real field name) and adjust the constructor call if it differs.

- [ ] **Step 7: Run test to verify it fails**

Run: `cd backend && pytest tests/test_transactions_deduction_override.py -v`
Expected: FAIL — `deduction_pct_override` missing from response / rejected by schema.

- [ ] **Step 8: Extend transaction schemas**

In `backend/app/schemas/transaction.py`, add to `TransactionUpdate`:

```python
    deduction_pct_override: Optional[Decimal] = None
```

Add to `TransactionResponse`:

```python
    deduction_pct_override: Optional[Decimal] = None
```

No route change needed — `update_transaction` in `backend/app/api/routes/transactions.py` already applies `data.model_dump(exclude_unset=True)` generically via `setattr`.

- [ ] **Step 9: Run test to verify it passes**

Run: `cd backend && pytest tests/test_transactions_deduction_override.py -v`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
cd backend
git add app/schemas/category.py app/schemas/transaction.py tests/test_categories_routes.py tests/test_transactions_deduction_override.py
git commit -m "feat: expose deduction fields on category and transaction APIs"
```

---

### Task 3: `TaxSettings` get/put endpoint

**Files:**
- Create: `backend/app/schemas/tax_settings.py`
- Create: `backend/app/api/routes/tax_settings.py`
- Modify: `backend/app/api/routes/__init__.py`
- Test: `backend/tests/test_tax_settings_routes.py`

**Interfaces:**
- Consumes: `TaxSettings` model from Task 1.
- Produces: `GET /api/tax-settings` → `TaxSettingsResponse`; `PUT /api/tax-settings` → `TaxSettingsResponse`. `TaxSettingsResponse` fields: `marginal_federal_rate, marginal_state_rate, current_federal_withholding_per_period, remaining_pay_periods_this_year` (all `Optional`).

- [ ] **Step 1: Write the failing route test**

```python
# backend/tests/test_tax_settings_routes.py
"""Route tests for /api/tax-settings: get/put, household scoping, partial updates."""
from __future__ import annotations

import pytest

from tests.test_categories_routes import fixture, _seed_household, _client


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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_tax_settings_routes.py -v`
Expected: FAIL — `404 Not Found` (no `/api/tax-settings` route registered yet).

- [ ] **Step 3: Write the schema**

```python
# backend/app/schemas/tax_settings.py
from pydantic import BaseModel, field_validator
from decimal import Decimal
from typing import Optional


def _clean_rate(value: Optional[Decimal]) -> Optional[Decimal]:
    if value is None:
        return value
    if value < 0 or value > 100:
        raise ValueError("rate must be between 0 and 100")
    return value


class TaxSettingsUpdate(BaseModel):
    marginal_federal_rate: Optional[Decimal] = None
    marginal_state_rate: Optional[Decimal] = None
    current_federal_withholding_per_period: Optional[Decimal] = None
    remaining_pay_periods_this_year: Optional[int] = None

    @field_validator("marginal_federal_rate", "marginal_state_rate")
    @classmethod
    def _validate_rate(cls, v: Optional[Decimal]) -> Optional[Decimal]:
        return _clean_rate(v)

    @field_validator("remaining_pay_periods_this_year")
    @classmethod
    def _validate_periods(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and v < 0:
            raise ValueError("remaining_pay_periods_this_year must not be negative")
        return v


class TaxSettingsResponse(BaseModel):
    marginal_federal_rate: Optional[Decimal]
    marginal_state_rate: Optional[Decimal]
    current_federal_withholding_per_period: Optional[Decimal]
    remaining_pay_periods_this_year: Optional[int]

    model_config = {"from_attributes": True}
```

- [ ] **Step 4: Write the route**

```python
# backend/app/api/routes/tax_settings.py
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.api.deps import get_household_id
from app.models import TaxSettings
from app.schemas.tax_settings import TaxSettingsUpdate, TaxSettingsResponse

router = APIRouter()


async def _get_or_create(db: AsyncSession, household_id: str) -> TaxSettings:
    result = await db.execute(select(TaxSettings).where(TaxSettings.household_id == household_id))
    settings = result.scalar_one_or_none()
    if settings is None:
        settings = TaxSettings(household_id=household_id)
        db.add(settings)
        await db.flush()
    return settings


@router.get("", response_model=TaxSettingsResponse)
async def get_tax_settings(
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    settings = await _get_or_create(db, household_id)
    await db.commit()
    return TaxSettingsResponse.model_validate(settings)


@router.put("", response_model=TaxSettingsResponse)
async def update_tax_settings(
    data: TaxSettingsUpdate,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    settings = await _get_or_create(db, household_id)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(settings, field, value)
    await db.commit()
    await db.refresh(settings)
    return TaxSettingsResponse.model_validate(settings)
```

- [ ] **Step 5: Register the router**

In `backend/app/api/routes/__init__.py`, add `tax_settings` to the import list (alphabetically near `subscriptions`) and add:

```python
router.include_router(tax_settings.router, prefix="/tax-settings", tags=["tax-settings"])
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && pytest tests/test_tax_settings_routes.py -v`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
cd backend
git add app/schemas/tax_settings.py app/api/routes/tax_settings.py app/api/routes/__init__.py tests/test_tax_settings_routes.py
git commit -m "feat: add /api/tax-settings get/put endpoint"
```

---

### Task 4: Deductions summary endpoint

**Files:**
- Create: `backend/app/schemas/deductions.py`
- Create: `backend/app/services/deductions.py`
- Create: `backend/app/api/routes/deductions.py`
- Modify: `backend/app/api/routes/__init__.py`
- Test: `backend/tests/test_deductions_summary.py`

**Interfaces:**
- Consumes: `Category.deductible/deduction_pct/tax_line`, `Transaction.deduction_pct_override`, `TaxSettings` (Tasks 1–3).
- Produces: `GET /api/deductions/summary?year=YYYY` → `DeductionsSummaryResponse { year, lines: [{tax_line, amount}], total, estimated_tax_savings: Optional[Decimal], suggested_withholding_reduction_per_period: Optional[Decimal] }`. Also exposes `compute_deductions_summary(db, household_id, year) -> DeductionsSummaryResponse` from `app/services/deductions.py` for the route to call and for direct unit testing.

- [ ] **Step 1: Write the failing service-level test**

```python
# backend/tests/test_deductions_summary.py
"""Tests for the deductions summary aggregation service and route."""
from __future__ import annotations

import uuid
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
        id=str(uuid.uuid4()), account_id=account.id, date=txn_date, amount=amount,
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
    assert summary.lines == [{"tax_line": "Schedule E — Cleaning", "amount": Decimal("50.00")}]
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
    assert summary.lines == [{"tax_line": "Medical", "amount": Decimal("10.00")}]


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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_deductions_summary.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.deductions'`.

- [ ] **Step 3: Write the schema**

```python
# backend/app/schemas/deductions.py
from pydantic import BaseModel
from decimal import Decimal
from typing import Optional


class DeductionLine(BaseModel):
    tax_line: str
    amount: Decimal


class DeductionsSummaryResponse(BaseModel):
    year: int
    lines: list[DeductionLine]
    total: Decimal
    estimated_tax_savings: Optional[Decimal] = None
    suggested_withholding_reduction_per_period: Optional[Decimal] = None
```

- [ ] **Step 4: Write the aggregation service**

```python
# backend/app/services/deductions.py
"""Aggregates deductible transactions into a per-tax-line summary, with an
optional estimated-tax-savings and withholding nudge driven by manually
entered TaxSettings. No IRS bracket logic — arithmetic on user-supplied
rates only. See docs/superpowers/specs/2026-09-05-tax-deductions-design.md.
"""
from __future__ import annotations

from collections import defaultdict
from decimal import Decimal

from sqlalchemy import select, extract
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Category, TaxSettings, Transaction
from app.schemas.deductions import DeductionLine, DeductionsSummaryResponse

_CENTS = Decimal("0.01")


async def compute_deductions_summary(db: AsyncSession, household_id: str, year: int) -> DeductionsSummaryResponse:
    result = await db.execute(
        select(Transaction, Category)
        .join(Category, Transaction.category_id == Category.id)
        .join(Category.group)
        .where(
            Category.deductible.is_(True),
            extract("year", Transaction.date) == year,
        )
        .where(Category.group.has(household_id=household_id))
    )
    rows = result.all()

    totals: dict[str, Decimal] = defaultdict(lambda: Decimal("0.00"))
    grand_total = Decimal("0.00")
    for txn, category in rows:
        pct = txn.deduction_pct_override if txn.deduction_pct_override is not None else category.deduction_pct
        deductible_amount = (txn.amount * pct / Decimal("100")).quantize(_CENTS)
        label = category.tax_line or category.name
        totals[label] += deductible_amount
        grand_total += deductible_amount

    lines = [DeductionLine(tax_line=label, amount=amount) for label, amount in totals.items()]

    settings_result = await db.execute(select(TaxSettings).where(TaxSettings.household_id == household_id))
    settings = settings_result.scalar_one_or_none()

    estimated_tax_savings: Decimal | None = None
    suggested_withholding_reduction_per_period: Decimal | None = None
    if settings and settings.marginal_federal_rate is not None and settings.marginal_state_rate is not None:
        combined_rate = (settings.marginal_federal_rate + settings.marginal_state_rate) / Decimal("100")
        estimated_tax_savings = (grand_total * combined_rate).quantize(_CENTS)
        if (
            settings.current_federal_withholding_per_period is not None
            and settings.remaining_pay_periods_this_year is not None
            and settings.remaining_pay_periods_this_year > 0
        ):
            suggested_withholding_reduction_per_period = (
                estimated_tax_savings / settings.remaining_pay_periods_this_year
            ).quantize(_CENTS)

    return DeductionsSummaryResponse(
        year=year,
        lines=lines,
        total=grand_total,
        estimated_tax_savings=estimated_tax_savings,
        suggested_withholding_reduction_per_period=suggested_withholding_reduction_per_period,
    )
```

Note: `Category.group.has(household_id=household_id)` requires `Category.group` relationship (already defined in `app/models/category.py`) and works as a correlated `EXISTS` subquery under SQLAlchemy 2.0's async ORM — if `.has()` errors in this codebase's SQLAlchemy version, replace the two `.join`/`.where` lines with an explicit `.join(CategoryGroup, Category.group_id == CategoryGroup.id).where(CategoryGroup.household_id == household_id)`, matching the pattern already used in `backend/app/api/routes/categories.py`'s `update_category`.

- [ ] **Step 5: Write the route**

```python
# backend/app/api/routes/deductions.py
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.api.deps import get_household_id
from app.schemas.deductions import DeductionsSummaryResponse
from app.services.deductions import compute_deductions_summary

router = APIRouter()


@router.get("/summary", response_model=DeductionsSummaryResponse)
async def get_deductions_summary(
    year: int = Query(default_factory=lambda: date.today().year),
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    return await compute_deductions_summary(db, household_id, year)
```

- [ ] **Step 6: Register the router**

In `backend/app/api/routes/__init__.py`, add `deductions` to the import list and:

```python
router.include_router(deductions.router, prefix="/deductions", tags=["deductions"])
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd backend && pytest tests/test_deductions_summary.py -v`
Expected: PASS (8 tests). If the `.has()` query errors, apply the fallback noted in Step 4 and re-run.

- [ ] **Step 8: Run the full backend suite to check for regressions**

Run: `cd backend && pytest -q`
Expected: all tests pass (no changes to existing behavior — only additive fields/routes).

- [ ] **Step 9: Commit**

```bash
cd backend
git add app/schemas/deductions.py app/services/deductions.py app/api/routes/deductions.py app/api/routes/__init__.py tests/test_deductions_summary.py
git commit -m "feat: add GET /api/deductions/summary aggregation endpoint"
```

---

### Task 5: Frontend API clients (`tax-settings.ts`, `deductions.ts`, extend `categories.ts`/`transactions.ts`)

**Files:**
- Modify: `frontend/src/lib/api/categories.ts`
- Modify: `frontend/src/lib/api/transactions.ts`
- Create: `frontend/src/lib/api/tax-settings.ts`
- Create: `frontend/src/lib/api/deductions.ts`
- Test: `frontend/src/lib/api/deductions.test.ts`

**Interfaces:**
- Consumes: `GET/PUT /api/tax-settings`, `GET /api/deductions/summary`, extended category/transaction routes (Tasks 2–4).
- Produces: `taxSettingsApi.{get,update}`, `deductionsApi.summary(year)`, `Category` interface with `deductible/deduction_pct/tax_line`, `categoriesApi.update` accepting those fields, transaction update type accepting `deduction_pct_override`.

- [ ] **Step 1: Extend `Category` type and `categoriesApi.update` in `categories.ts`**

In `frontend/src/lib/api/categories.ts`, update the `Category` interface:

```typescript
export interface Category {
  id: string;
  group_id: string;
  name: string;
  sort_order: number;
  goal_type: string;
  goal_amount: number | null;
  goal_target_date: string | null;
  created_at: string;
  deductible: boolean;
  deduction_pct: number;
  tax_line: string | null;
}
```

And update `update`:

```typescript
  update: (id: string, data: Partial<{ name: string; group_id: string; deductible: boolean; deduction_pct: number; tax_line: string | null }>) =>
    api.put<Category>(`/categories/${id}`, data).then((r) => r.data),
```

- [ ] **Step 2: Extend transaction update type in `transactions.ts`**

Read `frontend/src/lib/api/transactions.ts` first to find the existing update payload type (mirrors `TransactionUpdate` in the backend schema) and add `deduction_pct_override?: number | null` to it, following whatever naming convention that file already uses (e.g. if it's `UpdateTransactionInput` or inlined in `transactionsApi.update`).

- [ ] **Step 3: Write the failing deductions API test**

```typescript
// frontend/src/lib/api/deductions.test.ts
import { describe, it, expect, vi } from "vitest";
import api from "./client";
import { deductionsApi } from "./deductions";

vi.mock("./client", () => ({
  default: { get: vi.fn() },
}));

describe("deductionsApi.summary", () => {
  it("requests the summary for the given year", async () => {
    const mockData = { year: 2026, lines: [], total: 0, estimated_tax_savings: null, suggested_withholding_reduction_per_period: null };
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: mockData });

    const result = await deductionsApi.summary(2026);

    expect(api.get).toHaveBeenCalledWith("/deductions/summary", { params: { year: 2026 } });
    expect(result).toEqual(mockData);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/api/deductions.test.ts`
Expected: FAIL — `Cannot find module './deductions'`.

- [ ] **Step 5: Write `tax-settings.ts` and `deductions.ts`**

```typescript
// frontend/src/lib/api/tax-settings.ts
import api from "./client";

export interface TaxSettings {
  marginal_federal_rate: number | null;
  marginal_state_rate: number | null;
  current_federal_withholding_per_period: number | null;
  remaining_pay_periods_this_year: number | null;
}

export type TaxSettingsUpdate = Partial<TaxSettings>;

export const taxSettingsApi = {
  get: () => api.get<TaxSettings>("/tax-settings").then((r) => r.data),
  update: (data: TaxSettingsUpdate) => api.put<TaxSettings>("/tax-settings", data).then((r) => r.data),
};
```

```typescript
// frontend/src/lib/api/deductions.ts
import api from "./client";

export interface DeductionLine {
  tax_line: string;
  amount: number;
}

export interface DeductionsSummary {
  year: number;
  lines: DeductionLine[];
  total: number;
  estimated_tax_savings: number | null;
  suggested_withholding_reduction_per_period: number | null;
}

export const deductionsApi = {
  summary: (year: number) =>
    api.get<DeductionsSummary>("/deductions/summary", { params: { year } }).then((r) => r.data),
};
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/api/deductions.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd frontend
git add src/lib/api/categories.ts src/lib/api/transactions.ts src/lib/api/tax-settings.ts src/lib/api/deductions.ts src/lib/api/deductions.test.ts
git commit -m "feat: add frontend API clients for tax settings and deductions summary"
```

---

### Task 6: Category modal — deductible toggle, percent, tax-line field

**Files:**
- Modify: `frontend/src/app/(app)/categories/category-item.tsx`
- Modify: `frontend/src/app/(app)/categories/category-item.test.tsx`

**Interfaces:**
- Consumes: `Category` type and `categoriesApi.update` from Task 5.

- [ ] **Step 1: Read the current modal implementation**

Read `frontend/src/app/(app)/categories/category-item.tsx` in full to find the edit form's existing fields (name, goal settings) and the `useMutation` call that submits `categoriesApi.update`. Match its existing state-management style (likely `useState` per field, or a single form-state object) exactly — do not introduce a new form library.

- [ ] **Step 2: Write the failing component test**

Append to `frontend/src/app/(app)/categories/category-item.test.tsx` (reuse whatever render/setup helpers the existing tests in that file already use):

```typescript
it("toggles tax deductible and shows percent + tax line inputs", async () => {
  const category = makeCategory({ deductible: false, deduction_pct: 100, tax_line: null }); // use this file's existing category factory/fixture
  const { user, ...utils } = renderCategoryItem(category); // use this file's existing render helper

  await user.click(utils.getByRole("button", { name: /edit/i }));
  const toggle = utils.getByRole("switch", { name: /tax deductible/i });
  await user.click(toggle);

  expect(utils.getByLabelText(/deduction %/i)).toBeInTheDocument();
  expect(utils.getByLabelText(/tax line/i)).toBeInTheDocument();
});
```

Adjust `makeCategory`/`renderCategoryItem` names to whatever helpers `category-item.test.tsx` already exports/uses — read the file first and reuse its existing patterns rather than inventing new ones.

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/app/\(app\)/categories/category-item.test.tsx`
Expected: FAIL — no element with role `switch` named `/tax deductible/i`.

- [ ] **Step 4: Add the toggle, percent, and tax-line fields to the edit form**

In the edit form JSX in `category-item.tsx`, add (using this codebase's existing `Switch`/`Input`/`Label` components from `@/components/ui`, matching whatever import style the rest of the file already uses):

```tsx
<div className="flex items-center gap-2">
  <Switch
    id="deductible"
    aria-label="Tax deductible"
    checked={formState.deductible}
    onCheckedChange={(checked) => setFormState((s) => ({ ...s, deductible: checked }))}
  />
  <Label htmlFor="deductible">Tax deductible</Label>
</div>
{formState.deductible && (
  <>
    <div>
      <Label htmlFor="deduction_pct">Deduction %</Label>
      <Input
        id="deduction_pct"
        type="number"
        min={0}
        max={100}
        value={formState.deduction_pct}
        onChange={(e) => setFormState((s) => ({ ...s, deduction_pct: Number(e.target.value) }))}
      />
    </div>
    <div>
      <Label htmlFor="tax_line">Tax line</Label>
      <Input
        id="tax_line"
        value={formState.tax_line ?? ""}
        onChange={(e) => setFormState((s) => ({ ...s, tax_line: e.target.value || null }))}
        placeholder="e.g. Schedule E — Cleaning"
      />
    </div>
  </>
)}
```

Wire `formState.deductible`, `deduction_pct`, `tax_line` into the initial state (seeded from the `category` prop) and into the object passed to `categoriesApi.update` on submit.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/app/\(app\)/categories/category-item.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd frontend
git add src/app/\(app\)/categories/category-item.tsx src/app/\(app\)/categories/category-item.test.tsx
git commit -m "feat: add tax-deductible toggle to category edit form"
```

---

### Task 7: Deductions page

**Files:**
- Create: `frontend/src/app/(app)/deductions/page.tsx`
- Create: `frontend/src/app/(app)/deductions/tax-settings-card.tsx`
- Create: `frontend/src/app/(app)/deductions/deductions-summary-table.tsx`
- Test: `frontend/src/app/(app)/deductions/deductions-summary-table.test.tsx`
- Test: `frontend/src/app/(app)/deductions/tax-settings-card.test.tsx`
- Modify: navigation — find and update the sidebar/nav component that lists `Accounts / Budget / Categories / ...` (search for where `"/budget"` or `"/categories"` appears as a nav href) to add a `"/deductions"` entry.

**Interfaces:**
- Consumes: `deductionsApi.summary`, `taxSettingsApi.{get,update}` from Task 5.
- Produces: `/deductions` route rendering `DeductionsSummaryTable` and `TaxSettingsCard`.

- [ ] **Step 1: Find the nav component**

Run: `cd frontend && grep -rln '"/budget"' src/components src/app | grep -v test`
Read the matched file to learn its list-item shape (label, href, icon) before Step 7 below.

- [ ] **Step 2: Write the failing summary table test**

```typescript
// frontend/src/app/(app)/deductions/deductions-summary-table.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { DeductionsSummaryTable } from "./deductions-summary-table";
import type { DeductionsSummary } from "@/lib/api/deductions";

const baseSummary: DeductionsSummary = {
  year: 2026,
  lines: [
    { tax_line: "Schedule E — Cleaning", amount: 1240 },
    { tax_line: "Schedule A — Medical", amount: 340 },
  ],
  total: 1580,
  estimated_tax_savings: null,
  suggested_withholding_reduction_per_period: null,
};

describe("DeductionsSummaryTable", () => {
  it("renders each line and the total", () => {
    render(<DeductionsSummaryTable summary={baseSummary} />);
    expect(screen.getByText("Schedule E — Cleaning")).toBeInTheDocument();
    expect(screen.getByText("$1,240.00")).toBeInTheDocument();
    expect(screen.getByText("$1,580.00")).toBeInTheDocument();
  });

  it("shows a prompt instead of a savings figure when settings are incomplete", () => {
    render(<DeductionsSummaryTable summary={baseSummary} />);
    expect(screen.getByText(/add your tax rate/i)).toBeInTheDocument();
  });

  it("shows the estimated savings and withholding nudge when present", () => {
    const summary: DeductionsSummary = {
      ...baseSummary,
      estimated_tax_savings: 417.11,
      suggested_withholding_reduction_per_period: 52.14,
    };
    render(<DeductionsSummaryTable summary={summary} />);
    expect(screen.getByText(/417\.11/)).toBeInTheDocument();
    expect(screen.getByText(/52\.14/)).toBeInTheDocument();
    expect(screen.getByText(/not tax advice/i)).toBeInTheDocument();
  });

  it("shows an empty state with no deductible categories", () => {
    render(<DeductionsSummaryTable summary={{ ...baseSummary, lines: [], total: 0 }} />);
    expect(screen.getByText(/no deductible categories yet/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npx vitest run "src/app/(app)/deductions/deductions-summary-table.test.tsx"`
Expected: FAIL — `Cannot find module './deductions-summary-table'`.

- [ ] **Step 4: Write `deductions-summary-table.tsx`**

```tsx
// frontend/src/app/(app)/deductions/deductions-summary-table.tsx
"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DeductionsSummary } from "@/lib/api/deductions";

function formatCurrency(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function DeductionsSummaryTable({ summary }: { summary: DeductionsSummary }) {
  if (summary.lines.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          No deductible categories yet. Mark a category as tax deductible from the Categories page to see it here.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Deductions Summary ({summary.year})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <table className="w-full text-sm">
          <tbody>
            {summary.lines.map((line) => (
              <tr key={line.tax_line} className="border-b">
                <td className="py-2">{line.tax_line}</td>
                <td className="py-2 text-right">{formatCurrency(line.amount)}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td className="py-2">Total</td>
              <td className="py-2 text-right">{formatCurrency(summary.total)}</td>
            </tr>
          </tbody>
        </table>

        {summary.estimated_tax_savings === null ? (
          <p className="text-sm text-muted-foreground">
            Add your tax rate below to see an estimated tax savings.
          </p>
        ) : (
          <div className="text-sm space-y-1">
            <p>Estimated tax savings: {formatCurrency(summary.estimated_tax_savings)}</p>
            {summary.suggested_withholding_reduction_per_period !== null && (
              <p>
                You could consider reducing withholding by ~{formatCurrency(summary.suggested_withholding_reduction_per_period)}/paycheck
                for the rest of the year.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              This is an estimate based on the rate you entered, not tax advice.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run "src/app/(app)/deductions/deductions-summary-table.test.tsx"`
Expected: PASS.

- [ ] **Step 6: Write the failing tax-settings-card test**

```typescript
// frontend/src/app/(app)/deductions/tax-settings-card.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { TaxSettingsCard } from "./tax-settings-card";

describe("TaxSettingsCard", () => {
  it("calls onSave with the entered rate when the form is submitted", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <TaxSettingsCard
        settings={{ marginal_federal_rate: null, marginal_state_rate: null, current_federal_withholding_per_period: null, remaining_pay_periods_this_year: null }}
        onSave={onSave}
      />
    );

    await user.type(screen.getByLabelText(/federal rate/i), "22");
    await user.type(screen.getByLabelText(/state rate/i), "4.4");
    await user.click(screen.getByRole("button", { name: /save/i }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ marginal_federal_rate: 22, marginal_state_rate: 4.4 })
    );
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `cd frontend && npx vitest run "src/app/(app)/deductions/tax-settings-card.test.tsx"`
Expected: FAIL — `Cannot find module './tax-settings-card'`.

- [ ] **Step 8: Write `tax-settings-card.tsx`**

```tsx
// frontend/src/app/(app)/deductions/tax-settings-card.tsx
"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { TaxSettings, TaxSettingsUpdate } from "@/lib/api/tax-settings";

export function TaxSettingsCard({
  settings,
  onSave,
}: {
  settings: TaxSettings;
  onSave: (data: TaxSettingsUpdate) => Promise<void>;
}) {
  const [form, setForm] = useState({
    marginal_federal_rate: settings.marginal_federal_rate?.toString() ?? "",
    marginal_state_rate: settings.marginal_state_rate?.toString() ?? "",
    current_federal_withholding_per_period: settings.current_federal_withholding_per_period?.toString() ?? "",
    remaining_pay_periods_this_year: settings.remaining_pay_periods_this_year?.toString() ?? "",
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({
        marginal_federal_rate: form.marginal_federal_rate === "" ? null : Number(form.marginal_federal_rate),
        marginal_state_rate: form.marginal_state_rate === "" ? null : Number(form.marginal_state_rate),
        current_federal_withholding_per_period:
          form.current_federal_withholding_per_period === "" ? null : Number(form.current_federal_withholding_per_period),
        remaining_pay_periods_this_year:
          form.remaining_pay_periods_this_year === "" ? null : Number(form.remaining_pay_periods_this_year),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tax Settings</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="marginal_federal_rate">Marginal federal rate (%)</Label>
            <Input
              id="marginal_federal_rate"
              type="number"
              value={form.marginal_federal_rate}
              onChange={(e) => setForm((f) => ({ ...f, marginal_federal_rate: e.target.value }))}
            />
          </div>
          <div>
            <Label htmlFor="marginal_state_rate">Marginal state rate (%)</Label>
            <Input
              id="marginal_state_rate"
              type="number"
              value={form.marginal_state_rate}
              onChange={(e) => setForm((f) => ({ ...f, marginal_state_rate: e.target.value }))}
            />
          </div>
          <div>
            <Label htmlFor="current_federal_withholding_per_period">Current federal withholding per paycheck</Label>
            <Input
              id="current_federal_withholding_per_period"
              type="number"
              value={form.current_federal_withholding_per_period}
              onChange={(e) => setForm((f) => ({ ...f, current_federal_withholding_per_period: e.target.value }))}
            />
          </div>
          <div>
            <Label htmlFor="remaining_pay_periods_this_year">Remaining paychecks this year</Label>
            <Input
              id="remaining_pay_periods_this_year"
              type="number"
              value={form.remaining_pay_periods_this_year}
              onChange={(e) => setForm((f) => ({ ...f, remaining_pay_periods_this_year: e.target.value }))}
            />
          </div>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `cd frontend && npx vitest run "src/app/(app)/deductions/tax-settings-card.test.tsx"`
Expected: PASS.

- [ ] **Step 10: Write the page**

Read `frontend/src/app/(app)/plan/page.tsx` first for this codebase's page-shell conventions (how it uses `PageHeader`/`page-title-context` from `@/components/page`, and how it wires `useQuery`/`useMutation` with `useQueryClient` for cache invalidation), then write:

```tsx
// frontend/src/app/(app)/deductions/page.tsx
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/page/page-header";
import { deductionsApi } from "@/lib/api/deductions";
import { taxSettingsApi, type TaxSettingsUpdate } from "@/lib/api/tax-settings";
import { DeductionsSummaryTable } from "./deductions-summary-table";
import { TaxSettingsCard } from "./tax-settings-card";
import { toastApiError } from "@/lib/toast-error";

export default function DeductionsPage() {
  const year = new Date().getFullYear();
  const queryClient = useQueryClient();

  const summaryQuery = useQuery({
    queryKey: ["deductions-summary", year],
    queryFn: () => deductionsApi.summary(year),
  });

  const settingsQuery = useQuery({
    queryKey: ["tax-settings"],
    queryFn: () => taxSettingsApi.get(),
  });

  const saveSettings = useMutation({
    mutationFn: (data: TaxSettingsUpdate) => taxSettingsApi.update(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tax-settings"] });
      queryClient.invalidateQueries({ queryKey: ["deductions-summary", year] });
    },
    onError: toastApiError,
  });

  if (summaryQuery.isLoading || settingsQuery.isLoading) {
    return <div className="p-6">Loading…</div>;
  }
  if (!summaryQuery.data || !settingsQuery.data) {
    return <div className="p-6">Could not load deductions.</div>;
  }

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Deductions" />
      <DeductionsSummaryTable summary={summaryQuery.data} />
      <TaxSettingsCard settings={settingsQuery.data} onSave={(data) => saveSettings.mutateAsync(data)} />
    </div>
  );
}
```

Adjust the `PageHeader` import/props and the `toastApiError` import path to match exactly what `frontend/src/app/(app)/plan/page.tsx` (or another existing page) actually uses — read that file before finalizing this step, since the exact prop name/shape wasn't re-verified against every page in this pass.

- [ ] **Step 11: Add the nav entry**

Using the file found in Step 1, add a `"/deductions"` entry with an appropriate icon (e.g. `Receipt` or `Landmark` from `lucide-react`, matching whatever icon library the nav already imports) and label "Deductions", following that file's existing list-item shape exactly.

- [ ] **Step 12: Run the full frontend test suite**

Run: `cd frontend && npm test -- --run`
Expected: all tests pass, including the new ones from Tasks 5–7.

- [ ] **Step 13: Run lint, typecheck, and build**

Run: `cd frontend && npm run lint && npm run typecheck && npm run build`
Expected: all three exit 0. Fix any type errors from the manual `Category`/transaction type edits before proceeding.

- [ ] **Step 14: Commit**

```bash
cd frontend
git add "src/app/(app)/deductions" src/app/\(app\)/categories/category-item.tsx  # plus whatever nav file was edited in Step 11
git commit -m "feat: add Deductions page with summary table and tax settings card"
```

---

### Task 8: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full backend suite**

Run: `cd backend && pytest -q`
Expected: all tests pass, including every test added in Tasks 1–4.

- [ ] **Step 2: Run the full frontend gate**

Run: `cd frontend && npm run lint && npm test -- --run && npm run build`
Expected: all three pass, per the CLAUDE.md pre-PR gate.

- [ ] **Step 3: Manually exercise the feature**

Start the dev stack (`docker-compose up` or however this repo normally runs locally — check `README.md` if unsure), mark one category deductible via the UI, add a transaction to it, visit `/deductions`, confirm the total and (after entering rates) the savings/nudge lines render correctly.

- [ ] **Step 4: Report results**

Summarize what was verified (tests passing, manual walkthrough outcome) — do not claim "done" without having actually run the commands above.
