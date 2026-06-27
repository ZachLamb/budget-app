# Nano-only AI: replace the self-hosted cloud LLM with on-device Gemini Nano

**Date:** 2026-06-14
**Status:** Design — pending implementation plan

## Context & motivation

Clarity ships AI features behind a tiered router ([router.ts](../../../frontend/src/lib/llm/router.ts), [features.ts](../../../frontend/src/lib/llm/features.ts)):

- **Tier 1 `nano`** — Chrome/Edge built-in Gemini Nano via the `LanguageModel` Prompt API ([nano.ts](../../../frontend/src/lib/llm/providers/nano.ts)).
- **Tier 2 `web-llm`** — `@mlc-ai/web-llm`, a ~1.8 GB WebGPU model downloaded on-device.
- **Tier 4 `server`** — self-hosted Ollama (dev) / Modal vLLM (prod) behind the FastAPI proxy ([server.ts](../../../frontend/src/lib/llm/providers/server.ts), [llm_client.py](../../../backend/app/services/ai/llm_client.py)).

Two problems drive this work:

1. **Operational + cost burden + privacy goal.** The self-hosted cloud model (Tier 4 — "our local LLM," i.e. the model we run ourselves) costs GPU spend (Modal) and ops, and is the only path where inference content leaves the device.
2. **The current AI features don't work well and the UX is confusing.** An audit found: Settings ignores Nano entirely (the "on-device" section only configures the web-llm download); Nano's own model download has no progress/await/error UX so first use silently hangs; structured features use fragile free-text JSON parsing instead of schema-constrained output; and most of the explain-charge component is cloud cold-start plumbing. Internal tiers leak into the UI.

The Prompt API graduated from origin trial to **stable for general web pages in Chrome 148 (Q2 2026)** with JSON-schema structured output, so Nano-on-the-web is no longer experimental.

## Goals

- Remove the self-hosted cloud LLM tier (Tier 4) entirely — frontend and backend.
- Make Gemini Nano the primary on-device model; keep web-llm as a fallback for the **light** features.
- Keep all nine features working, including the four "heavy" ones that a small model can't do in a single call, by building per-feature **quality-amplification pipelines**.
- Fix the foundation: real Nano setup/progress/error UX, schema-constrained structured output.
- Radically simplify the AI UX by deleting the cloud surface (toggle, consent dialogs, PII gating, cold-start copy) and hiding internal tiers.

## Non-goals

- **Offline-first / fully client-side grounding.** Facts are still computed server-side (rejected Approach 2). Not an offline app.
- **A generic declarative pipeline engine.** Pipelines are concrete per-feature functions sharing helpers (rejected Approach 3; revisit only if features proliferate — rule of three).
- **Third-party hosted model APIs** (Gemini cloud, OpenAI, Anthropic, etc.). Fail closed; no content to third parties.
- **Tier 3 (WASM CPU).** Remains unimplemented.

## Decisions (locked)

- **D1** — Delete Tier 4 (self-hosted cloud): Ollama/Modal, the FastAPI model proxy, the client `server` provider.
- **D2** — On-device only. Nano (T1) primary; web-llm (T2) fallback. No third-party model APIs.
- **D3** — Keep all nine features. The four heavy features (`budget_recommendations`, `goal_planning`, `free_form_qa`, `financial_advice`) move from cloud-only to on-device pipelines.
- **D4** — Heavy features get full pipelines: grounding + decomposition + self-critique + deterministic verification. (Self-consistency voting is a Phase 3 refinement — see Risks.)
- **D5** — Architecture: extend the existing "backend computes facts → client runs the model" pattern (already used by categorize/FSA). Pragmatic per-feature pipelines + shared step helpers, not a generic engine.
- **D6** — *Phase the cloud deletion after the replacement exists* (avoids a broken window), and *the heavy pipelines are Nano-only in v1* (web-llm stays for the light features only). See Phasing.
- **D7** — *Specialized Chrome AI APIs are in v1*, used opportunistically inside the Nano pipelines: **Summarizer** (stable, Chrome 138 — no token), and **Writer / Rewriter / Proofreader** (joint/Proofreader origin trials through Chrome 148 — require a per-origin trial token). All four are **capability-detected and optional**: every step that can use a specialized API must fall back to the **Prompt API** when the API or its token is absent. They are **Nano-side only** (the Writing Assistance + Proofreader APIs are not available in Web Workers, so web-llm cannot use them) — a third reason the heavy pipelines are Nano-only in v1.

## End-state architecture

