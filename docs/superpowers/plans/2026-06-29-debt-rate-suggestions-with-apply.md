# Structured Debt-Rate Suggestions with Apply — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the free-text debt rate note with structured per-account APR / minimum-payment suggestions the user can explicitly apply to their accounts — guard-railed because LLM output flows into a financial-data write.

**Architecture:** New heavy Nano-only feature `debt_rate_suggestions`: a `/api/ai/facts/debt` fact endpoint grounds per-account facts, `pipelines/rates.ts` generates a verified `{ suggestions: [...] }` object, and the Plan debt tab renders per-account Accept / Accept-all that writes only **missing** fields via the existing `accountsApi.update`. Every number is verifier-bounded and re-validated server-side; nothing is auto-applied.

**Tech Stack:** FastAPI / SQLAlchemy / Pydantic / pytest (backend); Next.js 16 / React / TypeScript / Vitest (frontend). Reuses `pipelines/steps.ts` (`ground`, `generateVerified`, `Check`) and `accountsApi.update`.

**Spec:** [2026-06-29-deferred-ai-features-design.md](../specs/2026-06-29-deferred-ai-features-design.md) § WS5.

**Prerequisite:** Plan 1 (`finish-ai-reliability-branch`) committed — depends on the shared `useAiPipelineRun`/`AiRunStatus` infrastructure. `debt_rate_suggestions` is a heavy (`runFeature`) feature, so its demo uses `demoStructuredResult` normally (no streaming caveat).

## Global Constraints

- `debt_rate_suggestions` is **heavy, Nano-only** (Tier 1). It must be added to `HEAVY_FEATURES` in **both** `frontend/src/lib/llm/useLlm.ts` **and** `frontend/src/hooks/use-ai-pipeline-run.ts`.
- **Security (LLM → financial write):**
  - Schema constrains `account_id`; verifier rejects ids not in the grounded facts.
  - Verifier bounds: `0 ≤ suggested_apr ≤ 0.35`; `0 ≤ suggested_min_payment ≤ abs(balance)`.
  - Suggestions only for accounts **missing** the field (`has_apr` / `has_min_payment` false). Apply writes **only the missing field(s)** — never overwrites a user-entered value.
  - Apply is explicit per-account; the exact value is shown before writing; Accept-all applies only already-displayed values; nothing auto-applies.
  - The account `PUT` re-validates ranges **server-side** and enforces household ownership.
  - Copy permanently frames values as unverified estimates to confirm on statements.
- APR is stored as a fraction (e.g. `0.2299` = 22.99%), per `backend/app/api/routes/debt.py`.
- **Backend tests** live in `backend/tests/test_facts_endpoints.py` (+ existing account-route tests); reuse its `_seed_budget_fixture(...)`-style helpers, the `client` fixture, `headers` auth, and `Household(..., ai_enabled=...)`. Do **not** invent `db`/`auth`/`household` fixtures.
- Demo mode returns canned suggestions (no model). Commit only when the human asks.

---

## File structure

| File | Action | Responsibility |
|------|--------|----------------|
| `backend/app/schemas/facts.py` | Modify | `DebtAccountFact`, `DebtFacts` |
| `backend/app/services/ai/debt_facts.py` | **Create** | `compute_debt_facts(db, household_id)` |
| `backend/app/api/routes/facts.py` | Modify | `GET /debt` endpoint |
| `backend/app/api/routes/accounts.py` (+ its update schema) | Modify | Server-side range validation on apply |
| `backend/tests/...` | Create/Modify | Debt-facts + apply-validation tests |
| `frontend/src/lib/llm/features.ts` | Modify | Add `debt_rate_suggestions` FeatureId + policy |
| `frontend/src/lib/llm/schema.ts` | Modify | `debt_rate_suggestions` JSON schema |
| `frontend/src/lib/llm/useLlm.ts` | Modify | `HEAVY_FEATURES` + `runFeature` dispatch case |
| `frontend/src/hooks/use-ai-pipeline-run.ts` | Modify | `HEAVY_FEATURES` set |
| `frontend/src/lib/llm/contracts.ts` | Modify | Demo suggestions |
| `frontend/src/lib/llm/pipelines/rates.ts` | **Create** | `runRatesPipeline` |
| `frontend/src/lib/llm/pipelines/rates.test.ts` | **Create** | Verifier tests |
| `frontend/src/app/(app)/plan/page.tsx` | Modify | Structured suggestion + apply UI (replaces free-text note) |

