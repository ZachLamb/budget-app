# Nano-only AI — Phase 2: Pipelines + remove the cloud Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the four heavy on-device pipelines (ground → decompose → generate(schema) → critique → verify → compose, sequential), wired to specialized Chrome AI APIs with Prompt-API fallbacks; then delete the self-hosted cloud tier end-to-end (frontend + backend) without leaving a broken window.

**Architecture:** Backend exposes deterministic *fact* endpoints (no model). A new `frontend/src/lib/llm/pipelines/` layer runs concrete per-feature functions over those facts on Nano, with a deterministic code verifier as the source of truth (critique revisions accepted only if they pass `verify`). After pipelines are validated, the Tier-4 cloud path is removed from the router, providers, components, backend services, routes, and config; per-feature kill switches are added.

**Tech Stack:** Next.js/React/TypeScript, Vitest, Chrome `LanguageModel` + Summarizer/Writer/Rewriter/Proofreader, FastAPI, SQLAlchemy, Alembic, pytest.

**Spec:** `docs/superpowers/specs/2026-06-14-nano-only-ai-design.md` (Phase 2).

**Prerequisite:** Phase 1 merged (capability `specialized`, `specialized.ts`, Nano `ensureReady`/schema, `needs_nano_setup`, `schema.ts`).

---

## File Structure

