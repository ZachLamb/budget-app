# Deferred AI Features — Design

**Status:** Approved design (2026-06-29). Source: brainstorming session continuing the
`fix/ai-reliability-and-progress-ux` branch.

## Context & motivation

The `fix/ai-reliability-and-progress-ux` branch (uncommitted, 40 targeted tests passing)
implemented the AI reliability + progress-UX plan
([2026-06-28-ai-features-reliability-and-progress-ux.md](../plans/2026-06-28-ai-features-reliability-and-progress-ux.md)).
That plan deliberately **deferred** several items and left three features disabled in the
registry (`goal_planning`, `spending_summary`, `anomaly_explanation`) "until UI exists."

This design covers that deferred work: finishing the branch, and wiring the deferred
features into real user-facing surfaces. It builds on the now-shared infrastructure:
`useAiPipelineRun` ([hook](../../../frontend/src/hooks/use-ai-pipeline-run.ts)) and
`AiRunStatus` ([component](../../../frontend/src/components/llm/ai-run-status.tsx)).

## Goals

- Complete the reliability branch so it is commit/ship-ready.
- Surface `goal_planning` (pipeline already built) in the UI.
- Add a light `spending_summary` to the Dashboard.
- Build deterministic anomaly detection + `anomaly_explanation`.
- Rebuild structured per-account debt-rate suggestions with an explicit apply step.

## Non-goals

- Playwright e2e harness (separately deferred; not in this scope).
- Re-architecting the pipeline / gate / hook layer (reuse as-is).
- A statistical/ML anomaly subsystem (we build lightweight deterministic detection only).
- A real external APR data source for debt rates (none exists; suggestions are AI estimates,
  guard-railed — see WS5).

## Shared architecture (locked, reused)

- **Heavy features** dispatch via `useLlm.runFeature(feature, args)` →
  `pipelines/*` (`ground → generate → verify`), **Nano-only** (Tier 1). Verifier is the
  decider: LLM output is rejected unless it reconciles with grounded facts.
  See [useLlm.ts](../../../frontend/src/lib/llm/useLlm.ts) `HEAVY_FEATURES`.
- **Light features** come in two dispatch styles, both Tier 1/2:
  - *Structured JSON* via `runStructuredJson(feature, ctx, opts)`
    ([run-structured.ts](../../../frontend/src/lib/llm/run-structured.ts)) — used by
    `categorize_transaction` / `fsa_review`. Note: `ctx` is the `RouterContext` (tier/gate
    decision), **not** facts; the caller embeds grounded facts into `opts.prompt`. There is
    **no `verify` step** on this path (only `parseForFeature` parsing) — caller/parse-side
    validation is required if model values must be trusted.
  - *Streaming text* via `llm.run(feature, prompt, opts)` /
    `useAiPipelineRun.runStream` — used by `explain_charge`. Best fit for pure-narrative
    outputs where the authoritative numbers are rendered deterministically from facts and the
    model only supplies prose (treated as untrusted text).
- **Grounded fact endpoints** are model-free deterministic aggregates under
  `/api/ai/facts/*` ([facts.py](../../../backend/app/api/routes/facts.py)), gated by
  `_require_ai_enabled` ([ai.py](../../../backend/app/api/routes/ai.py)) and the existing
  `/api/ai/` IP rate-limit middleware.
- **UI:** new surfaces reuse `AiRunStatus` for progress/cancel and
  `MaybeAiErrorWithSettings` for failures. Heavy surfaces use `useAiPipelineRun`.
- **Schemas** live in `SCHEMAS: Partial<Record<FeatureId, …>>`
  ([schema.ts](../../../frontend/src/lib/llm/schema.ts)); `schemaForFeature(id)`.
- **Demo mode:** every wired feature must return a canned result via
  `demoStructuredResult` / the heavy-pipeline demo path
  ([contracts.ts](../../../frontend/src/lib/llm/contracts.ts)) so demo mode never needs a model.

