# Tax Projection Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Status — 2026-09-20

**Tasks 1–16 are implemented and merged to `main`** (branch `feat/tax-projection-engine`,
merge commit "Tax projection engine: real brackets, a guided setup, and honest gaps"). The
step checkboxes below were never ticked during execution; the commit log is the record —
one `feat(tax)`/`test(tax)` commit per task.

**Acceptance item 1 is the only thing still open, and it needs data, not code.** The engine
must reproduce the last two *real* filed returns. `backend/tests/backtest/` is built and
skips without `backend/tests/backtest/returns.local.json`, which is gitignored by design
(it describes a real person's finances — never commit it). Its README maps every figure to
its box on the form. Build that file locally and run
`cd backend && pytest tests/backtest/ -v` to close Phase 1.

**Two corrections to this plan, made while implementing and already applied in code:**
- Task 16's comparison was wrong — see the note in that task. `total_liability` is federal
  + FICA + state and matches no single line on any filed form.
- Acceptance item 5 ("an unsupported year or filing status raises rather than
  approximating") holds for the engine, but the *route* must not. Raising a 422 from
  `/tax/projection` replaced the whole Taxes page with the engine's message and a dead
  Retry button; it now returns `available: false` with `unsupported_filing_status`.

**Found by driving the app after the plan was complete** (all fixed, all with tests): a
missing pay frequency and blank withholding boxes were each read as a silent zero and
presented as confident numbers; the Taxes page has since been rebuilt around a first-time
user (setup checklist, progressive disclosure in the paystub form, correctable paystubs).
The lesson worth carrying: the plan's own "never fabricate a zero" rule was honoured inside
the engine and broken twice at the seams around it.

**Goal:** Replace the hand-entered marginal rate behind the deductions feature with a real tax projection engine that answers "what will I owe this year, and is my withholding on track?"

**Architecture:** A pure-function engine (`backend/app/services/tax/`) over versioned per-year rate tables. Dataclass in, dataclass out — no DB session, no I/O, no clock. Marginal impact is computed by re-running the engine with the actual amount under consideration, never by looking up a bracket. Database models feed the engine through an assembly service; routes contain no tax math.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2.x async, Alembic, Pydantic v2, pytest/pytest-asyncio. Frontend: Next.js App Router, React Query, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-19-tax-projection-engine-design.md` (read with its umbrella: `docs/superpowers/specs/2026-09-19-tax-platform-umbrella-design.md`)

## Global Constraints

- **All money is `Decimal`.** Never float. Quantize to cents with `Decimal("0.01")` and `ROUND_HALF_UP` only at output boundaries, never mid-calculation.
- **The engine takes no DB session, no network, no `datetime.now()`.** Anything time-dependent is passed in.
- **Verified 2026 figures** (each carries its source URL in the rate module):
  - Standard deduction single **$16,100**; head of household $24,150; married joint $32,200
  - Federal brackets single: 10% / 12% over **$12,400** / 22% over **$50,400** / 24% over **$105,700** / 32% over **$201,775** / 35% over **$256,225** / 37% over **$640,600**
  - Social Security wage base **$184,500** at **6.2%**
  - Medicare **1.45%**; Additional Medicare **0.9%** over **$200,000**
  - Colorado **4.40% flat**, applied to federal taxable income after state additions/subtractions
  - Passive loss special allowance **$25,000**, reduced by 50% of MAGI over **$100,000**, zero at **$150,000**
- **Phase 1 populates and tests `SINGLE` only.** Every other filing status raises `UnsupportedFilingStatusError` — never approximate with Single's tables.
- **Never fabricate a zero.** A value that cannot be computed is `None` with a reason, not `0`.
- **MAGI for the passive-loss phase-out excludes the passive loss itself** (IRS Pub 925). Using AGI-after-loss is wrong and creates a false circularity. This note must appear in `limitations.py`.
- **Privacy:** no SSN, no employer, no address, no document blobs anywhere in the models. Back-test inputs are gitignored.
- **Before opening a PR:** `cd backend && pytest -q` and `cd frontend && npm run lint && npm test -- --run && npm run build` must all pass.
- **Backend test-harness contract** (applies to every task with route
  tests — the plan's own test snippets get this WRONG and must be adapted,
  as Task 9 did). Verified against `backend/tests/test_categories_routes.py`
  and `backend/tests/test_tax_routes.py`:
  - `fixture` yields `(session, engine)` — so `session, _ = fixture`.
    It is NOT `(session, app)`.
  - `_seed_household(session)` returns `(household_id, headers)`. The
    headers carry authentication and must be passed on every request.
  - `_client()` takes NO arguments: `async with _client() as client:`.
  - **All routes are mounted under `/api`** (`app.include_router(api_router,
    prefix="/api")` in `app/main.py`). A test hitting `/tax/profile` rather
    than `/api/tax/profile` gets a 404 that looks like a routing bug.
  - So the shape is:
    `session, _ = fixture` → `hid, headers = await _seed_household(session)`
    → `async with _client() as client:` → `await client.get("/api/tax/...", headers=headers)`.
- **Apostrophes:** `&apos;` in **JSX text only** (ESLint `react/no-unescaped-entities`). In JS string literals and JSX attribute values use a plain `'` — `&apos;` there is not an entity and renders literally on screen.

## Blast radius (verified by direct search; the GitNexus index is stale at `fb04c54` and does not contain these symbols)

- `compute_deductions_summary` — 1 caller (`app/api/routes/deductions.py:22`) + 8 test call sites in `backend/tests/test_deductions_summary.py`
- `TaxSettings` — `app/models/tax_settings.py`, `app/models/__init__.py`, `app/schemas/tax_settings.py`, `app/api/routes/tax_settings.py`, `app/services/deductions.py:52`, and 3 test files. **The two non-test importers are load-bearing:** `app.main` pulls in the routes package, so deleting the model without removing them at the same time makes the entire app unimportable and every test uncollectable. Task 7 removes all of them together.
- Frontend consumers: `frontend/src/lib/api/deductions.ts`, `frontend/src/lib/api/tax-settings.ts`, `frontend/src/app/(app)/deductions/{page,deductions-summary-table,tax-settings-card}.tsx` and their tests

### Spec gap resolved here

The spec says `GET /deductions/summary` keeps its response shape, but
`suggested_withholding_reduction_per_period` is currently derived from
`current_federal_withholding_per_period` and
`remaining_pay_periods_this_year` — two columns this phase **drops**.

**Resolution:** the field stays in the response and keeps its meaning,
but is now computed by the engine as
`refund_or_amount_due / remaining_pay_periods`, where remaining periods
come from `Household.pay_frequency` and the latest paystub's `pay_date`.
It is `None` when no paystub exists. Task 11 implements this; Task 15
updates the copy.

## File Structure

**New — engine (pure, no I/O):**
- `backend/app/services/tax/__init__.py` — public exports only
- `backend/app/services/tax/rates/__init__.py`
- `backend/app/services/tax/rates/federal_2026.py` — federal `RateSet` fragment, sourced
- `backend/app/services/tax/rates/colorado_2026.py` — CO fragment, sourced
- `backend/app/services/tax/rates/registry.py` — `get_rates(year)`, raises on unknown year
- `backend/app/services/tax/inputs.py` — all dataclasses and enums
- `backend/app/services/tax/engine.py` — `project()`, `impact_of()`
- `backend/app/services/tax/limitations.py` — passive activity loss
- `backend/app/services/tax/safe_harbor.py` — underpayment test

**New — persistence and wiring:**
- `backend/app/models/tax_profile.py` — `TaxProfile`, `Paystub`, `PriorYearReturn`
- `backend/alembic/versions/0013_tax_projection_engine.py`
- `backend/app/services/tax_assembly.py` — DB → `TaxInputs` (the only place both worlds meet)
- `backend/app/schemas/tax.py` — Pydantic request/response models
- `backend/app/api/routes/tax.py` — profile, paystubs, prior-year, projection, impact

**Modified:**
- `backend/app/models/__init__.py`, `backend/app/models/category.py`
- `backend/app/services/deductions.py` — flat-rate math → engine
- `backend/app/api/routes/__init__.py`
- Deleted: `app/models/tax_settings.py`, `app/schemas/tax_settings.py`, `app/api/routes/tax_settings.py`

**Frontend — new:** `frontend/src/lib/api/tax.ts`, `frontend/src/app/(app)/taxes/{page,projection-card,withholding-card,next-dollar-card,paystub-form,paystub-list,filing-status-walkthrough,prior-year-form}.tsx` + tests

**Frontend — modified:** `deductions.ts`, `deductions-summary-table.tsx`, `deductions/page.tsx`; deleted `tax-settings.ts`, `tax-settings-card.tsx`

---

### Task 1: Rate tables and registry

**Files:**
- Create: `backend/app/services/tax/__init__.py`, `backend/app/services/tax/rates/__init__.py`
- Create: `backend/app/services/tax/rates/federal_2026.py`, `backend/app/services/tax/rates/colorado_2026.py`, `backend/app/services/tax/rates/registry.py`
- Test: `backend/tests/tax/test_rates_registry.py`

**Interfaces:**
- Consumes: nothing
- Produces: `FilingStatus` (StrEnum), `Bracket`, `FederalRates`, `StateRates`, `RateSet`, `get_rates(year: int) -> RateSet`, `UnknownTaxYearError`, `UnsupportedFilingStatusError`

Note: `FilingStatus` and the rate dataclasses live in `rates/registry.py` and are re-exported from `app.services.tax`. Task 2's `inputs.py` imports `FilingStatus` from `app.services.tax.rates.registry`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/tax/test_rates_registry.py
"""The rate registry must fail loudly on an unknown year rather than
silently reusing another year's brackets."""
from __future__ import annotations

from decimal import Decimal

import pytest

from app.services.tax.rates.registry import (
    FilingStatus,
    UnknownTaxYearError,
    get_rates,
)


def test_2026_single_figures_match_published_values():
    rates = get_rates(2026)
    fed = rates.federal
    assert fed.standard_deduction[FilingStatus.SINGLE] == Decimal("16100")
    assert fed.social_security_wage_base == Decimal("184500")
    assert fed.social_security_rate == Decimal("0.062")
    assert fed.medicare_rate == Decimal("0.0145")
    assert fed.additional_medicare_threshold == Decimal("200000")
    assert fed.additional_medicare_rate == Decimal("0.009")

    brackets = fed.brackets[FilingStatus.SINGLE]
    assert [b.upper for b in brackets[:3]] == [
        Decimal("12400"), Decimal("50400"), Decimal("105700")
    ]
    assert [b.rate for b in brackets[:3]] == [
        Decimal("0.10"), Decimal("0.12"), Decimal("0.22")
    ]
    assert brackets[-1].upper is None
    assert brackets[-1].rate == Decimal("0.37")


def test_brackets_are_contiguous_and_ascending():
    """A typo in a bracket edge is silent and expensive; assert structure."""
    brackets = get_rates(2026).federal.brackets[FilingStatus.SINGLE]
    uppers = [b.upper for b in brackets]
    assert uppers[-1] is None, "last bracket must be open-ended"
    finite = uppers[:-1]
    assert finite == sorted(finite), "bracket edges must ascend"
    assert len(set(finite)) == len(finite), "bracket edges must be unique"
    rates = [b.rate for b in brackets]
    assert rates == sorted(rates), "marginal rates must not decrease"


def test_colorado_is_flat_on_federal_taxable_income():
    state = get_rates(2026).state
    assert state.code == "CO"
    assert state.flat_rate == Decimal("0.044")
    assert state.starts_from_federal_taxable_income is True


def test_unknown_year_raises_rather_than_falling_back():
    with pytest.raises(UnknownTaxYearError) as exc:
        get_rates(2019)
    assert "2019" in str(exc.value)


def test_passive_loss_allowance_constants():
    pal = get_rates(2026).passive_loss
    assert pal.max_allowance == Decimal("25000")
    assert pal.phaseout_start == Decimal("100000")
    assert pal.phaseout_end == Decimal("150000")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/tax/test_rates_registry.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.tax'`

- [ ] **Step 3: Write minimal implementation**

```python
# backend/app/services/tax/__init__.py
"""Pure tax calculation. No database session, no network, no clock.

Everything in this package is a function of its arguments. That is what
makes the engine testable against published IRS examples and what lets
the phase 3 optimizer re-run it safely with perturbed inputs.
"""
```

```python
# backend/app/services/tax/rates/__init__.py
```

```python
# backend/app/services/tax/rates/registry.py
"""Versioned tax rate tables, one module per jurisdiction per year.

Rates are DATA, reviewed once a year. Every figure carries its source URL
in the module that defines it. get_rates() raises on a year it has no
table for rather than falling back to an adjacent year -- a stale-rate
bug is invisible in the UI and wrong by thousands of dollars.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from enum import StrEnum


class FilingStatus(StrEnum):
    SINGLE = "single"
    MARRIED_JOINT = "married_joint"
    MARRIED_SEPARATE = "married_separate"
    HEAD_OF_HOUSEHOLD = "head_of_household"
    QUALIFYING_SURVIVING_SPOUSE = "qualifying_surviving_spouse"


class UnknownTaxYearError(LookupError):
    """No rate table exists for the requested year."""


class UnsupportedFilingStatusError(NotImplementedError):
    """Phase 1 populates SINGLE only; others must not be approximated."""


@dataclass(frozen=True)
class Bracket:
    upper: Decimal | None   # None = open-ended top bracket
    rate: Decimal


@dataclass(frozen=True)
class FederalRates:
    brackets: dict[FilingStatus, list[Bracket]]
    standard_deduction: dict[FilingStatus, Decimal]
    social_security_wage_base: Decimal
    social_security_rate: Decimal
    medicare_rate: Decimal
    additional_medicare_threshold: Decimal
    additional_medicare_rate: Decimal


@dataclass(frozen=True)
class StateRates:
    code: str
    flat_rate: Decimal
    starts_from_federal_taxable_income: bool


@dataclass(frozen=True)
class PassiveLossRates:
    max_allowance: Decimal
    phaseout_start: Decimal
    phaseout_end: Decimal


@dataclass(frozen=True)
class RateSet:
    year: int
    federal: FederalRates
    state: StateRates
    passive_loss: PassiveLossRates
    supported_statuses: frozenset[FilingStatus]


def get_rates(year: int) -> RateSet:
    from app.services.tax.rates import colorado_2026, federal_2026

    if year == 2026:
        return RateSet(
            year=2026,
            federal=federal_2026.RATES,
            state=colorado_2026.RATES,
            passive_loss=federal_2026.PASSIVE_LOSS,
            supported_statuses=federal_2026.SUPPORTED_STATUSES,
        )
    raise UnknownTaxYearError(
        f"No tax rate table for {year}. Rate tables are added deliberately, "
        f"one module per year -- see app/services/tax/rates/."
    )
```

```python
# backend/app/services/tax/rates/federal_2026.py
"""Federal rates for tax year 2026.

Source: IRS, "IRS releases tax inflation adjustments for tax year 2026,
including amendments from the One, Big, Beautiful Bill"
https://www.irs.gov/newsroom/irs-releases-tax-inflation-adjustments-for-tax-year-2026-including-amendments-from-the-one-big-beautiful-bill

Social Security wage base source: SSA Contribution and Benefit Base
https://www.ssa.gov/oact/cola/cbb.html

Passive activity loss allowance source: IRS Publication 925
https://www.irs.gov/publications/p925

NOTE: 2026 incorporates One Big Beautiful Bill amendments. Do not derive
a later year's figures from these by inflation-adjusting them; add a new
module with its own sourced values.
"""
from __future__ import annotations

from decimal import Decimal

from app.services.tax.rates.registry import (
    Bracket,
    FederalRates,
    FilingStatus,
    PassiveLossRates,
)

_SINGLE_BRACKETS = [
    Bracket(Decimal("12400"), Decimal("0.10")),
    Bracket(Decimal("50400"), Decimal("0.12")),
    Bracket(Decimal("105700"), Decimal("0.22")),
    Bracket(Decimal("201775"), Decimal("0.24")),
    Bracket(Decimal("256225"), Decimal("0.32")),
    Bracket(Decimal("640600"), Decimal("0.35")),
    Bracket(None, Decimal("0.37")),
]

# Phase 1 populates SINGLE only. Other statuses are structurally supported
# -- the shape is identical -- but must raise rather than return wrong
# numbers. Populate them by adding their sourced bracket lists here and
# extending SUPPORTED_STATUSES.
SUPPORTED_STATUSES = frozenset({FilingStatus.SINGLE})

RATES = FederalRates(
    brackets={FilingStatus.SINGLE: _SINGLE_BRACKETS},
    standard_deduction={
        FilingStatus.SINGLE: Decimal("16100"),
        FilingStatus.HEAD_OF_HOUSEHOLD: Decimal("24150"),
        FilingStatus.MARRIED_JOINT: Decimal("32200"),
    },
    social_security_wage_base=Decimal("184500"),
    social_security_rate=Decimal("0.062"),
    medicare_rate=Decimal("0.0145"),
    additional_medicare_threshold=Decimal("200000"),
    additional_medicare_rate=Decimal("0.009"),
)

PASSIVE_LOSS = PassiveLossRates(
    max_allowance=Decimal("25000"),
    phaseout_start=Decimal("100000"),
    phaseout_end=Decimal("150000"),
)
```

```python
# backend/app/services/tax/rates/colorado_2026.py
"""Colorado rates for tax year 2026.

Colorado applies a flat rate to FEDERAL TAXABLE INCOME after state
additions and subtractions -- so the federal standard deduction flows
through and there is no state bracket table or state standard deduction.

Source: Colorado Department of Revenue, Individual Income Tax Guide
https://tax.colorado.gov/individual-income-tax-guide
"""
from __future__ import annotations

from decimal import Decimal

from app.services.tax.rates.registry import StateRates

RATES = StateRates(
    code="CO",
    flat_rate=Decimal("0.044"),
    starts_from_federal_taxable_income=True,
)
```

Also create `backend/tests/tax/__init__.py` (empty) if the test suite requires package init — check whether `backend/tests/` has an `__init__.py` and match it.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/tax/test_rates_registry.py -v`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/tax backend/tests/tax
git commit -m "feat(tax): add versioned 2026 federal and Colorado rate tables

Rate tables are data with a source URL per figure. get_rates() raises on
an unknown year rather than falling back, because a stale-rate bug is
invisible in the UI and wrong by thousands."
```

---

### Task 2: Engine input and output types

**Files:**
- Create: `backend/app/services/tax/inputs.py`
- Test: `backend/tests/tax/test_inputs.py`

**Interfaces:**
- Consumes: `FilingStatus` from Task 1
- Produces: `WithholdingBuckets`, `ScheduleEResult`, `TaxInputs`, `SafeHarborResult`, `ExplainStep`, `TaxProjection`, `Change` (+ subclasses `ExtraWages`, `ExtraPretax401k`, `ExtraPretaxHsa`, `ExtraBusinessExpense`, `ExtraItemizedDeduction`)

Every field is `Decimal`. Deferral types are **separate fields, not one total**, because they hit different tax bases: a 401(k) dollar reduces federal and state tax but not FICA, while an HSA dollar reduces all three. This distinction is the difference between 28.40% and 36.05% for the household in the spec, and a single `pretax_total` field would make it unrepresentable.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/tax/test_inputs.py
"""Input types must be frozen (the engine perturbs by copy, never mutation)
and must keep deferral types separate."""
from __future__ import annotations

import dataclasses
from decimal import Decimal

import pytest

from app.services.tax.inputs import (
    ExtraPretax401k,
    ExtraWages,
    ScheduleEResult,
    TaxInputs,
    WithholdingBuckets,
)
from app.services.tax.rates.registry import FilingStatus


def _minimal_inputs(**overrides) -> TaxInputs:
    base = dict(
        filing_status=FilingStatus.SINGLE,
        wages_ytd=Decimal("100000"),
        projected_remaining_wages=Decimal("0"),
        pretax_401k=Decimal("0"),
        pretax_hsa=Decimal("0"),
        pretax_other=Decimal("0"),
        federal_withheld_ytd=Decimal("0"),
        state_withheld_ytd=Decimal("0"),
        ss_withheld_ytd=Decimal("0"),
        medicare_withheld_ytd=Decimal("0"),
        projected_remaining_withholding=WithholdingBuckets.zero(),
        itemized_deductions=Decimal("0"),
        schedule_e=None,
        prior_year_total_tax=None,
        prior_year_agi=None,
    )
    base.update(overrides)
    return TaxInputs(**base)


def test_tax_inputs_are_frozen():
    inputs = _minimal_inputs()
    with pytest.raises(dataclasses.FrozenInstanceError):
        inputs.wages_ytd = Decimal("1")  # type: ignore[misc]


def test_deferral_types_are_separate_fields():
    """401(k) and HSA hit different tax bases; one lumped total cannot
    express that. Guard against a future 'simplification'."""
    names = {f.name for f in dataclasses.fields(TaxInputs)}
    assert {"pretax_401k", "pretax_hsa", "pretax_other"} <= names
    assert "pretax_total" not in names


def test_total_wages_sums_ytd_and_projected():
    inputs = _minimal_inputs(
        wages_ytd=Decimal("120000"), projected_remaining_wages=Decimal("59000")
    )
    assert inputs.total_wages == Decimal("179000")


def test_withholding_buckets_total():
    buckets = WithholdingBuckets(
        federal=Decimal("100"), state=Decimal("20"),
        social_security=Decimal("62"), medicare=Decimal("15"),
    )
    assert buckets.total == Decimal("197")
    assert WithholdingBuckets.zero().total == Decimal("0")


def test_schedule_e_net_is_supplied_unlimited():
    """Phase 2 supplies the UNLIMITED net; the engine applies the passive
    loss limit. Confirm the carry-in field exists for that calculation."""
    result = ScheduleEResult(
        gross_rental_income=Decimal("30000"),
        allowable_expenses=Decimal("48000"),
        net=Decimal("-18000"),
        active_participation=True,
        suspended_loss_carryin=Decimal("4000"),
    )
    assert result.net == Decimal("-18000")
    assert result.is_loss is True


def test_change_types_apply_to_the_right_field():
    inputs = _minimal_inputs()
    bumped = ExtraWages(Decimal("1000")).apply(inputs)
    assert bumped.projected_remaining_wages == Decimal("1000")
    assert bumped.wages_ytd == inputs.wages_ytd, "must not mutate YTD actuals"

    deferred = ExtraPretax401k(Decimal("5000")).apply(inputs)
    assert deferred.pretax_401k == Decimal("5000")
    assert deferred.total_wages == inputs.total_wages, "deferral is not income"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/tax/test_inputs.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.tax.inputs'`

- [ ] **Step 3: Write minimal implementation**

```python
# backend/app/services/tax/inputs.py
"""Engine input and output types.

All money is Decimal. All inputs are frozen -- impact_of() perturbs by
dataclasses.replace(), never by mutation, so a caller's inputs can never
be corrupted by asking a hypothetical question about them.
"""
from __future__ import annotations

from dataclasses import dataclass, replace
from decimal import Decimal
from typing import Literal

from app.services.tax.rates.registry import FilingStatus

ZERO = Decimal("0")


@dataclass(frozen=True)
class WithholdingBuckets:
    federal: Decimal
    state: Decimal
    social_security: Decimal
    medicare: Decimal

    @classmethod
    def zero(cls) -> "WithholdingBuckets":
        return cls(federal=ZERO, state=ZERO, social_security=ZERO, medicare=ZERO)

    @property
    def total(self) -> Decimal:
        return self.federal + self.state + self.social_security + self.medicare


@dataclass(frozen=True)
class ScheduleEResult:
    """The phase 2 -> phase 1 boundary.

    `net` is the UNLIMITED result of the rental business. The engine, not
    phase 2, applies the passive activity loss limitation -- loss
    limitation is tax law and belongs with the tax math. See
    limitations.py.
    """
    gross_rental_income: Decimal
    allowable_expenses: Decimal
    net: Decimal
    active_participation: bool
    suspended_loss_carryin: Decimal

    @property
    def is_loss(self) -> bool:
        return self.net < ZERO


@dataclass(frozen=True)
class TaxInputs:
    filing_status: FilingStatus
    wages_ytd: Decimal
    projected_remaining_wages: Decimal
    pretax_401k: Decimal
    pretax_hsa: Decimal
    pretax_other: Decimal
    federal_withheld_ytd: Decimal
    state_withheld_ytd: Decimal
    ss_withheld_ytd: Decimal
    medicare_withheld_ytd: Decimal
    projected_remaining_withholding: WithholdingBuckets
    itemized_deductions: Decimal
    schedule_e: ScheduleEResult | None
    prior_year_total_tax: Decimal | None
    prior_year_agi: Decimal | None

    @property
    def total_wages(self) -> Decimal:
        return self.wages_ytd + self.projected_remaining_wages

    @property
    def withheld_ytd_total(self) -> Decimal:
        return (
            self.federal_withheld_ytd + self.state_withheld_ytd
            + self.ss_withheld_ytd + self.medicare_withheld_ytd
        )


@dataclass(frozen=True)
class ExplainStep:
    """One rule application, in the order the engine applied it. Backs the
    'show the work' principle -- built by the engine, never reconstructed
    by the UI."""
    label: str
    amount: Decimal
    detail: str


@dataclass(frozen=True)
class SafeHarborResult:
    status: Literal["met", "not_met", "unknown"]
    test_used: Literal["90_percent_current", "100_percent_prior",
                       "110_percent_prior", "none"]
    required_payment: Decimal | None
    projected_payment: Decimal | None
    shortfall: Decimal | None
    per_period_to_close: Decimal | None
    reason: str


@dataclass(frozen=True)
class TaxProjection:
    agi: Decimal
    magi_for_pal: Decimal
    deduction_taken: Decimal
    deduction_kind: Literal["standard", "itemized"]
    standard_deduction: Decimal
    itemized_total: Decimal
    taxable_income: Decimal
    federal_income_tax: Decimal
    social_security_tax: Decimal
    medicare_tax: Decimal
    additional_medicare_tax: Decimal
    state_tax: Decimal
    total_liability: Decimal
    total_withheld_projected: Decimal
    refund_or_amount_due: Decimal   # positive = refund, negative = owed
    effective_rate: Decimal
    schedule_e_allowed_loss: Decimal
    schedule_e_suspended_loss: Decimal
    safe_harbor: SafeHarborResult
    explain: list[ExplainStep]


class Change:
    """A hypothetical adjustment. impact_of() applies one and re-runs the
    engine. Phase 3 enumerates these; it adds no tax math of its own."""
    def apply(self, inputs: TaxInputs) -> TaxInputs:
        raise NotImplementedError


@dataclass(frozen=True)
class ExtraWages(Change):
    amount: Decimal

    def apply(self, inputs: TaxInputs) -> TaxInputs:
        # Adjust PROJECTED wages, never YTD actuals -- YTD is measured fact.
        return replace(
            inputs,
            projected_remaining_wages=inputs.projected_remaining_wages + self.amount,
        )


@dataclass(frozen=True)
class ExtraPretax401k(Change):
    amount: Decimal

    def apply(self, inputs: TaxInputs) -> TaxInputs:
        return replace(inputs, pretax_401k=inputs.pretax_401k + self.amount)


@dataclass(frozen=True)
class ExtraPretaxHsa(Change):
    amount: Decimal

    def apply(self, inputs: TaxInputs) -> TaxInputs:
        return replace(inputs, pretax_hsa=inputs.pretax_hsa + self.amount)


@dataclass(frozen=True)
class ExtraItemizedDeduction(Change):
    amount: Decimal

    def apply(self, inputs: TaxInputs) -> TaxInputs:
        return replace(
            inputs, itemized_deductions=inputs.itemized_deductions + self.amount
        )


@dataclass(frozen=True)
class ExtraBusinessExpense(Change):
    """A Schedule E expense. Reduces rental net dollar for dollar, which is
    why it is worth something even when itemized deductions are worth
    nothing -- but it may be limited if it creates a loss."""
    amount: Decimal

    def apply(self, inputs: TaxInputs) -> TaxInputs:
        if inputs.schedule_e is None:
            existing = ScheduleEResult(
                gross_rental_income=ZERO, allowable_expenses=ZERO, net=ZERO,
                active_participation=True, suspended_loss_carryin=ZERO,
            )
        else:
            existing = inputs.schedule_e
        return replace(
            inputs,
            schedule_e=replace(
                existing,
                allowable_expenses=existing.allowable_expenses + self.amount,
                net=existing.net - self.amount,
            ),
        )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/tax/test_inputs.py -v`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/tax/inputs.py backend/tests/tax/test_inputs.py
git commit -m "feat(tax): add frozen engine input and output types

Deferral types stay separate fields because 401(k) and HSA dollars hit
different tax bases -- the difference between a 28.40% and 36.05%
valuation. Changes apply by replace(), never mutation."
```

---

### Task 3: Core engine — deduction choice, brackets, FICA, state

**Files:**
- Create: `backend/app/services/tax/engine.py`
- Test: `backend/tests/tax/test_engine_core.py`

**Interfaces:**
- Consumes: Task 1 rates, Task 2 types
- Produces: `project(inputs: TaxInputs, rates: RateSet) -> TaxProjection`

This task implements everything except the passive-loss limitation (Task 4) and safe harbor (Task 5). Wire those in as stubs: `schedule_e_allowed_loss` uses the unlimited net and `safe_harbor` is a fixed "unknown" result. Tasks 4 and 5 replace the stubs.

**Critical:** 401(k) reduces federal and state taxable income but **not** the FICA wage base. HSA reduces both. Getting this backwards silently overstates every deferral's value by roughly 27%.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/tax/test_engine_core.py
"""Core engine math, asserted against figures computed from the published
2026 tables. Every expected value here is hand-derivable from the rate
module -- if one fails, check the rate table before the engine."""
from __future__ import annotations

from decimal import Decimal

import pytest

from app.services.tax.engine import project
from app.services.tax.inputs import TaxInputs, WithholdingBuckets
from app.services.tax.rates.registry import (
    FilingStatus,
    UnsupportedFilingStatusError,
    get_rates,
)

RATES = get_rates(2026)


def make_inputs(**overrides) -> TaxInputs:
    base = dict(
        filing_status=FilingStatus.SINGLE,
        wages_ytd=Decimal("179000"),
        projected_remaining_wages=Decimal("0"),
        pretax_401k=Decimal("0"),
        pretax_hsa=Decimal("0"),
        pretax_other=Decimal("0"),
        federal_withheld_ytd=Decimal("0"),
        state_withheld_ytd=Decimal("0"),
        ss_withheld_ytd=Decimal("0"),
        medicare_withheld_ytd=Decimal("0"),
        projected_remaining_withholding=WithholdingBuckets.zero(),
        itemized_deductions=Decimal("0"),
        schedule_e=None,
        prior_year_total_tax=None,
        prior_year_agi=None,
    )
    base.update(overrides)
    return TaxInputs(**base)


def test_single_filer_179k_full_picture():
    """The spec's worked example. 179,000 - 16,100 = 162,900 taxable."""
    p = project(make_inputs(), RATES)
    assert p.agi == Decimal("179000")
    assert p.deduction_kind == "standard"
    assert p.deduction_taken == Decimal("16100")
    assert p.taxable_income == Decimal("162900")
    assert p.federal_income_tax == Decimal("31694.00")
    assert p.social_security_tax == Decimal("11098.00")
    assert p.medicare_tax == Decimal("2595.50")
    assert p.additional_medicare_tax == Decimal("0.00")
    assert p.state_tax == Decimal("7167.60")
    assert p.total_liability == Decimal("52555.10")


def test_standard_deduction_wins_when_itemized_is_lower():
    p = project(make_inputs(itemized_deductions=Decimal("5000")), RATES)
    assert p.deduction_kind == "standard"
    assert p.deduction_taken == Decimal("16100")
    assert p.itemized_total == Decimal("5000")
    assert p.standard_deduction == Decimal("16100")


def test_itemized_wins_when_higher():
    p = project(make_inputs(itemized_deductions=Decimal("20000")), RATES)
    assert p.deduction_kind == "itemized"
    assert p.deduction_taken == Decimal("20000")


def test_401k_reduces_income_tax_but_not_fica():
    """The single most important behavior in this module."""
    base = project(make_inputs(), RATES)
    deferred = project(make_inputs(pretax_401k=Decimal("23500")), RATES)

    assert deferred.social_security_tax == base.social_security_tax
    assert deferred.medicare_tax == base.medicare_tax
    assert deferred.federal_income_tax < base.federal_income_tax
    assert deferred.state_tax < base.state_tax

    saved = base.total_liability - deferred.total_liability
    assert saved == Decimal("6674.00")


def test_hsa_reduces_fica_as_well():
    base = project(make_inputs(), RATES)
    hsa = project(make_inputs(pretax_hsa=Decimal("4000")), RATES)
    assert hsa.social_security_tax < base.social_security_tax
    assert hsa.medicare_tax < base.medicare_tax


def test_social_security_caps_at_the_wage_base():
    capped = project(make_inputs(wages_ytd=Decimal("300000")), RATES)
    expected = Decimal("184500") * Decimal("0.062")
    assert capped.social_security_tax == expected.quantize(Decimal("0.01"))


def test_additional_medicare_applies_only_above_threshold():
    below = project(make_inputs(wages_ytd=Decimal("199000")), RATES)
    assert below.additional_medicare_tax == Decimal("0.00")

    above = project(make_inputs(wages_ytd=Decimal("210000")), RATES)
    assert above.additional_medicare_tax == (
        Decimal("10000") * Decimal("0.009")
    ).quantize(Decimal("0.01"))


def test_colorado_applies_to_federal_taxable_income():
    p = project(make_inputs(), RATES)
    assert p.state_tax == (
        p.taxable_income * Decimal("0.044")
    ).quantize(Decimal("0.01"))


def test_taxable_income_never_negative():
    p = project(make_inputs(wages_ytd=Decimal("10000")), RATES)
    assert p.taxable_income == Decimal("0")
    assert p.federal_income_tax == Decimal("0.00")


def test_refund_is_positive_and_amount_due_is_negative():
    owed = project(make_inputs(federal_withheld_ytd=Decimal("1000")), RATES)
    assert owed.refund_or_amount_due < 0

    refund = project(
        make_inputs(
            federal_withheld_ytd=Decimal("40000"),
            state_withheld_ytd=Decimal("8000"),
            ss_withheld_ytd=Decimal("11098"),
            medicare_withheld_ytd=Decimal("2595.50"),
        ),
        RATES,
    )
    assert refund.refund_or_amount_due > 0


def test_unsupported_filing_status_raises_rather_than_approximating():
    with pytest.raises(UnsupportedFilingStatusError):
        project(make_inputs(filing_status=FilingStatus.MARRIED_JOINT), RATES)


def test_explain_trace_is_populated_and_ordered():
    p = project(make_inputs(), RATES)
    labels = [s.label for s in p.explain]
    assert "Adjusted gross income" in labels
    assert "Taxable income" in labels
    assert labels.index("Adjusted gross income") < labels.index("Taxable income")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/tax/test_engine_core.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.tax.engine'`

- [ ] **Step 3: Write minimal implementation**

```python
# backend/app/services/tax/engine.py
"""The tax engine. A pure function of its arguments.

No database session, no network, no clock. This is what makes it
testable against published IRS examples and safe for the phase 3
optimizer to re-run with perturbed inputs.
"""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

from app.services.tax.inputs import (
    ZERO,
    ExplainStep,
    SafeHarborResult,
    TaxInputs,
    TaxProjection,
)
from app.services.tax.rates.registry import (
    FilingStatus,
    RateSet,
    UnsupportedFilingStatusError,
)

CENTS = Decimal("0.01")


def _cents(value: Decimal) -> Decimal:
    return value.quantize(CENTS, rounding=ROUND_HALF_UP)


def _bracket_tax(taxable: Decimal, brackets) -> Decimal:
    """Progressive tax. Each bracket's rate applies only to the income
    inside it -- never the whole amount."""
    tax = ZERO
    lower = ZERO
    for bracket in brackets:
        if bracket.upper is None or taxable <= bracket.upper:
            return tax + (taxable - lower) * bracket.rate
        tax += (bracket.upper - lower) * bracket.rate
        lower = bracket.upper
    return tax


_UNKNOWN_SAFE_HARBOR = SafeHarborResult(
    status="unknown",
    test_used="none",
    required_payment=None,
    projected_payment=None,
    shortfall=None,
    per_period_to_close=None,
    reason="Safe harbor is computed in safe_harbor.py (Task 5).",
)


def project(inputs: TaxInputs, rates: RateSet) -> TaxProjection:
    if inputs.filing_status not in rates.supported_statuses:
        raise UnsupportedFilingStatusError(
            f"{inputs.filing_status} is not populated for {rates.year}. "
            "Approximating with another status would be wrong by thousands; "
            "add its sourced rate table instead."
        )

    explain: list[ExplainStep] = []
    fed = rates.federal

    # --- Wage bases -----------------------------------------------------
    # 401(k) reduces income tax but NOT the FICA wage base. HSA reduces
    # both. Reversing this overstates a deferral's value by ~27%.
    gross_wages = inputs.total_wages
    fica_wages = gross_wages - inputs.pretax_hsa - inputs.pretax_other
    income_tax_wages = fica_wages - inputs.pretax_401k

    explain.append(ExplainStep(
        "Wages", _cents(gross_wages),
        "Year-to-date actuals plus projected remaining pay.",
    ))

    # --- Schedule E (unlimited here; Task 4 applies the loss limit) -----
    schedule_e_net = inputs.schedule_e.net if inputs.schedule_e else ZERO
    allowed_loss = -schedule_e_net if schedule_e_net < ZERO else ZERO
    suspended_loss = ZERO

    # MAGI for the passive-loss phase-out EXCLUDES the passive loss itself
    # (IRS Pub 925). Task 4 consumes this.
    magi_for_pal = income_tax_wages

    agi = income_tax_wages + schedule_e_net
    explain.append(ExplainStep(
        "Adjusted gross income", _cents(agi),
        "Wages less pre-tax deferrals, plus rental income or allowed loss.",
    ))

    # --- Deduction ------------------------------------------------------
    standard = fed.standard_deduction[inputs.filing_status]
    itemized = inputs.itemized_deductions
    if itemized > standard:
        deduction_taken, deduction_kind = itemized, "itemized"
        detail = "Itemized deductions exceed the standard deduction."
    else:
        deduction_taken, deduction_kind = standard, "standard"
        detail = (
            f"Standard deduction applies. Itemized deductions total "
            f"{_cents(itemized)}, which is below it, so they reduce your "
            f"tax by nothing this year."
        )
    explain.append(ExplainStep("Deduction", _cents(deduction_taken), detail))

    taxable_income = max(ZERO, agi - deduction_taken)
    explain.append(ExplainStep(
        "Taxable income", _cents(taxable_income),
        "Adjusted gross income less your deduction, floored at zero.",
    ))

    # --- Federal income tax ---------------------------------------------
    federal_income_tax = _cents(
        _bracket_tax(taxable_income, fed.brackets[inputs.filing_status])
    )
    explain.append(ExplainStep(
        "Federal income tax", federal_income_tax,
        "Each bracket's rate applied only to the income inside it.",
    ))

    # --- FICA ------------------------------------------------------------
    ss_base = min(fica_wages, fed.social_security_wage_base)
    social_security_tax = _cents(ss_base * fed.social_security_rate)
    medicare_tax = _cents(fica_wages * fed.medicare_rate)
    additional_medicare_tax = _cents(
        max(ZERO, fica_wages - fed.additional_medicare_threshold)
        * fed.additional_medicare_rate
    )
    explain.append(ExplainStep(
        "Social Security", social_security_tax,
        f"6.2% on wages up to {_cents(fed.social_security_wage_base)}. "
        "Pre-tax 401(k) does not reduce this.",
    ))
    explain.append(ExplainStep(
        "Medicare", medicare_tax + additional_medicare_tax,
        "1.45% on all wages, plus 0.9% above "
        f"{_cents(fed.additional_medicare_threshold)}.",
    ))

    # --- State -----------------------------------------------------------
    state_tax = _cents(taxable_income * rates.state.flat_rate)
    explain.append(ExplainStep(
        f"{rates.state.code} income tax", state_tax,
        f"{rates.state.flat_rate * 100}% flat on federal taxable income.",
    ))

    total_liability = _cents(
        federal_income_tax + social_security_tax + medicare_tax
        + additional_medicare_tax + state_tax
    )
    total_withheld = _cents(
        inputs.withheld_ytd_total + inputs.projected_remaining_withholding.total
    )
    refund_or_amount_due = _cents(total_withheld - total_liability)

    effective_rate = (
        _cents(total_liability / gross_wages * 100) if gross_wages > ZERO else ZERO
    )

    return TaxProjection(
        agi=_cents(agi),
        magi_for_pal=_cents(magi_for_pal),
        deduction_taken=_cents(deduction_taken),
        deduction_kind=deduction_kind,
        standard_deduction=_cents(standard),
        itemized_total=_cents(itemized),
        taxable_income=_cents(taxable_income),
        federal_income_tax=federal_income_tax,
        social_security_tax=social_security_tax,
        medicare_tax=medicare_tax,
        additional_medicare_tax=additional_medicare_tax,
        state_tax=state_tax,
        total_liability=total_liability,
        total_withheld_projected=total_withheld,
        refund_or_amount_due=refund_or_amount_due,
        effective_rate=effective_rate,
        schedule_e_allowed_loss=_cents(allowed_loss),
        schedule_e_suspended_loss=_cents(suspended_loss),
        safe_harbor=_UNKNOWN_SAFE_HARBOR,
        explain=explain,
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/tax/test_engine_core.py -v`
Expected: PASS (12 tests)

If `test_single_filer_179k_full_picture` fails, hand-check against the rate table before touching the engine: 162,900 taxable → 10% of 12,400 = 1,240; 12% of 38,000 = 4,560; 22% of 55,300 = 12,166; 24% of 57,200 = 13,728; total 31,694.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/tax/engine.py backend/tests/tax/test_engine_core.py
git commit -m "feat(tax): add core projection engine

Progressive brackets, standard-vs-itemized selection, FICA with the wage
base cap and Additional Medicare, and Colorado's flat rate on federal
taxable income. 401(k) reduces income tax but not the FICA base; HSA
reduces both. Passive-loss limiting and safe harbor are stubbed for the
next two tasks."
```

---

### Task 4: Passive activity loss limitation

**Files:**
- Create: `backend/app/services/tax/limitations.py`
- Modify: `backend/app/services/tax/engine.py` (replace the unlimited-loss stub)
- Test: `backend/tests/tax/test_limitations.py`

**Interfaces:**
- Consumes: `PassiveLossRates` (Task 1), `ScheduleEResult` (Task 2)
- Produces: `allowed_rental_loss(magi, rental_loss, active_participation, rates) -> LossAllowance` where `LossAllowance` is a frozen dataclass with `allowed: Decimal` and `suspended: Decimal`

**This is the subtlest task in the plan.** The $25,000 special allowance shrinks by 50¢ per dollar of MAGI above $100,000 and is gone at $150,000. The allowance depends on MAGI, and MAGI appears to depend on the loss — but **IRS Pub 925 defines MAGI for this purpose to exclude the passive loss itself**, so this is a single forward pass, not a fixed-point solve. Implementing it the intuitive way (AGI after the loss) turns a $15,000 allowance into $18,000 and is wrong.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/tax/test_limitations.py
"""Passive activity loss limitation.

Expected values are derived directly from IRS Pub 925: allowance is
$25,000, reduced by 50% of MAGI over $100,000, zero at $150,000.
"""
from __future__ import annotations

from decimal import Decimal

import pytest

from app.services.tax.engine import project
from app.services.tax.inputs import ScheduleEResult, TaxInputs, WithholdingBuckets
from app.services.tax.limitations import allowed_rental_loss
from app.services.tax.rates.registry import FilingStatus, get_rates

RATES = get_rates(2026)
PAL = RATES.passive_loss
LOSS = Decimal("-18000")


@pytest.mark.parametrize(
    "magi,expected_allowed,expected_suspended",
    [
        (Decimal("85000"), Decimal("18000"), Decimal("0")),
        (Decimal("100000"), Decimal("18000"), Decimal("0")),
        (Decimal("105000"), Decimal("18000"), Decimal("0")),
        (Decimal("120000"), Decimal("15000"), Decimal("3000")),
        (Decimal("140000"), Decimal("5000"), Decimal("13000")),
        (Decimal("150000"), Decimal("0"), Decimal("18000")),
        (Decimal("179000"), Decimal("0"), Decimal("18000")),
    ],
)
def test_allowance_phases_out_between_100k_and_150k(
    magi, expected_allowed, expected_suspended
):
    result = allowed_rental_loss(magi, LOSS, True, PAL)
    assert result.allowed == expected_allowed
    assert result.suspended == expected_suspended


def test_no_active_participation_means_no_allowance():
    result = allowed_rental_loss(Decimal("50000"), LOSS, False, PAL)
    assert result.allowed == Decimal("0")
    assert result.suspended == Decimal("18000")


def test_rental_income_is_not_limited():
    """Only LOSSES are limited. Income passes through untouched."""
    result = allowed_rental_loss(Decimal("179000"), Decimal("12000"), True, PAL)
    assert result.allowed == Decimal("12000")
    assert result.suspended == Decimal("0")


def test_magi_excludes_the_passive_loss_itself():
    """IRS Pub 925 regression guard. Using AGI-after-loss would give an
    $18,000 allowance here instead of the correct $15,000, and would
    create an apparent circularity that does not exist."""
    magi_correct = Decimal("120000")
    magi_wrong = magi_correct + LOSS  # 102,000 -- what AGI-after-loss gives

    assert allowed_rental_loss(magi_correct, LOSS, True, PAL).allowed == Decimal("15000")
    assert allowed_rental_loss(magi_wrong, LOSS, True, PAL).allowed == Decimal("18000")


def _inputs_with_rental_loss(wages: Decimal) -> TaxInputs:
    return TaxInputs(
        filing_status=FilingStatus.SINGLE,
        wages_ytd=wages,
        projected_remaining_wages=Decimal("0"),
        pretax_401k=Decimal("0"),
        pretax_hsa=Decimal("0"),
        pretax_other=Decimal("0"),
        federal_withheld_ytd=Decimal("0"),
        state_withheld_ytd=Decimal("0"),
        ss_withheld_ytd=Decimal("0"),
        medicare_withheld_ytd=Decimal("0"),
        projected_remaining_withholding=WithholdingBuckets.zero(),
        itemized_deductions=Decimal("0"),
        schedule_e=ScheduleEResult(
            gross_rental_income=Decimal("30000"),
            allowable_expenses=Decimal("48000"),
            net=LOSS,
            active_participation=True,
            suspended_loss_carryin=Decimal("0"),
        ),
        prior_year_total_tax=None,
        prior_year_agi=None,
    )


def test_engine_applies_the_limit_rather_than_passing_the_loss_through():
    """At $160k wages the whole loss suspends, so AGI must equal wages."""
    p = project(_inputs_with_rental_loss(Decimal("160000")), RATES)
    assert p.schedule_e_allowed_loss == Decimal("0.00")
    assert p.schedule_e_suspended_loss == Decimal("18000.00")
    assert p.agi == Decimal("160000.00")


def test_engine_allows_the_full_loss_below_the_phaseout():
    p = project(_inputs_with_rental_loss(Decimal("85000")), RATES)
    assert p.schedule_e_allowed_loss == Decimal("18000.00")
    assert p.agi == Decimal("67000.00")


def test_magi_for_pal_is_reported_and_excludes_the_loss():
    p = project(_inputs_with_rental_loss(Decimal("120000")), RATES)
    assert p.magi_for_pal == Decimal("120000.00")
    assert p.schedule_e_allowed_loss == Decimal("15000.00")
    assert p.schedule_e_suspended_loss == Decimal("3000.00")
    assert p.agi == Decimal("105000.00")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/tax/test_limitations.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.tax.limitations'`

- [ ] **Step 3: Write minimal implementation**

```python
# backend/app/services/tax/limitations.py
"""Passive activity loss limitation (IRS Publication 925).

A rental loss is not automatically usable against W2 income. A special
allowance of $25,000 is reduced by 50% of modified AGI over $100,000 and
is gone entirely at $150,000. The unused portion is SUSPENDED and
carries forward -- it is not lost, but it does not help this year.

CRITICAL IMPLEMENTATION NOTE
----------------------------
The allowance depends on MAGI, and MAGI looks like it depends on the
loss, which looks circular. It is not. Pub 925 defines MAGI for this
purpose to EXCLUDE the passive loss itself, so this is a single forward
pass with no fixed-point solve.

Implementing it the intuitive way -- using AGI after the loss has been
applied -- gives a different and WRONG answer: at $120,000 of wages with
an $18,000 loss, the correct allowance is $15,000, but AGI-after-loss
($102,000) yields $18,000. Do not "simplify" this.

https://www.irs.gov/publications/p925
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from app.services.tax.rates.registry import PassiveLossRates

ZERO = Decimal("0")
HALF = Decimal("0.5")


@dataclass(frozen=True)
class LossAllowance:
    allowed: Decimal     # positive magnitude usable this year
    suspended: Decimal   # positive magnitude carried forward


def allowed_rental_loss(
    magi: Decimal,
    rental_net: Decimal,
    active_participation: bool,
    rates: PassiveLossRates,
) -> LossAllowance:
    """`magi` must EXCLUDE the passive loss (see module docstring).

    `rental_net` is signed: negative is a loss, positive is income.
    Income is never limited and passes through untouched.
    """
    if rental_net >= ZERO:
        return LossAllowance(allowed=rental_net, suspended=ZERO)

    loss = -rental_net

    if not active_participation:
        return LossAllowance(allowed=ZERO, suspended=loss)

    if magi <= rates.phaseout_start:
        allowance = rates.max_allowance
    elif magi >= rates.phaseout_end:
        allowance = ZERO
    else:
        allowance = rates.max_allowance - (magi - rates.phaseout_start) * HALF

    allowed = min(loss, allowance)
    return LossAllowance(allowed=allowed, suspended=loss - allowed)
```

Now replace the stub in `engine.py`. Find this block:

```python
    schedule_e_net = inputs.schedule_e.net if inputs.schedule_e else ZERO
    allowed_loss = -schedule_e_net if schedule_e_net < ZERO else ZERO
    suspended_loss = ZERO

    # MAGI for the passive-loss phase-out EXCLUDES the passive loss itself
    # (IRS Pub 925). Task 4 consumes this.
    magi_for_pal = income_tax_wages

    agi = income_tax_wages + schedule_e_net
```

and replace it with:

```python
    # MAGI for the passive-loss phase-out EXCLUDES the passive loss itself
    # (IRS Pub 925) -- which is why this is a single forward pass and not
    # a fixed-point solve. See limitations.py.
    magi_for_pal = income_tax_wages

    if inputs.schedule_e is None:
        allowed_loss = ZERO
        suspended_loss = ZERO
        schedule_e_contribution = ZERO
    else:
        allowance = allowed_rental_loss(
            magi_for_pal,
            inputs.schedule_e.net,
            inputs.schedule_e.active_participation,
            rates.passive_loss,
        )
        if inputs.schedule_e.is_loss:
            allowed_loss = allowance.allowed
            suspended_loss = allowance.suspended
            schedule_e_contribution = -allowance.allowed
            explain.append(ExplainStep(
                "Rental loss allowed this year", _cents(allowed_loss),
                f"Of {_cents(-inputs.schedule_e.net)} in rental loss, "
                f"{_cents(suspended_loss)} is suspended and carries forward "
                "because your income is above the passive-loss threshold."
                if suspended_loss > ZERO else
                "Your full rental loss is usable this year.",
            ))
        else:
            allowed_loss = ZERO
            suspended_loss = ZERO
            schedule_e_contribution = inputs.schedule_e.net
            explain.append(ExplainStep(
                "Rental income", _cents(inputs.schedule_e.net),
                "Net rental income after expenses and depreciation.",
            ))

    agi = income_tax_wages + schedule_e_contribution
```

Add the import at the top of `engine.py`:

```python
from app.services.tax.limitations import allowed_rental_loss
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/tax/test_limitations.py tests/tax/test_engine_core.py -v`
Expected: PASS (both files — the core tests must still pass, since they use `schedule_e=None`)

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/tax/limitations.py backend/app/services/tax/engine.py backend/tests/tax/test_limitations.py
git commit -m "feat(tax): apply the passive activity loss limitation

A rental loss is not automatically usable against W2 income. Passing it
through raw understates tax by thousands at higher incomes. MAGI for the
phase-out excludes the passive loss itself (Pub 925), which is what
makes this a single forward pass rather than a fixed-point solve --
guarded by an explicit regression test."
```

---

### Task 5: Safe harbor

**Files:**
- Create: `backend/app/services/tax/safe_harbor.py`
- Modify: `backend/app/services/tax/engine.py` (replace the `_UNKNOWN_SAFE_HARBOR` stub)
- Test: `backend/tests/tax/test_safe_harbor.py`

**Interfaces:**
- Consumes: `SafeHarborResult` (Task 2)
- Produces: `evaluate_safe_harbor(total_liability, projected_withholding, prior_year_total_tax, prior_year_agi, remaining_periods) -> SafeHarborResult`

Underpayment is generally avoided by paying the lesser of 90% of this year's tax or 100% of last year's — **110%** when prior-year AGI exceeds $150,000. When prior-year data is absent the result is `"unknown"`, never `"met"`.

**Partial prior-year data is an ordinary path, not an edge case.**
`PriorYearReturn.agi` and `.total_tax` are independently nullable, so a user
can easily record one without the other. Treating a missing AGI as "not high
income" measures against 100% of prior tax when 110% may apply —
understating the requirement and permitting a false `"met"`.

But do **not** return `"unknown"` whenever AGI is missing; that discards
answers we can compute. The requirement is `min(90% of current, f x prior)`
with `f` of 1.0 or 1.1. When 90%-of-current is already the lesser figure
under 1.0, it is lesser under 1.1 too — the multiplier is irrelevant and the
answer is certain. The AGI only matters when the prior-year test binds.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/tax/test_safe_harbor.py
"""Safe harbor must never report 'met' on missing data."""
from __future__ import annotations

from decimal import Decimal

from app.services.tax.safe_harbor import evaluate_safe_harbor


def test_unknown_when_prior_year_is_missing():
    result = evaluate_safe_harbor(
        total_liability=Decimal("52555.10"),
        projected_withholding=Decimal("40000"),
        prior_year_total_tax=None,
        prior_year_agi=None,
        remaining_periods=6,
    )
    assert result.status == "unknown"
    assert result.test_used == "none"
    assert result.shortfall is None
    assert "prior" in result.reason.lower()


def test_high_income_uses_110_percent_of_prior_year_as_the_alternative():
    result = evaluate_safe_harbor(
        total_liability=Decimal("60000"),
        projected_withholding=Decimal("52000"),
        prior_year_total_tax=Decimal("49310.60"),
        prior_year_agi=Decimal("170000"),
        remaining_periods=6,
    )
    # lesser of 90% of 60,000 = 54,000, and 110% of 49,310.60 = 54,241.66
    assert result.test_used == "90_percent_current"
    assert result.required_payment == Decimal("54000.00")
    assert result.status == "not_met"
    assert result.shortfall == Decimal("2000.00")
    assert result.per_period_to_close == Decimal("333.33")


def test_100_percent_of_prior_year_wins_when_it_is_the_lesser():
    result = evaluate_safe_harbor(
        total_liability=Decimal("60000"),
        projected_withholding=Decimal("40000"),
        prior_year_total_tax=Decimal("38000"),
        prior_year_agi=Decimal("120000"),
        remaining_periods=4,
    )
    # lesser of 90% of 60,000 = 54,000, and 100% of 38,000 = 38,000
    assert result.test_used == "100_percent_prior"
    assert result.required_payment == Decimal("38000.00")
    assert result.status == "met"
    assert result.shortfall == Decimal("0.00")
    assert result.per_period_to_close == Decimal("0.00")


def test_met_when_withholding_exceeds_the_requirement():
    result = evaluate_safe_harbor(
        total_liability=Decimal("52555.10"),
        projected_withholding=Decimal("52000"),
        prior_year_total_tax=Decimal("49310.60"),
        prior_year_agi=Decimal("170000"),
        remaining_periods=6,
    )
    # lesser of 47,299.59 and 54,241.66 -> 47,299.59; 52,000 clears it
    assert result.status == "met"
    assert result.test_used == "90_percent_current"


def test_zero_remaining_periods_does_not_divide_by_zero():
    result = evaluate_safe_harbor(
        total_liability=Decimal("60000"),
        projected_withholding=Decimal("10000"),
        prior_year_total_tax=Decimal("38000"),
        prior_year_agi=Decimal("120000"),
        remaining_periods=0,
    )
    assert result.status == "not_met"
    assert result.per_period_to_close is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/tax/test_safe_harbor.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.tax.safe_harbor'`

- [ ] **Step 3: Write minimal implementation**

```python
# backend/app/services/tax/safe_harbor.py
"""Underpayment safe harbor.

Generally, penalty is avoided by paying the LESSER of 90% of this year's
tax or 100% of last year's -- 110% when last year's AGI exceeded
$150,000.

When prior-year data is missing the answer is "unknown", never "met".
Telling someone they are safe when we cannot know is the one outcome
worth avoiding at any cost.
"""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

from app.services.tax.inputs import SafeHarborResult

CENTS = Decimal("0.01")
ZERO = Decimal("0")
HIGH_INCOME_AGI_THRESHOLD = Decimal("150000")
CURRENT_YEAR_FRACTION = Decimal("0.90")
PRIOR_YEAR_FRACTION = Decimal("1.00")
PRIOR_YEAR_FRACTION_HIGH_INCOME = Decimal("1.10")


def _cents(value: Decimal) -> Decimal:
    return value.quantize(CENTS, rounding=ROUND_HALF_UP)


def evaluate_safe_harbor(
    total_liability: Decimal,
    projected_withholding: Decimal,
    prior_year_total_tax: Decimal | None,
    prior_year_agi: Decimal | None,
    remaining_periods: int,
) -> SafeHarborResult:
    if prior_year_total_tax is None:
        return SafeHarborResult(
            status="unknown",
            test_used="none",
            required_payment=None,
            projected_payment=_cents(projected_withholding),
            shortfall=None,
            per_period_to_close=None,
            reason=(
                "Enter last year's total tax to check whether this year's "
                "withholding is high enough to avoid an underpayment penalty."
            ),
        )

    current_year_requirement = total_liability * CURRENT_YEAR_FRACTION
    prior_year_100_percent = prior_year_total_tax * PRIOR_YEAR_FRACTION

    # If 90% of current is the binding constraint, it applies regardless of
    # which prior-year multiplier (1.0 or 1.1) would apply -- so the answer
    # is definitive even when prior-year AGI is missing.
    if current_year_requirement <= prior_year_100_percent:
        required = current_year_requirement
        test_used = "90_percent_current"
    elif prior_year_agi is None:
        # The prior-year test binds, but we cannot tell which multiplier
        # applies. Treating a missing AGI as "not high income" here would
        # understate required_payment and permit a false "met" -- the worst
        # output this module can produce. Say we do not know, and ask for
        # the one figure that would settle it.
        return SafeHarborResult(
            status="unknown",
            test_used="none",
            required_payment=None,
            projected_payment=_cents(projected_withholding),
            shortfall=None,
            per_period_to_close=None,
            reason=(
                "To finish this check we need last year's adjusted gross income. "
                "The rule uses 110% of last year's tax when last year's AGI was over "
                "$150,000, and 100% otherwise, so without it we can't tell which applies to you."
            ),
        )
    else:
        high_income = prior_year_agi > HIGH_INCOME_AGI_THRESHOLD
        prior_fraction = (
            PRIOR_YEAR_FRACTION_HIGH_INCOME if high_income else PRIOR_YEAR_FRACTION
        )
        prior_year_requirement = prior_year_total_tax * prior_fraction

        # Still required: with high_income the 1.1x figure can exceed 90% of
        # current even though the 1.0x figure did not.
        if current_year_requirement <= prior_year_requirement:
            required = current_year_requirement
            test_used = "90_percent_current"
        else:
            required = prior_year_requirement
            test_used = (
                "110_percent_prior" if high_income else "100_percent_prior"
            )

    required = _cents(required)
    projected = _cents(projected_withholding)
    shortfall = _cents(max(ZERO, required - projected))
    met = shortfall == ZERO

    if met:
        per_period = ZERO
        reason = (
            "Your projected withholding meets the safe harbor, so an "
            "underpayment penalty is not expected."
        )
    elif remaining_periods > 0:
        per_period = _cents(shortfall / Decimal(remaining_periods))
        reason = (
            f"You are ${shortfall} short of the safe harbor. Withholding "
            f"about ${per_period} more per paycheck for the rest of the "
            "year would close the gap."
        )
    else:
        per_period = None
        reason = (
            f"You are ${shortfall} short of the safe harbor and there are "
            "no pay periods left this year to close it through withholding."
        )

    return SafeHarborResult(
        status="met" if met else "not_met",
        test_used=test_used,
        required_payment=required,
        projected_payment=projected,
        shortfall=shortfall,
        per_period_to_close=per_period,
        reason=reason,
    )
```

Now wire it into `engine.py`. Add to the imports:

```python
from app.services.tax.safe_harbor import evaluate_safe_harbor
```

Add a `remaining_periods: int = 0` parameter to `project()`:

```python
def project(inputs: TaxInputs, rates: RateSet, remaining_periods: int = 0) -> TaxProjection:
```

Replace `safe_harbor=_UNKNOWN_SAFE_HARBOR,` in the return with:

```python
        safe_harbor=evaluate_safe_harbor(
            total_liability=total_liability,
            projected_withholding=total_withheld,
            prior_year_total_tax=inputs.prior_year_total_tax,
            prior_year_agi=inputs.prior_year_agi,
            remaining_periods=remaining_periods,
        ),
```

Delete the now-unused `_UNKNOWN_SAFE_HARBOR` constant.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/tax/ -v`
Expected: PASS (all four tax test files)

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/tax/safe_harbor.py backend/app/services/tax/engine.py backend/tests/tax/test_safe_harbor.py
git commit -m "feat(tax): add underpayment safe harbor check

Lesser of 90% of current-year tax or 100% of prior-year (110% above
\$150k prior AGI). Returns 'unknown' rather than 'met' when prior-year
data is missing -- a false 'you're safe' is the one outcome worth
avoiding at any cost."
```

---

### Task 6: `impact_of` — the marginal surface

**Files:**
- Modify: `backend/app/services/tax/engine.py`
- Modify: `backend/app/services/tax/__init__.py` (public exports)
- Test: `backend/tests/tax/test_impact.py`

**Interfaces:**
- Consumes: `project()` (Task 3), `Change` subclasses (Task 2)
- Produces: `impact_of(inputs, change, rates) -> Decimal` (dollars of **additional** tax; negative means tax goes down)

**Why dollars and not a rate.** A design proof showed that perturbing by an arbitrary fixed step gives a step-dependent answer: at wages just below a bracket edge the same engine reported 24.05% with a $1 step and 34.05% with a $10,000 step. Reporting a rate therefore requires picking a constant that silently changes the answer. `impact_of` perturbs by the **actual amount** the caller is asking about, which is exact for that question. Any percentage shown in the UI is derived by the caller and labeled with the amount it is blended over.

**Additivity matters.** Two $5,000 moves evaluated in sequence must equal one $10,000 move. Without it, the phase 3 ranking would depend on evaluation order. This is asserted below.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/tax/test_impact.py
"""impact_of must be exact for the amount asked about, and additive."""
from __future__ import annotations

from decimal import Decimal

from app.services.tax.engine import impact_of, project
from app.services.tax.inputs import (
    ExtraBusinessExpense,
    ExtraItemizedDeduction,
    ExtraPretax401k,
    ExtraWages,
    ScheduleEResult,
    TaxInputs,
    WithholdingBuckets,
)
from app.services.tax.rates.registry import FilingStatus, get_rates

RATES = get_rates(2026)


def make_inputs(**overrides) -> TaxInputs:
    base = dict(
        filing_status=FilingStatus.SINGLE,
        wages_ytd=Decimal("179000"),
        projected_remaining_wages=Decimal("0"),
        pretax_401k=Decimal("0"),
        pretax_hsa=Decimal("0"),
        pretax_other=Decimal("0"),
        federal_withheld_ytd=Decimal("0"),
        state_withheld_ytd=Decimal("0"),
        ss_withheld_ytd=Decimal("0"),
        medicare_withheld_ytd=Decimal("0"),
        projected_remaining_withholding=WithholdingBuckets.zero(),
        itemized_deductions=Decimal("0"),
        schedule_e=None,
        prior_year_total_tax=None,
        prior_year_agi=None,
    )
    base.update(overrides)
    return TaxInputs(**base)


def test_extra_wages_cost_the_expected_dollars():
    """At $179k: 24% federal + 6.2% SS + 1.45% Medicare + 4.4% CO."""
    cost = impact_of(make_inputs(), ExtraWages(Decimal("1000")), RATES)
    assert cost == Decimal("360.50")


def test_401k_saves_less_than_the_marginal_rate_because_fica_is_untouched():
    saved = -impact_of(make_inputs(), ExtraPretax401k(Decimal("23500")), RATES)
    assert saved == Decimal("6674.00")
    naive = Decimal("23500") * Decimal("0.3605")
    assert saved < naive


def test_impact_is_additive():
    """Required for a coherent phase 3 ranking."""
    inputs = make_inputs(wages_ytd=Decimal("120000"))
    first = impact_of(inputs, ExtraWages(Decimal("5000")), RATES)
    after_first = ExtraWages(Decimal("5000")).apply(inputs)
    second = impact_of(after_first, ExtraWages(Decimal("5000")), RATES)
    both = impact_of(inputs, ExtraWages(Decimal("10000")), RATES)
    assert first + second == both


def test_impact_does_not_mutate_the_caller_inputs():
    inputs = make_inputs()
    before = project(inputs, RATES).total_liability
    impact_of(inputs, ExtraWages(Decimal("50000")), RATES)
    assert project(inputs, RATES).total_liability == before


def test_personal_itemized_deduction_below_standard_is_worth_nothing():
    """The headline correctness fix. Not an approximation -- exactly zero."""
    saved = -impact_of(
        make_inputs(), ExtraItemizedDeduction(Decimal("5000")), RATES
    )
    assert saved == Decimal("0.00")


def test_business_expense_is_worth_something_from_the_first_dollar():
    """Same dollars as the test above, valued through Schedule E."""
    inputs = make_inputs(
        schedule_e=ScheduleEResult(
            gross_rental_income=Decimal("30000"),
            allowable_expenses=Decimal("10000"),
            net=Decimal("20000"),
            active_participation=True,
            suspended_loss_carryin=Decimal("0"),
        )
    )
    saved = -impact_of(inputs, ExtraBusinessExpense(Decimal("5000")), RATES)
    assert saved > Decimal("0")
    assert saved == Decimal("1420.00")   # 5,000 x (24% + 4.4%) -- no FICA on rental


def test_business_expense_beyond_rental_income_is_worth_nothing_at_high_income():
    """At $179k MAGI the passive-loss allowance is zero, so an expense that
    creates a LOSS suspends rather than reducing this year's tax."""
    inputs = make_inputs(
        schedule_e=ScheduleEResult(
            gross_rental_income=Decimal("10000"),
            allowable_expenses=Decimal("10000"),
            net=Decimal("0"),
            active_participation=True,
            suspended_loss_carryin=Decimal("0"),
        )
    )
    saved = -impact_of(inputs, ExtraBusinessExpense(Decimal("5000")), RATES)
    assert saved == Decimal("0.00")


def test_perturbation_surfaces_the_passive_loss_phaseout_cliff():
    """Inside the $100k-$150k phase-out an extra dollar of wages also
    destroys 50c of rental-loss allowance. Nothing special-cases this."""
    def cost_at(wages: str) -> Decimal:
        inputs = make_inputs(
            wages_ytd=Decimal(wages),
            schedule_e=ScheduleEResult(
                gross_rental_income=Decimal("30000"),
                allowable_expenses=Decimal("48000"),
                net=Decimal("-18000"),
                active_participation=True,
                suspended_loss_carryin=Decimal("0"),
            ),
        )
        return impact_of(inputs, ExtraWages(Decimal("1000")), RATES)

    inside = cost_at("125000")
    outside = cost_at("155000")
    assert inside > outside, "the phase-out must cost more than the bracket alone"
    assert inside > Decimal("400"), "should exceed a plain 34% marginal cost"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/tax/test_impact.py -v`
Expected: FAIL — `ImportError: cannot import name 'impact_of'`

- [ ] **Step 3: Write minimal implementation**

Append to `backend/app/services/tax/engine.py`:

```python
def impact_of(inputs: TaxInputs, change: Change, rates: RateSet) -> Decimal:
    """Dollars of ADDITIONAL tax from applying `change`. Negative means the
    change reduces tax.

    This is the engine's entire marginal surface. It perturbs by the
    ACTUAL amount under consideration rather than a fixed step, because a
    fixed step gives a step-dependent answer near a bracket edge -- at
    wages just below one, a $1 step and a $10,000 step differ by ten
    percentage points. Callers that want a percentage divide by the
    amount and label it as blended over that amount.

    `inputs` is never mutated; Change.apply() returns a copy.
    """
    base = project(inputs, rates).total_liability
    changed = project(change.apply(inputs), rates).total_liability
    return _cents(changed - base)
```

Add `Change` to the imports in `engine.py`:

```python
from app.services.tax.inputs import (
    ZERO,
    Change,
    ExplainStep,
    SafeHarborResult,
    TaxInputs,
    TaxProjection,
)
```

Fill in `backend/app/services/tax/__init__.py`:

```python
"""Pure tax calculation. No database session, no network, no clock.

Everything in this package is a function of its arguments. That is what
makes the engine testable against published IRS examples and what lets
the phase 3 optimizer re-run it safely with perturbed inputs.
"""
from app.services.tax.engine import impact_of, project
from app.services.tax.inputs import (
    Change,
    ExplainStep,
    ExtraBusinessExpense,
    ExtraItemizedDeduction,
    ExtraPretax401k,
    ExtraPretaxHsa,
    ExtraWages,
    SafeHarborResult,
    ScheduleEResult,
    TaxInputs,
    TaxProjection,
    WithholdingBuckets,
)
from app.services.tax.rates.registry import (
    FilingStatus,
    RateSet,
    UnknownTaxYearError,
    UnsupportedFilingStatusError,
    get_rates,
)

__all__ = [
    "Change", "ExplainStep", "ExtraBusinessExpense", "ExtraItemizedDeduction",
    "ExtraPretax401k", "ExtraPretaxHsa", "ExtraWages", "FilingStatus",
    "RateSet", "SafeHarborResult", "ScheduleEResult", "TaxInputs",
    "TaxProjection", "UnknownTaxYearError", "UnsupportedFilingStatusError",
    "WithholdingBuckets", "get_rates", "impact_of", "project",
]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/tax/ -v`
Expected: PASS (all five tax test files)

If `test_business_expense_is_worth_something_from_the_first_dollar` fails, check that rental income is not being run through the FICA wage base — Schedule E income is not wages and carries no Social Security or Medicare tax in this model.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/tax/engine.py backend/app/services/tax/__init__.py backend/tests/tax/test_impact.py
git commit -m "feat(tax): add impact_of, the engine's marginal surface

Reports dollars for the actual amount asked about rather than a rate
from an arbitrary step -- a fixed step gives step-dependent answers near
a bracket edge. Additivity is asserted, since the phase 3 ranking
depends on it. Tests pin the two findings that motivated this work: a
personal deduction below the standard deduction is worth exactly zero,
and a business expense past rental income is worth zero at high income."
```

---

### Task 7: Models and migration

**Files:**
- Create: `backend/app/models/tax_profile.py`
- Create: `backend/alembic/versions/0013_tax_projection_engine.py`
- Modify: `backend/app/models/__init__.py`, `backend/app/models/category.py`
- Delete: `backend/app/models/tax_settings.py`, `backend/app/schemas/tax_settings.py`, `backend/app/api/routes/tax_settings.py`
- Modify: `backend/app/api/routes/__init__.py` (drop the tax_settings include), `backend/app/services/deductions.py` (drop its `TaxSettings` read)
- Test: `backend/tests/test_tax_models.py`

**Interfaces:**
- Consumes: nothing from earlier tasks (persistence only)
- Produces: `TaxProfile`, `Paystub`, `PriorYearReturn` models; `Category.deduction_kind`

**Privacy constraint:** no SSN, no employer name, no address, no document blob. If a field is not consumed by the engine, it does not belong here.

**Deleting the model breaks `app.main`, not just tests.**
`app/api/routes/tax_settings.py` and `app/services/deductions.py` both
import `TaxSettings` directly, so removing the model makes the whole app
unimportable and *every* test uncollectable — not merely the three test
files noted below. This task therefore also deletes the tax-settings
route and schema and strips the `TaxSettings` read out of
`deductions.py`, whose two estimate fields return `None` (never `0`)
until Task 11 recomputes them through the engine.

Match the existing migration style in `0012_tax_deductions.py` — the `_columns()` / `_tables()` inspector helpers and idempotent guards.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_tax_models.py
"""Model-level tests for the tax projection tables."""
from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import select

from tests.test_categories_routes import fixture, _seed_household
from app.models import (
    Category,
    CategoryGroup,
    Paystub,
    PriorYearReturn,
    TaxProfile,
)


@pytest.mark.asyncio
async def test_tax_profile_round_trips(fixture):
    session, _ = fixture
    hid, _ = await _seed_household(session)
    session.add(TaxProfile(
        id=str(uuid.uuid4()),
        household_id=hid,
        filing_status="single",
        walkthrough_answers={"married": False, "dependents": False},
    ))
    await session.flush()

    result = await session.execute(
        select(TaxProfile).where(TaxProfile.household_id == hid)
    )
    profile = result.scalar_one()
    assert profile.filing_status == "single"
    assert profile.walkthrough_answers["married"] is False
    assert profile.de_minimis_election is False


@pytest.mark.asyncio
async def test_tax_profile_has_no_manual_rate_columns(fixture):
    """The hand-entered marginal rates are gone -- they are now derived."""
    columns = set(TaxProfile.__table__.columns.keys())
    assert "marginal_federal_rate" not in columns
    assert "marginal_state_rate" not in columns
    assert "current_federal_withholding_per_period" not in columns
    assert "remaining_pay_periods_this_year" not in columns


@pytest.mark.asyncio
async def test_models_carry_no_sensitive_identifiers(fixture):
    """Privacy guard: nothing here should ever hold an SSN or employer."""
    for model in (TaxProfile, Paystub, PriorYearReturn):
        columns = set(model.__table__.columns.keys())
        for banned in ("ssn", "social_security_number", "employer",
                       "address", "document", "document_blob"):
            assert banned not in columns, f"{model.__name__} must not store {banned}"


@pytest.mark.asyncio
async def test_paystub_round_trips_with_ytd_columns(fixture):
    session, _ = fixture
    hid, _ = await _seed_household(session)
    session.add(Paystub(
        id=str(uuid.uuid4()),
        household_id=hid,
        pay_date=date(2026, 9, 15),
        gross=Decimal("6884.62"),
        pretax_401k=Decimal("904.00"),
        pretax_hsa=Decimal("160.00"),
        pretax_other=Decimal("120.00"),
        federal_withheld=Decimal("1240.00"),
        state_withheld=Decimal("280.00"),
        ss_withheld=Decimal("417.80"),
        medicare_withheld=Decimal("97.70"),
        gross_ytd=Decimal("124000.00"),
        pretax_401k_ytd=Decimal("16272.00"),
        pretax_hsa_ytd=Decimal("2880.00"),
        pretax_other_ytd=Decimal("2160.00"),
        federal_withheld_ytd=Decimal("22320.00"),
        state_withheld_ytd=Decimal("5040.00"),
        ss_withheld_ytd=Decimal("7520.40"),
        medicare_withheld_ytd=Decimal("1758.60"),
    ))
    await session.flush()

    result = await session.execute(
        select(Paystub).where(Paystub.household_id == hid)
    )
    stub = result.scalar_one()
    assert stub.gross_ytd == Decimal("124000.00")
    assert stub.pay_date == date(2026, 9, 15)


@pytest.mark.asyncio
async def test_prior_year_return_round_trips(fixture):
    session, _ = fixture
    hid, _ = await _seed_household(session)
    session.add(PriorYearReturn(
        id=str(uuid.uuid4()),
        household_id=hid,
        year=2025,
        filing_status="single",
        agi=Decimal("168000.00"),
        taxable_income=Decimal("153000.00"),
        total_tax=Decimal("49310.60"),
        total_withheld=Decimal("50000.00"),
        itemized=False,
        itemized_amount=Decimal("0.00"),
        schedule_e_net=Decimal("-4000.00"),
        passive_loss_carryforward=Decimal("4000.00"),
        capital_loss_carryforward=Decimal("0.00"),
        qbi_carryforward=Decimal("0.00"),
    ))
    await session.flush()

    result = await session.execute(
        select(PriorYearReturn).where(PriorYearReturn.household_id == hid)
    )
    prior = result.scalar_one()
    assert prior.total_tax == Decimal("49310.60")
    assert prior.passive_loss_carryforward == Decimal("4000.00")


@pytest.mark.asyncio
async def test_category_deduction_kind_defaults_to_personal_itemized(fixture):
    """Existing rows must keep their current meaning on migration."""
    session, _ = fixture
    hid, _ = await _seed_household(session)
    group = CategoryGroup(id=str(uuid.uuid4()), household_id=hid, name="Rental")
    session.add(group)
    await session.flush()
    category = Category(id=str(uuid.uuid4()), group_id=group.id, name="Cleaning")
    session.add(category)
    await session.flush()
    assert category.deduction_kind == "personal_itemized"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_tax_models.py -v`
Expected: FAIL — `ImportError: cannot import name 'TaxProfile' from 'app.models'`

- [ ] **Step 3: Write minimal implementation**

```python
# backend/app/models/tax_profile.py
"""Persistence for the tax projection engine.

PRIVACY: these tables hold no SSN, no employer, no address, and no
document blobs. Prior-year returns are read for a defined field list and
the source PDF is never persisted. If a field is not consumed by the
engine, it does not belong here.
"""
from __future__ import annotations

import uuid
from datetime import date as _date, datetime, timezone
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import (
    JSON, Boolean, Date, DateTime, ForeignKey, Index, Integer, Numeric, String,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

_MONEY = Numeric(14, 2)


class TaxProfile(Base):
    """Replaces TaxSettings. The hand-entered marginal rate columns are
    gone -- those numbers are now computed by the engine."""
    __tablename__ = "tax_profiles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    household_id: Mapped[str] = mapped_column(String(36), ForeignKey("households.id"), unique=True, index=True)
    # Nullable on arrival: rows migrated from tax_settings have no status,
    # and the Taxes page prompts for the walkthrough.
    filing_status: Mapped[Optional[str]] = mapped_column(String(40), nullable=True, default=None)
    # The walkthrough's ANSWERS, not just its conclusion -- so next year it
    # can ask "is this still true?" and a surprising number can be traced
    # back to the answer that caused it.
    walkthrough_answers: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True, default=None)
    walkthrough_completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True, default=None)
    de_minimis_election: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class Paystub(Base):
    """One entered paystub. The engine anchors on the LATEST stub's YTD
    columns and projects the remainder of the year forward, so a mid-year
    raise self-corrects at the next entry."""
    __tablename__ = "paystubs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    household_id: Mapped[str] = mapped_column(String(36), ForeignKey("households.id"), index=True)
    pay_date: Mapped[_date] = mapped_column(Date)

    gross: Mapped[Decimal] = mapped_column(_MONEY)
    pretax_401k: Mapped[Decimal] = mapped_column(_MONEY, default=Decimal("0.00"))
    pretax_hsa: Mapped[Decimal] = mapped_column(_MONEY, default=Decimal("0.00"))
    pretax_other: Mapped[Decimal] = mapped_column(_MONEY, default=Decimal("0.00"))
    federal_withheld: Mapped[Decimal] = mapped_column(_MONEY, default=Decimal("0.00"))
    state_withheld: Mapped[Decimal] = mapped_column(_MONEY, default=Decimal("0.00"))
    ss_withheld: Mapped[Decimal] = mapped_column(_MONEY, default=Decimal("0.00"))
    medicare_withheld: Mapped[Decimal] = mapped_column(_MONEY, default=Decimal("0.00"))

    gross_ytd: Mapped[Decimal] = mapped_column(_MONEY)
    pretax_401k_ytd: Mapped[Decimal] = mapped_column(_MONEY, default=Decimal("0.00"))
    pretax_hsa_ytd: Mapped[Decimal] = mapped_column(_MONEY, default=Decimal("0.00"))
    pretax_other_ytd: Mapped[Decimal] = mapped_column(_MONEY, default=Decimal("0.00"))
    federal_withheld_ytd: Mapped[Decimal] = mapped_column(_MONEY, default=Decimal("0.00"))
    state_withheld_ytd: Mapped[Decimal] = mapped_column(_MONEY, default=Decimal("0.00"))
    ss_withheld_ytd: Mapped[Decimal] = mapped_column(_MONEY, default=Decimal("0.00"))
    medicare_withheld_ytd: Mapped[Decimal] = mapped_column(_MONEY, default=Decimal("0.00"))

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("uq_paystubs_household_pay_date", "household_id", "pay_date", unique=True),
    )