---

### Task 1: Backend `DebtFacts` schema

**Files:** Modify `backend/app/schemas/facts.py`

**Interfaces:** Produces `DebtFacts(accounts: list[DebtAccountFact])`.

- [ ] **Step 1: Add models**

```python
class DebtAccountFact(BaseModel):
    account_id: str
    name: str
    type: str
    balance: float
    has_apr: bool
    has_min_payment: bool
    current_apr: float | None
    current_min_payment: float | None


class DebtFacts(BaseModel):
    accounts: list[DebtAccountFact]
```

- [ ] **Step 2: Import check + stage**

Run: `cd backend && python -c "from app.schemas.facts import DebtFacts"`

```bash
git add backend/app/schemas/facts.py
```

---

### Task 2: `compute_debt_facts` service

**Files:**
- Create: `backend/app/services/ai/debt_facts.py`
- Create/Modify: backend test for the service

**Interfaces:** Produces `async compute_debt_facts(db, household_id) -> dict[str, object]` shaped for `DebtFacts`. Reuses the debt-account filter from `app/api/routes/debt.py:list_debt_accounts` (liability accounts for the household).

- [ ] **Step 1: Write the failing test**

```python
import pytest
from app.services.ai.debt_facts import compute_debt_facts

@pytest.mark.asyncio
async def test_flags_missing_fields(db, household, seed_debt_accounts):
    # one account with interest_rate=None, minimum_payment=None;
    # one fully populated.
    result = await compute_debt_facts(db, household.id)
    by_id = {a["account_id"]: a for a in result["accounts"]}
    missing = by_id[seed_debt_accounts["missing_id"]]
    assert missing["has_apr"] is False
    assert missing["has_min_payment"] is False
    full = by_id[seed_debt_accounts["full_id"]]
    assert full["has_apr"] is True and full["has_min_payment"] is True
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd backend && pytest tests -k debt_facts -v`

- [ ] **Step 3: Implement**

```python
from __future__ import annotations

"""Per-account debt facts for the rate-suggestion pipeline (model-free)."""

from sqlalchemy import select

from app.models.account import Account
# Reuse the same liability filter list_debt_accounts uses; import or replicate it.


async def compute_debt_facts(db, household_id: str) -> dict[str, object]:
    rows = await db.execute(
        select(Account)
        .where(Account.household_id == household_id)
        .where(Account.closed_at.is_(None))
        # same liability/debt predicate as routes/debt.py:list_debt_accounts
        .where(Account.is_debt.is_(True))  # adjust to the actual debt predicate
    )
    accounts: list[dict[str, object]] = []
    for a in rows.scalars().all():
        apr = None if a.interest_rate is None else float(a.interest_rate)
        minp = None if a.minimum_payment is None else float(a.minimum_payment)
        accounts.append(
            {
                "account_id": str(a.id),
                "name": a.name,
                "type": str(getattr(a, "account_type", "") or ""),
                "balance": float(a.balance),
                "has_apr": apr is not None,
                "has_min_payment": minp is not None,
                "current_apr": apr,
                "current_min_payment": minp,
            }
        )
    return {"accounts": accounts}
```

> Replace `Account.is_debt.is_(True)` with the exact predicate `list_debt_accounts` uses (grep `def list_debt_accounts` in `routes/debt.py` and copy its `.where(...)` filter so the two stay consistent).

- [ ] **Step 4: Run — expect PASS + stage**

```bash
cd backend && pytest tests -k debt_facts -v
git add backend/app/services/ai/debt_facts.py backend/tests
```

---

### Task 3: `/api/ai/facts/debt` endpoint

**Files:** Modify `backend/app/api/routes/facts.py` (+ test)

- [ ] **Step 1: Failing endpoint test** (mirror the anomalies/goal route tests)

