# Parallel Execution Plan — Deferred AI Features

> **For the orchestrator:** This re-slices the four feature plans into **waves of file-disjoint subagents** so they can run concurrently without merge conflicts. Dispatch all agents in a wave in **one message** (parallel); gate between waves. Use `superpowers:dispatching-parallel-agents`. Give parallel agents `isolation: "worktree"`.

**Source plans (read these for the actual code/steps):**
- P1 [finish-ai-reliability-branch](2026-06-29-finish-ai-reliability-branch.md)
- P2 [wire-goal-planning-and-spending-summary](2026-06-29-wire-goal-planning-and-spending-summary.md)
- P3 [anomaly-detection-and-explanation](2026-06-29-anomaly-detection-and-explanation.md)
- P4 [debt-rate-suggestions-with-apply](2026-06-29-debt-rate-suggestions-with-apply.md)
- Spec [deferred-ai-features-design](../specs/2026-06-29-deferred-ai-features-design.md)

---

## Why waves (the conflict matrix)

The plans are decomposed by *feature*; several **files are edited by multiple plans**. Dispatching one agent per plan in parallel would collide on these:

| Shared file | Edited by |
|---|---|
| `frontend/src/lib/llm/features.ts` (+ test) | P2, P3, P4 |
| `frontend/src/lib/llm/contracts.ts` | P2, P3, P4 |
| `frontend/src/lib/llm/useLlm.ts` | P2, P4 |
| `frontend/src/hooks/use-ai-pipeline-run.ts` | P2, P4 |
| `frontend/src/app/(app)/plan/page.tsx` | P2, P4 |
| `backend/app/api/routes/facts.py` | P3, P4 |
| `backend/app/schemas/facts.py` | P3, P4 |
| `backend/tests/test_facts_endpoints.py` | P3, P4 |

So: a single serialized agent owns all shared "registry/wiring" files; everything else is split into disjoint lanes. Type/registry symbols are created **first** so each parallel agent compiles in isolation.

## Wave graph (max concurrency = 5)

```
A  [1, blocking]   Foundation: P1 + all cross-cutting types/registry/demo
   │
B  [5, PARALLEL]   Feature logic on disjoint new/owned files
   │   B1 goal.ts   B2 rates.ts   B3 anomaly.py   B4 debt_facts.py   B5 accounts.py
   │
C  [1, blocking]   Integration: shared dispatch + fact routes + route tests + CI
   │
D  [3, PARALLEL]   UI surfaces on disjoint files
   │   D1 dashboard   D2 plan/page.tsx   D3 transactions + ai.ts
   │
E  [1, blocking]   Full CI + integration review + commit
```

---

## Shared interface contracts

Every isolated agent must target these exact signatures so the pieces integrate. Wave A creates the type-level symbols; Waves B/C/D depend on them.

```ts
// frontend types (Wave A creates the FeatureId/params; B implements fns)
type FeatureId = … | "debt_rate_suggestions";
interface RunFeatureParams { question?: string; goalId?: string; }

runGoalPipeline(ctx: PipelineContext, params?: { goalId?: string }): Promise<GoalResult>; // B1
runRatesPipeline(ctx: PipelineContext): Promise<RateResult>;                              // B2
interface RateSuggestion { account_id: string; suggested_apr: number; suggested_min_payment: number; reasoning: string; }
interface RateResult { suggestions: RateSuggestion[]; }
interface DebtFact { account_id: string; name: string; type: string; balance: number; has_apr: boolean; has_min_payment: boolean; current_apr: number | null; current_min_payment: number | null; }
interface DebtFacts { accounts: DebtFact[]; }

demoStreamText(feature: FeatureId): string[]; // Wave A helper in contracts.ts; runStream emits it in demo mode
aiApi.getAnomalies(): Promise<{ anomalies: AnomalyFact[] }>; // D3 (type added Wave A or D3)
```

