# Anomaly Detection + Explanation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic "unusual transaction" detection in the backend and a per-transaction on-device "Explain why flagged" action that streams a short explanation.

**Architecture:** Detection is **100% deterministic backend code** (a new `compute_anomaly_facts` service + `/api/ai/facts/anomalies` endpoint) so no number ever originates from the model. The frontend renders the deterministic facts and uses the light **streaming-text** path (`useAiPipelineRun.runStream`) for the explanation only. The LLM narrates an already-flagged row; it cannot create or rank anomalies.

**Tech Stack:** FastAPI / SQLAlchemy async / Pydantic / pytest (backend); Next.js 16 / React / TypeScript / Vitest (frontend). Reuses the aggregation style of `app/services/ai/budget.py:compute_spending_patterns`.

**Spec:** [2026-06-29-deferred-ai-features-design.md](../specs/2026-06-29-deferred-ai-features-design.md) § WS4b.

**Prerequisite:** Plan 1 (`finish-ai-reliability-branch`) committed (shared `useAiPipelineRun`/`AiRunStatus`), and Plan 2 Task 6 (the `runStream` demo short-circuit + `demoStreamText` helper), which this plan reuses for `anomaly_explanation`.

## Global Constraints

- Detection threshold and floors are **server-side constants**, never client-supplied: `N = 3.0` (ratio), `MIN_HISTORY_COUNT = 3` (transactions in baseline), `MIN_AMOUNT = 25.00` (absolute floor).
- Only **expense** transactions (`Transaction.amount < 0`) on budget accounts; exclude transfers and uncategorized rows. Guard against divide-by-zero (skip categories whose baseline mean is 0).
- Endpoint reuses the existing AI auth gate `_require_ai_enabled` and the `/api/ai/` IP rate-limit middleware. Enforce household ownership (the gate already scopes to `household_id`).
- LLM output is untrusted: the model receives one flagged row's deterministic facts and returns prose only; the UI renders the authoritative numbers itself.
- Demo mode returns a canned explanation (no model). `anomaly_explanation` streams, so reuse the `runStream` demo short-circuit + `demoStreamText` helper added in Plan 2 (do **not** rely on `demoStructuredResult` for it).
- **Backend tests** live in `backend/tests/test_facts_endpoints.py`; reuse its `_seed_budget_fixture(...)`-style seeding helpers, the `client` fixture, `headers` auth, and `Household(..., ai_enabled=...)`. Do **not** invent `db`/`auth`/`household` fixtures.
- Commit only when the human asks.

---

## File structure

| File | Action | Responsibility |
|------|--------|----------------|
| `backend/app/schemas/facts.py` | Modify | `AnomalyFact`, `AnomalyFacts` Pydantic models |
| `backend/app/services/ai/anomaly.py` | **Create** | `compute_anomaly_facts(db, household_id)` deterministic detection |
| `backend/tests/.../test_anomaly_facts.py` | **Create** | Detection unit + boundary tests (place beside existing fact tests) |
| `backend/app/api/routes/facts.py` | Modify | `GET /anomalies` endpoint |
| `backend/tests/.../test_facts_routes.py` | Modify/Create | Endpoint auth + shape test |
| `frontend/src/lib/api/ai.ts` (or facts client) | Modify | `getAnomalies()` client + `AnomalyFact` type |
| `frontend/src/app/(app)/transactions/page.tsx` | Modify | Flag badge + `AnomalyExplain` action per flagged row |
| `frontend/src/lib/llm/features.ts` | Modify | `anomaly_explanation.enabled = true` |
| `frontend/src/lib/llm/features.test.ts` | Modify | Drop anomaly from the disabled set |
| `frontend/src/lib/llm/contracts.ts` | Modify | Demo explanation |

---

### Task 1: `AnomalyFacts` schema

**Files:**
- Modify: `backend/app/schemas/facts.py`

**Interfaces:**
- Produces: `AnomalyFacts(anomalies: list[AnomalyFact])` with `AnomalyFact(transaction_id, category, amount, category_avg, ratio, date, payee)`.

- [ ] **Step 1: Add the models**

Append to `facts.py`:

```python
class AnomalyFact(BaseModel):
    transaction_id: str
    category: str
    amount: float          # signed, as stored (negative for expense)
    category_avg: float    # mean absolute expense in this category, trailing 3 mo
    ratio: float           # abs(amount) / category_avg
    date: str              # ISO date
    payee: str | None


class AnomalyFacts(BaseModel):
    anomalies: list[AnomalyFact]
```

- [ ] **Step 2: Import check + stage**

Run: `cd backend && python -c "from app.schemas.facts import AnomalyFacts"`
Expected: no error.

```bash
git add backend/app/schemas/facts.py
```

---