```python
@pytest.mark.asyncio
async def test_debt_facts_requires_ai(client, household_no_ai):
    resp = await client.get("/api/ai/facts/debt", headers=auth(household_no_ai))
    assert resp.status_code in (403, 409)

@pytest.mark.asyncio
async def test_debt_facts_shape(client, household_ai_on):
    resp = await client.get("/api/ai/facts/debt", headers=auth(household_ai_on))
    assert resp.status_code == 200 and "accounts" in resp.json()
```

- [ ] **Step 2: Run — expect FAIL**, then add the route to `facts.py`:

```python
from app.schemas.facts import DebtFacts  # add to facts import
from app.services.ai.debt_facts import compute_debt_facts


@router.get("/debt", response_model=DebtFacts)
async def debt_facts(
    household_id: str = Depends(_require_ai_enabled),
    db: AsyncSession = Depends(get_db),
) -> DebtFacts:
    """Per-account debt facts (deterministic) for rate suggestions."""
    return DebtFacts(**await compute_debt_facts(db, household_id))
```

- [ ] **Step 3: Run — expect PASS + stage**

```bash
cd backend && pytest tests -k debt_facts -v
git add backend/app/api/routes/facts.py backend/tests
```

---

### Task 4: Server-side range validation on apply (defense in depth)

**Files:** Modify `backend/app/api/routes/accounts.py` (the `PUT /accounts/{id}` handler and/or its update schema) + test.

**Interfaces:** The account update rejects `interest_rate` outside `[0, 1]` and `minimum_payment < 0` with HTTP 422, independent of the AI path.

- [ ] **Step 1: Failing validation test**

```python
@pytest.mark.asyncio
async def test_rejects_out_of_range_apr(client, household_ai_on, debt_account):
    resp = await client.put(
        f"/api/accounts/{debt_account.id}",
        json={"interest_rate": 5.0},  # 500% — invalid
        headers=auth(household_ai_on),
    )
    assert resp.status_code == 422

@pytest.mark.asyncio
async def test_rejects_negative_min_payment(client, household_ai_on, debt_account):
    resp = await client.put(
        f"/api/accounts/{debt_account.id}",
        json={"minimum_payment": -10},
        headers=auth(household_ai_on),
    )
    assert resp.status_code == 422
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Add validators to the account-update Pydantic model**

```python
from pydantic import field_validator

class AccountUpdate(BaseModel):  # the existing update model
    # ... existing fields ...

    @field_validator("interest_rate")
    @classmethod
    def _apr_range(cls, v):
        if v is not None and not (0 <= v <= 1):
            raise ValueError("interest_rate must be a fraction between 0 and 1")
        return v

    @field_validator("minimum_payment")
    @classmethod
    def _min_payment_nonneg(cls, v):
        if v is not None and v < 0:
            raise ValueError("minimum_payment must be >= 0")
        return v
```

(If the route accepts a free-form dict rather than a typed model, add an explicit check in the handler before persisting. Ownership is already enforced by the existing account auth dependency — confirm it scopes to `household_id`.)

- [ ] **Step 4: Run — expect PASS + stage**

```bash
cd backend && pytest tests -k "account" -v
git add backend/app/api/routes/accounts.py backend/tests
```

---

### Task 5: Register the `debt_rate_suggestions` feature

**Files:** Modify `features.ts`, `schema.ts`, `useLlm.ts`, `use-ai-pipeline-run.ts`, `contracts.ts`, `features.test.ts`.

**Interfaces:** Produces `FeatureId` member `"debt_rate_suggestions"` (heavy, Nano-only) with an object schema `{ suggestions: RateSuggestion[] }`.

- [ ] **Step 1: Add to the `FeatureId` union + `FEATURES`** in `features.ts`:

```ts
// in the FeatureId union:
| "debt_rate_suggestions"