class PriorYearReturn(Base):
    """Fields extracted from a filed return. `total_tax` is Form 1040 line
    24 and drives the safe-harbor check; the carryforwards are values the
    user would never think to type from memory."""
    __tablename__ = "prior_year_returns"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    household_id: Mapped[str] = mapped_column(String(36), ForeignKey("households.id"), index=True)
    year: Mapped[int] = mapped_column(Integer)
    filing_status: Mapped[Optional[str]] = mapped_column(String(40), nullable=True, default=None)

    agi: Mapped[Optional[Decimal]] = mapped_column(_MONEY, nullable=True, default=None)
    taxable_income: Mapped[Optional[Decimal]] = mapped_column(_MONEY, nullable=True, default=None)
    total_tax: Mapped[Optional[Decimal]] = mapped_column(_MONEY, nullable=True, default=None)
    total_withheld: Mapped[Optional[Decimal]] = mapped_column(_MONEY, nullable=True, default=None)
    itemized: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    itemized_amount: Mapped[Optional[Decimal]] = mapped_column(_MONEY, nullable=True, default=None)
    schedule_e_net: Mapped[Optional[Decimal]] = mapped_column(_MONEY, nullable=True, default=None)
    passive_loss_carryforward: Mapped[Decimal] = mapped_column(_MONEY, default=Decimal("0.00"), server_default="0.00")
    capital_loss_carryforward: Mapped[Decimal] = mapped_column(_MONEY, default=Decimal("0.00"), server_default="0.00")
    qbi_carryforward: Mapped[Decimal] = mapped_column(_MONEY, default=Decimal("0.00"), server_default="0.00")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("uq_prior_year_returns_household_year", "household_id", "year", unique=True),
    )