**Backend — create fact endpoints (keep, don't delete):**

| File | Responsibility |
|------|----------------|
| `backend/app/api/routes/facts.py` (Create) | `GET /api/ai/facts/{budget,goal,context}` — deterministic aggregates, household-scoped. |
| `backend/app/schemas/facts.py` (Create) | Pydantic response models for the fact endpoints. |
| `backend/app/api/routes/__init__.py` (Modify) | Mount the facts router under `/api/ai`. |

**Frontend — create pipeline layer:**

| File | Responsibility |
|------|----------------|
| `frontend/src/lib/llm/pipelines/types.ts` (Create) | `PipelineContext`, `PipelineProgress`, step result shapes. |
| `frontend/src/lib/llm/errors.ts` (Create) | `OnDeviceError` taxonomy. |
| `frontend/src/lib/llm/session-pool.ts` (Create) | `withNanoSlot()` concurrency cap (v1 cap = 1, sequential). |
| `frontend/src/lib/llm/pipelines/steps.ts` (Create) | `ground`, `generateStructured`, `critique`, `verify`, `compose`. |
| `frontend/src/lib/llm/pipelines/budget.ts` (Create) | `budget_recommendations` pipeline. |
| `frontend/src/lib/llm/pipelines/goal.ts` (Create) | `goal_planning` pipeline. |
| `frontend/src/lib/llm/pipelines/qa.ts` (Create) | `free_form_qa` pipeline. |
| `frontend/src/lib/llm/pipelines/advice.ts` (Create) | `financial_advice` pipeline. |
| `frontend/src/lib/llm/schema.ts` (Modify) | Add schemas for the four heavy features. |
| `frontend/src/lib/llm/contracts.ts` (Modify) | Demo results for the four heavy pipelines. |

**Frontend — remove cloud:**

| File | Action |
|------|--------|
| `frontend/src/lib/llm/providers/server.ts` (+`.test.ts`) | Delete |
| `frontend/src/lib/llm/pii-detect.ts` (+`.test.ts`) | Delete |
| `frontend/src/components/llm/cloud-consent-dialog.tsx` | Delete |
| `frontend/src/components/llm/pii-warning-dialog.tsx` | Delete |
| `frontend/src/lib/llm/features.ts` | Light five `[1,2]`, heavy four `[1]`, `defaultTier:1`, `minimumTier:1`, drop `cloudPossible` |
| `frontend/src/lib/llm/router.ts` | Drop Tier-4 branch, `cloudConsentGrants`, `needs_cloud_consent`, `preferredTierByFeature` |
| `frontend/src/lib/llm/useLlm.ts` | Drop server provider + cloud consent query; route heavy features through pipelines |
| `frontend/src/lib/llm/consent.ts` | Drop cloud branches (keep local download consent) |
| `frontend/src/lib/llm/types.ts` | `Tier = 1 | 2`; drop `server` capability + `"server"` provider name |
| `frontend/src/lib/llm/capability.ts` | Drop `server` field |
| `frontend/src/lib/llm/index.ts` | Drop `LLMError`/`scanPrompt` exports |
| `frontend/src/components/llm/explain-charge.tsx` | Collapse to button → stream → result |
| `frontend/src/components/llm/ai-settings-card.tsx` | Delete the Cloud AI section + keep-alive re-grant |

**Backend — remove cloud (end-state; sequenced after pipelines validate):**

Delete: `services/ai/llm_client.py`, `circuit.py`, `cache.py`, `llm_rate_limit.py`, `household_rate_limit.py`, `log_redact.py`, `json_extract.py`, `status.py`, `insights.py`, `services/categorization/llm.py`, `api/deps_llm.py`, the cloud route in `routes/llm.py` (`POST /api/llm/cloud`), and `OLLAMA_*`/Modal config. Triage: `prompt_safety.py` (KEEP — still used by `candidates.py`/`fsa.py`), `debt_plan.py`/`budget.py`/`interest_rates.py`/`action.py` (keep deterministic parts, drop model calls), `routes/ai.py` (remove model routes, keep fact/candidate/FSA-status routes).

**Per-feature kill switches:** `frontend/src/lib/llm/features.ts` `enabled: boolean` per feature.

---

## Part A — Backend fact endpoints (do first; pipelines depend on them)

### Task A1: `GET /api/ai/facts/budget`

**Files:**
- Create: `backend/app/schemas/facts.py`
- Create: `backend/app/api/routes/facts.py`
- Modify: `backend/app/api/routes/__init__.py`
- Test: `backend/tests/test_facts_endpoints.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_facts_endpoints.py` (follow the HTTP-integration pattern from `test_me_export.py`: `AsyncClient` + `ASGITransport`, `app.dependency_overrides`, in-memory SQLite, `_token_for`):

```python
import pytest
from httpx import ASGITransport, AsyncClient
from app.main import app
from app.api.deps import get_household_id

@pytest.mark.asyncio
async def test_facts_budget_requires_household(monkeypatch):
    # ai_enabled household → 200 with grounded aggregates
    app.dependency_overrides[get_household_id] = lambda: "hh-1"
    # ...override get_db with a seeded session exposing one over-budget category...
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/ai/facts/budget", headers={"Authorization": "Bearer t"})
    assert resp.status_code == 200
    body = resp.json()
    assert "categories" in body
    assert all({"category_id", "name", "budgeted", "actual"} <= c.keys() for c in body["categories"])
    app.dependency_overrides.clear()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_facts_endpoints.py -v`
Expected: FAIL — 404 (route not mounted).

- [ ] **Step 3: Define the response schema**

Create `backend/app/schemas/facts.py`:

```python
from pydantic import BaseModel

class BudgetCategoryFact(BaseModel):
    category_id: str
    name: str
    budgeted: float
    actual: float
    remaining: float

class BudgetFacts(BaseModel):
    month: str
    categories: list[BudgetCategoryFact]
    total_budgeted: float
    total_actual: float
```

- [ ] **Step 4: Implement the route**

Create `backend/app/api/routes/facts.py`. Reuse the existing deterministic aggregation in `app/services/ai/budget.py` (the 3-month/over-budget computation it already does *before* the model call) — extract that aggregation into a model-free helper if it is currently inline, and call it here. Apply the same household gate used by FSA candidates (`_require_ai_enabled` from `routes/ai.py`) plus the IP rate-limit middleware that already covers `/api/ai/`.

```python
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_db
from app.api.routes.ai import _require_ai_enabled
from app.schemas.facts import BudgetFacts
from app.services.ai.budget import compute_budget_facts  # model-free helper

router = APIRouter(prefix="/ai/facts", tags=["ai-facts"])

@router.get("/budget", response_model=BudgetFacts)
async def budget_facts(
    household_id: str = Depends(_require_ai_enabled),
    db: AsyncSession = Depends(get_db),
) -> BudgetFacts:
    return BudgetFacts(**await compute_budget_facts(db, household_id))
```

If `compute_budget_facts` does not yet exist, add it to `budget.py` by lifting the deterministic aggregation out of `generate_budget_suggestions` (leave the LLM call alone for now — it is deleted later in this phase). Add a focused unit test for `compute_budget_facts` against a fake DB (pattern: `test_categorize_candidates.py`).

- [ ] **Step 5: Mount the router**

In `backend/app/api/routes/__init__.py`, import and `include_router(facts.router)` under the `/api` prefix (matching the existing `ai`/`llm` mounting).

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_facts_endpoints.py -v`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/app/schemas/facts.py backend/app/api/routes/facts.py backend/app/api/routes/__init__.py backend/app/services/ai/budget.py backend/tests/test_facts_endpoints.py
git commit -m "feat(api): add GET /api/ai/facts/budget grounded fact endpoint"
```

### Task A2: `GET /api/ai/facts/goal`

**Files:** Modify `facts.py`, `schemas/facts.py`; Test `test_facts_endpoints.py`.

- [ ] **Step 1: Write the failing test** — assert `200` returns `{ goals: [{ goal_id, name, target_amount, current_amount, monthly_contribution, months_remaining }] }`, household-scoped (a goal from another household is absent).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Add `GoalFacts`/`GoalFact` to `schemas/facts.py`.**
- [ ] **Step 4: Implement `GET /ai/facts/goal`** reusing the deterministic metrics already in `routes/goals.py` (`_compute_goal_metrics`, `_derive_linked_current_amount`). Extract a shared `compute_goal_facts(db, household_id)` helper so both the goals route and this fact endpoint use one code path.
- [ ] **Step 5: Run → PASS.**
- [ ] **Step 6: Commit** `feat(api): add GET /api/ai/facts/goal`.

### Task A3: `GET /api/ai/facts/context`

**Files:** Modify `facts.py`, `schemas/facts.py`; Test `test_facts_endpoints.py`.

- [ ] **Step 1: Write the failing test** — assert `200` returns a structured snapshot (accounts summary, recent spend by category, budget pace, goals) derived from `build_financial_context` / `build_chat_evidence_list`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Add `ContextFacts` schema** (structured, not the free-text string `build_financial_context` returns today — return the underlying numbers so the client verifier can reconcile against them). If `context.py`/`evidence.py` only expose strings/lists, add a `build_context_facts(db, household_id) -> dict` returning typed aggregates.
- [ ] **Step 4: Implement `GET /ai/facts/context`.**
- [ ] **Step 5: Run → PASS.**
- [ ] **Step 6: Commit** `feat(api): add GET /api/ai/facts/context`.

### Task A4: Fact-endpoint authorization tests

**Files:** Test `backend/tests/test_facts_endpoints.py`.

- [ ] **Step 1: Write failing tests** asserting: (a) a household with `ai_enabled=False` gets the `_require_ai_enabled` rejection; (b) each endpoint only returns the caller's household data (seed two households, assert isolation); (c) unauthenticated request is rejected.
- [ ] **Step 2: Run → FAIL** for any gap.
- [ ] **Step 3: Fix** route deps if any test fails (they should pass if `_require_ai_enabled` + `get_household_id` are used).
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `test(api): fact endpoint authz + household isolation`.

---

## Part B — Frontend pipeline scaffolding

### Task B1: Error taxonomy

**Files:** Create `frontend/src/lib/llm/errors.ts`; Test `frontend/src/lib/llm/errors.test.ts`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { OnDeviceError, userMessageFor } from "./errors";

describe("OnDeviceError", () => {
  it("carries a code and maps to one user message", () => {
    const e = new OnDeviceError("verify_failed", "numbers did not reconcile");
    expect(e.code).toBe("verify_failed");
    expect(userMessageFor(e)).toMatch(/couldn.t check/i);
  });
  it("maps no_model to a Chrome/Edge hint", () => {
    expect(userMessageFor(new OnDeviceError("no_model", ""))).toMatch(/chrome or edge/i);
  });
});
```

- [ ] **Step 2: Run → FAIL** (module not found).
- [ ] **Step 3: Implement `errors.ts`**

```typescript
export type OnDeviceErrorCode =
  | "no_model"
  | "download_failed"
  | "session_create_failed"
  | "context_overflow"
  | "schema_parse_failed"
  | "verify_failed"
  | "aborted";

export class OnDeviceError extends Error {
  constructor(readonly code: OnDeviceErrorCode, message: string) {
    super(message);
    this.name = "OnDeviceError";
  }
}

const MESSAGES: Record<OnDeviceErrorCode, string> = {
  no_model: "On-device AI needs Chrome or Edge on desktop.",
  download_failed: "Couldn't finish setting up on-device AI. Try again.",
  session_create_failed: "On-device AI couldn't start. Try again.",
  context_overflow: "There was too much to analyze at once. Try a narrower question.",
  schema_parse_failed: "The result came back malformed. Try again.",
  verify_failed: "We couldn't check the result against your numbers. Try again.",
  aborted: "Cancelled.",
};

export function userMessageFor(e: unknown): string {
  if (e instanceof OnDeviceError) return MESSAGES[e.code];
  return "Something went wrong. Try again.";
}
```

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(llm): on-device error taxonomy`.

### Task B2: Pipeline types + session pool

**Files:** Create `frontend/src/lib/llm/pipelines/types.ts`, `frontend/src/lib/llm/session-pool.ts`; Test `frontend/src/lib/llm/session-pool.test.ts`.

- [ ] **Step 1: Define `pipelines/types.ts`**

```typescript
import type { CapabilitySnapshot, LLMProvider } from "../types";

export interface PipelineProgress {
  step: string;
  label: string;
}

export interface PipelineContext {
  provider: LLMProvider; // Nano in v1
  capability: CapabilitySnapshot;
  signal?: AbortSignal;
  onProgress?: (p: PipelineProgress) => void;
}
```

- [ ] **Step 2: Write the failing session-pool test**

```typescript
import { describe, expect, it } from "vitest";
import { withNanoSlot } from "./session-pool";

describe("withNanoSlot", () => {
  it("serializes work when the cap is 1", async () => {
    const order: string[] = [];
    const a = withNanoSlot(async () => { order.push("a-start"); await Promise.resolve(); order.push("a-end"); });
    const b = withNanoSlot(async () => { order.push("b-start"); order.push("b-end"); });
    await Promise.all([a, b]);
    expect(order).toEqual(["a-start", "a-end", "b-start", "b-end"]);
  });
});
```

- [ ] **Step 3: Run → FAIL.**
- [ ] **Step 4: Implement `session-pool.ts`** (v1 cap = 1; Phase 3 raises the cap + adds `clone()`):

```typescript
let chain: Promise<unknown> = Promise.resolve();

/** Run `fn` with a Nano slot. v1 caps concurrency at 1 (sequential). */
export function withNanoSlot<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.then(() => undefined, () => undefined);
  return run;
}
```

- [ ] **Step 5: Run → PASS.**
- [ ] **Step 6: Commit** `feat(llm): pipeline context types + Nano session slot`.

### Task B3: Shared steps

**Files:** Create `frontend/src/lib/llm/pipelines/steps.ts`; Test `frontend/src/lib/llm/pipelines/steps.test.ts`.

- [ ] **Step 1: Write the failing test** for `generateStructured` (parses schema-constrained JSON, throws `schema_parse_failed` on garbage), `verify` (throws `verify_failed` when a check returns false), `ground` (fetches from the given fact URL):

```typescript
import { describe, expect, it, vi } from "vitest";
import { generateStructured, verify } from "./steps";
import { OnDeviceError } from "../errors";
import type { LLMProvider } from "../types";

function fake(out: string): LLMProvider {
  return { name: "nano", tier: 1, privacy: "local", async *generate() { yield out; } };
}

describe("generateStructured", () => {
  it("parses schema-constrained JSON", async () => {
    const v = await generateStructured(fake('{"a":1}'), { system: "s", prompt: "p", schema: { type: "object" } });
    expect(v).toEqual({ a: 1 });
  });
  it("throws schema_parse_failed on non-JSON", async () => {
    await expect(generateStructured(fake("not json"), { system: "s", prompt: "p", schema: {} }))
      .rejects.toMatchObject({ code: "schema_parse_failed" });
  });
});

describe("verify", () => {
  it("throws verify_failed when a check fails", () => {
    expect(() => verify({ x: 1 }, [() => false])).toThrow(OnDeviceError);
  });
  it("returns the result when all checks pass", () => {
    expect(verify({ x: 1 }, [() => true])).toEqual({ x: 1 });
  });
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `steps.ts`**

```typescript
import { api } from "@/lib/api/client"; // existing axios-style client used elsewhere
import type { LLMProvider, GenerateOptions } from "../types";
import { OnDeviceError } from "../errors";
import { parseJsonResponse } from "../contracts";

export async function ground<T>(factPath: string, signal?: AbortSignal): Promise<T> {
  try {
    const r = await api.get<T>(factPath, { signal });
    return r.data;
  } catch {
    throw new OnDeviceError("no_model", "Could not load the data to analyze.");
  }
}

export interface GenerateStructuredSpec {
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  temperature?: number;
  topK?: number;
  signal?: AbortSignal;
}

export async function generateStructured<T = unknown>(
  provider: LLMProvider,
  spec: GenerateStructuredSpec,
): Promise<T> {
  const opts: GenerateOptions = {
    system: spec.system,
    schema: provider.tier === 1 ? spec.schema : undefined,
    temperature: spec.temperature,
    topK: spec.topK,
    signal: spec.signal,
  };
  let out = "";
  for await (const chunk of provider.generate(spec.prompt, opts)) out += chunk;
  try {
    return parseJsonResponse(out) as T;
  } catch {
    throw new OnDeviceError("schema_parse_failed", "Model returned malformed output.");
  }
}

export type Check<T> = (result: T) => boolean;

export function verify<T>(result: T, checks: Check<T>[]): T {
  for (const check of checks) {
    if (!check(result)) throw new OnDeviceError("verify_failed", "Result failed verification.");
  }
  return result;
}

/**
 * Reflexion pass. Returns the critiqued draft as a CANDIDATE only — the caller
 * accepts it solely if it passes `verify`; otherwise it keeps the original.
 */
export async function critique<T>(
  provider: LLMProvider,
  spec: GenerateStructuredSpec,
): Promise<T> {
  return generateStructured<T>(provider, spec);
}
```

(Confirm the existing API client import path during implementation; the explore map shows `frontend/src/lib/api/*` clients — reuse `frontend/src/lib/api/client.ts` or equivalent rather than raw `fetch`.)

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(llm): shared pipeline steps (ground/generateStructured/verify/critique)`.

---

## Part C — The four heavy pipelines

Each pipeline: `ground` facts → `decompose` → `generateStructured` (schema) per sub → `critique` (accept only if `verify` passes) → `verify` → `compose` (Writer/Rewriter if available, else Prompt API; optional `proofread`). All run under `withNanoSlot`, emit `onProgress`, honor `signal`.

### Task C1: `budget_recommendations` pipeline

**Files:**
- Modify: `frontend/src/lib/llm/schema.ts` (add `budget_recommendations` schema)
- Create: `frontend/src/lib/llm/pipelines/budget.ts`
- Test: `frontend/src/lib/llm/pipelines/budget.test.ts`

- [ ] **Step 1: Add the schema**

In `schema.ts` `SCHEMAS`, add:

```typescript
  budget_recommendations: {
    type: "object",
    required: ["recommendations"],
    additionalProperties: false,
    properties: {
      recommendations: {
        type: "array",
        items: {
          type: "object",
          required: ["category_id", "suggested_amount", "rationale"],
          additionalProperties: false,
          properties: {
            category_id: { type: "string" },
            suggested_amount: { type: "number" },
            rationale: { type: "string" },
          },
        },
      },
    },
  },
```

- [ ] **Step 2: Write the failing pipeline test**

```typescript
import { describe, expect, it, vi } from "vitest";
import { runBudgetPipeline } from "./budget";
import type { PipelineContext } from "./types";

vi.mock("./steps", async (orig) => {
  const mod = await (orig as () => Promise<Record<string, unknown>>)();
  return {
    ...mod,
    ground: vi.fn().mockResolvedValue({
      month: "2026-06",
      categories: [{ category_id: "c1", name: "Dining", budgeted: 200, actual: 350, remaining: -150 }],
      total_budgeted: 200, total_actual: 350,
    }),
  };
});

function ctx(out: string): PipelineContext {
  return {
    provider: { name: "nano", tier: 1, privacy: "local", async *generate() { yield out; } },
    capability: { nano: { available: true, status: "available" }, webgpu: { available: false, modelSize: "none" }, server: { available: true }, specialized: { summarizer: false, writer: false, rewriter: false, proofreader: false } },
  };
}

describe("runBudgetPipeline", () => {
  it("accepts a recommendation whose category exists and amount is in range", async () => {
    const out = '{"recommendations":[{"category_id":"c1","suggested_amount":300,"rationale":"trim dining"}]}';
    const result = await runBudgetPipeline(ctx(out));
    expect(result.recommendations[0].category_id).toBe("c1");
  });

  it("rejects a recommendation citing a non-existent category (verify_failed after retries)", async () => {
    const out = '{"recommendations":[{"category_id":"ghost","suggested_amount":300,"rationale":"x"}]}';
    await expect(runBudgetPipeline(ctx(out))).rejects.toMatchObject({ code: "verify_failed" });
  });
});
```

- [ ] **Step 3: Run → FAIL.**
- [ ] **Step 4: Implement `budget.ts`**

```typescript
import { withNanoSlot } from "../session-pool";
import { schemaForFeature } from "../schema";
import { ground, generateStructured, verify, type Check } from "./steps";
import type { PipelineContext } from "./types";

interface BudgetFacts {
  month: string;
  categories: { category_id: string; name: string; budgeted: number; actual: number; remaining: number }[];
  total_budgeted: number;
  total_actual: number;
}

export interface BudgetRecommendation {
  category_id: string;
  suggested_amount: number;
  rationale: string;
}
export interface BudgetResult {
  recommendations: BudgetRecommendation[];
}

const MAX_RETRIES = 2;

export async function runBudgetPipeline(ctx: PipelineContext): Promise<BudgetResult> {
  return withNanoSlot(async () => {
    ctx.onProgress?.({ step: "ground", label: "Checking your budget…" });
    const facts = await ground<BudgetFacts>("/ai/facts/budget", ctx.signal);
    const known = new Set(facts.categories.map((c) => c.category_id));
    const maxAmount = Math.max(facts.total_budgeted * 1.5, ...facts.categories.map((c) => c.actual)) || Number.MAX_SAFE_INTEGER;

    const checks: Check<BudgetResult>[] = [
      (r) => r.recommendations.length > 0,
      (r) => r.recommendations.every((x) => known.has(x.category_id)),
      (r) => r.recommendations.every((x) => x.suggested_amount >= 0 && x.suggested_amount <= maxAmount),
      (r) => r.recommendations.every((x) => x.rationale.trim().length > 0),
    ];

    const overBudget = facts.categories.filter((c) => c.remaining < 0);
    const system = "You are a careful budgeting assistant. Only use the provided category IDs. Return amounts in dollars.";
    const prompt =
      `Suggest adjusted monthly budget amounts for these over-budget categories.\n` +
      `Use ONLY these category_id values: ${[...known].join(", ")}.\n` +
      `Facts: ${JSON.stringify({ month: facts.month, overBudget })}`;

    ctx.onProgress?.({ step: "generate", label: "Writing recommendations…" });
    let result: BudgetResult | null = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      ctx.signal?.throwIfAborted?.();
      const draft = await generateStructured<BudgetResult>(ctx.provider, {
        system,
        prompt,
        schema: schemaForFeature("budget_recommendations")!,
        signal: ctx.signal,
      });
      try {
        result = verify(draft, checks);
        break;
      } catch {
        if (attempt === MAX_RETRIES) throw new (await import("../errors")).OnDeviceError("verify_failed", "Could not produce a valid budget.");
      }
    }
    ctx.onProgress?.({ step: "done", label: "Done" });
    return result!;
  });
}
```

- [ ] **Step 5: Run → PASS.**
- [ ] **Step 6: Commit** `feat(llm): budget_recommendations on-device pipeline`.

### Task C2: `goal_planning` pipeline

**Files:** Modify `schema.ts`; Create `frontend/src/lib/llm/pipelines/goal.ts`; Test `goal.test.ts`.

- [ ] **Step 1: Add `goal_planning` schema** (object with `plan: { goal_id, monthly_contribution, months_to_target, note }`).
- [ ] **Step 2: Write failing test** with a mocked `ground` returning one goal; assert: accepts a plan whose `goal_id` exists and `monthly_contribution >= 0` and `months_to_target` reconciles with `(target-current)/monthly` within ±1; rejects a fabricated `goal_id` and an arithmetic mismatch.
- [ ] **Step 3: Run → FAIL.**
- [ ] **Step 4: Implement `goal.ts`** mirroring `budget.ts` structure. `ground<GoalFacts>("/ai/facts/goal")`. Verifier checks: goal_id ∈ known, contribution ≥ 0, and `Math.abs(months_to_target - Math.ceil((target-current)/contribution)) <= 1` (skip when contribution is 0). Compose a short plan sentence (Writer/Rewriter optional).
- [ ] **Step 5: Run → PASS.**
- [ ] **Step 6: Commit** `feat(llm): goal_planning on-device pipeline`.

### Task C3: `free_form_qa` pipeline

**Files:** Modify `schema.ts`; Create `frontend/src/lib/llm/pipelines/qa.ts`; Test `qa.test.ts`.

- [ ] **Step 1: Add `free_form_qa` schema** (object `{ answer: string, cited_facts: string[] }`).
- [ ] **Step 2: Write failing test** with mocked `ground<ContextFacts>("/ai/facts/context")`; assert: the answer is non-empty and length-capped; every entry in `cited_facts` corresponds to a fact key/id present in the grounded context (reject hallucinated citations).
- [ ] **Step 3: Run → FAIL.**
- [ ] **Step 4: Implement `qa.ts`**. If the grounded context is large, condense it first with `summarize(ctx.provider, JSON.stringify(facts))` (Summarizer or Prompt-API fallback) before prompting. Verifier: answer length ≤ cap, `cited_facts ⊆ known fact ids`. Compose with optional `proofread`.
- [ ] **Step 5: Run → PASS.**
- [ ] **Step 6: Commit** `feat(llm): free_form_qa on-device pipeline`.

### Task C4: `financial_advice` pipeline (most conservative verifier)

**Files:** Modify `schema.ts`; Create `frontend/src/lib/llm/pipelines/advice.ts`; Test `advice.test.ts`.

- [ ] **Step 1: Add `financial_advice` schema** (object `{ advice: string, basis: string[], disclaimer: string }`).
- [ ] **Step 2: Write failing test**: assert the result always carries the fixed disclaimer string; `basis` entries map to grounded facts; advice is rejected if it contains numeric claims not present in the facts (verifier scans for `$`/number tokens and requires each to appear in the grounded facts). This is the strictest verifier per the spec's risk note.
- [ ] **Step 3: Run → FAIL.**
- [ ] **Step 4: Implement `advice.ts`** grounding on `/ai/facts/context`. Verifier: disclaimer present and unmodified (the pipeline sets it, not the model), `basis ⊆ known facts`, and a `numbersReconcile` check — extract numeric tokens from `advice` and require each to be a substring of the serialized facts. Always append the fixed disclaimer in `compose` regardless of model output. Mark the result `draft: true` for the UI.
- [ ] **Step 5: Run → PASS.**
- [ ] **Step 6: Commit** `feat(llm): financial_advice on-device pipeline with strict verifier`.

### Task C5: Wire pipelines into `useLlm` + demo mode

**Files:** Modify `frontend/src/lib/llm/useLlm.ts`, `frontend/src/lib/llm/contracts.ts`; Test `contracts.test.ts`, `useLlm` consumers.

- [ ] **Step 1: Demo results — write failing test** in `frontend/src/lib/llm/run-structured.test.ts`/`contracts` test asserting `demoStructuredResult("budget_recommendations")` (and goal/qa/advice) returns a canned object matching each pipeline's result shape.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Extend `demoStructuredResult`** in `contracts.ts` with canned results for the four heavy features.
- [ ] **Step 4: Add a `runFeature(feature, params)` entry** in `useLlm.ts` (or a sibling `usePipeline` hook) that, for the heavy four, builds a `PipelineContext` from the Nano provider + capability and calls the matching pipeline; in demo mode returns `demoStructuredResult`. Light features keep the existing `run`/`runStructuredJson` path.
- [ ] **Step 5: Run → PASS** (`npx vitest run src/lib/llm`).
- [ ] **Step 6: Commit** `feat(llm): route heavy features through on-device pipelines + demo stubs`.

### Task C6: Heavy-feature step-progress UI + unavailable empty-state

**Files:** Modify the heavy-feature components (e.g. `frontend/src/components/ai-advisor.tsx` for `free_form_qa`, the budget/goal advice surfaces); Create a shared `frontend/src/components/llm/ai-unavailable.tsx`.

- [ ] **Step 1: Write failing test** for `AiUnavailable` (renders one honest, tier-jargon-free message, `role="status"`, keyboard-focusable) and for a heavy feature showing step-progress labels + a Cancel button while running.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `AiUnavailable`** and wire `onProgress` labels + `AbortController` cancel into the heavy-feature components; non-Nano browsers render `AiUnavailable` for the heavy four (web-llm heavy deferred).
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(ui): heavy-feature step progress + shared unavailable state`.

### Task C7: Pipeline integration tests (adversarial fixtures)

**Files:** Test `frontend/src/lib/llm/pipelines/*.test.ts`.

- [ ] **Step 1: Add adversarial integration tests** per pipeline using a fake provider that returns, across retries: malformed JSON (→ `schema_parse_failed` then retry), a hallucinated category/goal id (→ `verify_failed`), an out-of-range amount (→ `verify_failed`), and finally a valid output (→ accepted). Assert the retry/verify/critique behavior.
- [ ] **Step 2: Run → confirm PASS.**
- [ ] **Step 3: Commit** `test(llm): adversarial pipeline integration coverage`.

---

## Part D — Remove the cloud (only after Parts A–C are green)

> Sequenced last so the heavy features are served by pipelines before the cloud path is deleted — no broken window.

### Task D1: Frontend feature policy → on-device only

**Files:** Modify `frontend/src/lib/llm/features.ts`; Test `features.test.ts`.

- [ ] **Step 1: Update the failing test** to assert: light five (`explain_charge`, `categorize_transaction`, `spending_summary`, `anomaly_explanation`, `fsa_review`) → `allowedTiers: [1, 2]`; heavy four → `allowedTiers: [1]`; all → `defaultTier: 1`, `minimumTier: 1`; `cloudPossible` removed; new `enabled: true` per feature (kill switch).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Update `features.ts`** accordingly (drop `cloudPossible`, add `enabled`).
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `refactor(llm): features on-device only + per-feature kill switch`.

### Task D2: Router — drop Tier 4

**Files:** Modify `frontend/src/lib/llm/router.ts`, `types.ts`, `capability.ts`; Test `router.test.ts`, `capability.test.ts`.

- [ ] **Step 1: Update failing tests** to remove all Tier-4 expectations and `cloudConsentGrants`/`needs_cloud_consent`/`preferredTierByFeature`; assert decisions are now `ready | needs_nano_setup | needs_download_consent | unavailable`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Edit `router.ts`**: remove the Tier-4 branch, the `server` factory from `RouterContext.providers`, `cloudConsentGrants`, `needs_cloud_consent`, `preferredTierByFeature`; simplify `capableTiers`. Set `Tier = 1 | 2` in `types.ts`; drop `"server"` from `ProviderName` and the `server` field from `CapabilitySnapshot` + `capability.ts`/`emptySnapshot`.
- [ ] **Step 4: Run → PASS** (`npx vitest run src/lib/llm/router.test.ts src/lib/llm/capability.test.ts`).
- [ ] **Step 5: Commit** `refactor(llm): remove Tier-4 from router/types/capability`.

### Task D3: Delete the cloud provider, PII, consent dialogs

**Files:** Delete `providers/server.ts`(+test), `pii-detect.ts`(+test), `components/llm/cloud-consent-dialog.tsx`, `components/llm/pii-warning-dialog.tsx`; Modify `useLlm.ts`, `consent.ts`, `index.ts`, `ai-feature-gate.tsx`.

- [ ] **Step 1: Delete the four files** (and their tests).
- [ ] **Step 2: Sweep importers** — grep for `server`, `makeServerProvider`, `LLMError`, `scanPrompt`, `CloudConsentDialog`, `PiiWarningDialog`, `cloudConsentGrants`, `listCloudConsent`, `grantCloudConsent` across `frontend/src`. Remove the server provider factory and cloud-consent React Query from `useLlm.ts`; remove cloud branches from `consent.ts`; drop `LLMError`/`scanPrompt` from `index.ts`; remove the `CloudConsentDialog` loop from `ai-feature-gate.tsx` (only `needs_nano_setup` + `needs_download_consent` remain).
- [ ] **Step 3: Run the whole frontend suite** `cd frontend && npx vitest run` → fix every broken import/type until green.
- [ ] **Step 4: Commit** `refactor(llm): delete cloud provider, PII scan, and cloud-consent UI`.

### Task D4: Collapse explain-charge

**Files:** Modify `frontend/src/components/llm/explain-charge.tsx`; Test `explain-charge.test.tsx`.

- [ ] **Step 1: Update failing test** — assert the component renders button → (loading) → streamed result, with no PII dialog, no 429 UI, no `fallbackToLocal`, no cold-start copy.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Rewrite the component** to ~80 lines: `gate.prepareFeature("explain_charge")` → `llm.run(...)` stream → render. Delete PII/429/tier/cold-start code.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `refactor(ui): collapse explain-charge to on-device only`.

### Task D5: Settings — delete the Cloud AI section

**Files:** Modify `frontend/src/components/llm/ai-settings-card.tsx`; Test `ai-settings-card.test.tsx`.

- [ ] **Step 1: Update failing test** — assert no "Cloud AI" section, no all-features toggle, no keep-alive re-grant; keep the global AI on/off and the Phase-1 Nano status block.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Remove the cloud section + keep-alive effect**; keep `ai_enabled` toggle + Nano/WebGPU status.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `refactor(ui): remove Cloud AI settings section`.

### Task D6: Backend — delete model plumbing + routes

**Files:** Delete `services/ai/{llm_client,circuit,cache,llm_rate_limit,household_rate_limit,log_redact,json_extract,status,insights}.py`, `services/categorization/llm.py`, `api/deps_llm.py`; Modify `routes/llm.py`, `routes/ai.py`, `routes/categorization.py`, `config.py`; Delete the matching tests.

- [ ] **Step 1: Remove the cloud generate route** — delete `POST /api/llm/cloud` from `routes/llm.py` (keep the consent CRUD routes for now; consent table is not dropped this phase, but stop the cloud generate path). Delete `circuit`/`cache`/`llm_rate_limit`/`log_redact` usages there.
- [ ] **Step 2: Trim `routes/ai.py`** — remove model-calling routes: `/insights`, `/budget-insights`, `/chat/stream`, `/advisor-turn`, `/budget-suggestions`, `/debt-plan-suggestion`, `/parse-action`, `/suggest-interest-rates`, `/status`. KEEP: `/fsa-review/candidates`, `/fsa-review/items` (GET/PATCH) (data-only). Delete `run_fsa_review` (the model batch) — FSA inference now runs client-side via the pipeline/`runBatchedStructuredJson`. Remove `require_cloud_feature`/`deps_llm` imports.
- [ ] **Step 3: Trim `routes/categorization.py`** — remove `POST /api/categorization/suggest` (server model) ; keep `/suggest/candidates`, `/apply`, `/apply-rules`. Delete `services/categorization/llm.py`.
- [ ] **Step 4: Triage mixed files** — in `debt_plan.py`/`budget.py`/`interest_rates.py`/`action.py`, delete the model-call functions (`suggest_debt_plan`, `generate_budget_suggestions` LLM tail, `suggest_interest_rates`, `parse_action_message`) but KEEP deterministic helpers (`compute_budget_facts`, debt math, `execute_parsed_action`, action tokens). KEEP `prompt_safety.py` (still used by `candidates.py`/`fsa.py`).
- [ ] **Step 5: Delete the now-unused service files** and their tests (`test_llm_circuit.py`, `test_llm_cache.py`, `test_llm_rate_limit.py`, `test_household_ai_rate_limit.py`, `test_ai_llm_parsing.py`, plus `test_advisor_turn.py` if the route is gone).
- [ ] **Step 6: Remove config** — delete `ollama_url`/`ollama_model`/`llm_backend_api_key` and any Modal warm-up from `config.py`; remove the IP-rate-limit rule for `/api/llm/cloud` in `middleware/rate_limit.py` and add/confirm a rule for `/api/ai/facts/`.
- [ ] **Step 7: Run the backend suite** `cd backend && python -m pytest tests/ -v` → fix all import errors and assert removed routes now 404 (add `test_removed_routes_404.py`).
- [ ] **Step 8: Commit** `refactor(api): delete self-hosted cloud LLM plumbing and routes`.

### Task D7: Stop writing cloud consent + remove cloud settings fields (migration)

**Files:** Modify `models/llm.py` writers, settings schema; Create an Alembic migration; Modify `.env.example`, `next.config.ts` (CSP).

- [ ] **Step 1: Stop writing consent records** — remove calls that create `LlmConsent`/`LlmAudit` rows (the cloud path is gone). **Do NOT drop the `llm_consent`/`llm_audit` tables** (deferred to Phase 3 cleanup migration). Keep `Household.ai_enabled`.
- [ ] **Step 2: Settings schema** — confirm `AiSettingsResponse`/`AiSettingsUpdate` already only expose `ai_enabled`; remove any preferred-tier/per-feature-cloud-consent fields if present.
- [ ] **Step 3: CSP + env** — in `frontend/next.config.ts`, trim any cloud-model origins from `connect-src` (keep `*.hf.co`/huggingface for web-llm weights; specialized APIs add nothing). Remove `OLLAMA_*`/Modal vars from `.env.example`/`backend/.env.example`.
- [ ] **Step 4: Migration if schema changed** — `cd backend && alembic revision --autogenerate -m "drop cloud settings fields"`; review the generated file; ensure it does **not** drop the consent tables.
- [ ] **Step 5: Run** `cd backend && alembic upgrade head && python -m pytest tests/ -v`.
- [ ] **Step 6: Commit** `chore: stop writing cloud consent; trim cloud config/CSP`.

---

## Task E: Phase 2 full verification gate

- [ ] **Step 1:** From repo root run `./scripts/ci-local.sh` (backend pytest, frontend lint/tests/fallow, Vercel build gate). Fix all failures.
- [ ] **Step 2:** Grep sweep for stragglers: `rg -n "Tier 4|tier: 4|server provider|cloudConsent|ollama|OLLAMA|Modal|pii|cloud_generate" frontend/src backend/app` → resolve every hit.
- [ ] **Step 3:** Manual smoke on Chrome desktop: each heavy feature runs a pipeline with step-progress + cancel; non-Nano browser shows `AiUnavailable` for the heavy four and web-llm for the light five; Settings has no Cloud section.
- [ ] **Step 4:** Commit any fixes. Phase 2 done when `ci-local.sh` is green.

---

## Self-Review (run after implementing)

1. **Spec coverage (Phase 2):** fact endpoints + authz ✓ (A1–A4); pipeline scaffolding/errors/session-pool/steps ✓ (B1–B3); four heavy pipelines with verifiers + specialized APIs + demo + progress UI ✓ (C1–C7); Tier-4 removal frontend+backend, PII/consent deletion, explain-charge collapse, settings cleanup, consent-table preserved, CSP/config trim, kill switches ✓ (D1–D7).
2. **Type consistency:** `PipelineContext` (B2) is consumed by every pipeline (C1–C4) and `useLlm.runFeature` (C5). `generateStructured`/`verify`/`ground` signatures (B3) are used unchanged in C1–C4. Fact response shapes in `schemas/facts.py` (A1–A3) match the `*Facts` interfaces in `budget.ts`/`goal.ts`/`qa.ts`/`advice.ts`. `OnDeviceError` codes (B1) are the only error type pipelines throw.
3. **No placeholders:** scaffolding + budget pipeline ship full code; goal/qa/advice specify their exact schema fields and verifier checks rather than deferring; deletion tasks enumerate exact files and the grep sweep that proves completeness.