### Task 2: `compute_anomaly_facts` detection service

**Files:**
- Create: `backend/app/services/ai/anomaly.py`
- Create: `backend/tests/.../test_anomaly_facts.py` (mirror the dir of existing budget/facts tests — grep `compute_spending_patterns` under `backend/tests`)

**Interfaces:**
- Produces: `async compute_anomaly_facts(db: AsyncSession, household_id: str) -> dict[str, object]` shaped for `AnomalyFacts`.

- [ ] **Step 1: Write the failing test**

```python
import pytest
from app.services.ai.anomaly import compute_anomaly_facts

@pytest.mark.asyncio
async def test_flags_transaction_above_ratio(db, household, seed_category_history):
    # seed_category_history: a "Groceries" category with 3+ prior expenses
    # averaging ~$80, then a current-month $300 expense (ratio 3.75x ≥ N=3)
    result = await compute_anomaly_facts(db, household.id)
    ids = [a["transaction_id"] for a in result["anomalies"]]
    assert seed_category_history["big_txn_id"] in ids

@pytest.mark.asyncio
async def test_does_not_flag_just_below_threshold(db, household, seed_near_threshold):
    # current expense at 2.9x the baseline mean → not flagged
    result = await compute_anomaly_facts(db, household.id)
    assert result["anomalies"] == []

@pytest.mark.asyncio
async def test_skips_categories_without_history(db, household, seed_no_history):
    # brand-new category, single big expense, < MIN_HISTORY_COUNT baseline txns
    result = await compute_anomaly_facts(db, household.id)
    assert result["anomalies"] == []
```

(Reuse the test fixtures/factories the existing fact tests use for households, accounts, categories, and transactions; if none expose seeding helpers, add small local factory functions in the test file.)

- [ ] **Step 2: Run — expect FAIL**

Run: `cd backend && pytest tests -k anomaly -v`
Expected: FAIL — module `app.services.ai.anomaly` does not exist.

- [ ] **Step 3: Implement detection**

Create `backend/app/services/ai/anomaly.py` (mirrors `budget.py:compute_spending_patterns` aggregation):

```python
from __future__ import annotations

"""Deterministic 'unusual transaction' detection (model-free).

Flags current-month expense transactions whose absolute amount is at least
``N`` times the trailing-3-month mean expense for the same category. All
thresholds are server constants; no LLM output is involved.
"""

from datetime import date
from decimal import Decimal

from sqlalchemy import extract, func, select

from app.models.account import Account
from app.models.category import Category
from app.models.transaction import Transaction

ANOMALY_RATIO = 3.0
MIN_HISTORY_COUNT = 3
MIN_AMOUNT = Decimal("25")


async def compute_anomaly_facts(db, household_id: str) -> dict[str, object]:
    today = date.today()

    # Trailing 3 full months (exclude current) for the baseline.
    baseline_keys: list[tuple[int, int]] = []
    for i in range(3, 0, -1):
        total = today.month - 1 - i
        year = today.year + total // 12
        month = total % 12 + 1
        baseline_keys.append((year, month))

    budget_account_subq = (
        select(Account.id)
        .where(Account.household_id == household_id)
        .where(Account.is_budget_account.is_(True))
        .where(Account.closed_at.is_(None))
        .scalar_subquery()
    )

    # Baseline: mean absolute expense + count per category over the 3 months.
    baseline_rows = await db.execute(
        select(
            Category.name,
            func.avg(func.abs(Transaction.amount)),
            func.count(Transaction.id),
        )
        .join(Transaction, Transaction.category_id == Category.id)
        .where(
            Transaction.account_id.in_(budget_account_subq),
            Transaction.amount < 0,
            Transaction.category_id.isnot(None),
            func.row(extract("year", Transaction.date), extract("month", Transaction.date)).in_(
                [func.row(y, m) for (y, m) in baseline_keys]
            ),
        )
        .group_by(Category.name)
    )
    baseline: dict[str, tuple[float, int]] = {
        name: (float(avg or 0), int(cnt)) for name, avg, cnt in baseline_rows.all()
    }

    # Candidates: current-month expenses.
    candidate_rows = await db.execute(
        select(Transaction, Category.name)
        .join(Category, Transaction.category_id == Category.id)
        .where(
            Transaction.account_id.in_(budget_account_subq),
            Transaction.amount < 0,
            Transaction.category_id.isnot(None),
            extract("year", Transaction.date) == today.year,
            extract("month", Transaction.date) == today.month,
        )
    )

    anomalies: list[dict[str, object]] = []
    for txn, cat_name in candidate_rows.all():
        mean, count = baseline.get(cat_name, (0.0, 0))
        if count < MIN_HISTORY_COUNT or mean <= 0:
            continue
        amount = abs(Decimal(str(txn.amount)))
        if amount < MIN_AMOUNT:
            continue
        ratio = float(amount) / mean
        if ratio < ANOMALY_RATIO:
            continue
        anomalies.append(
            {
                "transaction_id": str(txn.id),
                "category": cat_name,
                "amount": float(txn.amount),
                "category_avg": round(mean, 2),
                "ratio": round(ratio, 2),
                "date": txn.date.isoformat(),
                "payee": getattr(txn, "payee", None) and str(txn.payee),
            }
        )

    anomalies.sort(key=lambda a: a["ratio"], reverse=True)
    return {"anomalies": anomalies[:20]}
```