```

In `backend/app/models/category.py`, add to `Category` after `tax_line`:

```python
    # Business expenses (Schedule E) reduce income from the first dollar;
    # personal itemized deductions only matter above the standard
    # deduction. They are worth very different amounts and must not be
    # summed together. Existing rows default to personal_itemized, which
    # preserves their current meaning.
    deduction_kind: Mapped[str] = mapped_column(
        String(30), default="personal_itemized", server_default="personal_itemized"
    )
```

In `backend/app/models/__init__.py`, replace the `TaxSettings` import and `__all__` entry with:

```python
from app.models.tax_profile import Paystub, PriorYearReturn, TaxProfile
```

and in `__all__`: replace `"TaxSettings",` with `"Paystub", "PriorYearReturn", "TaxProfile",`.

Delete `backend/app/models/tax_settings.py`.

```python
# backend/alembic/versions/0013_tax_projection_engine.py
"""tax projection engine: tax_profiles, paystubs, prior_year_returns

Revision ID: 0013_tax_projection_engine
Revises: 0012_tax_deductions
Create Date: 2026-09-19

Replaces tax_settings with tax_profiles. The four manual rate/withholding
columns are dropped -- those numbers are now computed by the engine from
paystub actuals. Existing rows are preserved as profiles with a null
filing_status, which the Taxes page prompts to fill via the walkthrough.

Adds categories.deduction_kind, defaulting to 'personal_itemized' so
existing rows keep their current meaning.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0013_tax_projection_engine"
down_revision = "0012_tax_deductions"
branch_labels = None
depends_on = None


def _columns(table: str) -> set[str]:
    bind = op.get_bind()
    return {c["name"] for c in inspect(bind).get_columns(table)}


def _tables() -> set[str]:
    bind = op.get_bind()
    return set(inspect(bind).get_table_names())


def upgrade() -> None:
    tables = _tables()

    if "tax_profiles" not in tables:
        op.create_table(
            "tax_profiles",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("household_id", sa.String(36), sa.ForeignKey("households.id"), nullable=False),
            sa.Column("filing_status", sa.String(40), nullable=True),
            sa.Column("walkthrough_answers", sa.JSON(), nullable=True),
            sa.Column("walkthrough_completed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("de_minimis_election", sa.Boolean(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_tax_profiles_household_id", "tax_profiles", ["household_id"], unique=True)

        # Carry existing households forward so the feature does not appear
        # to lose their data. The rate columns are deliberately not copied.
        if "tax_settings" in tables:
            op.execute(
                "INSERT INTO tax_profiles (id, household_id, filing_status, "
                "de_minimis_election, created_at) "
                "SELECT id, household_id, NULL, FALSE, created_at FROM tax_settings"
            )

    if "paystubs" not in tables:
        op.create_table(
            "paystubs",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("household_id", sa.String(36), sa.ForeignKey("households.id"), nullable=False),
            sa.Column("pay_date", sa.Date(), nullable=False),
            sa.Column("gross", sa.Numeric(14, 2), nullable=False),
            sa.Column("pretax_401k", sa.Numeric(14, 2), nullable=False, server_default="0.00"),
            sa.Column("pretax_hsa", sa.Numeric(14, 2), nullable=False, server_default="0.00"),
            sa.Column("pretax_other", sa.Numeric(14, 2), nullable=False, server_default="0.00"),
            sa.Column("federal_withheld", sa.Numeric(14, 2), nullable=False, server_default="0.00"),
            sa.Column("state_withheld", sa.Numeric(14, 2), nullable=False, server_default="0.00"),
            sa.Column("ss_withheld", sa.Numeric(14, 2), nullable=False, server_default="0.00"),
            sa.Column("medicare_withheld", sa.Numeric(14, 2), nullable=False, server_default="0.00"),
            sa.Column("gross_ytd", sa.Numeric(14, 2), nullable=False),
            sa.Column("pretax_401k_ytd", sa.Numeric(14, 2), nullable=False, server_default="0.00"),
            sa.Column("pretax_hsa_ytd", sa.Numeric(14, 2), nullable=False, server_default="0.00"),
            sa.Column("pretax_other_ytd", sa.Numeric(14, 2), nullable=False, server_default="0.00"),
            sa.Column("federal_withheld_ytd", sa.Numeric(14, 2), nullable=False, server_default="0.00"),
            sa.Column("state_withheld_ytd", sa.Numeric(14, 2), nullable=False, server_default="0.00"),
            sa.Column("ss_withheld_ytd", sa.Numeric(14, 2), nullable=False, server_default="0.00"),
            sa.Column("medicare_withheld_ytd", sa.Numeric(14, 2), nullable=False, server_default="0.00"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_paystubs_household_id", "paystubs", ["household_id"])
        op.create_index("uq_paystubs_household_pay_date", "paystubs", ["household_id", "pay_date"], unique=True)

    if "prior_year_returns" not in tables:
        op.create_table(
            "prior_year_returns",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("household_id", sa.String(36), sa.ForeignKey("households.id"), nullable=False),
            sa.Column("year", sa.Integer(), nullable=False),
            sa.Column("filing_status", sa.String(40), nullable=True),
            sa.Column("agi", sa.Numeric(14, 2), nullable=True),
            sa.Column("taxable_income", sa.Numeric(14, 2), nullable=True),
            sa.Column("total_tax", sa.Numeric(14, 2), nullable=True),
            sa.Column("total_withheld", sa.Numeric(14, 2), nullable=True),
            sa.Column("itemized", sa.Boolean(), nullable=False, server_default="0"),
            sa.Column("itemized_amount", sa.Numeric(14, 2), nullable=True),
            sa.Column("schedule_e_net", sa.Numeric(14, 2), nullable=True),
            sa.Column("passive_loss_carryforward", sa.Numeric(14, 2), nullable=False, server_default="0.00"),
            sa.Column("capital_loss_carryforward", sa.Numeric(14, 2), nullable=False, server_default="0.00"),
            sa.Column("qbi_carryforward", sa.Numeric(14, 2), nullable=False, server_default="0.00"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_prior_year_returns_household_id", "prior_year_returns", ["household_id"])
        op.create_index("uq_prior_year_returns_household_year", "prior_year_returns", ["household_id", "year"], unique=True)

    if "deduction_kind" not in _columns("categories"):
        op.add_column(
            "categories",
            sa.Column("deduction_kind", sa.String(30), nullable=False, server_default="personal_itemized"),
        )

    if "tax_settings" in _tables():
        op.drop_table("tax_settings")


def downgrade() -> None:
    tables = _tables()
    if "tax_settings" not in tables:
        op.create_table(
            "tax_settings",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("household_id", sa.String(36), sa.ForeignKey("households.id"), nullable=False),
            sa.Column("marginal_federal_rate", sa.Numeric(5, 2), nullable=True),
            sa.Column("marginal_state_rate", sa.Numeric(5, 2), nullable=True),
            sa.Column("current_federal_withholding_per_period", sa.Numeric(10, 2), nullable=True),
            sa.Column("remaining_pay_periods_this_year", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_tax_settings_household_id", "tax_settings", ["household_id"], unique=True)

    if "deduction_kind" in _columns("categories"):
        op.drop_column("categories", "deduction_kind")
    for table in ("prior_year_returns", "paystubs", "tax_profiles"):
        if table in _tables():
            op.drop_table(table)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/test_tax_models.py -v`
Expected: PASS (6 tests)

Then confirm the migration applies cleanly and the existing suite is not broken yet by the deleted model — the three old test files still import `TaxSettings` and **will fail here**. That is expected and is fixed in Task 12. Run:

Run: `cd backend && alembic upgrade head && alembic downgrade -1 && alembic upgrade head`
Expected: all three succeed with no error

- [ ] **Step 5: Commit**

```bash
git add backend/app/models backend/alembic/versions/0013_tax_projection_engine.py backend/tests/test_tax_models.py
git rm backend/app/models/tax_settings.py
git commit -m "feat(tax): replace TaxSettings with TaxProfile, Paystub, PriorYearReturn

Drops the four hand-entered rate and withholding columns -- those are
now computed from paystub actuals by the engine. Existing tax_settings
rows carry forward as profiles with a null filing status, which the
Taxes page prompts to fill. Adds categories.deduction_kind defaulting to
personal_itemized so existing rows keep their meaning.

Old TaxSettings tests fail after this commit and are rewritten in the
deductions-summary task."
```

---

### Task 8: Assembly service — the only place the two worlds meet

**Files:**
- Create: `backend/app/services/tax_assembly.py`
- Test: `backend/tests/test_tax_assembly.py`

**Interfaces:**
- Consumes: models (Task 7), `TaxInputs`/`ScheduleEResult`/`WithholdingBuckets` (Task 2)
- Produces:
  - `build_tax_inputs(db, household_id, year) -> AssemblyResult`
  - `AssemblyResult` frozen dataclass: `inputs: TaxInputs | None`, `remaining_periods: int`, `missing: list[str]`
  - `remaining_pay_periods(pay_frequency, last_pay_date, year) -> int`
  - `PERIODS_PER_YEAR: dict[str, int]`

This is the boundary between the database and the pure engine. **No tax math here** — it reads rows and shapes them into `TaxInputs`. When required data is missing it returns `inputs=None` with a populated `missing` list so the route can say what it needs rather than projecting from nothing.

Projection of remaining wages: `latest_stub.gross * remaining_periods`, added to `gross_ytd`. Same shape for each withholding bucket.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_tax_assembly.py
"""DB -> TaxInputs assembly. Contains no tax math; it shapes rows."""
from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import select

from tests.test_categories_routes import fixture, _seed_household
from app.models import Household, Paystub, PriorYearReturn, TaxProfile
from app.services.tax_assembly import (
    build_tax_inputs,
    remaining_pay_periods,
)


@pytest.mark.parametrize(
    "frequency,last_pay,expected",
    [
        ("biweekly", date(2026, 9, 18), 7),    # 26/yr, ~7 left after 18 Sep
        ("semimonthly", date(2026, 9, 15), 7), # 24/yr
        ("monthly", date(2026, 9, 1), 3),      # 12/yr
        ("weekly", date(2026, 12, 25), 0),     # none left
    ],
)
def test_remaining_pay_periods(frequency, last_pay, expected):
    assert remaining_pay_periods(frequency, last_pay, 2026) == expected


def test_remaining_pay_periods_unknown_frequency_is_zero():
    assert remaining_pay_periods(None, date(2026, 9, 18), 2026) == 0
    assert remaining_pay_periods("fortnightly", date(2026, 9, 18), 2026) == 0


async def _seed_profile(session, hid: str, status: str = "single"):
    session.add(TaxProfile(
        id=str(uuid.uuid4()), household_id=hid, filing_status=status,
    ))
    await session.flush()


async def _seed_stub(session, hid: str, pay_date: date, **overrides):
    values = dict(
        gross=Decimal("6884.62"), gross_ytd=Decimal("124000.00"),
        pretax_401k=Decimal("0.00"), pretax_401k_ytd=Decimal("0.00"),
        pretax_hsa=Decimal("0.00"), pretax_hsa_ytd=Decimal("0.00"),
        pretax_other=Decimal("0.00"), pretax_other_ytd=Decimal("0.00"),
        federal_withheld=Decimal("1240.00"), federal_withheld_ytd=Decimal("22320.00"),
        state_withheld=Decimal("280.00"), state_withheld_ytd=Decimal("5040.00"),
        ss_withheld=Decimal("417.80"), ss_withheld_ytd=Decimal("7520.40"),
        medicare_withheld=Decimal("97.70"), medicare_withheld_ytd=Decimal("1758.60"),
    )
    values.update(overrides)
    session.add(Paystub(id=str(uuid.uuid4()), household_id=hid, pay_date=pay_date, **values))
    await session.flush()


@pytest.mark.asyncio
async def test_missing_everything_reports_what_is_needed(fixture):
    session, _ = fixture
    hid, _ = await _seed_household(session)
    result = await build_tax_inputs(session, hid, 2026)
    assert result.inputs is None
    assert "filing_status" in result.missing
    assert "paystub" in result.missing


@pytest.mark.asyncio
async def test_missing_paystub_alone_still_blocks_projection(fixture):
    session, _ = fixture
    hid, _ = await _seed_household(session)
    await _seed_profile(session, hid)
    result = await build_tax_inputs(session, hid, 2026)
    assert result.inputs is None
    assert result.missing == ["paystub"]


@pytest.mark.asyncio
async def test_anchors_on_latest_stub_ytd_and_projects_forward(fixture):
    session, _ = fixture
    hid, _ = await _seed_household(session)
    household = await session.get(Household, hid)
    household.pay_frequency = "monthly"
    await _seed_profile(session, hid)
    # An older stub must be ignored in favour of the latest.
    await _seed_stub(session, hid, date(2026, 8, 1), gross_ytd=Decimal("110000.00"))
    await _seed_stub(session, hid, date(2026, 9, 1))
    await session.flush()

    result = await build_tax_inputs(session, hid, 2026)
    assert result.inputs is not None
    assert result.remaining_periods == 3
    assert result.inputs.wages_ytd == Decimal("124000.00")
    assert result.inputs.projected_remaining_wages == Decimal("20653.86")  # 6884.62 x 3
    assert result.inputs.federal_withheld_ytd == Decimal("22320.00")
    assert result.inputs.projected_remaining_withholding.federal == Decimal("3720.00")


@pytest.mark.asyncio
async def test_prior_year_carryforwards_are_wired_in(fixture):
    session, _ = fixture
    hid, _ = await _seed_household(session)
    household = await session.get(Household, hid)
    household.pay_frequency = "monthly"
    await _seed_profile(session, hid)
    await _seed_stub(session, hid, date(2026, 9, 1))
    session.add(PriorYearReturn(
        id=str(uuid.uuid4()), household_id=hid, year=2025,
        agi=Decimal("168000.00"), total_tax=Decimal("49310.60"),
    ))
    await session.flush()

    result = await build_tax_inputs(session, hid, 2026)
    assert result.inputs.prior_year_total_tax == Decimal("49310.60")
    assert result.inputs.prior_year_agi == Decimal("168000.00")
    assert "prior_year_return" not in result.missing


@pytest.mark.asyncio
async def test_prior_year_absence_is_reported_but_not_blocking(fixture):
    session, _ = fixture
    hid, _ = await _seed_household(session)
    household = await session.get(Household, hid)
    household.pay_frequency = "monthly"
    await _seed_profile(session, hid)
    await _seed_stub(session, hid, date(2026, 9, 1))
    await session.flush()

    result = await build_tax_inputs(session, hid, 2026)
    assert result.inputs is not None, "projection still works without prior year"
    assert "prior_year_return" in result.missing
    assert result.inputs.prior_year_total_tax is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_tax_assembly.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.tax_assembly'`

- [ ] **Step 3: Write minimal implementation**

```python
# backend/app/services/tax_assembly.py
"""Shapes database rows into the engine's TaxInputs.