| Tier | Provider | Role after this work |
|------|----------|----------------------|
| 1 | `nano` | **Default** wherever capable (Chrome/Edge desktop). All features. |
| 2 | `web-llm` | Fallback **for light features only** when Nano is absent + WebGPU present. Behind the existing ~1.8 GB download consent. |
| ~~4~~ | ~~`server`~~ | **Deleted.** |
| — | none | Feature shows a single honest "AI runs on-device — use Chrome/Edge on desktop" state. |

**One flow for every feature:**

```
backend computes grounded facts (deterministic, no model)
  → client pipeline
  → provider.generate(), JSON-schema-constrained on Nano
  → deterministic code verifier  (+ self-critique for the heavy four)
  → compose → render
```

**Core invariant:** all arithmetic and aggregation happens in code (server-side fact endpoints). The model only phrases judgments over pre-computed, grounded facts. This is what makes a ~3–4B on-device model "good enough" for tasks the cloud 7B used to handle.

## The quality-amplification pipeline layer (core new build)

New module tree under `frontend/src/lib/llm/`:

```
pipelines/
  baseline.ts   # light features: ground → generateStructured → verify
  budget.ts     # budget_recommendations
  goal.ts       # goal_planning
  qa.ts         # free_form_qa
  advice.ts     # financial_advice
  steps.ts      # shared step helpers
  types.ts      # PipelineContext, StepResult, progress + cancellation
session-pool.ts # Nano clone() pool w/ concurrency cap; web-llm via existing engine lock
schema.ts       # per-feature JSON schemas + provider-aware structured generate
specialized.ts  # capability-detected Summarizer/Writer/Rewriter/Proofreader wrappers (+ Prompt-API fallback)
errors.ts       # on-device error taxonomy
```

**Shared steps (`steps.ts`):**

- `ground(feature, params)` — fetch pre-computed facts from the backend fact endpoint(s).
- `generateStructured(provider, { system, prompt, schema, temperature })` — **provider-aware**: Nano uses `responseConstraint` (JSON schema) with `omitResponseConstraintInput` to save context; web-llm (light features only) uses the existing prompt-nudge + `parseJsonResponse` retry ([run-structured.ts](../../../frontend/src/lib/llm/run-structured.ts)).
- `decompose(facts)` — split a heavy task into narrow sub-prompts (e.g., one per over-budget category) each within Nano's context window.
- `critique(provider, draft, rules, facts)` — reflexion pass. **The verifier, not the critique, decides:** a revision is accepted only if it passes `verify`; otherwise the original is kept (small-model critique can regress correct answers).
- `verify(result, checks)` — deterministic validation in code: numbers reconcile against the grounded facts, cited transactions/categories exist, suggested amounts fall within the actual budget, output matches the schema and length caps. On failure: regenerate up to a small bound, then surface a clean error.
- `compose(parts)` — assemble the final user-facing output from verified parts. **May use the Writer/Rewriter API** (via `specialized.ts`) to phrase/tighten the prose when available; falls back to a Prompt-API generate when the API or its origin-trial token is absent. Composed prose is still run through `verify` (numbers/refs unchanged).
- **Specialized-API helpers (`specialized.ts`)** — thin, capability-detected wrappers: `summarize()` (Summarizer, stable), `write()`/`rewrite()` (Writer/Rewriter, origin-trial token), `proofread()` (Proofreader, origin-trial token). Each exposes `isAvailable()` and **always has a Prompt-API fallback** so a missing token never breaks a feature. `summarize` is used opportunistically in `qa`/`advice` to condense grounded facts that approach the context budget; `proofread` is an optional final polish on composed prose (never alters numbers — re-`verify` after). Origin-trial tokens are injected via a `<meta http-equiv="origin-trial">` tag (see Frontend changes); none of these run in the web-llm worker.
- `selfConsistency(provider, spec, n, temperature)` — **Phase 3.** Runs N samples via the clone pool at *raised* temperature, reconciling only **discrete** sub-decisions (extraction/classification), never prose.

**Concurrency model (provider-aware):**

- **v1 runs pipeline steps sequentially** — simpler and correct. Parallelism is a Phase 3 optimization, added only where latency demands it.
- Nano parallelism, when added, uses `session.clone()` from a small pool with a concurrency cap (resource-bounded); concurrent calls on a single session are unsupported.
- web-llm is hard-serialized to one generation per tab ([engine-busy.ts](../../../frontend/src/lib/llm/engine-busy.ts)); it cannot parallelize. This is a second reason heavy pipelines (which benefit most from parallel passes) are Nano-only in v1.