```python
# backend (Wave A creates pydantic models; B implements services; C adds routes)
class AnomalyFact(BaseModel): transaction_id: str; category: str; amount: float; category_avg: float; ratio: float; date: str; payee: str | None
class AnomalyFacts(BaseModel): anomalies: list[AnomalyFact]
class DebtAccountFact(BaseModel): account_id: str; name: str; type: str; balance: float; has_apr: bool; has_min_payment: bool; current_apr: float | None; current_min_payment: float | None
class DebtFacts(BaseModel): accounts: list[DebtAccountFact]

async compute_anomaly_facts(db, household_id) -> dict  # shaped for AnomalyFacts   (B3)
async compute_debt_facts(db, household_id) -> dict      # shaped for DebtFacts      (B4)
```

---

## Wave A — Foundation (1 agent, main tree, blocking)

**Agent prompt:**

> You are completing the AI reliability branch and laying the type foundation for four AI features. Work in the main working tree on `fix/ai-reliability-and-progress-ux`.
>
> **Do P1 in full:** follow [finish-ai-reliability-branch](2026-06-29-finish-ai-reliability-branch.md) Tasks 1–4 (migrate `ai-advisor.tsx` to `AiRunStatus`, fix the `llm-timeout.ts` Ollama comment, remove dead cloud branches from `local-ai-setup-wizard.tsx`, run `./scripts/ci-local.sh`). Do **not** run the final human commit step — stage only.
>
> **Then add these cross-cutting type/registry changes** (so later parallel agents compile in isolation), per the cited plan tasks — but do NOT implement pipeline/service bodies or dispatch wiring:
> - `frontend/src/lib/llm/features.ts` (+ `features.test.ts`): add `"debt_rate_suggestions"` to `FeatureId` and a heavy policy (P4 Task 5 Step 1); set `enabled: true` for `goal_planning`, `spending_summary`, `anomaly_explanation`, `debt_rate_suggestions`; update the disabled-set tests (P2 Task 3 Step 1, P3 Task 6 Step 1).
> - `frontend/src/lib/llm/schema.ts`: add the `debt_rate_suggestions` schema (P4 Task 5 Step 2).
> - `frontend/src/lib/llm/useLlm.ts`: add `goalId?: string` to `RunFeatureParams` (P2 Task 2 Step 1) and `"debt_rate_suggestions"` to `HEAVY_FEATURES` (P4 Task 5 Step 3). Do NOT add dispatch `case` bodies yet.
> - `frontend/src/hooks/use-ai-pipeline-run.ts`: add `"debt_rate_suggestions"` to its `HEAVY_FEATURES`, and add the `isDemoMode` short-circuit to `runStream` calling `demoStreamText(feature)` (P2 Task 6 Step 2).
> - `frontend/src/lib/llm/contracts.ts`: add `demoStructuredResult` entries for `goal_planning` and `debt_rate_suggestions`, and a `demoStreamText(feature)` helper with canned strings for `spending_summary` and `anomaly_explanation` (P2 Task 3 Step 4, P2 Task 6, P4 Task 5 Step 4).
> - `backend/app/schemas/facts.py`: add `AnomalyFact`/`AnomalyFacts` and `DebtAccountFact`/`DebtFacts` exactly per the Shared Interface Contracts (P3 Task 1, P4 Task 1).
>
> **Constraints:** Do NOT create pipeline files, service files, fact routes, or UI. Do NOT add `useLlm` dispatch cases. Match the Shared Interface Contracts verbatim.
> **Verify:** `cd frontend && npm run typecheck && npm run test:run -- src/lib/llm` and `cd backend && python -c "from app.schemas.facts import AnomalyFacts, DebtFacts"`. Then `./scripts/ci-local.sh`.
> **Return:** list of files changed and confirmation the contracts match.

**Gate:** CI green; types exist; demo mode works. Then dispatch Wave B.

---

## Wave B — Feature logic (5 parallel agents, each `isolation: "worktree"`)

Each agent owns only its listed files and must not touch any shared/registry file (those were Wave A or are Wave C).

**B1 — goal pipeline targeting** (general-purpose, worktree)
> Implement [P2](2026-06-29-wire-goal-planning-and-spending-summary.md) **Task 1** only. Own ONLY `frontend/src/lib/llm/pipelines/goal.ts` and `goal.test.ts`. Produce `runGoalPipeline(ctx, params?: { goalId?: string })` per the Shared Interface Contracts; add the `plan.goal_id === goalId` verifier check. Do NOT edit `useLlm.ts` (Wave C wires dispatch). Verify: `cd frontend && npm run test:run -- src/lib/llm/pipelines/goal.test.ts`. Return a summary.

