# AI Features Reliability + Progress UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every wired on-device AI surface reliably runnable (especially Nano-first setup), surface failures consistently with Settings links, and upgrade loading/progress UI to match AI Advisor quality across heavy and light features.

**Architecture:** Fix the setup gate bug at the root (`ensureReady` must not skip Nano activation when WebGPU cache exists). Introduce a shared `useAiPipelineRun` hook + upgraded `AiRunStatus` component for all `runFeature` / long `run` call sites. Migrate each page incrementally; keep `AiFeatureGateProvider` as the single gate. Do not add new features (`goal_planning`, `spending_summary`, `anomaly_explanation`) in this plan — mark them disabled or document as follow-up.

**Tech Stack:** Next.js 16 / React / TypeScript, Vitest, existing pipelines under `frontend/src/lib/llm/pipelines/`, FastAPI backend unchanged except copy-only fixes if any.

**Spec / audit basis:** Conversation audit 2026-06-28 on `main` (post PR #36 on-device setup UX). Aligns with `docs/superpowers/specs/2026-06-14-nano-only-ai-design.md` (on-device only, Nano primary).

**Branch:** Create `fix/ai-reliability-and-progress-ux` from latest `main`.

---

## Execution phases (recommended order)

```
Phase 0 (quick ship, ~1 day)     A1 + A4 + C7 + C8  → fixes most "AI broken" reports
Phase 1 (foundation, ~1.5 days)  A2 + A3 + B1 + B2 + B3
Phase 2 (migrations, ~2 days)    C1–C6 (parallelizable after Phase 1)
Phase 3 (verify)                 D1 + D2
```

**Dependency graph:**

```
A1 ──┬──> B2 ──> C1,C2,C3,C4,C5
A2 ──┤
A3 ──┘
B1 ──> C1,C2,C3,C4,C7
A4, C7, C8 — independent (can land in Phase 0)
C6 — independent of B2 (inline errors only)
```

**Parallelization:** After B1+B2 merge, sub-agents may own C2 / C3 / C4 / C5 / C6 concurrently (disjoint files).

---

## Success criteria (definition of done)

- [ ] User with WebGPU model cached + Nano `downloadable` can run Dashboard insights, Budget recommendations, and Plan debt advice without hitting “Could not prepare AI…” loop.
- [ ] Every user-facing AI action shows one of: idle / in-progress (labeled step or batch) / error with Settings link / result.
- [ ] Cancel works on all heavy pipeline runs and FSA scan (already partial).
- [ ] No “Ollama” copy remains in AI troubleshooting UI.
- [ ] `./scripts/ci-local.sh` passes.
- [ ] Manual smoke checklist (§ Manual QA) completed on Chrome desktop.

---

## File structure (create / modify)

| File | Action | Responsibility |
|------|--------|----------------|
| `frontend/src/hooks/use-local-ai-setup.ts` | Modify | Fix `ensureReady` Nano vs WebGPU logic |
| `frontend/src/hooks/use-local-ai-setup.test.ts` | Modify | Regression: WebGPU cached + Nano downloadable → wizard opens |
| `frontend/src/lib/llm/prepare-feature-result.ts` | **Create** | `interpretPrepareFeatureResult()` — cancelled vs unavailable UX helper |
| `frontend/src/lib/llm/prepare-feature-result.test.ts` | **Create** | Unit tests for helper |
| `frontend/src/lib/llm/prepare-feature-types.ts` | **Create** | `PrepareFeatureResult` type (avoid importing from client gate module) |
| `frontend/src/hooks/use-ai-pipeline-run.ts` | **Create** | Shared prepare + runFeature/run with progress/cancel/error |
| `frontend/src/hooks/use-ai-pipeline-run.test.ts` | **Create** | Hook tests with mocked gate + llm |
| `frontend/src/components/llm/ai-run-status.tsx` | **Create** | Upgraded progress UI (step + optional batch bar + cancel) |
| `frontend/src/components/llm/ai-run-status.test.tsx` | **Create** | a11y + render tests |
| `frontend/src/components/llm/ai-step-progress.tsx` | Modify or deprecate | Re-export from `AiRunStatus` or thin wrapper for backward compat |
| `frontend/src/lib/llm/errors.ts` | Modify | Richer `userMessageFor` for router/gate messages |
| `frontend/src/lib/llm/errors.test.ts` | Modify | New cases |
| `frontend/src/components/transactions/fsa-review-panel.tsx` | Modify | Copy, batch progress visibility, settings link on batch fail |
| `frontend/src/hooks/use-fsa-review-scan.ts` | Modify | Optional: expose `batchProgress` during re-scan |
| `frontend/src/app/(app)/page.tsx` | Modify | InsightsPanel → hook + AiRunStatus |
| `frontend/src/app/(app)/budget/page.tsx` | Modify | SpendingPatternsPanel + budget recommendations |
| `frontend/src/app/(app)/plan/page.tsx` | Modify | Debt tab runs + remove dead rate card UI |
| `frontend/src/components/llm/explain-charge.tsx` | Modify | Cancel message + streaming header |
| `frontend/src/hooks/use-categorize-suggestions.ts` | Modify | Export stable error shape |
| `frontend/src/app/(app)/transactions/page.tsx` | Modify | Inline categorize error |
| `frontend/src/app/(app)/rules/page.tsx` | Modify | Inline categorize error |
| `frontend/src/components/ai-advisor.tsx` | Modify | Adopt `AiRunStatus` (replace `AiStepProgress`) |
| `frontend/src/app/layout.tsx` | Modify | Remove Ollama from meta description |
| `frontend/src/lib/llm/features.ts` | Modify | Disable unwired features (`goal_planning`, `spending_summary`, `anomaly_explanation`) |
| `frontend/src/lib/llm/contracts.ts` | Modify | Fix stale header comment (tier defaults) |

---

## Feature → migration map

| Feature ID | UI surface | Run API | Migration task |
|------------|------------|---------|----------------|
| `free_form_qa` | `ai-advisor.tsx` | `runFeature` | C1 |
| `financial_advice` | `page.tsx` InsightsPanel | `runFeature` | C2 |
| `financial_advice` | `budget/page.tsx` SpendingPatternsPanel | `runFeature` | C3 |
| `financial_advice` | `plan/page.tsx` DebtTab (recommendation + rates) | `runFeature` | C4 |
| `budget_recommendations` | `budget/page.tsx` AI Suggestions button | `runFeature` | C3 |
| `explain_charge` | `explain-charge.tsx` | `run` (stream) | C5 |
| `categorize_transaction` | transactions + rules | `runStructuredJson` | C6 |
| `fsa_review` | FSA panel + hook | `runBatchedStructuredJson` | C7 |
| `goal_planning` | — | — | C8 (disable only) |
| `spending_summary` | — | — | C8 |
| `anomaly_explanation` | — | — | C8 |

### Run-model taxonomy (drives hook design)

| Model | Features | Progress source | Hook method |
|-------|----------|-----------------|-------------|
| **Heavy pipeline** | `free_form_qa`, `financial_advice`, `budget_recommendations` | `PipelineProgress` steps | `run()` → `llm.runFeature` |
| **Stream** | `explain_charge` | Custom “Explaining…” + chunks | `runStream()` → `llm.run` |
| **Structured batch** | `fsa_review` | `(done, total)` batches | Keep `useFsaReviewScan`; use `AiRunStatus` batch mode |
| **Structured single** | `categorize_transaction` | Button pending only (fast) | Keep hook; inline error + tier badge |

Do **not** force FSA/categorize through `useAiPipelineRun` — different progress shape. Only share `AiRunStatus` + error helpers.

---

## Part A — Root reliability fixes

### Task A1: Fix `ensureReady()` Nano bypass

**Problem:** `ensureReady` returns early when `getModelDownloadStatus().kind === "downloaded"` (WebGPU Tier 2). Router then returns `needs_nano_setup` for heavy features; `prepareFeature` loops until failure.

**Files:**
- Modify: `frontend/src/hooks/use-local-ai-setup.ts:138-171`
- Test: `frontend/src/hooks/use-local-ai-setup.test.ts`

- [ ] **Step 1: Write failing test**

Add to `use-local-ai-setup.test.ts`:

```typescript
it("opens wizard when WebGPU is cached but Nano is downloadable", async () => {
  getModelDownloadStatusMock.mockResolvedValue({
    kind: "downloaded",
    modelId: "model-3b",
    sizeLabel: "1.8 GB",
  });
  getCapabilityMock.mockResolvedValue({
    webgpu: { available: true, modelSize: "3b", storageQuotaBytes: 5_000_000_000 },
    nano: { available: false, status: "downloadable" },
  });

  const { result } = renderHook(() => useLocalAiSetup());
  const wizardPromise = result.current.ensureReady();

  await waitFor(() => {
    expect(result.current.wizardProps.open).toBe(true);
  });

  act(() => {
    result.current.wizardProps.onCancel();
  });
  await expect(wizardPromise).rejects.toThrow(/cancelled/i);
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `cd frontend && npm run test:run -- src/hooks/use-local-ai-setup.test.ts`
Expected: FAIL — wizard does not open.

- [ ] **Step 3: Implement fix**

Logic (simplified — avoid redundant branches):

```typescript
const ensureReady = useCallback(async (): Promise<void> => {
  if (isDemoMode) return;

  const cap = await getCapability(true);
  const downloadStatus = await getModelDownloadStatus(true);

  const nanoNeedsSetup =
    cap.nano.status === "downloadable" || cap.nano.status === "downloading";
  const webLlmReady = downloadStatus.kind === "downloaded";

  // Ready: Nano available OR WebGPU model cached and Nano does not need setup.
  if (!nanoNeedsSetup && (cap.nano.available || webLlmReady)) {
    return;
  }

  if (pendingRef.current) return pendingRef.current.promise;
  // ... existing wizard open logic (setCapability(cap), setOpen(true), etc.)
}, []);
```

Ensure `startDownload` / wizard `device-check` step already routes Nano downloadable → `startDownloadNano` (existing in `startDownload`).

**Edge case:** Nano `available` + WebGPU not downloaded → return (light features can consent to WebGPU later via router).

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/use-local-ai-setup.ts frontend/src/hooks/use-local-ai-setup.test.ts
git commit -m "fix: open Nano setup wizard when WebGPU model is already cached"
```

---

### Task A2: Prepare result types + `interpretPrepareFeatureResult`

**Files:**
- Create: `frontend/src/lib/llm/prepare-feature-types.ts`
- Create: `frontend/src/lib/llm/prepare-feature-result.ts`
- Create: `frontend/src/lib/llm/prepare-feature-result.test.ts`
- Modify: `frontend/src/lib/llm/ai-feature-gate.tsx` — import/re-export type from `prepare-feature-types.ts`

**Double-toast policy:** `prepareFeature()` already calls `toastAiAvailability` for `unavailable` (not cancelled). Callers using `interpretPrepareFeatureResult` must:
- **`cancelled`** → inline error only (gate does not toast)
- **`unavailable`** → inline error only; do **not** toast again (gate already did)
- **`run`** → proceed

- [ ] **Step 1: Create shared type** (`prepare-feature-types.ts`)

```typescript
import type { FeatureId } from "./features";

export type PrepareFeatureResult =
  | { ok: true; decision?: { kind: "ready"; tier: 1 | 2 } }
  | { ok: false; reason: "cancelled" | "unavailable"; message?: string };
```

Update `ai-feature-gate.tsx` to import this type (keep export for backward compat).

- [ ] **Step 2: Write failing tests** (`prepare-feature-result.test.ts`)

```typescript
import { describe, expect, it, vi } from "vitest";
import { interpretPrepareFeatureResult } from "./prepare-feature-result";

describe("interpretPrepareFeatureResult", () => {
  it("returns run for ok", () => {
    expect(interpretPrepareFeatureResult({ ok: true }).action).toBe("run");
  });
  it("returns cancelled copy for cancelled", () => {
    const r = interpretPrepareFeatureResult({ ok: false, reason: "cancelled" });
    expect(r.action).toBe("stop");
    expect(r.userMessage).toMatch(/cancelled/i);
  });
  it("returns unavailable copy for unavailable", () => {
    const r = interpretPrepareFeatureResult({
      ok: false,
      reason: "unavailable",
      message: "On-device AI needs Chrome",
    });
    expect(r.action).toBe("stop");
    expect(r.userMessage).toContain("Chrome");
  });
});
```

- [ ] **Step 3: Implement** (`prepare-feature-result.ts`)

```typescript
import type { PrepareFeatureResult } from "./prepare-feature-types";

export type PrepareInterpretation =
  | { action: "run" }
  | { action: "stop"; userMessage: string; showSettingsLink: boolean };

export function interpretPrepareFeatureResult(
  prepared: PrepareFeatureResult,
): PrepareInterpretation {
  if (prepared.ok) return { action: "run" };
  if (prepared.reason === "cancelled") {
    return {
      action: "stop",
      userMessage: "On-device AI setup was cancelled. Open AI settings to try again.",
      showSettingsLink: true,
    };
  }
  return {
    action: "stop",
    userMessage: prepared.message ?? "AI is not available for this feature.",
    showSettingsLink: true,
  };
}
```

- [ ] **Step 4: Run tests + commit**

---

### Task A3: Improve `userMessageFor`

**Files:**
- Modify: `frontend/src/lib/llm/errors.ts`
- Modify: `frontend/src/lib/llm/errors.test.ts`

- [ ] **Step 1: Add tests for Error.message passthrough when AI-related**

```typescript
it("preserves on-device AI error messages from generic Error", () => {
  expect(userMessageFor(new Error("On-device AI needs a quick one-time setup."))).toMatch(
    /one-time setup/i,
  );
});
```

- [ ] **Step 2: Implement**

```typescript
import { isAiAvailabilityMessage } from "./ai-settings-link";

export function userMessageFor(e: unknown): string {
  if (e instanceof OnDeviceError) return MESSAGES[e.code];
  if (e instanceof Error) {
    if (isAiAvailabilityMessage(e.message)) return e.message;
    if (e.message.trim()) return e.message;
  }
  return "Something went wrong. Try again.";
}
```

- [ ] **Step 3: Run `npm run test:run -- src/lib/llm/errors.test.ts` + commit**

---

### Task A4: Remove stale Ollama copy

**Files:**
- Modify: `frontend/src/components/transactions/fsa-review-panel.tsx:225-227`
- Modify: `frontend/src/app/layout.tsx` (meta description)

- [ ] **Step 1: Replace FSA batch-failure message**

```tsx
<MaybeAiErrorWithSettings
  message="The AI did not return results for this scan. Check on-device AI setup in Settings and try again."
/>
```

- [ ] **Step 2: Update layout meta** — replace “Ollama” with “on-device AI (Chrome/Edge)”.

- [ ] **Step 3: Grep guard**

Run: `rg -i ollama frontend/src` — expect zero matches in user-facing strings.

- [ ] **Step 4: Commit**

---

## Part B — Shared progress infrastructure

### Task B1: `AiRunStatus` component

**Files:**
- Create: `frontend/src/components/llm/ai-run-status.tsx`
- Create: `frontend/src/components/llm/ai-run-status.test.tsx`

**Design spec (match existing shadcn patterns):**
- Container: `rounded-md border bg-muted/30 px-3 py-2` (same as current `AiStepProgress`)
- Primary row: `Loader2` spin + `{progress.label}` or batch label `"Scanning batch {done+1} of {total}…"`
- When `batch`: `<Progress value={(done/total)*100} className="h-1.5 mt-2" />`
- Cancel: ghost `Button` size `sm`, `aria-label="Cancel AI task"`
- When only batch (FSA): pass `progress={{ step: "batch", label: "…" }}` or allow `progress` null with batch only

**Accessibility checklist (all AI surfaces after migration):**
- [ ] Trigger button sets `aria-busy={running}` while AI runs
- [ ] Progress region uses `role="status"` + `aria-live="polite"`
- [ ] Cancel is keyboard-reachable and does not trap focus
- [ ] Error messages associated with trigger via visible inline text (no `aria-describedby` required if adjacent)

- [ ] **Step 1: Write test (renders label + batch fraction)**

- [ ] **Step 2: Implement using shadcn `Progress`**

- [ ] **Step 3: Update `ai-step-progress.tsx` to re-export or delegate to `AiRunStatus` for backward compat**

- [ ] **Step 4: Commit**

---

### Task B2: `useAiPipelineRun` hook

**Files:**
- Create: `frontend/src/hooks/use-ai-pipeline-run.ts`
- Create: `frontend/src/hooks/use-ai-pipeline-run.test.ts`

**API:**

```typescript
export function useAiPipelineRun<T>(feature: FeatureId) {
  // uses useAiFeatureGate + useLlm internally
  return {
    run: (args: Record<string, unknown>, opts?: { signal?: AbortSignal }) => Promise<T>,
    progress: PipelineProgress | null,
    running: boolean,
    error: string | null,
    cancelled: boolean,
    cancel: () => void,
    clearError: () => void,
  };
}
```

**Behavior:**
1. `run()` calls `prepareFeature(feature)` → if stop, set `error` from `interpretPrepareFeatureResult`, **do not toast** (see double-toast policy), reject promise.
2. Creates `AbortController`, sets `running`, clears error.
3. Calls `llm.runFeature(feature, args, { signal, onProgress: setProgress })`.
4. On success, clears progress, returns result.
5. On `AbortError`, set `cancelled` true, no error string.
6. On other errors, `setError(userMessageFor(e))`.

**`runStream` signature (same file, B3 merged here):**

```typescript
runStream: (
  prompt: string,
  onChunk: (text: string) => void,
  opts?: { system?: string; maxTokens?: number },
) => Promise<void>;
```

- [ ] **Step 1: Write hook test with mocked gate/llm**
- [ ] **Step 2: Implement hook + runStream**
- [ ] **Step 3: Commit**

~~Task B3 separate file~~ — merged into B2 to avoid hook proliferation.

---

## Part C — Surface migrations

### Task C1: AI Advisor → `AiRunStatus`

**Files:**
- Modify: `frontend/src/components/ai-advisor.tsx`

- [ ] Replace `AiStepProgress` import with `AiRunStatus`
- [ ] Optionally refactor `send()` to use `useAiPipelineRun("free_form_qa")` — behavior must remain identical
- [ ] Verify FAB pulse + `aria-busy` on send button when `running`
- [ ] Run `npm run test:run -- src/components/ai-advisor.test.tsx`

---

### Task C2: Dashboard InsightsPanel

**Files:**
- Modify: `frontend/src/app/(app)/page.tsx` (`InsightsPanel`)

**Current:** React Query `queryFn` calls `runFeature` directly; expand calls `prepareFeature` once.

**Target:**
- On expand: `prepareFeature` + set `aiReady` (keep)
- Replace insights queryFn to use local state OR custom hook that exposes `progress` during fetch
- Show `AiRunStatus` above skeleton while `isFetching && progress`
- On gate fail: set inline error via `interpretPrepareFeatureResult` (not silent return)
- Wire cancel: abort query via `queryClient.cancelQueries` or move off react-query for AI leg

**Recommended approach:** Replace React Query for the AI insights leg with imperative fetch via `useAiPipelineRun`. Keep React Query only for non-AI data.

**Concrete pattern for C2/C3:**

```typescript
const ai = useAiPipelineRun<{ advice: string }>("financial_advice");
const [bullets, setBullets] = useState<string[]>([]);
const [insightsError, setInsightsError] = useState<string | null>(null);

const loadInsights = useCallback(async () => {
  setInsightsError(null);
  try {
    const result = await ai.run({
      question: "Give 3-5 specific, actionable insights…",
    });
    const parsed = result.advice.split(/\n+/).map(/* strip bullets */).filter(Boolean);
    setBullets(parsed.length ? parsed : [result.advice]);
  } catch {
    if (!ai.cancelled) setInsightsError(ai.error ?? "Could not load AI insights.");
  }
}, [ai]);

// On expand: prepareFeature once (existing), set aiReady, then loadInsights()
// On refresh button: loadInsights() directly (skip re-gate if aiReady — document in comment)
```

Render `{ai.running && <AiRunStatus progress={ai.progress} onCancel={ai.cancel} />}` above skeleton.

- [ ] Implement + test manually + commit

---

### Task C3: Budget page (patterns + recommendations)

**Files:**
- Modify: `frontend/src/app/(app)/budget/page.tsx`

**SpendingPatternsPanel:**
- Same pattern as C2 for insights query leg
- Keep `aiApi.getSpendingPatterns` on react-query (non-AI)

**Budget recommendations button (`handleLoadAiSuggestions`):**
- Replace inline `prepareFeature` + `runFeature` with `useAiPipelineRun("budget_recommendations")`
- Show `AiRunStatus` near button while loading
- Replace `toastPlainError` path with inline error region above suggestions panel when hook `error` set

- [ ] Commit

---

### Task C4: Plan debt tab

**Files:**
- Modify: `frontend/src/app/(app)/plan/page.tsx`

**Debt recommendation (`handleGetRecommendation`):**
- Use `useAiPipelineRun("financial_advice")`
- Show `AiRunStatus` under button during run

**Rate guidance (`handleSuggestRates`):**
- Use same hook
- Replace `toastApiError` with `toastMaybeAiAvailability` + inline error
- **Remove dead structured rate UI:** delete `rateSuggestions`, `visibleRateSuggestions`, `pendingSuggestions`, `acceptRateSuggestion`, `handleAcceptAll`, `dismissedRates`, `acceptedRateIds` state and JSX cards (~lines 450-620 region) — keep only `rateNote` free-text display
- Add comment: structured per-account rates deferred until pipeline returns typed schema

- [ ] Run `npm run quality:check` (fallow may flag removed exports)
- [ ] Commit

---

### Task C5: Explain charge

**Files:**
- Modify: `frontend/src/components/llm/explain-charge.tsx`

- [ ] Use `runStream` pattern with `AbortController`
- [ ] Show “Explaining…” header row while streaming (spinner + cancel)
- [ ] On cancelled setup from gate: show `AiErrorWithSettings` with cancelled message
- [ ] Test: extend explain-charge tests if present, or add minimal render test

---

### Task C6: Categorize suggestions

**Files:**
- Modify: `frontend/src/hooks/use-categorize-suggestions.ts`
- Modify: `frontend/src/app/(app)/transactions/page.tsx`
- Modify: `frontend/src/app/(app)/rules/page.tsx`

- [ ] In hook: on gate fail, set `error` string before throw (or return `{ ok: false, error }` — prefer keeping throw but ensure mutation `onError` sets visible state)
- [ ] Add inline `MaybeAiErrorWithSettings` above suggest button when `categorizeAi.error`
- [ ] Show tier badge after success: “On-device (Nano)” / “On-device (WebGPU)” using hook `tier`

---

### Task C7: FSA review progress

**Files:**
- Modify: `frontend/src/components/transactions/fsa-review-panel.tsx`
- Modify: `frontend/src/hooks/use-fsa-review-scan.ts` (if needed)

- [ ] Change batch progress condition from `(loading || fetching) && !fsaData` to `(loading || fetching) && batchProgress`
- [ ] Render `AiRunStatus` with `batch={{ done, total }}` instead of plain text
- [ ] Fix panel header copy: change “When this section is open, we scan…” to “Click Scan now to run AI on eligible transactions…”
- [ ] Commit

---

### Task C8: Disable unwired features

**Files:**
- Modify: `frontend/src/lib/llm/features.ts`

- [ ] Set `enabled: false` for `goal_planning`, `spending_summary`, `anomaly_explanation`
- [ ] Add test in `features.test.ts`:

```typescript
it("leaves unwired features disabled until UI exists", () => {
  for (const id of ["goal_planning", "spending_summary", "anomaly_explanation"] as const) {
    expect(getFeaturePolicy(id).enabled).toBe(false);
  }
});
```

- [ ] Fix stale comment in `frontend/src/lib/llm/contracts.ts` header (tier defaults now 1)
- [ ] Commit

---

## Part E — Phase 0 quick ship (optional first PR)

Ship before full progress migration if time-constrained:

| Task | User-visible fix |
|------|------------------|
| A1 | Heavy AI works when WebGPU cached |
| A4 | Correct troubleshooting copy |
| C7 | FSA re-scan shows progress |
| C8 | Router won't advertise dead features |

PR title: `fix: AI setup gate and FSA progress (phase 0)`. Follow with Phase 1–2 PR.

---

## Part D — Verification

### Task D1: Automated CI

- [ ] Run `./scripts/ci-local.sh` from repo root — must pass

### Task D2: Manual QA checklist

Test on **Chrome desktop** with AI enabled in Settings:

| # | Action | Expected |
|---|--------|----------|
| 1 | Fresh Nano (`downloadable`): open Dashboard AI Suggestions | Wizard or activate flow; then insights load |
| 2 | WebGPU cached + Nano needs setup: Budget → AI Suggestions | Wizard opens (regression for A1) |
| 3 | AI Advisor send question | Step labels rotate; cancel aborts |
| 4 | Budget spending patterns expand | Step progress during narrative bullets |
| 5 | Plan → Get AI Recommendation | Step progress; error shows settings link if AI off |
| 6 | Transactions → Suggest categories (no AI) | Inline error + toast with settings |
| 7 | FSA Scan now → re-scan | Batch progress visible second time |
| 8 | Explain charge | Streaming indicator; cancel works |
| 9 | Turn AI off in Settings → try categorize | Settings link in toast |

---

## Commit strategy

1. `fix: ensure Nano wizard when WebGPU cached` (A1)
2. `feat: shared prepare result helper and richer AI errors` (A2–A3)
3. `fix: remove Ollama copy from AI surfaces` (A4)
4. `feat: AiRunStatus and useAiPipelineRun` (B1–B2, includes runStream)
5. `refactor: migrate AI surfaces to shared progress hooks` (C1–C7) — may split per surface
6. `chore: disable unwired AI features in registry` (C8)

---

## Out of scope (explicit)

- Wiring UI for `goal_planning`, `spending_summary`, `anomaly_explanation`
- Structured per-account rate suggestions on Plan (removed, not rebuilt)
- Removing dead cloud wizard branches in `local-ai-setup-wizard.tsx`
- E2E Playwright suite (optional follow-up)
- Backend changes beyond tests/copy

---

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| React Query + cancel complexity on Dashboard/Budget | Prefer moving LLM call out of `queryFn` into hook |
| `useAiPipelineRun` re-render loops | Stabilize callbacks with `useCallback`; test with renderHook |
| FSA batch progress flicker | Keep `batchProgress` until scan completes, then clear in `finally` |
| Plan rate UI removal breaks user expectation | Free-text `rateNote` remains; copy explains “verify on statements” |

---

## Estimated effort

| Part | Days |
|------|------|
| E — Phase 0 quick ship | 0.5–1 |
| A — Reliability (full) | 0.5–1 |
| B — Infrastructure | 1–1.5 |
| C — Migrations | 2–3 |
| D — QA | 0.5 |
| **Total** | **4–6 days** |

---

## Plan review log (two improvement passes)

### Pass 1 — Spec coverage & correctness

| Finding | Resolution |
|---------|------------|
| Task numbers in feature map didn't match Part C labels | Renumbered to C1–C8 |
| `PrepareFeatureResult` imported from client `ai-feature-gate` → circular deps | Added `prepare-feature-types.ts` |
| Double-toast when gate + caller both warn | Documented policy: inline only for gate failures |
| A1 `ensureReady` logic had redundant branches | Simplified to Nano-needs-setup vs ready |
| FSA/categorize forced into pipeline hook | Added run-model taxonomy; FSA keeps own hook |
| Missing Phase 0 for fast user relief | Added Part E |
| Missing `contracts.ts` stale doc | Added to C8 |
| C2/C3 React Query migration underspecified | Added concrete `loadInsights` pattern |

### Pass 2 — UX, a11y, and execution quality

| Finding | Resolution |
|---------|------------|
| B3 separate hook file = proliferation | Merged `runStream` into B2 |
| No a11y acceptance criteria | Added checklist under B1 |
| No visual spec for progress component | Added design tokens under B1 |
| No parallelization guidance | Added dependency graph + parallel note |
| Plan rate structured UI decision ambiguous | Explicit: remove dead UI, keep free-text (YAGNI) |
| Refresh re-gating unclear | Document skip re-gate when `aiReady` in C2 pattern |
| Missing regression test for disabled features | Added exact test code in C8 |

### Remaining follow-ups (post-plan, not blocking)

- Wire `ensureLocalSetup(featureId)` through wizard copy (cosmetic)
- Remove dead cloud branches in `local-ai-setup-wizard.tsx`
- Playwright e2e: one path per run model (4 tests)
- Future: structured rate schema on Plan when `financial_advice` pipeline supports it

---

## Execution handoff

Plan saved to `docs/superpowers/plans/2026-06-28-ai-features-reliability-and-progress-ux.md`.

**Two execution options:**

1. **Subagent-driven (recommended)** — one subagent per task (A1, B2, C2, …), review between tasks
2. **Inline** — implement Phase 0 in this session, then Phase 1–2 in follow-ups

**Which approach do you want?**