This is the ONLY module where persistence and the pure engine meet. It
contains no tax math -- it reads rows, projects the remainder of the
year from pay frequency, and hands the result to the engine.

When required data is missing it returns inputs=None with a populated
`missing` list, so the caller can say what it needs rather than
projecting from nothing. Never fabricate a zero.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Household, Paystub, PriorYearReturn, TaxProfile
from app.services.tax.inputs import TaxInputs, WithholdingBuckets
from app.services.tax.rates.registry import FilingStatus

CENTS = Decimal("0.01")
ZERO = Decimal("0.00")

# Pay periods in a full year, by the values Household.pay_frequency uses.
PERIODS_PER_YEAR: dict[str, int] = {
    "weekly": 52,
    "biweekly": 26,
    "semimonthly": 24,
    "monthly": 12,
}


def _cents(value: Decimal) -> Decimal:
    return value.quantize(CENTS, rounding=ROUND_HALF_UP)


@dataclass(frozen=True)
class AssemblyResult:
    inputs: TaxInputs | None
    remaining_periods: int
    missing: list[str]


def remaining_pay_periods(
    pay_frequency: str | None, last_pay_date: date, year: int
) -> int:
    """Whole pay periods left in `year` after `last_pay_date`.

    Returns 0 for an unknown or unset frequency rather than guessing --
    a wrong period count silently scales the whole projection.
    """
    periods = PERIODS_PER_YEAR.get(pay_frequency or "")
    if not periods:
        return 0
    year_end = date(year, 12, 31)
    if last_pay_date >= year_end:
        return 0
    days_left = (year_end - last_pay_date).days
    days_per_period = Decimal("365") / Decimal(periods)
    return int(Decimal(days_left) / days_per_period)