### Treating LLM output as untrusted (cross-cutting)

Per project security rules, model output is never rendered as HTML, executed, or used for
authorization. For every new feature the **numbers are deterministic** (from fact endpoints)
and the verifier rejects fabricated ids or out-of-band values before any output reaches the
user or a write path.

---

## WS1 — Finish the reliability branch *(mechanical, no design decisions)*

Completion of the existing plan. No new architecture.

- Migrate `ai-advisor.tsx` from `AiStepProgress` → `AiRunStatus` (optionally route `send()`
  through `useAiPipelineRun("free_form_qa")`; behavior must stay identical).
- Remove the residual "Ollama" reference in
  [llm-timeout.ts](../../../frontend/src/lib/api/llm-timeout.ts) comment (last user-facing/string
  match outside tests).
- Remove dead cloud-tier branches in `local-ai-setup-wizard.tsx`.
- Run `./scripts/ci-local.sh`; fix fallout; commit per the prior plan's commit strategy.

**Done when:** `rg -i ollama frontend/src` is clean (excluding intentional history), no
`AiStepProgress` consumers remain except its own back-compat shim, CI green, work committed.

---

## WS3 — `goal_planning` UI (per-goal + plan-all)

**Existing:** `/api/ai/facts/goal` ([facts.py](../../../backend/app/api/routes/facts.py)),
`pipelines/goal.ts` (`runGoalPipeline`, tested), and `runFeature` dispatch all exist.

**Gap:** `runGoalPipeline(ctx)` grounds *all* goals and asks the model to plan "ONE of these
goals" — it picks which; there is no way to target a specific goal. The `runFeature` heavy
path passes `args` but the goal pipeline ignores them.

**Build:**

