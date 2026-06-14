# Nano-only AI — Phase 3: Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the on-device pipelines fast and trustworthy: targeted `clone()` parallelism, self-consistency voting on discrete sub-decisions, input-hash caching, an eval harness that gates keep/cut decisions on weak features, and the deferred consent-table drop migration.

**Architecture:** Optimize the Phase 2 pipelines without changing their public shape. Parallelism uses `session.clone()` from a bounded pool. Self-consistency runs N samples at raised temperature and reconciles only discrete (extraction/classification) sub-decisions, never prose. Caching memoizes pipeline results by a hash of the grounded facts + feature. The eval harness asserts verifier properties over fixtures.

**Tech Stack:** Next.js/React/TypeScript, Vitest, Chrome `LanguageModel` (`clone()`, sampling params), FastAPI/Alembic/pytest.

**Spec:** `docs/superpowers/specs/2026-06-14-nano-only-ai-design.md` (Phase 3).

**Prerequisite:** Phase 2 merged (pipelines live, cloud removed, `withNanoSlot` cap = 1).

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `frontend/src/lib/llm/providers/nano.ts` | Add `cloneSession()` for parallel sub-calls. | Modify |
| `frontend/src/lib/llm/session-pool.ts` | Raise cap; `withNanoSlots(n)` + `mapWithClones`. | Modify |
| `frontend/src/lib/llm/pipelines/self-consistency.ts` | `selfConsistency()` voting over discrete sub-decisions. | Create |
| `frontend/src/lib/llm/pipelines/cache.ts` | Input-hash memoization for pipeline results. | Create |
| `frontend/src/lib/llm/pipelines/{budget,goal,qa,advice}.ts` | Adopt parallelism / self-consistency / cache where it helps. | Modify |
| `frontend/src/lib/llm/eval/fixtures/*.json` | Representative grounded inputs per heavy feature. | Create |
| `frontend/src/lib/llm/eval/harness.test.ts` | Verifier-property assertions over fixtures. | Create |
| `backend/alembic/versions/*_drop_llm_consent_tables.py` | Deferred destructive drop of `llm_consent`/`llm_audit`. | Create |

---

## Task 1: Nano `cloneSession()` + bounded clone pool

**Files:**
- Modify: `frontend/src/lib/llm/providers/nano.ts`
- Modify: `frontend/src/lib/llm/session-pool.ts`
- Test: `frontend/src/lib/llm/session-pool.test.ts`

Concurrent calls on a single Nano session are unsupported; parallelism requires `session.clone()`. The pool caps concurrent clones (resource-bounded).

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it, vi } from "vitest";
import { mapWithClones } from "./session-pool";