// in FEATURES:
debt_rate_suggestions: {
  id: "debt_rate_suggestions",
  label: "Debt rate suggestions",
  allowedTiers: HEAVY_TIERS,
  minimumTier: 1,
  defaultTier: 1,
  enabled: true,
},
```

- [ ] **Step 2: Add the schema** in `schema.ts` (mirror `budget_recommendations`):

```ts
debt_rate_suggestions: {
  type: "object",
  required: ["suggestions"],
  additionalProperties: false,
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        required: ["account_id", "suggested_apr", "suggested_min_payment", "reasoning"],
        additionalProperties: false,
        properties: {
          account_id: { type: "string" },
          suggested_apr: { type: "number" },
          suggested_min_payment: { type: "number" },
          reasoning: { type: "string" },
        },
      },
    },
  },
},
```

- [ ] **Step 3: Add to `HEAVY_FEATURES` in BOTH files**

In `useLlm.ts` and `use-ai-pipeline-run.ts`, add `"debt_rate_suggestions"` to the `HEAVY_FEATURES` set.

- [ ] **Step 4: Demo result** in `contracts.ts`:

```ts
debt_rate_suggestions: { suggestions: [{ account_id: "demo-card", suggested_apr: 0.2299, suggested_min_payment: 35, reasoning: "Typical store-card APR; verify on your statement." }] },
```

- [ ] **Step 5: Typecheck + stage**

```bash
cd frontend && npm run typecheck
git add frontend/src/lib/llm/features.ts frontend/src/lib/llm/schema.ts frontend/src/lib/llm/useLlm.ts frontend/src/hooks/use-ai-pipeline-run.ts frontend/src/lib/llm/contracts.ts
```

---

### Task 6: `runRatesPipeline`

**Files:**
- Create: `frontend/src/lib/llm/pipelines/rates.ts`
- Create: `frontend/src/lib/llm/pipelines/rates.test.ts`

**Interfaces:**
- Consumes: `ground`, `generateVerified`, `Check` from `./steps`; `schemaForFeature("debt_rate_suggestions")`.
- Produces: `runRatesPipeline(ctx: PipelineContext): Promise<RateResult>` with `RateResult { suggestions: RateSuggestion[] }`.

- [ ] **Step 1: Write the failing verifier tests** (mirror `goal.test.ts` mock setup)

```ts
it("rejects suggestions for unknown account ids", async () => {
  // ground → one account "a1"; provider → a suggestion for "a2"
  await expect(runRatesPipeline(ctx)).rejects.toBeTruthy();
});

it("rejects apr above 0.35", async () => {
  // provider returns suggested_apr 0.99 for a1 → verifier fails → bounded retry exhausts
  await expect(runRatesPipeline(ctx)).rejects.toBeTruthy();
});