1. **Pipeline:** thread an optional `goalId` from `args` into `runGoalPipeline`. When present,
   constrain the prompt to that goal and add a verifier check `plan.goal_id === goalId`. When
   absent, keep current "pick one" behavior (used by plan-all's fallback / safety).
2. **Per-goal action:** add an "AI plan" action to each active `GoalCard`
   ([plan/page.tsx](../../../frontend/src/app/(app)/plan/page.tsx) `GoalsTab`). Runs
   `useAiPipelineRun("goal_planning").run({ goalId })`; renders recommended monthly
   contribution, months-to-target, and the note inline with `AiRunStatus` progress/cancel.
3. **Plan-all:** a "Plan my goals" button on `GoalsTab` that loops active goals **sequentially**
   (Nano is serialized), accumulating per-goal results; one shared `AiRunStatus`. Cancel aborts
   the loop. Gate once up front — `prepareFeature` is cheap/idempotent when already ready, so
   re-gating per goal is acceptable but the wizard must not re-open mid-loop.
4. Flip `goal_planning.enabled = true`; add demo result.

**Surface:** Plan page, Goals tab. **Data flow:** facts (backend) → pipeline verify → inline UI.
**Out of scope:** writing the recommended contribution back to the goal (display only).

---

## WS4a — `spending_summary` on the Dashboard (light)

**Existing:** `/api/ai/facts/spending-patterns` returns deterministic category trends vs the
3-month average ([facts.py](../../../backend/app/api/routes/facts.py) →
`compute_spending_patterns`). The budget page already has a *heavy* `financial_advice`
"Spending Patterns" narrative; `spending_summary` is the **light, fast** complement on the home
Dashboard. Feature has **no schema yet** and no consumer.

**Dispatch decision:** streaming text (`runStream`), **not** structured JSON. The card renders
the deterministic highlights from the facts itself; the model only writes a short narrative.
This avoids a new schema, `parseForFeature`/union changes, and any trust in model-emitted
numbers. No new schema is added for this feature.

**Build:**

1. **UI:** a Dashboard card ([page.tsx](../../../frontend/src/app/(app)/page.tsx)) that fetches
   `/api/ai/facts/spending-patterns` (React Query, non-AI leg) and renders the deterministic
   top movers itself.
2. **Narrative:** on demand (button — user gesture, required for Nano), build a prompt embedding
   the facts and stream a short summary via `useAiPipelineRun("spending_summary").runStream(...)`,
   shown with `AiRunStatus` (cancel) and `MaybeAiErrorWithSettings`. Prose is rendered as text.
3. Flip `spending_summary.enabled = true`; add a demo narrative for demo mode.

**Surface:** home Dashboard. Tier 1 default, Tier 2 allowed (light). Authoritative numbers are
deterministic; the model contributes prose only.

---

## WS4b — `anomaly_explanation` (deterministic detection + explain)

**Existing:** nothing — there is no anomaly/outlier/flag concept anywhere in the app. Detection
must be **built deterministically in the backend**; the LLM only explains already-flagged facts.

**Build:**

1. **Backend detection (deterministic):** `compute_anomaly_facts(db, household_id)` flagging
   **expense** transactions whose amount exceeds **N×** their category's trailing 3-month average
   (default `N = 3`, a documented server constant; reuse the aggregation approach in
   [budget.py](../../../backend/app/services/ai/budget.py) `compute_spending_patterns`).
   Robustness rules to avoid noise: exclude transfers; require a minimum category history
   (≥ ~2 months of data) and a minimum absolute amount floor; guard against divide-by-zero when
   the category average is 0. Returns typed facts:
   `{ anomalies: { transaction_id, category, amount, category_avg, ratio, date, payee }[] }`.
   New `AnomalyFacts` in [schemas/facts.py](../../../backend/app/schemas/facts.py).
2. **Endpoint:** `GET /api/ai/facts/anomalies`
   ([facts.py](../../../backend/app/api/routes/facts.py)), same `_require_ai_enabled` gate +
   rate limit. The threshold N is a server constant (documented), not client-supplied.
3. **Dispatch decision:** streaming text (`runStream`), **not** structured JSON — same rationale
   as WS4a. The caller already knows the `transaction_id` (it is explaining a specific flagged
   row) and renders the deterministic numbers (amount, category average, ratio) itself, so the
   model only streams the explanation prose. No new schema; no `parseForFeature` change.
4. **UI:** a per-transaction "Explain why flagged" action on the transactions page
   ([transactions/page.tsx](../../../frontend/src/app/(app)/transactions/page.tsx)) shown only
   on rows present in the anomalies facts. Streams via
   `useAiPipelineRun("anomaly_explanation").runStream(...)` with the flagged row's facts embedded
   in the prompt; `AiRunStatus` + `MaybeAiErrorWithSettings`.
5. Flip `anomaly_explanation.enabled = true`; add a demo narrative.

**Security:** detection is fully deterministic and server-side (threshold, floors, history
guards); the LLM cannot introduce, re-rank, or alter anomalies — it only narrates a row that
the deterministic layer already flagged, and its prose is rendered as untrusted text.

---

## WS5 — Structured debt-rate suggestions with apply-on-accept

**Existing:** `handleSuggestRates` ([plan/page.tsx](../../../frontend/src/app/(app)/plan/page.tsx))
reuses the `financial_advice` pipeline and shows free-text `rateNote`. There is **no
deterministic APR source** (`interest_rates.py` does not exist). Debt accounts carry a nullable
`interest_rate` ([debt.ts](../../../frontend/src/lib/api/debt.ts),
[debt.py](../../../backend/app/api/routes/debt.py)). The use case is "I don't know this card's
APR — suggest a starting point," so suggested numbers are **inherently AI estimates**. The
removed flow wrote those estimates into account records on Accept.

**Decision (user-approved):** rebuild apply-on-accept, but heavily guard-railed because this is
LLM output flowing into a financial-data write.

**Build:**

1. **New feature id** `debt_rate_suggestions` (heavy, Nano-only): extend `FeatureId`,
   `FEATURES` ([features.ts](../../../frontend/src/lib/llm/features.ts)), `SCHEMAS`, the
   `runFeature` switch, and demo contracts.
2. **Fact endpoint** `GET /api/ai/facts/debt`: deterministic per-account facts
   (`account_id, name, type, balance, has_apr, has_min_payment, current_apr, current_min_payment`).
   New `DebtFacts` schema; same gate + rate limit.
3. **Pipeline** `pipelines/rates.ts` (`ground → generate(schema) → verify`): structured output
   `[{ account_id, suggested_apr, suggested_min_payment, reasoning }]`.
4. **UI:** rebuild the per-account suggestion list on the Plan debt tab with
   **explicit per-account Accept** and **Accept-all** (applies the already-shown values), writing
   via `debtApi` update; `AiRunStatus` during generation; persistent
   "estimate — verify on your statement" framing.

**Security guardrails (required):**

- Schema constrains `account_id` to existing accounts; verifier **rejects fabricated ids**
  (as the goal pipeline does for goal ids).
- Verifier bounds: `0 ≤ suggested_apr ≤ 0.35`, `0 ≤ suggested_min_payment ≤ balance`. Out-of-band
  → regenerate within the bounded retry, then clean error.
- **Only suggest for accounts missing the field** (`has_apr` / `has_min_payment` false). Never
  silently overwrite a user-entered value.
- Apply is **explicit, per value, never automatic**; the exact number is shown before it is
  written. Accept-all applies only the values already displayed.
- The account `PATCH` validates ranges **again server-side** (defense in depth) and enforces
  household ownership (existing auth).
- Copy permanently frames suggestions as unverified estimates.

---

## Error handling (all workstreams)

- Gate failures → inline `MaybeAiErrorWithSettings` (no double toast — gate already toasts
  `unavailable`; see [prepare-feature-result.ts](../../../frontend/src/lib/llm/prepare-feature-result.ts)).
- `AbortError` (cancel) → silent stop, no error text.
- Verifier exhaustion / model failure → `userMessageFor(e)` clean message.
- Backend fact endpoints: on empty data return empty facts (e.g. `{ anomalies: [] }`), and the UI
  shows an honest empty state rather than running the model.

## Testing strategy (TDD)

- **Pipelines/services:** unit tests for verifier checks (fabricated ids, out-of-band APR,
  goal-id targeting), mirroring `goal.test.ts` / `budget.test.ts`.
- **Backend facts:** tests for anomaly threshold (boundary at exactly N×), debt facts `has_*`
  flags, ownership/gate.
- **Hooks/UI:** render + a11y tests for each new surface (button `aria-busy`, `AiRunStatus`
  `role="status"`, Accept writes the displayed value).
- **Demo mode:** each new feature returns a canned result with no model.
- Gate: `./scripts/ci-local.sh`.

## Privacy & security summary

- No new data leaves the device for inference; facts are the household's own aggregates behind
  the existing AI auth gate + rate limit.
- LLM output is untrusted: deterministic numbers, verifier-gated, no auto-writes.
- WS5 is the only write path; it is per-account, explicit, bounded, missing-field-only, and
  re-validated server-side.

## Deliverable structure

One spec (this doc) → **4 implementation plans** under `docs/superpowers/plans/`:

1. **Finish AI reliability branch** (WS1).
2. **Wire goal_planning + spending_summary** (WS3 + WS4a — frontend-mostly).
3. **Anomaly detection + explanation** (WS4b — backend + frontend).
4. **Structured debt-rate suggestions with apply** (WS5 — backend + frontend + security).

## Open follow-ups (not in this scope)

- Playwright e2e (one per run-model).
- Writing recommended goal contributions back to the goal record.
- A real external APR data source to replace AI estimates in WS5.