describe("mapWithClones", () => {
  it("runs at most `cap` workers concurrently and preserves order", async () => {
    let active = 0;
    let peak = 0;
    const worker = vi.fn(async (n: number) => {
      active++; peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return n * 2;
    });
    const out = await mapWithClones([1, 2, 3, 4, 5], 2, worker);
    expect(out).toEqual([2, 4, 6, 8, 10]);
    expect(peak).toBeLessThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run → FAIL** (`mapWithClones` not exported).

- [ ] **Step 3: Implement `mapWithClones` in `session-pool.ts`**

```typescript
/** Map with a bounded concurrency cap, preserving input order. */
export async function mapWithClones<T, R>(
  items: T[],
  cap: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(cap, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}
```

- [ ] **Step 4: Add `cloneSession()` to `nano.ts`**

Expose a method that calls the underlying `session.clone()` (the Chrome API) so a worker can own an independent session:

```typescript
// In NanoProvider, alongside generate():
async cloneSession(opts: GenerateOptions = {}): Promise<LLMProvider> {
  const base = await ensureSession(opts);
  const cloned = (base as unknown as { clone?: () => Promise<NanoSession> }).clone
    ? await (base as unknown as { clone: () => Promise<NanoSession> }).clone()
    : base;
  return {
    name: "nano", tier: 1, privacy: "local",
    async *generate(prompt: string, o: GenerateOptions = {}) {
      yield* cloned.promptStreaming(prompt, {
        signal: o.signal,
        responseConstraint: o.schema,
        omitResponseConstraintInput: o.schema ? true : undefined,
      });
    },
  };
}
```

Add a test that `cloneSession()` returns a provider whose `generate` yields independently (mock `clone`).

- [ ] **Step 5: Run → PASS** (`npx vitest run src/lib/llm/session-pool.test.ts src/lib/llm/providers/nano.test.ts`).
- [ ] **Step 6: Commit** `feat(llm): Nano session clone + bounded clone pool`.

---

## Task 2: Apply parallelism to the decompose step (where latency demands)

**Files:** Modify `frontend/src/lib/llm/pipelines/budget.ts` (and goal/qa where decomposition fans out); Test the existing pipeline tests + a new latency-shape test.

Only parallelize features whose decomposition produces independent sub-prompts (e.g. budget: one per over-budget category). Keep sequential where there is a single pass.

- [ ] **Step 1: Write the failing test** asserting that when `budget` facts contain multiple over-budget categories, sub-generations run via `mapWithClones` (mock it; assert it was called with the category list and the per-feature cap).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Refactor `budget.ts`** to decompose into per-category sub-prompts and run them with `mapWithClones(categories, CAP, …)` using `provider.cloneSession()` per worker; merge results, then run the existing verifier on the merged set. Default `CAP = 3`.
- [ ] **Step 4: Run → PASS** (all budget tests including Phase 2 adversarial cases still green).
- [ ] **Step 5: Commit** `perf(llm): parallel decomposition for budget pipeline`.

---

## Task 3: Self-consistency on discrete sub-decisions

**Files:** Create `frontend/src/lib/llm/pipelines/self-consistency.ts`; Test `self-consistency.test.ts`; Modify the pipeline(s) with discrete extraction/classification sub-decisions.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { majorityVote } from "./self-consistency";

describe("majorityVote", () => {
  it("returns the most common discrete value", () => {
    expect(majorityVote(["a", "b", "a", "a", "b"])).toBe("a");
  });
  it("breaks ties deterministically by first occurrence", () => {
    expect(majorityVote(["b", "a", "a", "b"])).toBe("b");
  });
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `self-consistency.ts`**

```typescript
import type { LLMProvider } from "../types";
import { mapWithClones } from "../session-pool";
import { generateStructured, type GenerateStructuredSpec } from "./steps";

export function majorityVote<T extends string | number>(samples: T[]): T {
  const counts = new Map<T, number>();
  for (const s of samples) counts.set(s, (counts.get(s) ?? 0) + 1);
  let best = samples[0];
  let bestCount = -1;
  for (const s of samples) {
    const c = counts.get(s)!;
    if (c > bestCount) { best = s; bestCount = c; } // first-occurrence tie-break
  }
  return best;
}

/**
 * Run N samples at RAISED temperature and vote. Reconciles ONLY a discrete
 * sub-decision extracted by `pick` — never prose.
 */
export async function selfConsistency<T extends string | number>(
  provider: LLMProvider,
  spec: GenerateStructuredSpec,
  n: number,
  pick: (raw: unknown) => T,
  opts: { temperature?: number; topK?: number; cap?: number } = {},
): Promise<T> {
  const temperature = opts.temperature ?? 0.8;
  const topK = opts.topK ?? 40;
  const samples = await mapWithClones(
    Array.from({ length: n }, (_, i) => i),
    opts.cap ?? Math.min(n, 3),
    async () => pick(await generateStructured(provider, { ...spec, temperature, topK })),
  );
  return majorityVote(samples);
}
```

- [ ] **Step 4: Apply to a discrete sub-decision** — e.g. in `categorize`/`fsa` confidence labels or a budget category classification: replace the single low-temp call for that discrete field with `selfConsistency(provider, spec, 5, pickField)`. Keep prose generation single-pass.
- [ ] **Step 5: Run → PASS** (`npx vitest run src/lib/llm/pipelines`).
- [ ] **Step 6: Commit** `feat(llm): self-consistency voting for discrete sub-decisions`.

---

## Task 4: Input-hash result caching

**Files:** Create `frontend/src/lib/llm/pipelines/cache.ts`; Test `cache.test.ts`; Modify pipelines to wrap with the cache.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it, vi } from "vitest";
import { withInputCache, _clearPipelineCache } from "./cache";

describe("withInputCache", () => {
  it("returns the cached result for the same feature+facts hash", async () => {
    _clearPipelineCache();
    const compute = vi.fn().mockResolvedValue({ ok: 1 });
    const facts = { a: 1 };
    const r1 = await withInputCache("budget_recommendations", facts, compute);
    const r2 = await withInputCache("budget_recommendations", facts, compute);
    expect(r1).toBe(r2);
    expect(compute).toHaveBeenCalledTimes(1);
  });
  it("recomputes when facts change", async () => {
    _clearPipelineCache();
    const compute = vi.fn().mockImplementation(async () => ({ v: Math.random() }));
    await withInputCache("budget_recommendations", { a: 1 }, compute);
    await withInputCache("budget_recommendations", { a: 2 }, compute);
    expect(compute).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `cache.ts`** (in-memory, per-session; hash via a stable stringify + a small FNV-1a so it is dependency-free):

```typescript
import type { FeatureId } from "../features";

const store = new Map<string, unknown>();

function hash(obj: unknown): string {
  const s = JSON.stringify(obj);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

export async function withInputCache<T>(feature: FeatureId, facts: unknown, compute: () => Promise<T>): Promise<T> {
  const key = `${feature}:${hash(facts)}`;
  if (store.has(key)) return store.get(key) as T;
  const value = await compute();
  store.set(key, value);
  return value;
}

export function _clearPipelineCache(): void {
  store.clear();
}
```

- [ ] **Step 4: Wrap each pipeline** — after `ground`, wrap the generate→verify→compose body in `withInputCache(feature, facts, () => …)`. (Caching after grounding means identical facts skip the model.)
- [ ] **Step 5: Run → PASS.**
- [ ] **Step 6: Commit** `perf(llm): input-hash caching for pipeline results`.

---

## Task 5: Eval harness (gates keep/cut)

**Files:** Create `frontend/src/lib/llm/eval/fixtures/{budget,goal,qa,advice}.json`, `frontend/src/lib/llm/eval/harness.test.ts`.

This is a regression net for the verifiers, not a model benchmark. A handful of representative grounded inputs per heavy feature, run through each pipeline with a scripted/fake provider, asserting the verifier properties (numbers reconcile, references real, amounts in range, schema valid).

- [ ] **Step 1: Create fixtures** — for each heavy feature, 3–5 JSON files each with `{ facts, candidateOutputs: { good, hallucinatedRef, outOfRange, malformed } }`.
- [ ] **Step 2: Write the harness test**

```typescript
import { describe, expect, it } from "vitest";
import budgetFixtures from "./fixtures/budget.json";
import { runBudgetPipeline } from "../pipelines/budget";
// ...import the other pipelines + fixtures...
import type { PipelineContext } from "../pipelines/types";

function ctxReturning(out: string, facts: unknown): PipelineContext {
  // fake provider yields `out`; mock ground to return `facts` (vi.mock at top of file)
  return { provider: { name: "nano", tier: 1, privacy: "local", async *generate() { yield out; } }, capability: {} as never };
}

describe("budget eval fixtures", () => {
  for (const fx of budgetFixtures as { facts: unknown; candidateOutputs: Record<string, string> }[]) {
    it("accepts the good output and rejects adversarial ones", async () => {
      await expect(runBudgetPipeline(ctxReturning(fx.candidateOutputs.good, fx.facts))).resolves.toBeDefined();
      await expect(runBudgetPipeline(ctxReturning(fx.candidateOutputs.hallucinatedRef, fx.facts))).rejects.toMatchObject({ code: "verify_failed" });
      await expect(runBudgetPipeline(ctxReturning(fx.candidateOutputs.outOfRange, fx.facts))).rejects.toMatchObject({ code: "verify_failed" });
    });
  }
});
```

- [ ] **Step 3: Run → confirm PASS** for all four features.
- [ ] **Step 4: Document the keep/cut gate** — add a short `frontend/src/lib/llm/eval/README.md` describing how to add fixtures and that `financial_advice` is the cut candidate if its verifier can't keep false-positives near zero.
- [ ] **Step 5: Commit** `test(llm): fixture-based eval harness for heavy pipelines`.

---

## Task 6: Deferred consent-table drop migration

**Files:** Create an Alembic migration; Modify `backend/app/models/llm.py` (remove models) and any remaining importers; Test.

> Only after confirming no audit-retention requirement needs the rows (per the spec's note). This is the destructive drop intentionally deferred from Phase 2.

- [ ] **Step 1: Confirm no readers remain** — `rg -n "LlmConsent|LlmAudit|llm_consent|llm_audit" backend/app` should show only the model definitions + the `me.py` export/delete references. Decide with the maintainer whether the export must keep returning historical rows; if not, proceed.
- [ ] **Step 2: Write/adjust the failing test** — `test_me_export.py` should no longer expect `llm_consent`/`llm_audit` keys; update it.
- [ ] **Step 3: Generate the migration** — `cd backend && alembic revision --autogenerate -m "drop llm_consent and llm_audit tables"`. Review the generated `upgrade()`/`downgrade()`; ensure `downgrade()` recreates the tables.
- [ ] **Step 4: Remove the models** — delete `LlmConsent`/`LlmAudit` from `models/llm.py` and the `me.py` export/delete references; delete `services/ai/consent.py`/`audit.py`/`audit_retention.py` if now unused (grep to confirm).
- [ ] **Step 5: Run** `cd backend && alembic upgrade head && python -m pytest tests/ -v`.
- [ ] **Step 6: Commit** `chore(db): drop deferred llm_consent/llm_audit tables`.

---

## Task 7: Phase 3 verification gate

- [ ] **Step 1:** From repo root run `./scripts/ci-local.sh`; fix all failures.
- [ ] **Step 2:** Manual latency smoke on Chrome desktop — confirm the budget pipeline is visibly faster with parallel decomposition and step-progress still renders; confirm cached re-runs return instantly.
- [ ] **Step 3:** Commit any fixes. Phase 3 done when `ci-local.sh` is green and the eval harness passes.

---

## Self-Review (run after implementing)

1. **Spec coverage (Phase 3):** `clone()` parallelism where latency demands ✓ (Tasks 1–2); self-consistency on discrete sub-decisions only ✓ (Task 3); input-hash caching ✓ (Task 4); quality measurement + keep/cut eval harness ✓ (Task 5); deferred consent-table drop ✓ (Task 6). (Specialized Summarizer/Writer/Rewriter/Proofreader were pulled into v1/Phase 2 per D7 — not in this phase.)
2. **Type consistency:** `mapWithClones(items, cap, worker)` (Task 1) is used identically in parallel decomposition (Task 2) and `selfConsistency` (Task 3). `GenerateStructuredSpec` (Phase 2 `steps.ts`) is reused by `selfConsistency`. `withInputCache(feature, facts, compute)` (Task 4) keys on the same `FeatureId` union. `majorityVote` operates only on `string | number` (discrete), never prose.
3. **No placeholders:** every optimization task ships real code; the eval harness specifies the fixture shape and the four adversarial cases rather than deferring them.