it("accepts a valid bounded suggestion", async () => {
  const result = await runRatesPipeline(ctx);
  expect(result.suggestions[0].suggested_apr).toBeLessThanOrEqual(0.35);
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd frontend && npm run test:run -- src/lib/llm/pipelines/rates.test.ts`

- [ ] **Step 3: Implement** `rates.ts`:

```ts
import { schemaForFeature } from "../schema";
import { withNanoSlot } from "../session-pool";
import { generateVerified, ground, type Check } from "./steps";
import type { PipelineContext } from "./types";

export interface DebtFact {
  account_id: string;
  name: string;
  type: string;
  balance: number;
  has_apr: boolean;
  has_min_payment: boolean;
  current_apr: number | null;
  current_min_payment: number | null;
}
export interface DebtFacts { accounts: DebtFact[]; }

export interface RateSuggestion {
  account_id: string;
  suggested_apr: number;
  suggested_min_payment: number;
  reasoning: string;
}
export interface RateResult { suggestions: RateSuggestion[]; }

const APR_MAX = 0.35;

export async function runRatesPipeline(ctx: PipelineContext): Promise<RateResult> {
  return withNanoSlot(async () => {
    ctx.onProgress?.({ step: "ground", label: "Reading your debt accounts…" });
    const facts = await ground<DebtFacts>("/ai/facts/debt", ctx.signal);

    const byId = new Map(facts.accounts.map((a) => [a.account_id, a]));
    const eligible = facts.accounts.filter((a) => !a.has_apr || !a.has_min_payment);

    const checks: Check<RateResult>[] = [
      ({ suggestions }) => suggestions.every((s) => byId.has(s.account_id)),
      ({ suggestions }) =>
        suggestions.every((s) => s.suggested_apr >= 0 && s.suggested_apr <= APR_MAX),
      ({ suggestions }) =>
        suggestions.every((s) => {
          const a = byId.get(s.account_id)!;
          return s.suggested_min_payment >= 0 && s.suggested_min_payment <= Math.abs(a.balance);
        }),
      ({ suggestions }) => suggestions.every((s) => s.reasoning.trim().length > 0),
    ];

    const system =
      "You suggest conservative STARTING-POINT estimates for missing credit/loan APR and " +
      "minimum payment. Only use the provided account_id values. APR is a fraction (e.g. 0.2299) " +
      "and must never exceed 0.35. Minimum payment must not exceed the balance. These are " +
      "estimates the user must verify on their statements.";
    const prompt =
      `Suggest apr and minimum payment ONLY for these accounts missing data.\n` +
      `Use ONLY these account_id values: ${eligible.map((a) => a.account_id).join(", ")}.\n` +
      `Facts: ${JSON.stringify(eligible)}`;

    ctx.onProgress?.({ step: "generate", label: "Estimating rates…" });
    const result = await generateVerified<RateResult>(
      ctx.provider,
      { system, prompt, schema: schemaForFeature("debt_rate_suggestions")!, signal: ctx.signal },
      checks,
      { signal: ctx.signal },
    );
    ctx.onProgress?.({ step: "done", label: "Done" });
    return result;
  });
}
```

- [ ] **Step 4: Wire the dispatch** in `useLlm.ts` `runFeature` switch:

```ts
case "debt_rate_suggestions":
  return runRatesPipeline(pctx);
```

(Add `import { runRatesPipeline } from "./pipelines/rates";` at the top.)

- [ ] **Step 5: Run — expect PASS + stage**

```bash
cd frontend && npm run test:run -- src/lib/llm/pipelines/rates.test.ts
git add frontend/src/lib/llm/pipelines/rates.ts frontend/src/lib/llm/pipelines/rates.test.ts frontend/src/lib/llm/useLlm.ts
```

---

### Task 7: Plan debt tab — structured suggestions + apply

**Files:** Modify `frontend/src/app/(app)/plan/page.tsx`

**Interfaces:** Consumes `useAiPipelineRun<RateResult>("debt_rate_suggestions")`, `accountsApi.update`, `RateSuggestion`/`DebtFact` types from `@/lib/llm/pipelines/rates`, `AiRunStatus`, `MaybeAiErrorWithSettings`.

- [ ] **Step 1: Replace `handleSuggestRates` with the structured run**

```tsx
const aiRates = useAiPipelineRun<RateResult>("debt_rate_suggestions");
const [suggestions, setSuggestions] = useState<RateSuggestion[]>([]);
const [accepted, setAccepted] = useState<Set<string>>(new Set());
const queryClient = useQueryClient();
const debtFacts = /* the debt accounts already loaded on this tab, keyed by id */;

const handleSuggestRates = async () => {
  setSuggestions([]);
  setAccepted(new Set());
  aiRates.clearError();
  try {
    const result = await aiRates.run({});
    setSuggestions(result.suggestions);
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    // aiRates.error rendered below
  }
};
```

- [ ] **Step 2: Per-account apply (missing fields only)**

```tsx
const applyMutation = useMutation({
  mutationFn: ({ id, data }: { id: string; data: Record<string, number> }) =>
    accountsApi.update(id, data),
  onSuccess: (_d, vars) => {
    setAccepted((prev) => new Set([...prev, vars.id]));
    queryClient.invalidateQueries({ queryKey: ["debt-accounts"] }); // match the tab's query key
    appToast.success("Applied — verify on your statement");
  },
  onError: (err) => toastApiError("Could not apply suggestion", err),
});

const applyOne = (s: RateSuggestion) => {
  const account = debtFacts.get(s.account_id); // the deterministic account record
  if (!account) return;
  const data: Record<string, number> = {};
  if (account.interest_rate == null) data.interest_rate = s.suggested_apr;       // missing only
  if (account.minimum_payment == null) data.minimum_payment = s.suggested_min_payment; // missing only
  if (Object.keys(data).length === 0) return;
  applyMutation.mutate({ id: s.account_id, data });
};

const applyAll = () => {
  for (const s of suggestions) {
    if (!accepted.has(s.account_id)) applyOne(s);
  }
};
```

- [ ] **Step 3: Render suggestions with explicit values + estimate framing**

```tsx
<Button size="sm" variant="outline" onClick={() => void handleSuggestRates()} disabled={aiRates.running}>
  <Sparkles className={cn("mr-2 h-3 w-3", aiRates.running && "animate-pulse")} /> Suggest rates with AI
</Button>
{aiRates.running ? <AiRunStatus progress={aiRates.progress} onCancel={aiRates.cancel} /> : null}
{aiRates.error ? <MaybeAiErrorWithSettings message={aiRates.error} /> : null}

{suggestions.length > 0 && (
  <div className="space-y-2">
    <p className="text-xs text-amber-700 dark:text-amber-300">
      Estimates only — verify each value on your statement before relying on it.
    </p>
    <div className="flex justify-end">
      <Button size="sm" variant="ghost" onClick={applyAll} disabled={applyMutation.isPending}>
        Accept all
      </Button>
    </div>
    {suggestions.map((s) => {
      const acct = debtFacts.get(s.account_id);
      return (
        <div key={s.account_id} className="rounded-md border p-2 text-sm">
          <div className="font-medium">{acct?.name ?? s.account_id}</div>
          <div className="text-xs text-muted-foreground">
            {acct?.interest_rate == null ? `APR ≈ ${(s.suggested_apr * 100).toFixed(2)}%` : null}
            {acct?.minimum_payment == null ? ` · Min ≈ $${s.suggested_min_payment}` : null}
          </div>
          <p className="text-xs">{s.reasoning}</p>
          <Button size="sm" className="mt-1 h-7 text-xs" disabled={accepted.has(s.account_id) || applyMutation.isPending} onClick={() => applyOne(s)}>
            {accepted.has(s.account_id) ? "Applied" : "Accept"}
          </Button>
        </div>
      );
    })}
  </div>
)}
```

- [ ] **Step 4: Remove the old free-text `rateNote`/`rateError` path** left from the reliability branch (the `aiRun`/`financial_advice` rate block), since it's replaced.

- [ ] **Step 5: Manual check**

Run dev (or demo mode): click "Suggest rates with AI" → per-account cards show only missing fields with explicit values + estimate banner; "Accept" applies just the missing field(s) and flips to "Applied"; an account that already has both APR and min payment never appears.

- [ ] **Step 6: Typecheck + stage**

```bash
cd frontend && npm run typecheck
git add "src/app/(app)/plan/page.tsx"
```

---

### Task 8: Verify + commit

- [ ] **Step 1: Full CI**

Run: `./scripts/ci-local.sh`
Expected: PASS.

- [ ] **Step 2: Security re-grep**

Run: `cd frontend && rg -n "interest_rate|minimum_payment" "src/app/(app)/plan/page.tsx"`
Confirm apply only sends missing fields (no unconditional overwrite).

- [ ] **Step 3: Stage docs + present commit** (human triggers)

```bash
git add docs/superpowers/plans/2026-06-29-debt-rate-suggestions-with-apply.md
git commit -m "feat: structured debt-rate suggestions with guard-railed apply"
```

---

## Self-review

- **Spec coverage:** new feature id + schema + both HEAVY_FEATURES sets (T5) ✓; debt facts endpoint (T1-3) ✓; verifier bounds + unknown-id rejection + missing-only eligibility (T6) ✓; explicit per-account/Accept-all apply writing missing fields only (T7) ✓; server-side range re-validation (T4) ✓; estimate framing (T7) ✓.
- **Placeholders:** the one runtime unknown — the debt-account predicate — is called out explicitly with a grep-and-copy instruction (`list_debt_accounts`), not left vague. UI references real symbols (`accountsApi.update`, `useAiPipelineRun`).
- **Type consistency:** `RateResult { suggestions: RateSuggestion[] }` matches frontend schema (T5), pipeline (T6), demo (T5), and UI (T7); backend `DebtFacts`/`DebtAccountFact` fields match the frontend `DebtFacts`/`Debt­Fact` used by the pipeline (T1↔T6).
- **Security:** verifier bounds + server-side re-validation (defense in depth); missing-field-only writes; explicit apply; ownership via existing account auth; estimate framing persistent.