**Context budget:** before sending, use `session.measureInputUsage()` / `contextWindow` to ensure grounded facts fit; if not, decompose further. Nano's context window is small — untracked overflow silently truncates the prompt and is a primary "garbage output" cause. `maxTokens` is a no-op on Nano; control length via decomposition + batching, and tune FSA/categorize batch sizes for Nano (the cloud-era 2048 default is meaningless here).

## Backend changes

> The deletions below describe the **end state**. They are sequenced in [Phasing](#phasing): the cloud tier stays live through Phase 1 and is removed in Phase 2, after the pipelines replace it.

**Delete (model plumbing):** [llm_client.py](../../../backend/app/services/ai/llm_client.py), [circuit.py](../../../backend/app/services/ai/circuit.py), [cache.py](../../../backend/app/services/ai/cache.py), `llm_rate_limit.py`, `household_rate_limit.py`, `log_redact.py`, `prompt_safety.py`, `json_extract.py`, `status.py`, `insights.py`, `categorization/llm.py`, [deps_llm.py](../../../backend/app/api/deps_llm.py), the model routes in `routes/llm.py` and `routes/ai.py`, and `OLLAMA_*`/Modal config + any AI-only warm-up (e.g. Modal spin-up), keeping the non-AI hosting logic in `hosting/fly.py`.

**Audit, don't blind-delete (mixed deterministic + model code):** `debt_plan.py` (keep the debt math, drop the model call), `routes/goals.py`, `routes/me.py`, `routes/settings.py`, `action.py`/`action_token.py` (keep deterministic **action execution**; drop model-driven **action parsing**). Each needs per-function triage.

**Keep, expose as plain fact endpoints (the grounding layer):** [candidates.py](../../../backend/app/services/categorization/candidates.py) / [rules.py](../../../backend/app/services/categorization/rules.py), [fsa.py](../../../backend/app/services/ai/fsa.py), [budget.py](../../../backend/app/services/ai/budget.py), [interest_rates.py](../../../backend/app/services/ai/interest_rates.py), [context.py](../../../backend/app/services/ai/context.py), [evidence.py](../../../backend/app/services/ai/evidence.py). The categorize/FSA candidate endpoints already exist; add fact endpoints for budget / goal / Q&A context (e.g. `GET /api/ai/facts/{budget|goal|context}`) returning the user's own aggregates.

**Sweep callers.** Removing routes (status, ai, llm) without updating every frontend caller leaves 404s in settings/health UI. Explicit step: grep and update/remove all callers.

**Migrations.** Stop writing the cloud-consent records ([models/llm.py](../../../backend/app/models/llm.py)) and remove cloud-related fields from the settings schema. **Do not drop the consent table in this work** — defer the destructive drop to a separate cleanup migration once any audit-retention requirement is confirmed. Keep the global `settings.ai_enabled` flag.

**Settings schema.** Remove cloud/tier fields (preferred tier, per-feature cloud consent). Keep `ai_enabled`.

## Frontend changes

- **Delete:** `providers/server.ts` (+ test), `pii-detect.ts` + the PII warning dialog, the cloud branches of `consent.ts`, `cloud-consent-dialog.tsx`.
- **[features.ts](../../../frontend/src/lib/llm/features.ts):** every feature → `allowedTiers: [1, 2]` for the light five, `[1]` for the heavy four (Nano-only in v1); `defaultTier: 1`, `minimumTier: 1`; drop `cloudPossible`.
- **[router.ts](../../../frontend/src/lib/llm/router.ts):** drop the Tier-4 branch, `cloudConsentGrants`, `needs_cloud_consent`, and `preferredTierByFeature` (meaningless with two tiers). Add a **`needs_nano_setup`** decision when Nano reports `"downloadable"`, so we never silently kick off Chrome's model fetch (the hang fix). Decisions become: `ready` | `needs_nano_setup` | `needs_download_consent` (web-llm) | `unavailable`.
- **[nano.ts](../../../frontend/src/lib/llm/providers/nano.ts):** add an awaited `ensureReady()` that wires the `create()` `monitor` hook for download progress and surfaces errors; add a `schema` option → `responseConstraint`; set `temperature`+`topK` together per call (raised temp only for sampling steps). Triggering download requires user activation — only call from an explicit user action.
- **[capability.ts](../../../frontend/src/lib/llm/capability.ts):** keep nano + webgpu probes; remove the `server` field; **add a `specialized` field** probing `Summarizer`/`Writer`/`Rewriter`/`Proofreader` availability (each `boolean`, all default `false` and never block a feature). Re-probe (force) on Nano download progress/complete so the UI updates from downloadable → downloading → available.
- **Origin-trial token:** Writer/Rewriter/Proofreader require a per-origin trial token. Inject it via a `<meta http-equiv="origin-trial" content="…">` tag in the app `<head>` ([layout.tsx](../../../frontend/src/app/layout.tsx)), sourced from a **public build-time env var** (`NEXT_PUBLIC_CHROME_AI_OT_TOKEN`) so it is documented by *name* only and absent in environments that don't have one. When the env var is unset, the meta tag is omitted, `specialized.*.isAvailable()` returns `false`, and pipelines use the Prompt-API fallback. (Summarizer is stable and needs no token.)
- **[useLlm.ts](../../../frontend/src/lib/llm/useLlm.ts):** drop the server provider and the cloud-consent grants query.
- **[run-structured.ts](../../../frontend/src/lib/llm/run-structured.ts):** use schema-constrained generation on Nano; drop the Tier-4 escape hatch; keep batching (tuned for Nano).
- **Demo mode:** extend `demoStructuredResult` ([contracts.ts](../../../frontend/src/lib/llm/contracts.ts)) to cover the four heavy pipelines so demo mode keeps returning canned results without a model.

## UX redesign

- **Settings — one Nano-aware status** (replaces the web-llm-only section in [ai-settings-card.tsx](../../../frontend/src/components/llm/ai-settings-card.tsx)):
  - Nano available → "On-device AI ready" (no action).
  - Nano downloadable/downloading → "Setting up on-device AI…" with live progress; a button (user gesture) starts it.
  - No Nano but WebGPU → quiet "Download fallback model (1.8 GB)" for the light features.
  - Neither → "On-device AI needs Chrome or Edge on desktop" — no dead button.
  - **Delete the entire Cloud AI section**, the all-features toggle, and the silent keep-alive re-grant. Keep the global AI on/off (`ai_enabled`).
- **explain-charge** ([explain-charge.tsx](../../../frontend/src/components/llm/explain-charge.tsx)): collapse to button → stream → result. Remove the cold-start copy, PII dialog, `fallbackToLocal`, 429 UI, and tier badge (~275 → ~80 lines).
- **Heavy features:** because pipelines take seconds, show **step progress** ("Analyzing spending… checking the numbers… writing it up") with cancel — never a frozen spinner. Frame outputs as drafts where appropriate.
- **Unavailable:** one consistent, honest empty-state across all features — no tier jargon. `role="status"`, keyboard-navigable, AA contrast.

## Privacy & security

- **Net win:** no inference content ever leaves the device; the cloud-send path, PII pre-send scanning, and prompt-audit surface are deleted. Matches the privacy-first product value.
- **Don't regress authz.** The new fact endpoints return the user's financial aggregates — they need the **same ownership/household checks at the route layer** as any data endpoint, plus request validation and length caps. "It's just facts" is not a reason to weaken authorization.
- **Rate-limit the fact endpoints** (DB cost). The per-model-call rate limiters are removed; the data-endpoint limiters stay/extend.
- **Treat model output as untrusted:** schema-validate, length-cap (the contracts already slice strings — keep that), never render as HTML, never use for authorization.
- **Secrets/config hygiene:** remove `OLLAMA_*`/Modal secrets from env and `.env.example`; trim cloud-model origins from CSP `connect-src` (keep `*.hf.co` for web-llm weights). The Chrome AI origin-trial token (`NEXT_PUBLIC_CHROME_AI_OT_TOKEN`) is **not a secret** — it is an origin-bound public token embedded in the HTML; document it by name in `.env.example` with an empty default. Specialized APIs run fully on-device, so they add **no** `connect-src` origins.

## Error taxonomy (replaces the cloud-flavored `LLMError`)

`no_model` · `download_failed` · `session_create_failed` · `context_overflow` · `schema_parse_failed` · `verify_failed` (after bounded retries) · `aborted`. Each maps to one plain user-facing message and a consistent UI treatment. No 429/rate-limit/cold-start cases remain.

## Edge cases

- **User activation for download** — never auto-trigger Nano/web-llm download on mount; only from a click.
- **Nano "available" but `create()` fails** (eviction under disk pressure, enterprise policy disabled, mobile Chrome) — catch and degrade to web-llm (light) or the unavailable state; never crash.
- **Context overflow** — measure before send; decompose if facts don't fit.
- **Self-consistency variance** — sampling runs need raised temperature (with topK); the hardcoded 0.3 defeats voting. Applies only to discrete sub-decisions.
- **Critique regression** — only accept critique output that passes `verify`.
- **Output truncation** — Nano has no `maxTokens`; long structured outputs can truncate into invalid JSON. Batch/decompose to keep outputs short; verifier catches malformed output.
- **Capability staleness** — re-probe during/after Nano download.
- **web-llm heavy-feature gap** — on non-Nano browsers the four heavy features show the unavailable state in v1 (web-llm heavy pipelines deferred), while the light five still work on web-llm.
- **Demo mode** — heavy features must return canned pipeline results client-side.

## Testing strategy (TDD)

- **Unit:** router decisions incl. `needs_nano_setup` and no-Tier-4; capability probes (available/downloadable/unsupported); provider-aware `generateStructured`; each step (`ground`/`verify`/`critique`/`compose`) with a mock provider; verifier rejects non-reconciling numbers and fabricated references; session-pool concurrency cap.
- **Integration:** each pipeline end-to-end with a fake provider returning canned + adversarial outputs (malformed JSON, hallucinated category, out-of-range amount) → asserts verify/regenerate/critique behavior; web-llm fallback path for a light feature.
- **Component:** settings states (Nano ready / downloadable+progress / WebGPU-only / none); explain-charge happy path; the shared unavailable empty-state.
- **Backend:** fact endpoints' authz (ownership/household) + correctness; assert removed routes now 404; keep demo-mode tests.
- **Cleanup:** delete tests for removed code (server provider, cloud consent, PII).

## Phasing

**Phase 1 — Fix the foundation (cloud untouched).**
Real Nano setup/progress/error UX + `needs_nano_setup`; schema-constrained output for the light features; the `specialized` capability probes + the origin-trial-token meta tag wiring (so the helpers exist and report availability, even before any pipeline uses them); simplify the light-feature UX and the settings card; hide tier labels. *Outcome:* the light features actually work on Nano and the UX is clean. The cloud tier still backs the heavy four during this phase — **no broken window.**

**Phase 2 — Pipelines (with specialized APIs) + remove the cloud.**
Build `session-pool`, `schema`, `specialized`, `errors`, the shared steps, and the four heavy Nano pipelines (ground → decompose → generate(schema) → critique → verify → compose), sequential. Wire the specialized APIs into the steps that benefit (Summarizer for fact condensation, Writer/Rewriter for `compose`, optional Proofreader polish), each with a Prompt-API fallback. Validate against the eval fixtures. **Then** delete the cloud tier end-to-end (frontend `server.ts`, backend model plumbing, Modal/Ollama, consent UI/flow, PII). Add per-feature kill switches.

**Phase 3 — Polish.**
`clone()` parallelism where latency demands; self-consistency on discrete sub-decisions; caching by input-hash; quality measurement + keep/cut calls on weak features; the deferred consent-table drop migration.

## Risks & open questions

- **Nano quality ceiling on the heavy four**, even with pipelines. Mitigations: facts-in-code grounding, the deterministic verifier, "draft" framing, per-feature kill switch, and the eval harness to decide keep/cut. `financial_advice` is the riskiest — candidate for the most conservative verifier and the strongest disclaimer, or being cut if it can't be made reliable.
- **Multi-pass latency** on-device (seconds). Mitigations: sequential-first then targeted parallelism, capped self-consistency, step-progress UX, input-hash caching.
- **Audience shrink:** AI now needs Chrome/Edge desktop (heavy four) or a WebGPU download (light five). iOS/Safari/Firefox get the light features via download or nothing for the heavy four. Accepted consequence of going on-device only.
- **Chrome API churn:** Prompt API and Summarizer are stable (148/138); Writer/Rewriter/Proofreader are origin-trial (joint trial through Chrome 148) and **subject to change**. Mitigation: they are strictly **opportunistic** — capability-detected with a Prompt-API fallback on every path, gated behind a token env var, and **not available in Web Workers** (web-llm can't use them). If a trial ends or the API shape changes, the token meta tag is dropped and pipelines silently fall back to the Prompt API with no feature loss.

## Eval / quality measurement

A lightweight fixture-based harness (a handful of representative grounded inputs per heavy feature) asserting the verifier's properties (numbers reconcile, references real, amounts in range, schema valid) plus spot-checked output quality. Gates the Phase 2 "is it good enough?" decision and the Phase 3 keep/cut calls. Not a model benchmark — a regression net for the pipelines.