> **Implementation note:** prefer the proven per-month loop style from `compute_spending_patterns` (iterate `baseline_keys`, aggregate per month, then average) over the `func.row(...).in_([...])` tuple-match shown above — the latter is illustrative and may not be portable across the dev (SQLite) and prod databases. Keep the same thresholds and output shape either way.

- [ ] **Step 4: Run — expect PASS**

Run: `cd backend && pytest tests -k anomaly -v`
Expected: PASS.

- [ ] **Step 5: Stage**

```bash
git add backend/app/services/ai/anomaly.py backend/tests
```

---

### Task 3: `/api/ai/facts/anomalies` endpoint

**Files:**
- Modify: `backend/app/api/routes/facts.py`
- Modify/Create: backend facts-route test

**Interfaces:**
- Consumes: `compute_anomaly_facts`, `AnomalyFacts`, `_require_ai_enabled`.
- Produces: `GET /api/ai/facts/anomalies → AnomalyFacts`.

- [ ] **Step 1: Write the failing endpoint test**

Mirror an existing facts-route test (e.g. the budget/goal facts route test):

```python
@pytest.mark.asyncio
async def test_anomalies_requires_ai_enabled(client, household_no_ai):
    resp = await client.get("/api/ai/facts/anomalies", headers=auth(household_no_ai))
    assert resp.status_code in (403, 409)  # whatever _require_ai_enabled returns

@pytest.mark.asyncio
async def test_anomalies_returns_shape(client, household_ai_on):
    resp = await client.get("/api/ai/facts/anomalies", headers=auth(household_ai_on))
    assert resp.status_code == 200
    assert "anomalies" in resp.json()
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd backend && pytest tests -k anomalies -v`
Expected: FAIL — 404 (route missing).

- [ ] **Step 3: Add the route**

In `facts.py`, import and add (mirroring `goal_facts`):

```python
from app.schemas.facts import AnomalyFacts  # add to the existing facts import
from app.services.ai.anomaly import compute_anomaly_facts


@router.get("/anomalies", response_model=AnomalyFacts)
async def anomaly_facts(
    household_id: str = Depends(_require_ai_enabled),
    db: AsyncSession = Depends(get_db),
) -> AnomalyFacts:
    """Deterministically flagged unusual expense transactions (model-free)."""
    return AnomalyFacts(**await compute_anomaly_facts(db, household_id))
```

- [ ] **Step 4: Run — expect PASS**

Run: `cd backend && pytest tests -k anomalies -v`
Expected: PASS.

- [ ] **Step 5: Stage**

```bash
git add backend/app/api/routes/facts.py backend/tests
```

---

### Task 4: Frontend anomalies client + types

**Files:**
- Modify: `frontend/src/lib/api/ai.ts` (or wherever `getSpendingPatterns` lives — grep it)

**Interfaces:**
- Produces: `aiApi.getAnomalies(): Promise<{ anomalies: AnomalyFact[] }>` and an exported `AnomalyFact` type matching the backend schema.

- [ ] **Step 1: Add the type + client**

```ts
export interface AnomalyFact {
  transaction_id: string;
  category: string;
  amount: number;
  category_avg: number;
  ratio: number;
  date: string;
  payee: string | null;
}

// inside the existing aiApi object:
getAnomalies: () =>
  api.get<{ anomalies: AnomalyFact[] }>("/ai/facts/anomalies").then((r) => r.data),
```