**B2 — debt-rate pipeline** (general-purpose, worktree)
> Implement [P4](2026-06-29-debt-rate-suggestions-with-apply.md) **Task 6** (pipeline only; skip the Task 6 Step 4 `useLlm` dispatch edit — that is Wave C). Own ONLY `frontend/src/lib/llm/pipelines/rates.ts` and `rates.test.ts`. Produce `runRatesPipeline(ctx)` and the `RateResult`/`RateSuggestion`/`DebtFacts`/`DebtFact` types per the Shared Interface Contracts; verifier bounds APR ≤ 0.35 and min-payment ≤ balance and rejects unknown account ids. `schemaForFeature("debt_rate_suggestions")` already exists (Wave A). Verify: `cd frontend && npm run test:run -- src/lib/llm/pipelines/rates.test.ts`. Return a summary.

**B3 — anomaly detection service** (general-purpose, worktree)
> Implement [P3](2026-06-29-anomaly-detection-and-explanation.md) **Task 2** only. Own ONLY `backend/app/services/ai/anomaly.py` (new) and a NEW test file `backend/tests/test_anomaly_facts.py` (do NOT edit `test_facts_endpoints.py` — that's Wave C). Produce `compute_anomaly_facts(db, household_id)` shaped for `AnomalyFacts` (already in `schemas/facts.py` from Wave A). Use the proven per-month loop aggregation style from `app/services/ai/budget.py:compute_spending_patterns`; constants `N=3.0`, `MIN_HISTORY_COUNT=3`, `MIN_AMOUNT=25`; expense-only; guard divide-by-zero. Reuse the seeding helpers in `backend/tests/test_facts_endpoints.py` (`_seed_budget_fixture`-style) and the `session` fixture. Verify: `cd backend && pytest tests/test_anomaly_facts.py -v`. Return a summary.

**B4 — debt facts service** (general-purpose, worktree)
> Implement [P4](2026-06-29-debt-rate-suggestions-with-apply.md) **Task 2** only. Own ONLY `backend/app/services/ai/debt_facts.py` (new) and a NEW test file `backend/tests/test_debt_facts.py`. Produce `compute_debt_facts(db, household_id)` shaped for `DebtFacts`. **Grep `def list_debt_accounts` in `backend/app/api/routes/debt.py` and copy its liability/debt `.where(...)` predicate** so the two stay consistent. Reuse `test_facts_endpoints.py` seeding helpers + the `session` fixture. Verify: `cd backend && pytest tests/test_debt_facts.py -v`. Return a summary.

**B5 — account update validation** (general-purpose, worktree)
> Implement [P4](2026-06-29-debt-rate-suggestions-with-apply.md) **Task 4** only. Own ONLY `backend/app/api/routes/accounts.py` and its update schema (`backend/app/schemas/account.py` `AccountUpdate`) plus a NEW test `backend/tests/test_account_update_validation.py`. Add validators: `interest_rate` ∈ [0,1], `minimum_payment` ≥ 0 → HTTP 422. Confirm the route's existing auth dependency scopes to `household_id`. Reuse `test_facts_endpoints.py` helpers + `client`/`headers`. Verify: `cd backend && pytest tests/test_account_update_validation.py -v`. Return a summary.

**Gate:** merge all five worktrees (file-disjoint → clean). Run `./scripts/ci-local.sh`. Then Wave C.

---

## Wave C — Integration wiring (1 agent, main tree, blocking)

**Agent prompt:**
> Wire the now-existing pipelines/services into the shared files. Own: `frontend/src/lib/llm/useLlm.ts`, `backend/app/api/routes/facts.py`, `backend/tests/test_facts_endpoints.py`.
> - `useLlm.ts` `runFeature` switch: change `goal_planning` case to `runGoalPipeline(pctx, { goalId: params?.goalId })` (P2 Task 2 Step 2) and add `case "debt_rate_suggestions": return runRatesPipeline(pctx);` with the import (P4 Task 6 Step 4).
> - `facts.py`: add `GET /anomalies` (P3 Task 3 Step 3) and `GET /debt` (P4 Task 3 Step 2) routes with their imports.
> - `test_facts_endpoints.py`: add the route auth+shape tests for both (P3 Task 3, P4 Task 3) using the existing `client`/`headers`/`_seed_*` conventions.
> **Verify:** `./scripts/ci-local.sh`. **Return:** summary + confirmation all fact endpoints respond and heavy dispatch resolves.

**Gate:** full CI green. Then Wave D.

---

## Wave D — UI surfaces (3 parallel agents, each `isolation: "worktree"`)

Disjoint files. **Each agent must add a Vitest render/disabled-state test** for its surface (subagents can't do manual QA) and set `aria-busy` on AI trigger buttons.

**D1 — Dashboard spending summary** (general-purpose, worktree)
> Implement [P2](2026-06-29-wire-goal-planning-and-spending-summary.md) **Task 6 Steps 1, 3** (the demo short-circuit in Step 2 was done in Wave A). Own ONLY `frontend/src/app/(app)/page.tsx` and a new `page` render test. Build `SpendingSummaryCard`: render deterministic top movers from `aiApi.getSpendingPatterns`; stream the narrative via `useAiPipelineRun("spending_summary").runStream`. Add a render test (button disabled when no movers; `aria-busy` while running). Verify: `npm run typecheck && npm run test:run -- src/app`. Return summary.

**D2 — Plan page (goals AI + debt rates)** (general-purpose, worktree)
> Implement [P2](2026-06-29-wire-goal-planning-and-spending-summary.md) **Tasks 4 & 5** and [P4](2026-06-29-debt-rate-suggestions-with-apply.md) **Task 7**. Own ONLY `frontend/src/app/(app)/plan/page.tsx` (+ a render test). Add per-goal "AI plan" + "Plan my goals" to `GoalsTab`/`GoalCard`, and replace the free-text rate note with the structured suggestion + per-account/Accept-all apply (missing fields only, via `accountsApi.update`). Add render tests; `aria-busy` on triggers. Verify: `npm run typecheck && npm run test:run -- src/app`. Return summary.

**D3 — Transactions anomaly explain** (general-purpose, worktree)
> Implement [P3](2026-06-29-anomaly-detection-and-explanation.md) **Tasks 4 & 5**. Own ONLY `frontend/src/app/(app)/transactions/page.tsx` and `frontend/src/lib/api/ai.ts` (+ a render test). Add `aiApi.getAnomalies()` + `AnomalyFact` type; show an "Unusual" badge + `AnomalyExplain` (streaming) on flagged rows. Add a render test; `aria-busy` on the trigger. Verify: `npm run typecheck && npm run test:run -- src/app`. Return summary.

**Gate:** merge three worktrees (disjoint → clean). `./scripts/ci-local.sh`.

---

## Wave E — Final (1 agent, blocking)

> Run `./scripts/ci-local.sh`; security re-grep (P4 Task 8 Step 2); review the full diff; present the commit grouping (P1 Task 4) for the human to trigger. Do NOT auto-commit.

---

## Dispatch & verification mechanics

- **One message per wave** = parallel; gate (`ci-local.sh` + read each agent summary) before the next wave.
- **Worktrees:** parallel agents (B*, D*) use `isolation: "worktree"`; their files are disjoint so merges are clean. A/C/E run in the main tree.
- **Each agent prompt is self-contained:** scope, the plan/task to read, its exact file list, the Shared Interface Contracts, "do not touch files outside your list," and "return a change summary." Never let an agent inherit this session's context.
- **Spot-check** agent summaries for systematic errors (e.g., an agent editing a shared file it shouldn't).

## Alternative: worktree-per-plan (simpler, with merge cost)

Dispatch P1→commit, then P2/P3/P4 as one agent each in separate worktrees. Simpler to fire, but every shared registry file (`features.ts`, `contracts.ts`, `useLlm.ts`, `use-ai-pipeline-run.ts`, `facts.py`, `schemas/facts.py`, `test_facts_endpoints.py`, `plan/page.tsx`) produces a merge conflict at integration. Conflicts are mostly additive (distinct keys/cases) and resolvable, but the wave approach above avoids them entirely. Choose this only if orchestrating 4 agents is preferable to orchestrating the wave gates.