async def build_tax_inputs(
    db: AsyncSession, household_id: str, year: int
) -> AssemblyResult:
    missing: list[str] = []

    profile = (
        await db.execute(
            select(TaxProfile).where(TaxProfile.household_id == household_id)
        )
    ).scalar_one_or_none()
    if profile is None or not profile.filing_status:
        missing.append("filing_status")

    latest_stub = (
        await db.execute(
            select(Paystub)
            .where(Paystub.household_id == household_id)
            .order_by(Paystub.pay_date.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if latest_stub is None:
        missing.append("paystub")

    # The gate comes BEFORE the prior-year lookup on purpose: when the
    # projection is blocked outright, `missing` should list only what is
    # blocking it. Reporting a missing prior-year return alongside is
    # noise -- the safe-harbor check it feeds is downstream of there
    # being a projection at all.
    if profile is None or not profile.filing_status or latest_stub is None:
        return AssemblyResult(inputs=None, remaining_periods=0, missing=missing)

    prior = (
        await db.execute(
            select(PriorYearReturn)
            .where(
                PriorYearReturn.household_id == household_id,
                PriorYearReturn.year == year - 1,
            )
        )
    ).scalar_one_or_none()
    if prior is None or prior.total_tax is None:
        missing.append("prior_year_return")

    household = await db.get(Household, household_id)
    periods = remaining_pay_periods(
        household.pay_frequency if household else None,
        latest_stub.pay_date,
        year,
    )
    n = Decimal(periods)

    inputs = TaxInputs(
        filing_status=FilingStatus(profile.filing_status),
        wages_ytd=_cents(latest_stub.gross_ytd),
        projected_remaining_wages=_cents(latest_stub.gross * n),
        pretax_401k=_cents(latest_stub.pretax_401k_ytd + latest_stub.pretax_401k * n),
        pretax_hsa=_cents(latest_stub.pretax_hsa_ytd + latest_stub.pretax_hsa * n),
        pretax_other=_cents(latest_stub.pretax_other_ytd + latest_stub.pretax_other * n),
        federal_withheld_ytd=_cents(latest_stub.federal_withheld_ytd),
        state_withheld_ytd=_cents(latest_stub.state_withheld_ytd),
        ss_withheld_ytd=_cents(latest_stub.ss_withheld_ytd),
        medicare_withheld_ytd=_cents(latest_stub.medicare_withheld_ytd),
        projected_remaining_withholding=WithholdingBuckets(
            federal=_cents(latest_stub.federal_withheld * n),
            state=_cents(latest_stub.state_withheld * n),
            social_security=_cents(latest_stub.ss_withheld * n),
            medicare=_cents(latest_stub.medicare_withheld * n),
        ),
        # Deductions are wired in by the deductions task; a projection is
        # valid without them.
        itemized_deductions=ZERO,
        schedule_e=None,
        prior_year_total_tax=prior.total_tax if prior else None,
        prior_year_agi=prior.agi if prior else None,
    )
    return AssemblyResult(inputs=inputs, remaining_periods=periods, missing=missing)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/test_tax_assembly.py -v`
Expected: PASS (9 tests)

If a `remaining_pay_periods` parametrize case fails, check the expectation by hand against the formula (`days_left / (365 / periods)`, truncated) before changing the implementation — the expected values above were derived from it, and the truncation is deliberate: projecting a partial period would overstate remaining income.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/tax_assembly.py backend/tests/test_tax_assembly.py
git commit -m "feat(tax): assemble TaxInputs from paystubs and profile

The only module where persistence and the pure engine meet. Anchors on
the latest paystub's YTD columns and projects the rest of the year from
pay frequency, so a mid-year raise self-corrects at the next entry.
Returns inputs=None with a 'missing' list rather than projecting from
nothing."
```

---

### Task 9: Schemas and CRUD routes

**Files:**
- Create: `backend/app/schemas/tax.py`, `backend/app/api/routes/tax.py`
- Modify: `backend/app/api/routes/__init__.py`
- Delete: `backend/tests/test_tax_settings_routes.py` (the schema and route modules were already removed in Task 7 — see its note)
- Test: `backend/tests/test_tax_routes.py`

**Interfaces:**
- Consumes: models (Task 7)
- Produces: `GET|PUT /tax/profile`, `GET|POST /tax/paystubs`, `DELETE /tax/paystubs/{id}`, `GET|PUT /tax/prior-year/{year}`

Every route is household-scoped via `Depends(get_household_id)`, matching `deductions.py`. **Authorization is at the route layer**, and every query filters on `household_id` — a paystub id from another household must 404, not delete.

Validation at the boundary with Pydantic: amounts are non-negative `Decimal`s, `pay_date` must fall in a sane year range, `filing_status` must be a known value.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_tax_routes.py
"""Household-scoped CRUD for the tax tables."""
from __future__ import annotations

import uuid
from decimal import Decimal

import pytest
from sqlalchemy import select

from tests.test_categories_routes import fixture, _seed_household, _client
from app.models import Paystub, PriorYearReturn, TaxProfile


def _stub_payload(**overrides):
    payload = {
        "pay_date": "2026-09-15",
        "gross": "6884.62",
        "pretax_401k": "904.00",
        "pretax_hsa": "160.00",
        "pretax_other": "0.00",
        "federal_withheld": "1240.00",
        "state_withheld": "280.00",
        "ss_withheld": "417.80",
        "medicare_withheld": "97.70",
        "gross_ytd": "124000.00",
        "pretax_401k_ytd": "16272.00",
        "pretax_hsa_ytd": "2880.00",
        "pretax_other_ytd": "0.00",
        "federal_withheld_ytd": "22320.00",
        "state_withheld_ytd": "5040.00",
        "ss_withheld_ytd": "7520.40",
        "medicare_withheld_ytd": "1758.60",
    }
    payload.update(overrides)
    return payload


@pytest.mark.asyncio
async def test_get_profile_returns_empty_shape_when_absent(fixture):
    session, app = fixture
    hid, _ = await _seed_household(session)
    async with _client(app, hid) as client:
        response = await client.get("/tax/profile")
    assert response.status_code == 200
    assert response.json()["filing_status"] is None


@pytest.mark.asyncio
async def test_put_profile_upserts_and_stores_walkthrough_answers(fixture):
    session, app = fixture
    hid, _ = await _seed_household(session)
    async with _client(app, hid) as client:
        response = await client.put("/tax/profile", json={
            "filing_status": "single",
            "walkthrough_answers": {"married": False, "supports_dependent": False},
        })
    assert response.status_code == 200
    assert response.json()["filing_status"] == "single"

    result = await session.execute(select(TaxProfile).where(TaxProfile.household_id == hid))
    profile = result.scalar_one()
    assert profile.walkthrough_answers["married"] is False
    assert profile.walkthrough_completed_at is not None


@pytest.mark.asyncio
async def test_put_profile_rejects_unknown_filing_status(fixture):
    session, app = fixture
    hid, _ = await _seed_household(session)
    async with _client(app, hid) as client:
        response = await client.put("/tax/profile", json={"filing_status": "bachelor"})
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_create_and_list_paystubs_newest_first(fixture):
    session, app = fixture
    hid, _ = await _seed_household(session)
    async with _client(app, hid) as client:
        assert (await client.post("/tax/paystubs", json=_stub_payload())).status_code == 201
        assert (await client.post("/tax/paystubs", json=_stub_payload(
            pay_date="2026-09-30", gross_ytd="130884.62"
        ))).status_code == 201
        response = await client.get("/tax/paystubs")

    assert response.status_code == 200
    stubs = response.json()
    assert [s["pay_date"] for s in stubs] == ["2026-09-30", "2026-09-15"]


@pytest.mark.asyncio
async def test_duplicate_pay_date_is_rejected(fixture):
    session, app = fixture
    hid, _ = await _seed_household(session)
    async with _client(app, hid) as client:
        assert (await client.post("/tax/paystubs", json=_stub_payload())).status_code == 201
        response = await client.post("/tax/paystubs", json=_stub_payload())
    assert response.status_code == 409


@pytest.mark.asyncio
async def test_negative_gross_is_rejected(fixture):
    session, app = fixture
    hid, _ = await _seed_household(session)
    async with _client(app, hid) as client:
        response = await client.post("/tax/paystubs", json=_stub_payload(gross="-100.00"))
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_ytd_going_backwards_is_rejected(fixture):
    """Spec degradation rule: a stub inconsistent with earlier ones is
    flagged rather than silently accepted. Year-to-date figures only ever
    increase; a decrease means a typo or the wrong year, and accepting it
    would quietly scale the whole projection."""
    session, app = fixture
    hid, _ = await _seed_household(session)
    async with _client(app, hid) as client:
        assert (await client.post("/tax/paystubs", json=_stub_payload())).status_code == 201
        response = await client.post("/tax/paystubs", json=_stub_payload(
            pay_date="2026-09-30", gross_ytd="100000.00"
        ))
    assert response.status_code == 422
    assert "year-to-date" in response.text.lower()


@pytest.mark.asyncio
async def test_ytd_below_this_stubs_own_gross_is_rejected(fixture):
    session, app = fixture
    hid, _ = await _seed_household(session)
    async with _client(app, hid) as client:
        response = await client.post("/tax/paystubs", json=_stub_payload(
            gross="6884.62", gross_ytd="1000.00"
        ))
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_cannot_delete_another_households_paystub(fixture):
    """Authorization guard: ownership is checked, not just authentication."""
    session, app = fixture
    hid_a, _ = await _seed_household(session)
    hid_b, _ = await _seed_household(session)
    foreign = Paystub(
        id=str(uuid.uuid4()), household_id=hid_b,
        pay_date=__import__("datetime").date(2026, 9, 15),
        gross=Decimal("100.00"), gross_ytd=Decimal("100.00"),
    )
    session.add(foreign)
    await session.flush()

    async with _client(app, hid_a) as client:
        response = await client.delete(f"/tax/paystubs/{foreign.id}")
    assert response.status_code == 404

    result = await session.execute(select(Paystub).where(Paystub.id == foreign.id))
    assert result.scalar_one_or_none() is not None, "must not delete across households"


@pytest.mark.asyncio
async def test_prior_year_upsert_round_trips(fixture):
    session, app = fixture
    hid, _ = await _seed_household(session)
    async with _client(app, hid) as client:
        response = await client.put("/tax/prior-year/2025", json={
            "filing_status": "single",
            "agi": "168000.00",
            "total_tax": "49310.60",
            "total_withheld": "50000.00",
            "itemized": False,
            "passive_loss_carryforward": "4000.00",
        })
        assert response.status_code == 200
        fetched = await client.get("/tax/prior-year/2025")

    assert fetched.json()["total_tax"] == "49310.60"
    result = await session.execute(
        select(PriorYearReturn).where(PriorYearReturn.household_id == hid)
    )
    assert result.scalar_one().year == 2025
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_tax_routes.py -v`
Expected: FAIL — 404s on every route (`/tax/...` not registered)

- [ ] **Step 3: Write minimal implementation**

```python
# backend/app/schemas/tax.py
"""Request and response models for the tax routes.

Validation happens here, at the boundary, so the service layer can trust
its inputs. Amounts are non-negative; filing status is a closed set.
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

_MONEY = Field(default=Decimal("0.00"), ge=Decimal("0"), max_digits=14, decimal_places=2)
_MONEY_REQUIRED = Field(ge=Decimal("0"), max_digits=14, decimal_places=2)
_VALID_STATUSES = {
    "single", "married_joint", "married_separate",
    "head_of_household", "qualifying_surviving_spouse",
}


class TaxProfileUpdate(BaseModel):
    filing_status: Optional[str] = None
    walkthrough_answers: Optional[dict[str, Any]] = None
    de_minimis_election: Optional[bool] = None

    @field_validator("filing_status")
    @classmethod
    def _known_status(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in _VALID_STATUSES:
            raise ValueError(f"filing_status must be one of {sorted(_VALID_STATUSES)}")
        return v


class TaxProfileResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    filing_status: Optional[str] = None
    walkthrough_answers: Optional[dict[str, Any]] = None
    walkthrough_completed_at: Optional[datetime] = None
    de_minimis_election: bool = False


class PaystubCreate(BaseModel):
    pay_date: date
    gross: Decimal = _MONEY_REQUIRED
    pretax_401k: Decimal = _MONEY
    pretax_hsa: Decimal = _MONEY
    pretax_other: Decimal = _MONEY
    federal_withheld: Decimal = _MONEY
    state_withheld: Decimal = _MONEY
    ss_withheld: Decimal = _MONEY
    medicare_withheld: Decimal = _MONEY
    gross_ytd: Decimal = _MONEY_REQUIRED
    pretax_401k_ytd: Decimal = _MONEY
    pretax_hsa_ytd: Decimal = _MONEY
    pretax_other_ytd: Decimal = _MONEY
    federal_withheld_ytd: Decimal = _MONEY
    state_withheld_ytd: Decimal = _MONEY
    ss_withheld_ytd: Decimal = _MONEY
    medicare_withheld_ytd: Decimal = _MONEY

    @field_validator("pay_date")
    @classmethod
    def _sane_year(cls, v: date) -> date:
        if not (2000 <= v.year <= 2100):
            raise ValueError("pay_date year must be between 2000 and 2100")
        return v


class PaystubResponse(PaystubCreate):
    model_config = ConfigDict(from_attributes=True)

    id: str


class PriorYearReturnUpdate(BaseModel):
    filing_status: Optional[str] = None
    agi: Optional[Decimal] = None
    taxable_income: Optional[Decimal] = None
    total_tax: Optional[Decimal] = None
    total_withheld: Optional[Decimal] = None
    itemized: bool = False
    itemized_amount: Optional[Decimal] = None
    schedule_e_net: Optional[Decimal] = None
    passive_loss_carryforward: Decimal = _MONEY
    capital_loss_carryforward: Decimal = _MONEY
    qbi_carryforward: Decimal = _MONEY

    @field_validator("filing_status")
    @classmethod
    def _known_status(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in _VALID_STATUSES:
            raise ValueError(f"filing_status must be one of {sorted(_VALID_STATUSES)}")
        return v


class PriorYearReturnResponse(PriorYearReturnUpdate):
    model_config = ConfigDict(from_attributes=True)

    year: int
```

```python
# backend/app/api/routes/tax.py
"""Tax profile, paystub, and prior-year CRUD.

Every query filters on household_id -- authorization is at the route
layer, and an id belonging to another household must 404 rather than
act. No tax math lives here.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Path, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_household_id
from app.database import get_db
from app.models import Paystub, PriorYearReturn, TaxProfile
from app.schemas.tax import (
    PaystubCreate,
    PaystubResponse,
    PriorYearReturnResponse,
    PriorYearReturnUpdate,
    TaxProfileResponse,
    TaxProfileUpdate,
)

router = APIRouter()


@router.get("/profile", response_model=TaxProfileResponse)
async def get_profile(
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    profile = (
        await db.execute(select(TaxProfile).where(TaxProfile.household_id == household_id))
    ).scalar_one_or_none()
    if profile is None:
        return TaxProfileResponse()
    return TaxProfileResponse.model_validate(profile)


@router.put("/profile", response_model=TaxProfileResponse)
async def put_profile(
    data: TaxProfileUpdate,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    profile = (
        await db.execute(select(TaxProfile).where(TaxProfile.household_id == household_id))
    ).scalar_one_or_none()
    updates = data.model_dump(exclude_unset=True)

    if profile is None:
        profile = TaxProfile(id=str(uuid.uuid4()), household_id=household_id, **updates)
        db.add(profile)
    else:
        for key, value in updates.items():
            setattr(profile, key, value)

    if "walkthrough_answers" in updates:
        profile.walkthrough_completed_at = datetime.now(timezone.utc)

    await db.flush()
    await db.refresh(profile)
    return TaxProfileResponse.model_validate(profile)


@router.get("/paystubs", response_model=list[PaystubResponse])
async def list_paystubs(
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Paystub)
        .where(Paystub.household_id == household_id)
        .order_by(Paystub.pay_date.desc())
    )
    return [PaystubResponse.model_validate(s) for s in result.scalars().all()]


@router.post("/paystubs", response_model=PaystubResponse, status_code=status.HTTP_201_CREATED)
async def create_paystub(
    data: PaystubCreate,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    existing = (
        await db.execute(
            select(Paystub).where(
                Paystub.household_id == household_id,
                Paystub.pay_date == data.pay_date,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A paystub for {data.pay_date} already exists.",
        )

    # Year-to-date figures only ever increase. A decrease means a typo or
    # the wrong year, and accepting it would quietly scale the entire
    # projection -- so flag it rather than absorbing it silently.
    if data.gross_ytd < data.gross:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Year-to-date gross ({data.gross_ytd}) is less than this "
                f"paystub's gross ({data.gross}). Check the year-to-date column."
            ),
        )

    prior = (
        await db.execute(
            select(Paystub)
            .where(
                Paystub.household_id == household_id,
                Paystub.pay_date < data.pay_date,
            )
            .order_by(Paystub.pay_date.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if prior is not None and data.gross_ytd < prior.gross_ytd:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Year-to-date gross ({data.gross_ytd}) is lower than the "
                f"previous paystub's ({prior.gross_ytd}). Year-to-date totals "
                "only go up -- check the date and the year-to-date column."
            ),
        )

    stub = Paystub(id=str(uuid.uuid4()), household_id=household_id, **data.model_dump())
    db.add(stub)
    await db.flush()
    await db.refresh(stub)
    return PaystubResponse.model_validate(stub)


@router.delete("/paystubs/{paystub_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_paystub(
    paystub_id: str,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    stub = (
        await db.execute(
            select(Paystub).where(
                Paystub.id == paystub_id,
                Paystub.household_id == household_id,
            )
        )
    ).scalar_one_or_none()
    if stub is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Paystub not found")
    await db.delete(stub)
    await db.flush()


@router.get("/prior-year/{year}", response_model=PriorYearReturnResponse)
async def get_prior_year(
    year: int = Path(ge=2000, le=2100),
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    prior = (
        await db.execute(
            select(PriorYearReturn).where(
                PriorYearReturn.household_id == household_id,
                PriorYearReturn.year == year,
            )
        )
    ).scalar_one_or_none()
    if prior is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No return recorded for that year")
    return PriorYearReturnResponse.model_validate(prior)


@router.put("/prior-year/{year}", response_model=PriorYearReturnResponse)
async def put_prior_year(
    data: PriorYearReturnUpdate,
    year: int = Path(ge=2000, le=2100),
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    prior = (
        await db.execute(
            select(PriorYearReturn).where(
                PriorYearReturn.household_id == household_id,
                PriorYearReturn.year == year,
            )
        )
    ).scalar_one_or_none()
    updates = data.model_dump(exclude_unset=True)

    if prior is None:
        prior = PriorYearReturn(
            id=str(uuid.uuid4()), household_id=household_id, year=year, **updates
        )
        db.add(prior)
    else:
        for key, value in updates.items():
            setattr(prior, key, value)

    await db.flush()
    await db.refresh(prior)
    return PriorYearReturnResponse.model_validate(prior)
```

In `backend/app/api/routes/__init__.py`: remove `tax_settings` from the import list and add `tax`; replace the `tax_settings` include line with:

```python
router.include_router(tax.router, prefix="/tax", tags=["tax"])
```

Delete `backend/tests/test_tax_settings_routes.py`. (`app/schemas/tax_settings.py` and `app/api/routes/tax_settings.py` were already removed in Task 7, because leaving them would have made `app.main` unimportable the moment the model was deleted.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/test_tax_routes.py -v`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas/tax.py backend/app/api/routes/tax.py backend/app/api/routes/__init__.py backend/tests/test_tax_routes.py
git rm backend/tests/test_tax_settings_routes.py
git commit -m "feat(tax): add profile, paystub, and prior-year routes

Replaces the tax-settings routes. Every query filters on household_id so
a foreign id 404s rather than acting; duplicate pay dates 409. Amounts
and filing status are validated at the boundary."
```

---

### Task 10: Projection and impact routes

**Files:**
- Modify: `backend/app/api/routes/tax.py`, `backend/app/schemas/tax.py`
- Test: `backend/tests/test_tax_projection_route.py`

**Interfaces:**
- Consumes: `build_tax_inputs` (Task 8), `project`/`impact_of` (Tasks 3, 6)
- Produces: `GET /tax/projection?year=`, `POST /tax/impact`

`GET /tax/projection` returns `{"available": false, "missing": [...]}` rather than a fabricated projection when inputs are incomplete. An unsupported year returns 422 with the year named — never a fallback to another year's tables.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_tax_projection_route.py
"""Projection and impact endpoints."""
from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

import pytest

from tests.test_categories_routes import fixture, _seed_household, _client
from app.models import Household, Paystub, PriorYearReturn, TaxProfile


async def _seed_ready_household(session, *, gross_ytd="179000.00"):
    hid, _ = await _seed_household(session)
    household = await session.get(Household, hid)
    household.pay_frequency = "monthly"
    session.add(TaxProfile(id=str(uuid.uuid4()), household_id=hid, filing_status="single"))
    # A December stub leaves zero periods, so YTD is the whole year.
    session.add(Paystub(
        id=str(uuid.uuid4()), household_id=hid, pay_date=date(2026, 12, 31),
        gross=Decimal("0.00"), gross_ytd=Decimal(gross_ytd),
    ))
    await session.flush()
    return hid


@pytest.mark.asyncio
async def test_projection_unavailable_lists_what_is_missing(fixture):
    session, app = fixture
    hid, _ = await _seed_household(session)
    async with _client(app, hid) as client:
        response = await client.get("/tax/projection", params={"year": 2026})
    assert response.status_code == 200
    body = response.json()
    assert body["available"] is False
    assert "filing_status" in body["missing"]
    assert "paystub" in body["missing"]
    assert body.get("projection") is None


@pytest.mark.asyncio
async def test_projection_matches_the_engine(fixture):
    session, app = fixture
    hid = await _seed_ready_household(session)
    async with _client(app, hid) as client:
        response = await client.get("/tax/projection", params={"year": 2026})

    assert response.status_code == 200
    body = response.json()
    assert body["available"] is True
    p = body["projection"]
    assert p["taxable_income"] == "162900.00"
    assert p["total_liability"] == "52555.10"
    assert p["safe_harbor"]["status"] == "unknown"
    assert len(p["explain"]) > 0


@pytest.mark.asyncio
async def test_safe_harbor_becomes_known_once_prior_year_exists(fixture):
    session, app = fixture
    hid = await _seed_ready_household(session)
    session.add(PriorYearReturn(
        id=str(uuid.uuid4()), household_id=hid, year=2025,
        agi=Decimal("168000.00"), total_tax=Decimal("49310.60"),
    ))
    await session.flush()

    async with _client(app, hid) as client:
        response = await client.get("/tax/projection", params={"year": 2026})
    assert response.json()["projection"]["safe_harbor"]["status"] in {"met", "not_met"}


@pytest.mark.asyncio
async def test_unsupported_year_is_rejected_not_approximated(fixture):
    session, app = fixture
    hid = await _seed_ready_household(session)
    async with _client(app, hid) as client:
        response = await client.get("/tax/projection", params={"year": 2019})
    assert response.status_code == 422
    assert "2019" in response.text


@pytest.mark.asyncio
async def test_impact_endpoint_returns_dollars(fixture):
    session, app = fixture
    hid = await _seed_ready_household(session)
    async with _client(app, hid) as client:
        response = await client.post("/tax/impact", json={
            "year": 2026, "kind": "extra_wages", "amount": "1000.00",
        })
    assert response.status_code == 200
    body = response.json()
    assert body["amount_of_tax"] == "360.50"
    assert body["change_amount"] == "1000.00"


@pytest.mark.asyncio
async def test_impact_of_a_personal_deduction_below_the_standard_is_zero(fixture):
    """The correctness fix, asserted end to end."""
    session, app = fixture
    hid = await _seed_ready_household(session)
    async with _client(app, hid) as client:
        response = await client.post("/tax/impact", json={
            "year": 2026, "kind": "extra_itemized_deduction", "amount": "5000.00",
        })
    assert response.json()["amount_of_tax"] == "0.00"


@pytest.mark.asyncio
async def test_impact_rejects_an_unknown_kind(fixture):
    session, app = fixture
    hid = await _seed_ready_household(session)
    async with _client(app, hid) as client:
        response = await client.post("/tax/impact", json={
            "year": 2026, "kind": "buy_a_boat", "amount": "1000.00",
        })
    assert response.status_code == 422
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_tax_projection_route.py -v`
Expected: FAIL — 404 on `/tax/projection`

- [ ] **Step 3: Write minimal implementation**

Append to `backend/app/schemas/tax.py`:

```python
class ExplainStepResponse(BaseModel):
    label: str
    amount: Decimal
    detail: str


class SafeHarborResponse(BaseModel):
    status: str
    test_used: str
    required_payment: Optional[Decimal] = None
    projected_payment: Optional[Decimal] = None
    shortfall: Optional[Decimal] = None
    per_period_to_close: Optional[Decimal] = None
    reason: str


class TaxProjectionResponse(BaseModel):
    agi: Decimal
    magi_for_pal: Decimal
    deduction_taken: Decimal
    deduction_kind: str
    standard_deduction: Decimal
    itemized_total: Decimal
    taxable_income: Decimal
    federal_income_tax: Decimal
    social_security_tax: Decimal
    medicare_tax: Decimal
    additional_medicare_tax: Decimal
    state_tax: Decimal
    total_liability: Decimal
    total_withheld_projected: Decimal
    refund_or_amount_due: Decimal
    effective_rate: Decimal
    schedule_e_allowed_loss: Decimal
    schedule_e_suspended_loss: Decimal
    safe_harbor: SafeHarborResponse
    explain: list[ExplainStepResponse]


class ProjectionEnvelope(BaseModel):
    """Never returns a fabricated projection. When inputs are incomplete,
    `available` is false and `missing` says what to enter."""
    year: int
    available: bool
    missing: list[str] = []
    remaining_pay_periods: int = 0
    projection: Optional[TaxProjectionResponse] = None


IMPACT_KINDS = {
    "extra_wages", "extra_pretax_401k", "extra_pretax_hsa",
    "extra_business_expense", "extra_itemized_deduction",
}


class ImpactRequest(BaseModel):
    year: int = Field(ge=2000, le=2100)
    kind: str
    amount: Decimal = Field(gt=Decimal("0"), max_digits=14, decimal_places=2)

    @field_validator("kind")
    @classmethod
    def _known_kind(cls, v: str) -> str:
        if v not in IMPACT_KINDS:
            raise ValueError(f"kind must be one of {sorted(IMPACT_KINDS)}")
        return v


class ImpactResponse(BaseModel):
    kind: str
    change_amount: Decimal
    amount_of_tax: Decimal      # positive = more tax, negative = less
    blended_rate_percent: Decimal
    note: str
```

Append to `backend/app/api/routes/tax.py`:

```python
from datetime import date as _date
from decimal import Decimal

from fastapi import Query

from app.schemas.tax import (
    ImpactRequest, ImpactResponse, ProjectionEnvelope, TaxProjectionResponse,
)
from app.services.tax import (
    ExtraBusinessExpense, ExtraItemizedDeduction, ExtraPretax401k,
    ExtraPretaxHsa, ExtraWages, UnknownTaxYearError,
    UnsupportedFilingStatusError, get_rates, impact_of, project,
)
from app.services.tax_assembly import build_tax_inputs

_CHANGE_TYPES = {
    "extra_wages": ExtraWages,
    "extra_pretax_401k": ExtraPretax401k,
    "extra_pretax_hsa": ExtraPretaxHsa,
    "extra_business_expense": ExtraBusinessExpense,
    "extra_itemized_deduction": ExtraItemizedDeduction,
}


def _rates_or_422(year: int):
    try:
        return get_rates(year)
    except UnknownTaxYearError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/projection", response_model=ProjectionEnvelope)
async def get_projection(
    year: int = Query(default_factory=lambda: _date.today().year, ge=2000, le=2100),
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    rates = _rates_or_422(year)
    assembled = await build_tax_inputs(db, household_id, year)
    if assembled.inputs is None:
        return ProjectionEnvelope(year=year, available=False, missing=assembled.missing)

    try:
        projection = project(assembled.inputs, rates, assembled.remaining_periods)
    except UnsupportedFilingStatusError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return ProjectionEnvelope(
        year=year,
        available=True,
        missing=assembled.missing,
        remaining_pay_periods=assembled.remaining_periods,
        projection=TaxProjectionResponse.model_validate(projection, from_attributes=True),
    )


@router.post("/impact", response_model=ImpactResponse)
async def post_impact(
    data: ImpactRequest,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    rates = _rates_or_422(data.year)
    assembled = await build_tax_inputs(db, household_id, data.year)
    if assembled.inputs is None:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot compute impact yet. Still needed: {', '.join(assembled.missing)}",
        )

    change = _CHANGE_TYPES[data.kind](data.amount)
    try:
        dollars = impact_of(assembled.inputs, change, rates)
    except UnsupportedFilingStatusError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    blended = (dollars / data.amount * Decimal("100")).quantize(Decimal("0.01"))
    if dollars > 0:
        note = f"Adds ${dollars} in tax across this ${data.amount}."
    elif dollars < 0:
        note = f"Saves ${-dollars} in tax across this ${data.amount}."
    else:
        note = (
            f"Changes your tax by nothing. ${data.amount} here is worth "
            "$0 to you this year."
        )

    return ImpactResponse(
        kind=data.kind,
        change_amount=data.amount,
        amount_of_tax=dollars,
        blended_rate_percent=blended,
        note=note,
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/test_tax_projection_route.py -v`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/routes/tax.py backend/app/schemas/tax.py backend/tests/test_tax_projection_route.py
git commit -m "feat(tax): add projection and impact endpoints

The projection envelope returns available=false with a 'missing' list
rather than a fabricated figure, and an unsupported year 422s with the
year named rather than falling back to another year's tables. The impact
endpoint reports dollars, with the blended rate labeled by the amount it
spans."
```

---

### Task 11: Rewrite the deductions summary on the engine

**Files:**
- Modify: `backend/app/services/deductions.py`, `backend/app/schemas/deductions.py`
- Modify: `backend/tests/test_deductions_summary.py`, `backend/tests/test_tax_deductions_models.py`
- Test: `backend/tests/test_deductions_summary.py` (rewritten)

**Interfaces:**
- Consumes: `build_tax_inputs` (Task 8), `impact_of` (Task 6), `Category.deduction_kind` (Task 7)
- Produces: `compute_deductions_summary(db, household_id, year)` — **same signature**, extended response

**This is the task the whole phase exists for.** Replace flat-rate multiplication with the engine.

Response keeps every existing field so the current page and its tests keep working, and gains four:

| Field | Meaning |
|---|---|
| `business_total` | Schedule E expenses. Worth something from the first dollar. |
| `personal_itemized_total` | Schedule A style. Only matters above the standard deduction. |
| `personal_itemized_value` | What the personal total is **actually** worth — frequently `0.00`. |
| `standard_deduction` | So the page can explain why. |

`estimated_tax_savings` becomes `business value + personal value`, computed by two `impact_of` calls. It is `None` (not `0`) when no projection is available. **When it is `0.00`, that is a correct answer, not a missing one** — Task 15 updates the copy so a correct zero does not read as a bug.

`suggested_withholding_reduction_per_period` resolves the spec gap from the header: it is now `refund_or_amount_due / remaining_periods` when the projection shows an over-withholding, else `None`.

- [ ] **Step 1: Write the failing test**

Replace the body of `backend/tests/test_deductions_summary.py`. Remove every `TaxSettings` import and usage (that model is gone); seed a `TaxProfile` and a `Paystub` instead. Keep the existing grouping and percentage tests unchanged — they still pass and they guard the aggregation half.

```python
# backend/tests/test_deductions_summary.py  (additions; keep existing
# grouping/pct tests, swapping TaxSettings seeding for the helper below)
import uuid
from datetime import date as _date
from decimal import Decimal

import pytest

from app.models import Household, Paystub, TaxProfile
from app.services.deductions import compute_deductions_summary


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
    """Same dollars as the test above, valued through Schedule E."""
    session, _ = fixture
    hid, _ = await _seed_household(session)
    await _seed_tax_ready(session, hid)
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
```

Also update `backend/tests/test_tax_deductions_models.py`: drop the `TaxSettings` import and its round-trip test (covered now by `tests/test_tax_models.py`), keeping the category and transaction column tests.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_deductions_summary.py -v`
Expected: FAIL — `AttributeError: 'DeductionsSummaryResponse' object has no attribute 'business_total'`

- [ ] **Step 3: Write minimal implementation**

```python
# backend/app/schemas/deductions.py
from pydantic import BaseModel
from decimal import Decimal
from typing import Optional


class DeductionLine(BaseModel):
    tax_line: str
    amount: Decimal
    deduction_kind: str = "personal_itemized"


class DeductionsSummaryResponse(BaseModel):
    year: int
    lines: list[DeductionLine]
    total: Decimal
    estimated_tax_savings: Optional[Decimal] = None
    suggested_withholding_reduction_per_period: Optional[Decimal] = None
    # Business expenses reduce income from the first dollar; personal
    # itemized deductions only matter above the standard deduction. They
    # are worth very different amounts and must be reported separately.
    business_total: Decimal = Decimal("0.00")
    personal_itemized_total: Decimal = Decimal("0.00")
    personal_itemized_value: Optional[Decimal] = None
    standard_deduction: Optional[Decimal] = None
```

```python
# backend/app/services/deductions.py
"""Aggregates deductible transactions and values them through the tax
engine.

This module used to multiply a total by a hand-entered marginal rate.
That produced wrong numbers, not merely imprecise ones: a personal
deduction below the standard deduction saves nothing, but the flat-rate
code reported a saving anyway. Valuation now runs through impact_of(),
which re-runs the real engine.

See docs/superpowers/specs/2026-09-19-tax-projection-engine-design.md.
"""
from __future__ import annotations

from collections import defaultdict
from decimal import Decimal

from sqlalchemy import extract, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Account, Category, CategoryGroup, Transaction
from app.schemas.deductions import DeductionLine, DeductionsSummaryResponse
from app.services.tax import (
    ExtraBusinessExpense,
    ExtraItemizedDeduction,
    UnknownTaxYearError,
    UnsupportedFilingStatusError,
    get_rates,
    impact_of,
    project,
)
from app.services.tax_assembly import build_tax_inputs

_CENTS = Decimal("0.01")
_ZERO = Decimal("0.00")


async def compute_deductions_summary(
    db: AsyncSession, household_id: str, year: int
) -> DeductionsSummaryResponse:
    result = await db.execute(
        select(Transaction, Category)
        .join(Category, Transaction.category_id == Category.id)
        .join(CategoryGroup, Category.group_id == CategoryGroup.id)
        .join(Account, Transaction.account_id == Account.id)
        .where(
            Category.deductible.is_(True),
            extract("year", Transaction.date) == year,
            CategoryGroup.household_id == household_id,
            Account.household_id == household_id,
        )
    )
    rows = result.all()

    totals: dict[tuple[str, str], Decimal] = defaultdict(lambda: _ZERO)
    grand_total = _ZERO
    business_total = _ZERO
    personal_total = _ZERO

    for txn, category in rows:
        pct = (
            txn.deduction_pct_override
            if txn.deduction_pct_override is not None
            else category.deduction_pct
        )
        # Expenses are stored as negative amounts throughout this app.
        # Negate so a deductible expense summarizes as a positive
        # deduction, while a refund/credit still nets out correctly --
        # do not use abs(), which would break netting.
        amount = (-txn.amount * pct / Decimal("100")).quantize(_CENTS)
        label = category.tax_line or category.name
        kind = category.deduction_kind
        totals[(label, kind)] += amount
        grand_total += amount
        if kind == "business_expense":
            business_total += amount
        else:
            personal_total += amount

    lines = [
        DeductionLine(tax_line=label, amount=amount, deduction_kind=kind)
        for (label, kind), amount in totals.items()
    ]

    savings, personal_value, standard, per_period = await _value_deductions(
        db, household_id, year, business_total, personal_total
    )

    return DeductionsSummaryResponse(
        year=year,
        lines=lines,
        total=grand_total,
        estimated_tax_savings=savings,
        suggested_withholding_reduction_per_period=per_period,
        business_total=business_total,
        personal_itemized_total=personal_total,
        personal_itemized_value=personal_value,
        standard_deduction=standard,
    )


async def _value_deductions(
    db: AsyncSession,
    household_id: str,
    year: int,
    business_total: Decimal,
    personal_total: Decimal,
) -> tuple[Decimal | None, Decimal | None, Decimal | None, Decimal | None]:
    """Returns (total savings, personal value, standard deduction,
    per-period withholding adjustment). All None when the engine cannot
    run -- genuinely unknown, never a fabricated zero.

    A returned 0.00 IS an answer: it means those deductions are worth
    nothing this year.
    """
    try:
        rates = get_rates(year)
    except UnknownTaxYearError:
        return None, None, None, None

    assembled = await build_tax_inputs(db, household_id, year)
    if assembled.inputs is None:
        return None, None, None, None

    inputs = assembled.inputs
    try:
        baseline = project(inputs, rates, assembled.remaining_periods)

        business_value = (
            -impact_of(inputs, ExtraBusinessExpense(business_total), rates)
            if business_total > _ZERO else _ZERO
        )
        personal_value = (
            -impact_of(inputs, ExtraItemizedDeduction(personal_total), rates)
            if personal_total > _ZERO else _ZERO
        )
    except UnsupportedFilingStatusError:
        return None, None, None, None

    savings = (business_value + personal_value).quantize(_CENTS)

    # Resolves the spec's shape-preservation gap: the field survives, but
    # is now derived from the projection rather than from the dropped
    # manual withholding columns.
    per_period: Decimal | None = None
    if assembled.remaining_periods > 0 and baseline.refund_or_amount_due > _ZERO:
        per_period = (
            baseline.refund_or_amount_due / Decimal(assembled.remaining_periods)
        ).quantize(_CENTS)

    return savings, personal_value.quantize(_CENTS), baseline.standard_deduction, per_period
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest -q`
Expected: PASS — the **entire** backend suite, including the three old test files fixed in this task.

This is the first point where the whole suite should be green again since Task 7.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/deductions.py backend/app/schemas/deductions.py backend/tests/
git commit -m "feat(tax): value deductions through the engine, split by kind

Replaces flat-rate multiplication. A personal itemized deduction below
the standard deduction now correctly reports a \$0 saving where the old
code reported 26.4% of it; business expenses are valued separately
because they reduce income from the first dollar. The withholding
suggestion is now derived from the projection rather than the dropped
manual columns."
```

---

### Task 12: Frontend API client

**Files:**
- Create: `frontend/src/lib/api/tax.ts`, `frontend/src/lib/api/tax.test.ts`
- Modify: `frontend/src/lib/api/deductions.ts`, `frontend/src/lib/api/deductions.test.ts`
- (`frontend/src/lib/api/tax-settings.ts` is deleted in Task 15, not here — `deductions/page.tsx` still imports it until then, and deleting it early leaves the tree un-typecheckable.)

**Interfaces:**
- Consumes: routes from Tasks 9–11
- Produces: `taxApi` with `profile()`, `saveProfile()`, `paystubs()`, `addPaystub()`, `deletePaystub()`, `priorYear(year)`, `savePriorYear(year, data)`, `projection(year)`, `impact(body)`

**The backend serializes `Decimal` as JSON strings.** The existing `deductions.ts` coerces to `number` in one place; follow that pattern exactly — coerce once, at the boundary, so no component has to think about it.

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/src/lib/api/tax.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import api from "./client";
import { taxApi } from "./tax";

vi.mock("./client", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

describe("taxApi", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requests the projection for a year", async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: { year: 2026, available: false, missing: ["paystub"], remaining_pay_periods: 0, projection: null },
    });
    const result = await taxApi.projection(2026);
    expect(api.get).toHaveBeenCalledWith("/tax/projection", { params: { year: 2026 } });
    expect(result.available).toBe(false);
    expect(result.projection).toBeNull();
  });

  it("coerces decimal strings in the projection to numbers", async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        year: 2026, available: true, missing: [], remaining_pay_periods: 3,
        projection: {
          agi: "179000.00", magi_for_pal: "179000.00", deduction_taken: "16100.00",
          deduction_kind: "standard", standard_deduction: "16100.00",
          itemized_total: "0.00", taxable_income: "162900.00",
          federal_income_tax: "31694.00", social_security_tax: "11098.00",
          medicare_tax: "2595.50", additional_medicare_tax: "0.00",
          state_tax: "7167.60", total_liability: "52555.10",
          total_withheld_projected: "50000.00", refund_or_amount_due: "-2555.10",
          effective_rate: "29.36", schedule_e_allowed_loss: "0.00",
          schedule_e_suspended_loss: "0.00",
          safe_harbor: {
            status: "not_met", test_used: "90_percent_current",
            required_payment: "47299.59", projected_payment: "50000.00",
            shortfall: "0.00", per_period_to_close: "0.00", reason: "ok",
          },
          explain: [{ label: "Wages", amount: "179000.00", detail: "x" }],
        },
      },
    });

    const result = await taxApi.projection(2026);
    expect(result.projection!.total_liability).toBe(52555.1);
    expect(typeof result.projection!.total_liability).toBe("number");
    expect(result.projection!.refund_or_amount_due).toBe(-2555.1);
    expect(result.projection!.explain[0].amount).toBe(179000);
    expect(result.projection!.safe_harbor.shortfall).toBe(0);
  });

  it("posts an impact request and coerces the dollars", async () => {
    vi.mocked(api.post).mockResolvedValue({
      data: {
        kind: "extra_wages", change_amount: "1000.00",
        amount_of_tax: "360.50", blended_rate_percent: "36.05", note: "x",
      },
    });
    const result = await taxApi.impact({ year: 2026, kind: "extra_wages", amount: 1000 });
    expect(api.post).toHaveBeenCalledWith("/tax/impact", {
      year: 2026, kind: "extra_wages", amount: "1000",
    });
    expect(result.amount_of_tax).toBe(360.5);
  });

  it("returns null for a prior year that has no record", async () => {
    vi.mocked(api.get).mockRejectedValue({ response: { status: 404 } });
    await expect(taxApi.priorYear(2025)).resolves.toBeNull();
  });
});
```

Add to `frontend/src/lib/api/deductions.test.ts`:

```typescript
  it("coerces the new business and personal fields", async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        year: 2026, lines: [], total: "5000.00",
        estimated_tax_savings: "0.00",
        suggested_withholding_reduction_per_period: null,
        business_total: "0.00", personal_itemized_total: "5000.00",
        personal_itemized_value: "0.00", standard_deduction: "16100.00",
      },
    });
    const result = await deductionsApi.summary(2026);
    expect(result.personal_itemized_value).toBe(0);
    expect(result.standard_deduction).toBe(16100);
    expect(result.estimated_tax_savings).toBe(0);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- --run src/lib/api/tax.test.ts`
Expected: FAIL — cannot resolve `./tax`

- [ ] **Step 3: Write minimal implementation**

```typescript
// frontend/src/lib/api/tax.ts
import api from "./client";

// The backend serializes Decimal as a JSON string ("52555.10"). These
// types declare `number`; coerce once here so no component has to think
// about the wire format.
const num = (v: string | number) => Number(v);
const maybeNum = (v: string | number | null) => (v === null ? null : Number(v));

export type FilingStatus =
  | "single" | "married_joint" | "married_separate"
  | "head_of_household" | "qualifying_surviving_spouse";

export interface TaxProfile {
  filing_status: FilingStatus | null;
  walkthrough_answers: Record<string, unknown> | null;
  walkthrough_completed_at: string | null;
  de_minimis_election: boolean;
}

export interface Paystub {
  id: string;
  pay_date: string;
  gross: number;
  pretax_401k: number;
  pretax_hsa: number;
  pretax_other: number;
  federal_withheld: number;
  state_withheld: number;
  ss_withheld: number;
  medicare_withheld: number;
  gross_ytd: number;
  pretax_401k_ytd: number;
  pretax_hsa_ytd: number;
  pretax_other_ytd: number;
  federal_withheld_ytd: number;
  state_withheld_ytd: number;
  ss_withheld_ytd: number;
  medicare_withheld_ytd: number;
}

export type PaystubInput = Omit<Paystub, "id">;

export interface ExplainStep { label: string; amount: number; detail: string }

export interface SafeHarbor {
  status: "met" | "not_met" | "unknown";
  test_used: string;
  required_payment: number | null;
  projected_payment: number | null;
  shortfall: number | null;
  per_period_to_close: number | null;
  reason: string;
}

export interface TaxProjection {
  agi: number;
  magi_for_pal: number;
  deduction_taken: number;
  deduction_kind: "standard" | "itemized";
  standard_deduction: number;
  itemized_total: number;
  taxable_income: number;
  federal_income_tax: number;
  social_security_tax: number;
  medicare_tax: number;
  additional_medicare_tax: number;
  state_tax: number;
  total_liability: number;
  total_withheld_projected: number;
  refund_or_amount_due: number;
  effective_rate: number;
  schedule_e_allowed_loss: number;
  schedule_e_suspended_loss: number;
  safe_harbor: SafeHarbor;
  explain: ExplainStep[];
}

export interface ProjectionEnvelope {
  year: number;
  available: boolean;
  missing: string[];
  remaining_pay_periods: number;
  projection: TaxProjection | null;
}

export interface PriorYearReturn {
  year: number;
  filing_status: FilingStatus | null;
  agi: number | null;
  taxable_income: number | null;
  total_tax: number | null;
  total_withheld: number | null;
  itemized: boolean;
  itemized_amount: number | null;
  schedule_e_net: number | null;
  passive_loss_carryforward: number;
  capital_loss_carryforward: number;
  qbi_carryforward: number;
}

export type ImpactKind =
  | "extra_wages" | "extra_pretax_401k" | "extra_pretax_hsa"
  | "extra_business_expense" | "extra_itemized_deduction";

export interface ImpactResult {
  kind: ImpactKind;
  change_amount: number;
  amount_of_tax: number;       // positive = more tax
  blended_rate_percent: number;
  note: string;
}

const MONEY_KEYS: (keyof TaxProjection)[] = [
  "agi", "magi_for_pal", "deduction_taken", "standard_deduction",
  "itemized_total", "taxable_income", "federal_income_tax",
  "social_security_tax", "medicare_tax", "additional_medicare_tax",
  "state_tax", "total_liability", "total_withheld_projected",
  "refund_or_amount_due", "effective_rate", "schedule_e_allowed_loss",
  "schedule_e_suspended_loss",
];

function coerceProjection(p: TaxProjection): TaxProjection {
  const out = { ...p } as Record<string, unknown>;
  for (const key of MONEY_KEYS) out[key] = num(p[key] as unknown as string);
  out.explain = p.explain.map((s) => ({ ...s, amount: num(s.amount as unknown as string) }));
  out.safe_harbor = {
    ...p.safe_harbor,
    required_payment: maybeNum(p.safe_harbor.required_payment as unknown as string | null),
    projected_payment: maybeNum(p.safe_harbor.projected_payment as unknown as string | null),
    shortfall: maybeNum(p.safe_harbor.shortfall as unknown as string | null),
    per_period_to_close: maybeNum(p.safe_harbor.per_period_to_close as unknown as string | null),
  };
  return out as unknown as TaxProjection;
}

function coercePaystub(s: Paystub): Paystub {
  const out = { ...s } as Record<string, unknown>;
  for (const [key, value] of Object.entries(s)) {
    if (key !== "id" && key !== "pay_date") out[key] = num(value as string);
  }
  return out as unknown as Paystub;
}

export const taxApi = {
  profile: () => api.get<TaxProfile>("/tax/profile").then((r) => r.data),

  saveProfile: (data: Partial<TaxProfile>) =>
    api.put<TaxProfile>("/tax/profile", data).then((r) => r.data),

  paystubs: () =>
    api.get<Paystub[]>("/tax/paystubs").then((r) => r.data.map(coercePaystub)),

  addPaystub: (data: PaystubInput) =>
    api.post<Paystub>("/tax/paystubs", data).then((r) => coercePaystub(r.data)),

  deletePaystub: (id: string) => api.delete(`/tax/paystubs/${id}`).then(() => undefined),

  priorYear: (year: number) =>
    api
      .get<PriorYearReturn>(`/tax/prior-year/${year}`)
      .then((r) => r.data)
      .catch((e: { response?: { status?: number } }) => {
        if (e.response?.status === 404) return null;
        throw e;
      }),

  savePriorYear: (year: number, data: Partial<PriorYearReturn>) =>
    api.put<PriorYearReturn>(`/tax/prior-year/${year}`, data).then((r) => r.data),

  projection: (year: number) =>
    api
      .get<ProjectionEnvelope>("/tax/projection", { params: { year } })
      .then((r) => ({
        ...r.data,
        projection: r.data.projection ? coerceProjection(r.data.projection) : null,
      })),

  impact: (body: { year: number; kind: ImpactKind; amount: number }) =>
    api
      .post<ImpactResult>("/tax/impact", { ...body, amount: String(body.amount) })
      .then((r) => ({
        ...r.data,
        change_amount: num(r.data.change_amount as unknown as string),
        amount_of_tax: num(r.data.amount_of_tax as unknown as string),
        blended_rate_percent: num(r.data.blended_rate_percent as unknown as string),
      })),
};
```

In `frontend/src/lib/api/deductions.ts`, add the four fields to `DeductionsSummary` and coerce them in `coerceSummary`:

```typescript
export interface DeductionsSummary {
  year: number;
  lines: DeductionLine[];
  total: number;
  estimated_tax_savings: number | null;
  suggested_withholding_reduction_per_period: number | null;
  business_total: number;
  personal_itemized_total: number;
  personal_itemized_value: number | null;
  standard_deduction: number | null;
}
```

and inside `coerceSummary`'s returned object:

```typescript
    business_total: Number(data.business_total ?? 0),
    personal_itemized_total: Number(data.personal_itemized_total ?? 0),
    personal_itemized_value:
      data.personal_itemized_value === null || data.personal_itemized_value === undefined
        ? null
        : Number(data.personal_itemized_value),
    standard_deduction:
      data.standard_deduction === null || data.standard_deduction === undefined
        ? null
        : Number(data.standard_deduction),
```

Also add `deduction_kind: string;` to the `DeductionLine` interface.

Leave `frontend/src/lib/api/tax-settings.ts` in place — `deductions/page.tsx` still imports it. Task 15 removes that import and deletes the module in the same commit.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- --run src/lib/api/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/api/tax.ts frontend/src/lib/api/tax.test.ts frontend/src/lib/api/deductions.ts frontend/src/lib/api/deductions.test.ts
git commit -m "feat(tax): add the tax API client

Coerces the backend's Decimal-as-string wire format to numbers once at
the boundary, matching the existing deductions client. A missing
prior-year record resolves to null rather than throwing."
```

---

### Task 13: Filing status walkthrough

**Files:**
- Create: `frontend/src/app/(app)/taxes/filing-status-walkthrough.tsx` and `.test.tsx`
- Test: `frontend/src/app/(app)/taxes/filing-status-walkthrough.test.tsx`

**Interfaces:**
- Consumes: `taxApi.saveProfile` (Task 12)
- Produces: `<FilingStatusWalkthrough profile onSave />` where `onSave: (data: {filing_status, walkthrough_answers}) => void`

**This is a correctness control, not a UX nicety.** A single filer who picks "head of household" from a dropdown gets a standard deduction $8,050 too large — roughly $2,100 of phantom refund. The walkthrough asks plain questions and *derives* the status, then explains which answer produced it.

Determination logic:
- married → `married_joint` (with a note that filing separately exists and is usually worse)
- not married + supports a dependent who lived with them over half the year + paid over half the home costs → `head_of_household`
- otherwise → `single`

**Plain English everywhere.** No "marginal rate", no "withholding", no "AGI" in the question text.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/app/(app)/taxes/filing-status-walkthrough.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FilingStatusWalkthrough } from "./filing-status-walkthrough";

const emptyProfile = {
  filing_status: null,
  walkthrough_answers: null,
  walkthrough_completed_at: null,
  de_minimis_election: false,
};

describe("FilingStatusWalkthrough", () => {
  it("determines Single for an unmarried filer with no dependents", async () => {
    const onSave = vi.fn();
    render(<FilingStatusWalkthrough profile={emptyProfile} onSave={onSave} />);

    await userEvent.click(screen.getByRole("radio", { name: /no.*not married/i }));
    await userEvent.click(screen.getByRole("radio", { name: /no.*just me/i }));
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(onSave).toHaveBeenCalledWith({
      filing_status: "single",
      walkthrough_answers: { married: false, supports_dependent: false },
    });
  });

  it("determines head of household only when every condition is met", async () => {
    const onSave = vi.fn();
    render(<FilingStatusWalkthrough profile={emptyProfile} onSave={onSave} />);

    await userEvent.click(screen.getByRole("radio", { name: /no.*not married/i }));
    await userEvent.click(screen.getByRole("radio", { name: /yes.*lives with me/i }));
    await userEvent.click(screen.getByRole("radio", { name: /yes.*more than half the costs/i }));
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(onSave).toHaveBeenCalledWith({
      filing_status: "head_of_household",
      walkthrough_answers: {
        married: false, supports_dependent: true, pays_over_half_home: true,
      },
    });
  });

  it("falls back to Single when the home-cost test is not met", async () => {
    const onSave = vi.fn();
    render(<FilingStatusWalkthrough profile={emptyProfile} onSave={onSave} />);

    await userEvent.click(screen.getByRole("radio", { name: /no.*not married/i }));
    await userEvent.click(screen.getByRole("radio", { name: /yes.*lives with me/i }));
    await userEvent.click(screen.getByRole("radio", { name: /no.*someone else/i }));
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(onSave.mock.calls[0][0].filing_status).toBe("single");
  });

  it("explains the result rather than just naming it", async () => {
    render(<FilingStatusWalkthrough profile={emptyProfile} onSave={vi.fn()} />);
    await userEvent.click(screen.getByRole("radio", { name: /no.*not married/i }));
    await userEvent.click(screen.getByRole("radio", { name: /no.*just me/i }));
    expect(screen.getByText(/because you/i)).toBeInTheDocument();
  });

  it("does not offer a save until every question is answered", () => {
    render(<FilingStatusWalkthrough profile={emptyProfile} onSave={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /save/i })).not.toBeInTheDocument();
  });

  it("shows the stored answers when revisited", () => {
    render(
      <FilingStatusWalkthrough
        profile={{
          ...emptyProfile,
          filing_status: "single",
          walkthrough_answers: { married: false, supports_dependent: false },
        }}
        onSave={vi.fn()}
      />
    );
    expect(screen.getByRole("radio", { name: /no.*not married/i })).toBeChecked();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- --run "src/app/(app)/taxes/filing-status-walkthrough.test.tsx"`
Expected: FAIL — cannot resolve `./filing-status-walkthrough`

- [ ] **Step 3: Write minimal implementation**

```tsx
// frontend/src/app/(app)/taxes/filing-status-walkthrough.tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { FilingStatus, TaxProfile } from "@/lib/api/tax";

/**
 * Filing status is DERIVED from plain questions, never picked from a
 * list. A single filer who selects "head of household" gets a standard
 * deduction $8,050 too large -- about $2,100 of refund that does not
 * exist. This component is a correctness control.
 */

type Answers = {
  married?: boolean;
  supports_dependent?: boolean;
  pays_over_half_home?: boolean;
};

function determine(answers: Answers): FilingStatus | null {
  if (answers.married === undefined) return null;
  if (answers.married) return "married_joint";
  if (answers.supports_dependent === undefined) return null;
  if (!answers.supports_dependent) return "single";
  if (answers.pays_over_half_home === undefined) return null;
  return answers.pays_over_half_home ? "head_of_household" : "single";
}

const EXPLANATION: Record<FilingStatus, string> = {
  single: "Because you aren't married and nobody you support lives with you.",
  married_joint:
    "Because you're married. Filing separately is also possible, but it usually costs more.",
  head_of_household:
    "Because you aren't married, someone you support lives with you, and you pay more than half the cost of the home.",
  married_separate: "",
  qualifying_surviving_spouse: "",
};

const LABELS: Record<FilingStatus, string> = {
  single: "Single",
  married_joint: "Married, filing together",
  married_separate: "Married, filing separately",
  head_of_household: "Head of household",
  qualifying_surviving_spouse: "Qualifying surviving spouse",
};

function Choice({
  name, label, checked, onChange,
}: { name: string; label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="flex items-center gap-2 py-1 text-sm">
      <input type="radio" name={name} checked={checked} onChange={onChange} />
      <span>{label}</span>
    </label>
  );
}

export function FilingStatusWalkthrough({
  profile,
  onSave,
}: {
  profile: TaxProfile;
  onSave: (data: {
    filing_status: FilingStatus;
    walkthrough_answers: Record<string, unknown>;
  }) => void;
}) {
  const [answers, setAnswers] = useState<Answers>(
    (profile.walkthrough_answers as Answers) ?? {}
  );
  const status = determine(answers);

  const set = (patch: Answers) =>
    setAnswers((prev) => {
      const next = { ...prev, ...patch };
      // Dropping now-irrelevant answers keeps the stored record honest.
      if (next.married) { delete next.supports_dependent; delete next.pays_over_half_home; }
      if (next.supports_dependent === false) delete next.pays_over_half_home;
      return next;
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>How you file</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          A few plain questions. Getting this wrong is the most expensive
          mistake this page can make, so we work it out rather than asking
          you to pick from a list.
        </p>

        <fieldset>
          <legend className="text-sm font-medium">Are you married?</legend>
          <Choice name="married" label="No, I'm not married"
            checked={answers.married === false} onChange={() => set({ married: false })} />
          <Choice name="married" label="Yes, I'm married"
            checked={answers.married === true} onChange={() => set({ married: true })} />
        </fieldset>

        {answers.married === false && (
          <fieldset>
            <legend className="text-sm font-medium">
              Does anyone live with you that you financially support?
            </legend>
            <Choice name="dependent" label="No, it's just me"
              checked={answers.supports_dependent === false}
              onChange={() => set({ supports_dependent: false })} />
            <Choice name="dependent" label="Yes, a child or relative lives with me"
              checked={answers.supports_dependent === true}
              onChange={() => set({ supports_dependent: true })} />
          </fieldset>
        )}

        {answers.married === false && answers.supports_dependent === true && (
          <fieldset>
            <legend className="text-sm font-medium">
              Do you pay more than half the cost of keeping up your home?
            </legend>
            <Choice name="home" label="Yes, I pay more than half the costs"
              checked={answers.pays_over_half_home === true}
              onChange={() => set({ pays_over_half_home: true })} />
            <Choice name="home" label="No, someone else pays half or more"
              checked={answers.pays_over_half_home === false}
              onChange={() => set({ pays_over_half_home: false })} />
          </fieldset>
        )}

        {status && (
          <div className="rounded border p-3 text-sm">
            <p className="font-medium">You file as: {LABELS[status]}</p>
            <p className="text-muted-foreground">{EXPLANATION[status]}</p>
          </div>
        )}

        {status && (
          <Button
            onClick={() =>
              onSave({
                filing_status: status,
                walkthrough_answers: answers as Record<string, unknown>,
              })
            }
          >
            Save
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
```

**Apostrophe rule — easy to get backwards.** The project's ESLint rule (`react/no-unescaped-entities`) requires `&apos;` in **JSX text only**. In a JS string literal or a JSX attribute value, `&apos;` is not parsed as an entity and renders on screen as the literal characters. So `<p>You&apos;re on track</p>` is correct, but `label="No, I&apos;m not married"` and `const s = "You&apos;re..."` are both bugs. The code above follows this; keep it that way when editing.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- --run "src/app/(app)/taxes/filing-status-walkthrough.test.tsx"`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add "frontend/src/app/(app)/taxes/filing-status-walkthrough.tsx" "frontend/src/app/(app)/taxes/filing-status-walkthrough.test.tsx"
git commit -m "feat(tax): derive filing status from a plain-English walkthrough

Not a dropdown: a single filer who picks head of household gets a
standard deduction \$8,050 too large. The walkthrough asks plain
questions, derives the status, explains which answer produced it, and
stores the answers so next year can ask whether they still hold."
```

---

### Task 14: Taxes page

**Files:**
- Create: `frontend/src/app/(app)/taxes/page.tsx`, `projection-card.tsx`, `withholding-card.tsx`, `next-dollar-card.tsx`, `paystub-form.tsx`, `paystub-list.tsx`, `prior-year-form.tsx` + `.test.tsx` for the three cards
- Test: `projection-card.test.tsx`, `withholding-card.test.tsx`, `next-dollar-card.test.tsx`

**Interfaces:**
- Consumes: `taxApi` (Task 12), `FilingStatusWalkthrough` (Task 13)
- Produces: the `/taxes` route

Follow the existing page shell exactly — `PageHeader`, `QueryState`, `inlineErrorQueryMeta`, `SkeletonCard`, `toastApiError`, `appToast` — as `deductions/page.tsx` does.

**Degradation is the point.** When `available` is false the page renders what is missing and how to supply it; it never shows a number it cannot stand behind.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/app/(app)/taxes/projection-card.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProjectionCard } from "./projection-card";
import type { ProjectionEnvelope } from "@/lib/api/tax";

const projection = {
  agi: 179000, magi_for_pal: 179000, deduction_taken: 16100,
  deduction_kind: "standard" as const, standard_deduction: 16100,
  itemized_total: 0, taxable_income: 162900, federal_income_tax: 31694,
  social_security_tax: 11098, medicare_tax: 2595.5,
  additional_medicare_tax: 0, state_tax: 7167.6, total_liability: 52555.1,
  total_withheld_projected: 50000, refund_or_amount_due: -2555.1,
  effective_rate: 29.36, schedule_e_allowed_loss: 0,
  schedule_e_suspended_loss: 0,
  safe_harbor: {
    status: "unknown" as const, test_used: "none", required_payment: null,
    projected_payment: null, shortfall: null, per_period_to_close: null,
    reason: "Enter last year's total tax.",
  },
  explain: [
    { label: "Wages", amount: 179000, detail: "Year-to-date plus projected." },
    { label: "Taxable income", amount: 162900, detail: "Less your deduction." },
  ],
};

const available: ProjectionEnvelope = {
  year: 2026, available: true, missing: [], remaining_pay_periods: 3, projection,
};

describe("ProjectionCard", () => {
  it("says what is missing instead of showing a number it cannot stand behind", () => {
    render(
      <ProjectionCard
        envelope={{ year: 2026, available: false, missing: ["filing_status", "paystub"], remaining_pay_periods: 0, projection: null }}
      />
    );
    expect(screen.getByText(/how you file/i)).toBeInTheDocument();
    expect(screen.getByText(/a recent paystub/i)).toBeInTheDocument();
    expect(screen.queryByText(/\$0\.00/)).not.toBeInTheDocument();
  });

  it("shows an amount owed as owed, not as a negative refund", () => {
    render(<ProjectionCard envelope={available} />);
    expect(screen.getByText(/you're on track to owe/i)).toBeInTheDocument();
    expect(screen.getByText("$2,555.10")).toBeInTheDocument();
  });

  it("shows a refund when withholding exceeds the bill", () => {
    render(
      <ProjectionCard
        envelope={{
          ...available,
          projection: { ...projection, total_withheld_projected: 56000, refund_or_amount_due: 3444.9 },
        }}
      />
    );
    expect(screen.getByText(/back as a refund/i)).toBeInTheDocument();
  });

  it("explains a standard deduction in plain language", () => {
    render(<ProjectionCard envelope={available} />);
    expect(screen.getByText(/standard deduction/i)).toBeInTheDocument();
  });

  it("reveals the working when expanded", async () => {
    render(<ProjectionCard envelope={available} />);
    expect(screen.queryByText(/year-to-date plus projected/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /show the work/i }));
    expect(screen.getByText(/year-to-date plus projected/i)).toBeInTheDocument();
  });
});
```

```tsx
// frontend/src/app/(app)/taxes/withholding-card.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WithholdingCard } from "./withholding-card";

const base = {
  status: "unknown" as const, test_used: "none", required_payment: null,
  projected_payment: null, shortfall: null, per_period_to_close: null,
  reason: "Enter last year's total tax to check this.",
};

describe("WithholdingCard", () => {
  it("never claims you are safe when it does not know", () => {
    render(<WithholdingCard safeHarbor={base} remainingPeriods={3} />);
    expect(screen.getByText(/enter last year/i)).toBeInTheDocument();
    expect(screen.queryByText(/on track/i)).not.toBeInTheDocument();
  });

  it("gives a per-paycheck number when short", () => {
    render(
      <WithholdingCard
        safeHarbor={{
          ...base, status: "not_met", test_used: "90_percent_current",
          required_payment: 47299.59, projected_payment: 45000,
          shortfall: 2299.59, per_period_to_close: 766.53,
          reason: "You are $2299.59 short.",
        }}
        remainingPeriods={3}
      />
    );
    expect(screen.getByText("$766.53")).toBeInTheDocument();
  });

  it("confirms when the safe harbor is met", () => {
    render(
      <WithholdingCard
        safeHarbor={{ ...base, status: "met", test_used: "90_percent_current", shortfall: 0, per_period_to_close: 0, reason: "You are on track." }}
        remainingPeriods={3}
      />
    );
    expect(screen.getByText(/on track/i)).toBeInTheDocument();
  });
});
```

```tsx
// frontend/src/app/(app)/taxes/next-dollar-card.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextDollarCard } from "./next-dollar-card";

describe("NextDollarCard", () => {
  it("leads with dollars and labels the percentage by the amount it spans", () => {
    render(
      <NextDollarCard
        wages={{ kind: "extra_wages", change_amount: 1000, amount_of_tax: 360.5, blended_rate_percent: 36.05, note: "x" }}
        deferral={{ kind: "extra_pretax_401k", change_amount: 1000, amount_of_tax: -284, blended_rate_percent: -28.4, note: "y" }}
      />
    );
    expect(screen.getByText("$360.50")).toBeInTheDocument();
    expect(screen.getByText("$284.00")).toBeInTheDocument();
    expect(screen.getByText(/across this \$1,000/i)).toBeInTheDocument();
  });

  it("renders nothing rather than guessing when impact is unavailable", () => {
    const { container } = render(<NextDollarCard wages={null} deferral={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- --run "src/app/(app)/taxes/"`
Expected: FAIL — cannot resolve `./projection-card`

- [ ] **Step 3: Write minimal implementation**

```tsx
// frontend/src/app/(app)/taxes/projection-card.tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ProjectionEnvelope } from "@/lib/api/tax";
import { formatCurrency } from "@/lib/format";

const MISSING_LABELS: Record<string, string> = {
  filing_status: "How you file — answer the questions below.",
  paystub: "A recent paystub, including its year-to-date columns.",
  prior_year_return: "Last year's return (only needed for the withholding check).",
};

export function ProjectionCard({ envelope }: { envelope: ProjectionEnvelope }) {
  const [showWork, setShowWork] = useState(false);

  if (!envelope.available || !envelope.projection) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Your {envelope.year} taxes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-muted-foreground">
            Two things are needed before this can be worked out:
          </p>
          <ul className="list-disc pl-5">
            {envelope.missing
              .filter((m) => m !== "prior_year_return")
              .map((m) => (
                <li key={m}>{MISSING_LABELS[m] ?? m}</li>
              ))}
          </ul>
        </CardContent>
      </Card>
    );
  }

  const p = envelope.projection;
  const owed = p.refund_or_amount_due < 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your {envelope.year} taxes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-lg">
          {owed ? "You're on track to owe " : "You're on track to get "}
          <strong>{formatCurrency(Math.abs(p.refund_or_amount_due))}</strong>
          {owed ? " when you file." : " back as a refund."}
        </p>

        <table className="w-full">
          <tbody>
            <tr className="border-b">
              <td className="py-1">What you earn</td>
              <td className="py-1 text-right">{formatCurrency(p.agi)}</td>
            </tr>
            <tr className="border-b">
              <td className="py-1">
                {p.deduction_kind === "standard"
                  ? "Standard deduction (the flat amount everyone can subtract)"
                  : "Your itemized deductions"}
              </td>
              <td className="py-1 text-right">−{formatCurrency(p.deduction_taken)}</td>
            </tr>
            <tr className="border-b">
              <td className="py-1">Income you&apos;re taxed on</td>
              <td className="py-1 text-right">{formatCurrency(p.taxable_income)}</td>
            </tr>
            <tr className="border-b">
              <td className="py-1">Federal income tax</td>
              <td className="py-1 text-right">{formatCurrency(p.federal_income_tax)}</td>
            </tr>
            <tr className="border-b">
              <td className="py-1">Social Security and Medicare</td>
              <td className="py-1 text-right">
                {formatCurrency(p.social_security_tax + p.medicare_tax + p.additional_medicare_tax)}
              </td>
            </tr>
            <tr className="border-b">
              <td className="py-1">Colorado income tax</td>
              <td className="py-1 text-right">{formatCurrency(p.state_tax)}</td>
            </tr>
            <tr className="font-semibold">
              <td className="py-1">Total tax for the year</td>
              <td className="py-1 text-right">{formatCurrency(p.total_liability)}</td>
            </tr>
            <tr>
              <td className="py-1">Held back from your paychecks</td>
              <td className="py-1 text-right">{formatCurrency(p.total_withheld_projected)}</td>
            </tr>
          </tbody>
        </table>

        <Button variant="ghost" size="sm" onClick={() => setShowWork((v) => !v)}>
          {showWork ? "Hide the work" : "Show the work"}
        </Button>

        {showWork && (
          <ol className="space-y-2 border-t pt-3">
            {p.explain.map((step, i) => (
              <li key={`${step.label}-${i}`}>
                <div className="flex justify-between">
                  <span className="font-medium">{step.label}</span>
                  <span>{formatCurrency(step.amount)}</span>
                </div>
                <p className="text-xs text-muted-foreground">{step.detail}</p>
              </li>
            ))}
          </ol>
        )}

        <p className="text-xs text-muted-foreground">
          This is an estimate from published rates and the figures you entered.
          It is not tax advice or a filing tool.
        </p>
      </CardContent>
    </Card>
  );
}
```

```tsx
// frontend/src/app/(app)/taxes/withholding-card.tsx
"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SafeHarbor } from "@/lib/api/tax";
import { formatCurrency } from "@/lib/format";

export function WithholdingCard({
  safeHarbor, remainingPeriods,
}: { safeHarbor: SafeHarbor; remainingPeriods: number }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Is enough being held back?</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {safeHarbor.status === "unknown" && (
          <p className="text-muted-foreground">{safeHarbor.reason}</p>
        )}

        {safeHarbor.status === "met" && (
          <p>You&apos;re on track. No underpayment penalty is expected.</p>
        )}

        {safeHarbor.status === "not_met" && (
          <>
            <p>
              You&apos;re short by {formatCurrency(safeHarbor.shortfall ?? 0)} for
              the year.
            </p>
            {safeHarbor.per_period_to_close !== null ? (
              <p>
                Holding back{" "}
                <strong>{formatCurrency(safeHarbor.per_period_to_close)}</strong>{" "}
                more per paycheck for the remaining {remainingPeriods} would close it.
              </p>
            ) : (
              <p>There are no pay periods left this year to close the gap.</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
```

```tsx
// frontend/src/app/(app)/taxes/next-dollar-card.tsx
"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ImpactResult } from "@/lib/api/tax";
import { formatCurrency } from "@/lib/format";

/**
 * Leads with DOLLARS. Any percentage is labeled with the amount it is
 * blended over, because a rate from an arbitrary step is step-dependent
 * near a bracket edge.
 */
export function NextDollarCard({
  wages, deferral,
}: { wages: ImpactResult | null; deferral: ImpactResult | null }) {
  if (!wages && !deferral) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>What the next $1,000 does</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {wages && (
          <p>
            Earning $1,000 more costs you{" "}
            <strong>{formatCurrency(wages.amount_of_tax)}</strong> in tax — about{" "}
            {wages.blended_rate_percent.toFixed(1)}% across this $1,000.
          </p>
        )}
        {deferral && (
          <p>
            Putting $1,000 into your 401(k) saves you{" "}
            <strong>{formatCurrency(Math.abs(deferral.amount_of_tax))}</strong> —
            about {Math.abs(deferral.blended_rate_percent).toFixed(1)}% across this
            $1,000. It&apos;s less than the rate above because money set aside for
            retirement still has Social Security and Medicare taken out.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
```

`paystub-form.tsx`, `paystub-list.tsx`, and `prior-year-form.tsx` are straightforward controlled forms over `PaystubInput` and `PriorYearReturn`. Requirements: every money input is `type="number"` with `step="0.01"` and `min="0"`; the year-to-date fields are visually grouped and labeled "Year-to-date (from the right-hand column of your paystub)" since those are what the engine anchors on; each field has an associated `<label htmlFor>`; the list shows pay date, gross, and year-to-date gross with a delete button per row.

`page.tsx` follows `deductions/page.tsx`: `useQuery` for `taxApi.projection(year)`, `taxApi.profile()`, `taxApi.paystubs()`, and `taxApi.priorYear(year - 1)`; `useMutation` for save/add/delete each invalidating `["tax-projection", year]`; render `PageHeader` → `QueryState` → `ProjectionCard` → `WithholdingCard` (only when the projection is available) → `NextDollarCard` → `FilingStatusWalkthrough` → paystub list/form → prior-year form.

Fetch the two impact figures with a single `useQuery` keyed `["tax-impact", year]` that resolves both calls via `Promise.all`, and pass `null` for both when the projection is unavailable.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- --run "src/app/(app)/taxes/" && npm run lint`
Expected: PASS (11 tests) and lint clean

- [ ] **Step 5: Commit**

```bash
git add "frontend/src/app/(app)/taxes/"
git commit -m "feat(tax): add the Taxes page

Leads with what you owe or get back, in plain language. Shows its work
on request, says what is missing rather than projecting from nothing,
and reports the next-dollar figures in dollars with any percentage
labeled by the amount it spans."
```

---

### Task 15: Update the Deductions page for a correct zero

**Files:**
- Modify: `frontend/src/app/(app)/deductions/deductions-summary-table.tsx` and its test
- Modify: `frontend/src/app/(app)/deductions/page.tsx`
- Delete: `frontend/src/app/(app)/deductions/tax-settings-card.tsx` and its test, and `frontend/src/lib/api/tax-settings.ts` and its test

**Interfaces:**
- Consumes: the extended `DeductionsSummary` (Task 12)
- Produces: no new exports; the page loses its settings card and links to `/taxes`

**Why this task is not optional.** After Task 11, `estimated_tax_savings` legitimately returns `0.00` for personal deductions below the standard deduction — where the old code showed a number. Without a copy change, a correct zero reads as a bug. The page must **explain** the zero.

The `TaxSettingsCard` is deleted: the rates it collected no longer exist. Its replacement is the walkthrough and paystub entry on `/taxes`.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/app/(app)/deductions/deductions-summary-table.test.tsx  (rewrite)
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DeductionsSummaryTable } from "./deductions-summary-table";
import type { DeductionsSummary } from "@/lib/api/deductions";

const base: DeductionsSummary = {
  year: 2026,
  lines: [],
  total: 0,
  estimated_tax_savings: null,
  suggested_withholding_reduction_per_period: null,
  business_total: 0,
  personal_itemized_total: 0,
  personal_itemized_value: null,
  standard_deduction: null,
};

describe("DeductionsSummaryTable", () => {
  it("prompts for setup when no projection is available", () => {
    render(<DeductionsSummaryTable summary={{
      ...base,
      lines: [{ tax_line: "Schedule A — Medical", amount: 5000, deduction_kind: "personal_itemized" }],
      total: 5000, personal_itemized_total: 5000,
    }} />);
    expect(screen.getByText(/set up your taxes/i)).toBeInTheDocument();
  });

  it("explains a zero saving instead of just showing $0.00", () => {
    render(<DeductionsSummaryTable summary={{
      ...base,
      lines: [{ tax_line: "Schedule A — Medical", amount: 5000, deduction_kind: "personal_itemized" }],
      total: 5000,
      estimated_tax_savings: 0,
      personal_itemized_total: 5000,
      personal_itemized_value: 0,
      standard_deduction: 16100,
    }} />);
    expect(screen.getByText(/below your \$16,100 standard deduction/i)).toBeInTheDocument();
    expect(screen.getByText(/worth nothing/i)).toBeInTheDocument();
  });

  it("shows business expenses as worth money from the first dollar", () => {
    render(<DeductionsSummaryTable summary={{
      ...base,
      lines: [{ tax_line: "Schedule E — Cleaning", amount: 5000, deduction_kind: "business_expense" }],
      total: 5000,
      estimated_tax_savings: 1420,
      business_total: 5000,
      personal_itemized_value: 0,
      standard_deduction: 16100,
    }} />);
    expect(screen.getByText("$1,420.00")).toBeInTheDocument();
    expect(screen.queryByText(/worth nothing/i)).not.toBeInTheDocument();
  });

  it("separates the two kinds of deduction", () => {
    render(<DeductionsSummaryTable summary={{
      ...base,
      lines: [
        { tax_line: "Schedule E — Cleaning", amount: 3000, deduction_kind: "business_expense" },
        { tax_line: "Schedule A — Medical", amount: 2000, deduction_kind: "personal_itemized" },
      ],
      total: 5000, business_total: 3000, personal_itemized_total: 2000,
      estimated_tax_savings: 852, personal_itemized_value: 0, standard_deduction: 16100,
    }} />);
    expect(screen.getByText(/business expenses/i)).toBeInTheDocument();
    expect(screen.getByText(/personal deductions/i)).toBeInTheDocument();
  });

  it("keeps the empty state", () => {
    render(<DeductionsSummaryTable summary={base} />);
    expect(screen.getByText(/no deductible categories yet/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- --run "src/app/(app)/deductions/deductions-summary-table.test.tsx"`
Expected: FAIL — the zero-explanation and grouping text do not exist

- [ ] **Step 3: Write minimal implementation**

Replace the savings block in `deductions-summary-table.tsx` (keep the empty state and the line table, grouping lines by `deduction_kind`):

```tsx
        {summary.estimated_tax_savings === null ? (
          <p className="text-sm text-muted-foreground">
            Set up your taxes to see what these deductions are actually worth.
          </p>
        ) : (
          <div className="space-y-2 text-sm">
            <p>
              These deductions save you{" "}
              <strong>{formatCurrency(summary.estimated_tax_savings)}</strong> in
              tax this year.
            </p>

            {summary.personal_itemized_total > 0 &&
              summary.personal_itemized_value === 0 &&
              summary.standard_deduction !== null && (
                <p className="text-muted-foreground">
                  Your personal deductions of{" "}
                  {formatCurrency(summary.personal_itemized_total)} are below your{" "}
                  {formatCurrency(summary.standard_deduction)} standard deduction,
                  so they&apos;re worth nothing this year. Personal deductions only
                  start saving you money once they add up to more than that
                  amount. Your business expenses are different — they count from
                  the first dollar.
                </p>
              )}

            {summary.suggested_withholding_reduction_per_period !== null && (
              <p>
                You&apos;re on track for a refund, which means more is being held
                back than needed. Reducing it by about{" "}
                {formatCurrency(summary.suggested_withholding_reduction_per_period)}{" "}
                per paycheck would even it out.
              </p>
            )}

            <p className="text-xs text-muted-foreground">
              An estimate from published rates and the figures you entered, not
              tax advice.
            </p>
          </div>
        )}
```

Group the line table under two headings driven by `deduction_kind`:

```tsx
{(["business_expense", "personal_itemized"] as const).map((kind) => {
  const lines = summary.lines.filter((l) => l.deduction_kind === kind);
  if (lines.length === 0) return null;
  return (
    <div key={kind}>
      <h3 className="text-sm font-medium">
        {kind === "business_expense" ? "Business expenses" : "Personal deductions"}
      </h3>
      <table className="w-full text-sm">
        <tbody>
          {lines.map((line) => (
            <tr key={line.tax_line} className="border-b">
              <td className="py-2">{line.tax_line}</td>
              <td className="py-2 text-right">{formatCurrency(line.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
})}
```

In `deductions/page.tsx`: drop the `taxSettingsApi` query, the `saveSettings` mutation, and the `TaxSettingsCard` render; remove both imports. Add a link to `/taxes` in the page description. Then delete `tax-settings-card.tsx`, `tax-settings-card.test.tsx`, and — now that its last importer is gone — `frontend/src/lib/api/tax-settings.ts` and `frontend/src/lib/api/tax-settings.test.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run lint && npm test -- --run && npm run build`
Expected: all three pass — the **full** frontend suite

- [ ] **Step 5: Commit**

```bash
git add "frontend/src/app/(app)/deductions/"
git rm "frontend/src/app/(app)/deductions/tax-settings-card.tsx" "frontend/src/app/(app)/deductions/tax-settings-card.test.tsx" frontend/src/lib/api/tax-settings.ts frontend/src/lib/api/tax-settings.test.ts
git commit -m "feat(tax): explain a zero saving on the Deductions page

After the engine change a personal deduction below the standard
deduction correctly saves \$0 where the old flat-rate code showed a
number. Without this copy, a correct zero reads as a bug. Lines are now
grouped by kind, and the settings card is gone -- the rates it collected
no longer exist."
```

---

### Task 16: Back-test against filed returns

**Files:**
- Create: `backend/tests/backtest/test_filed_returns.py`, `backend/tests/backtest/README.md`
- Modify: `.gitignore`
- Test: `backend/tests/backtest/test_filed_returns.py`

**Interfaces:**
- Consumes: `project()`, `TaxInputs` (Tasks 2, 3)
- Produces: nothing importable; an acceptance gate

**Plan defect found during implementation (corrected in the code).** The
snippets below compare `projection.total_liability` against **Form 1040
line 24**. That is wrong: `total_liability` is federal income tax + FICA +
state tax, and line 24 is federal only — on a six-figure Colorado return
the comparison is off by roughly $20k, which reads as an engine defect and
would send the next reader hunting through `engine.py`. FICA never appears
on line 24 at all, and line 24 also carries credits and additional taxes
the engine does not model.

The implemented back-test instead checks each expected figure against the
one engine output that means the same thing:

| Fixture field | Engine output | Source |
|---|---|---|
| `actual_taxable_income` | `taxable_income` | Form 1040 line 15 |
| `actual_federal_income_tax` | `federal_income_tax` | Form 1040 line 16 |
| `actual_state_tax` | `state_tax` | Colorado DR 0104 net tax |
| `actual_ss_tax` | `social_security_tax` | W-2 box 4 |
| `actual_medicare_tax` | `medicare_tax` + `additional_medicare_tax` | W-2 box 6 |

A record supplying none of them fails rather than passing on nothing, and
`tests/backtest/test_harness_selfcheck.py` proves the gate can fail —
using figures hand-computed from the 2026 tables, so it runs in CI where
`returns.local.json` never exists. The README's `wages` mapping is also
corrected: the engine wants **gross** wages, so W-2 box 1 *plus* the
deferrals, not Form 1040 line 1z.

**The strongest validation available.** Unit tests prove the engine matches published examples. The back-test proves it reproduces *real filed returns* — the actual situation, including Schedule E and Colorado.

**Privacy:** the input file is gitignored and never committed. The test **skips** when it is absent, so CI and other machines stay green.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/backtest/test_filed_returns.py
"""Back-test: reproduce real filed returns.

Reads backend/tests/backtest/returns.local.json, which is GITIGNORED and
must never be committed -- it describes a real person's finances. The
test SKIPS when the file is absent, so CI and other machines stay green.

See README.md in this directory for the file format.
"""
from __future__ import annotations

import json
from decimal import Decimal
from pathlib import Path

import pytest

from app.services.tax.engine import project
from app.services.tax.inputs import ScheduleEResult, TaxInputs, WithholdingBuckets
from app.services.tax.rates.registry import (
    FilingStatus,
    UnknownTaxYearError,
    get_rates,
)

FIXTURE = Path(__file__).parent / "returns.local.json"
TOLERANCE = Decimal("25.00")   # dollars off Form 1040 line 24


def _load() -> list[dict]:
    if not FIXTURE.exists():
        pytest.skip(
            "No returns.local.json. Copy the shape from README.md to run the "
            "back-test locally; it is gitignored by design."
        )
    return json.loads(FIXTURE.read_text())["returns"]


def _dec(value) -> Decimal:
    return Decimal(str(value))


def _inputs_from(record: dict) -> TaxInputs:
    schedule_e = None
    if record.get("schedule_e"):
        se = record["schedule_e"]
        schedule_e = ScheduleEResult(
            gross_rental_income=_dec(se["gross_rental_income"]),
            allowable_expenses=_dec(se["allowable_expenses"]),
            net=_dec(se["net"]),
            active_participation=se.get("active_participation", True),
            suspended_loss_carryin=_dec(se.get("suspended_loss_carryin", 0)),
        )
    return TaxInputs(
        filing_status=FilingStatus(record["filing_status"]),
        wages_ytd=_dec(record["wages"]),
        projected_remaining_wages=Decimal("0"),
        pretax_401k=_dec(record.get("pretax_401k", 0)),
        pretax_hsa=_dec(record.get("pretax_hsa", 0)),
        pretax_other=_dec(record.get("pretax_other", 0)),
        federal_withheld_ytd=_dec(record.get("federal_withheld", 0)),
        state_withheld_ytd=_dec(record.get("state_withheld", 0)),
        ss_withheld_ytd=_dec(record.get("ss_withheld", 0)),
        medicare_withheld_ytd=_dec(record.get("medicare_withheld", 0)),
        projected_remaining_withholding=WithholdingBuckets.zero(),
        itemized_deductions=_dec(record.get("itemized_deductions", 0)),
        schedule_e=schedule_e,
        prior_year_total_tax=None,
        prior_year_agi=None,
    )


def test_engine_reproduces_each_filed_return():
    records = _load()
    assert records, "returns.local.json contains no returns"

    failures = []
    for record in records:
        year = record["year"]
        try:
            rates = get_rates(year)
        except UnknownTaxYearError:
            failures.append(f"{year}: no rate table for this year")
            continue

        projection = project(_inputs_from(record), rates)

        expected_total = _dec(record["actual_total_tax"])
        delta = projection.total_liability - expected_total
        if abs(delta) > TOLERANCE:
            failures.append(
                f"{year}: total tax off by ${delta} "
                f"(engine ${projection.total_liability}, filed ${expected_total})"
            )

        if "actual_taxable_income" in record:
            expected_taxable = _dec(record["actual_taxable_income"])
            taxable_delta = projection.taxable_income - expected_taxable
            if abs(taxable_delta) > TOLERANCE:
                failures.append(
                    f"{year}: taxable income off by ${taxable_delta} "
                    f"(engine ${projection.taxable_income}, filed ${expected_taxable})"
                )

    assert not failures, "Back-test failures:\n  " + "\n  ".join(failures)
```

```markdown
<!-- backend/tests/backtest/README.md -->
# Back-test inputs

`returns.local.json` holds figures from real filed returns and is
**gitignored**. Never commit it. It carries no SSN, employer, or address
— only the numbers the engine consumes.

The back-test skips when the file is absent, so CI stays green.

## Where each field comes from

| Field | Source |
|-------|--------|
| `filing_status` | Form 1040, the checked box at the top |
| `wages` | Form 1040 line 1z (or W-2 box 1 plus pre-tax deferrals) |
| `pretax_401k` | W-2 box 12, code D |
| `pretax_hsa` | W-2 box 12, code W |
| `federal_withheld` | W-2 box 2 |
| `state_withheld` | W-2 box 17 |
| `ss_withheld` | W-2 box 4 |
| `medicare_withheld` | W-2 box 6 |
| `itemized_deductions` | Schedule A total, if you itemized |
| `schedule_e.*` | Schedule E page 1 |
| `actual_total_tax` | **Form 1040 line 24** — the number to reproduce |
| `actual_taxable_income` | Form 1040 line 15 |

## Format

```json
{
  "returns": [
    {
      "year": 2026,
      "filing_status": "single",
      "wages": "179000.00",
      "pretax_401k": "0.00",
      "pretax_hsa": "0.00",
      "federal_withheld": "31000.00",
      "state_withheld": "7000.00",
      "ss_withheld": "11098.00",
      "medicare_withheld": "2595.50",
      "itemized_deductions": "0.00",
      "schedule_e": {
        "gross_rental_income": "30000.00",
        "allowable_expenses": "22000.00",
        "net": "8000.00",
        "active_participation": true,
        "suspended_loss_carryin": "0.00"
      },
      "actual_total_tax": "52555.10",
      "actual_taxable_income": "162900.00"
    }
  ]
}
```

A year with no rate table fails rather than skipping — add that year's
sourced rate module before back-testing against it.
```

Add to `.gitignore`:

```
# Back-test inputs: real filed-return figures, never committed
backend/tests/backtest/returns.local.json
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/backtest/ -v`
Expected: FAIL — `ModuleNotFoundError` for the test module before it exists; after creating it with no fixture present, SKIPPED

- [ ] **Step 3: Write minimal implementation**

The test above *is* the implementation. Create `backend/tests/backtest/__init__.py` if `backend/tests/` uses package init files.

Confirm the gitignore entry works:

```bash
cd ~/Code/budget-app && echo '{"returns":[]}' > backend/tests/backtest/returns.local.json
git status --porcelain backend/tests/backtest/   # must NOT list returns.local.json
rm backend/tests/backtest/returns.local.json
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/backtest/ -v`
Expected: SKIPPED with the "No returns.local.json" message

Then, locally only, create the real file from the README shape and run it again. **Phase 1 is not accepted until this passes against the last two filed returns.** If it fails, the discrepancy is information — read it before changing the engine, and check the rate table and the input mapping first.

- [ ] **Step 5: Commit**

```bash
git add backend/tests/backtest/ .gitignore
git commit -m "test(tax): back-test the engine against real filed returns

The strongest validation available: unit tests prove the engine matches
published examples, this proves it reproduces actual returns including
Schedule E and Colorado. Inputs are gitignored and the test skips when
absent, so CI stays green."
```

---

## Final verification

After Task 16, run the full gate from `CLAUDE.md` before opening a PR:

```bash
cd backend && pytest -q
cd ../frontend && npm run lint && npm test -- --run && npm run build
```

Also confirm the migration round-trips on a copy of the real database:

```bash
cd backend && alembic upgrade head && alembic downgrade -1 && alembic upgrade head
```

## Acceptance

Phase 1 is done when:

1. The engine reproduces the last two filed returns within tolerance (Task 16) — run locally with a real `returns.local.json`; the committed gate only proves the harness works.
2. `/taxes` shows a projection anchored on real paystub YTD figures.
3. The deductions summary reports **$0** for personal deductions below the standard deduction, and the page explains why.
4. Every figure on the Taxes page expands to the rule that produced it.
5. An unsupported year or filing status raises rather than approximating.