(Match the existing client's axios/get style — copy the shape of `getSpendingPatterns`.)

- [ ] **Step 2: Typecheck + stage**

```bash
cd frontend && npm run typecheck
git add src/lib/api/ai.ts
```

---

### Task 5: "Explain why flagged" on transaction rows

**Files:**
- Modify: `frontend/src/app/(app)/transactions/page.tsx`

**Interfaces:**
- Consumes: `aiApi.getAnomalies`, `useAiPipelineRun("anomaly_explanation").runStream`, `AiRunStatus`, `MaybeAiErrorWithSettings`.

- [ ] **Step 1: Load anomalies + build a lookup**

In the transactions page, add a query and a map keyed by transaction id:

```tsx
const { data: anomalyData } = useQuery({
  queryKey: ["anomalies"],
  queryFn: aiApi.getAnomalies,
});
const anomalies = useMemo(
  () => new Map((anomalyData?.anomalies ?? []).map((a) => [a.transaction_id, a])),
  [anomalyData],
);
```

- [ ] **Step 2: Add an `AnomalyExplain` subcomponent**

```tsx
function AnomalyExplain({ fact }: { fact: AnomalyFact }) {
  const ai = useAiPipelineRun("anomaly_explanation");
  const [text, setText] = useState("");

  const explain = async () => {
    setText("");
    ai.clearError();
    try {
      await ai.runStream(
        `Explain in one sentence why this expense is unusual. Use only these facts; do not invent numbers.\n` +
          `Facts: ${JSON.stringify(fact)}`,
        (chunk) => setText((s) => s + chunk),
        { maxTokens: 120 },
      );
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
    }
  };

  return (
    <div className="mt-1">
      <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => void explain()} disabled={ai.running}>
        <Sparkles className={cn("mr-1 h-3 w-3", ai.running && "animate-pulse")} /> Explain why flagged
      </Button>
      {ai.running ? <AiRunStatus progress={ai.progress} onCancel={ai.cancel} /> : null}
      {ai.error ? <MaybeAiErrorWithSettings message={ai.error} /> : null}
      {text ? <p className="text-xs text-amber-700 dark:text-amber-300">{text}</p> : null}
    </div>
  );
}
```

- [ ] **Step 3: Render a badge + the action on flagged rows**

Where each transaction row renders (grep the row/list render in `transactions/page.tsx`), for `anomalies.get(txn.id)`:

```tsx
{anomalies.get(txn.id) ? (
  <>
    <Badge variant="outline" className="border-amber-400 text-amber-700">Unusual</Badge>
    <AnomalyExplain fact={anomalies.get(txn.id)!} />
  </>
) : null}
```

- [ ] **Step 4: Manual check**

Run dev (or demo mode). A row above 3× its category baseline shows the "Unusual" badge; clicking "Explain why flagged" streams a one-line explanation; cancel works.

- [ ] **Step 5: Typecheck + stage**

```bash
cd frontend && npm run typecheck
git add "src/app/(app)/transactions/page.tsx"
```

---

### Task 6: Enable feature + demo + tests

**Files:**
- Modify: `frontend/src/lib/llm/features.ts`, `features.test.ts`, `contracts.ts`

- [ ] **Step 1: Update the disabled test**

In `features.test.ts`, anomaly is no longer disabled:

```ts
it("enables anomaly_explanation once wired", () => {
  expect(getFeaturePolicy("anomaly_explanation").enabled).toBe(true);
});
```

- [ ] **Step 2: Run — expect FAIL**, then flip `anomaly_explanation.enabled = true` in `features.ts`.

Run: `cd frontend && npm run test:run -- src/lib/llm/features.test.ts`

- [ ] **Step 3: Demo result**

In `contracts.ts`, add an `anomaly_explanation` entry to `demoStreamText` (the streaming demo helper from Plan 2 Task 6) returning a short canned explanation. `runStream`'s demo short-circuit emits it; `demoStructuredResult` is not used for streaming features.

- [ ] **Step 4: Run — expect PASS + stage**

```bash
cd frontend && npm run test:run -- src/lib/llm
git add frontend/src/lib/llm/features.ts frontend/src/lib/llm/features.test.ts frontend/src/lib/llm/contracts.ts
```

---

### Task 7: Verify + commit

- [ ] **Step 1: Backend + frontend CI**

Run: `./scripts/ci-local.sh`
Expected: PASS (includes pytest + vitest + build).

- [ ] **Step 2: Stage docs + present commit** (human triggers)

```bash
git add docs/superpowers/plans/2026-06-29-anomaly-detection-and-explanation.md
git commit -m "feat: deterministic anomaly detection + on-device explanation"
```

---

## Self-review

- **Spec coverage:** deterministic detection w/ floors+history+divide-by-zero guard (T2) ✓, endpoint w/ gate (T3) ✓, streaming explain (T5) ✓, enable+demo (T6) ✓.
- **Placeholders:** SQL/threshold constants are concrete; the `func.row(...).in_` note gives an explicit fallback rather than hand-waving. Test fixtures reference the existing backend test factories (real, in-repo) with a fallback to local factories.
- **Type consistency:** `AnomalyFact` fields match across backend schema (T1), service output (T2), frontend type (T4), and UI consumer (T5); endpoint returns `AnomalyFacts` (T1/T3).
- **Security:** detection deterministic + server-side; gate + rate limit reused; LLM gets one flagged row and returns prose only.
