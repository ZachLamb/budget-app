# Finish AI Reliability Branch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the remaining cleanup on `fix/ai-reliability-and-progress-ux` so the already-implemented (uncommitted) work is consistent and commit/ship-ready.

**Architecture:** Three small, independent cleanups (AI Advisor progress migration, residual copy fix, dead cloud-wizard removal), then a CI gate and commit. No new behavior. `AiStepProgress` already delegates to `AiRunStatus`, so the migration is a thin swap.

**Tech Stack:** Next.js 16 / React / TypeScript, Vitest, shadcn/ui, project CI via `./scripts/ci-local.sh`.

**Spec:** [2026-06-29-deferred-ai-features-design.md](../specs/2026-06-29-deferred-ai-features-design.md) § WS1.

## Global Constraints

- No "Ollama" or cloud-tier copy may remain in `frontend/src` user-facing strings or comments (history excepted).
- `AiStepProgress` stays as a back-compat shim only; do not delete it (other code may import it).
- Behavior must remain identical — this is cleanup, not a feature change.
- Commit only when the human asks (project rule); the final task prepares the commit but a human triggers it.

---

## File structure

| File | Action | Responsibility |
|------|--------|----------------|
| `frontend/src/components/ai-advisor.tsx` | Modify | Use `AiRunStatus` directly instead of `AiStepProgress` |
| `frontend/src/lib/api/llm-timeout.ts` | Modify | Drop "Ollama" from the doc comment |
| `frontend/src/components/llm/local-ai-setup-wizard.tsx` | Modify | Remove dead cloud-fallback props/branches |
| (any caller passing cloud props to the wizard) | Modify | Drop now-removed props |

---

### Task 1: Migrate AI Advisor to `AiRunStatus`

**Files:**
- Modify: `frontend/src/components/ai-advisor.tsx:23` (import) and `:312-318` (usage)

**Interfaces:**
- Consumes: `AiRunStatus({ progress, onCancel, className })` from `@/components/llm/ai-run-status`.
- Produces: nothing new.

- [ ] **Step 1: Confirm the current render in a test or by eye**

Run: `cd frontend && npm run test:run -- src/components/ai-advisor.test.tsx`
Expected: PASS (baseline before change).

- [ ] **Step 2: Swap the import**

In `frontend/src/components/ai-advisor.tsx` replace line 23:

```tsx
import { AiStepProgress } from "@/components/llm/ai-step-progress";
```

with:

```tsx
import { AiRunStatus } from "@/components/llm/ai-run-status";
```

- [ ] **Step 3: Swap the usage**

Replace the streaming block (around lines 312-318):

```tsx
<AiStepProgress
  progress={progress ?? { step: "start", label: "Starting…" }}
  onCancel={() => abortRef.current?.abort()}
/>
```

with:

```tsx
<AiRunStatus
  progress={progress ?? { step: "start", label: "Starting…" }}
  onCancel={() => abortRef.current?.abort()}
/>
```

(`AiRunStatus` accepts the same `progress`/`onCancel` props; `batch` is optional.)

- [ ] **Step 4: Run tests**

Run: `cd frontend && npm run test:run -- src/components/ai-advisor.test.tsx`
Expected: PASS — identical behavior.

- [ ] **Step 5: Stage (commit batched in Task 4)**

```bash
git add frontend/src/components/ai-advisor.tsx
```

---

### Task 2: Remove residual "Ollama" copy

**Files:**
- Modify: `frontend/src/lib/api/llm-timeout.ts:1`

- [ ] **Step 1: Edit the comment**

Replace line 1 of `frontend/src/lib/api/llm-timeout.ts`:

```ts
/** Axios timeout for routes that wait on LLM completion (Ollama / demo). */
```

with:

```ts
/** Axios timeout for routes that wait on LLM completion (on-device / demo). */
```

- [ ] **Step 2: Grep guard**

Run: `cd frontend && rg -i ollama src`
Expected: zero matches.

- [ ] **Step 3: Stage**

```bash
git add frontend/src/lib/api/llm-timeout.ts
```

---

### Task 3: Remove dead cloud branches from the setup wizard

**Files:**
- Modify: `frontend/src/components/llm/local-ai-setup-wizard.tsx`
- Modify: any component that renders `<LocalAiSetupWizard … />` and passes cloud props (grep below)

**Interfaces:**
- Removes from `WizardProps`: `cloudAvailable`, `onCloudFallback` (and any `Cloud`-icon-only imports). Keep `onGrantConsent` (it drives the on-device download, not cloud).

- [ ] **Step 1: Find every cloud reference**

Run:
```bash
cd frontend
rg -n "cloudAvailable|onCloudFallback|Use cloud AI|Cloud\b" src/components/llm/local-ai-setup-wizard.tsx
rg -rn "cloudAvailable|onCloudFallback" src --glob '!**/local-ai-setup-wizard.tsx'
```
Note every prop site and JSX branch. The second command finds external callers passing these props.

- [ ] **Step 2: Remove the cloud props and JSX**

In `local-ai-setup-wizard.tsx`:
- Delete `cloudAvailable` and `onCloudFallback` from `WizardProps` and from every `Pick<WizardProps, …>` sub-component prop list.
- Delete the `{cloudAvailable && ( <Button … onClick={onCloudFallback}> … Use cloud AI … </Button> )}` blocks (around lines 103-106 and 152-155).
- Remove the now-unused `Cloud` import from the `lucide-react` import (line 8) **only if** no other usage remains (re-grep `Cloud\b`).
- Remove the "to a cloud model for this setup path" sentence (around line 74).

- [ ] **Step 3: Remove the props at call sites**

For each caller found in Step 1's second command, delete the `cloudAvailable={…}` and `onCloudFallback={…}` props.

- [ ] **Step 4: Typecheck + tests**

Run:
```bash
cd frontend
npm run typecheck
npm run test:run -- src/components/llm
```
Expected: PASS, no unused-symbol or missing-prop errors.

- [ ] **Step 5: Stage**

```bash
git add frontend/src/components/llm/local-ai-setup-wizard.tsx
# plus any modified caller files
```

---

### Task 4: CI gate and commit the branch

**Files:** none (verification + git).

- [ ] **Step 1: Full local CI**

Run: `./scripts/ci-local.sh`
Expected: PASS (lint, typecheck, tests, build). Fix any fallout before continuing.

- [ ] **Step 2: Review the full diff**

Run: `git status && git diff --stat`
Confirm the change set matches the reliability work plus these three cleanups; nothing unexpected.

- [ ] **Step 3: Commit per the reliability plan's strategy**

> Project rule: a human triggers the commit. Present these commands; do not auto-run.

Suggested grouping (from the prior plan's commit strategy):
```bash
git add frontend/src/lib/llm/prepare-feature-types.ts frontend/src/lib/llm/prepare-feature-result.ts frontend/src/lib/llm/prepare-feature-result.test.ts frontend/src/lib/llm/errors.ts frontend/src/lib/llm/errors.test.ts
git commit -m "feat: shared prepare-result helper and richer AI errors"

git add frontend/src/components/llm/ai-run-status.tsx frontend/src/components/llm/ai-run-status.test.tsx frontend/src/components/llm/ai-step-progress.tsx frontend/src/hooks/use-ai-pipeline-run.ts frontend/src/hooks/use-ai-pipeline-run.test.ts
git commit -m "feat: AiRunStatus and useAiPipelineRun shared progress infra"

git add frontend/src/hooks/use-local-ai-setup.ts frontend/src/hooks/use-local-ai-setup.test.ts
git commit -m "fix: open Nano setup wizard when WebGPU model is already cached"

git add "frontend/src/app/(app)" frontend/src/components/llm/explain-charge.tsx frontend/src/components/llm/explain-charge.test.tsx frontend/src/components/transactions/fsa-review-panel.tsx frontend/src/components/ai-advisor.tsx frontend/src/hooks/use-categorize-suggestions.ts frontend/src/hooks/use-categorize-suggestions.test.ts frontend/src/app/layout.tsx frontend/src/lib/api/llm-timeout.ts frontend/src/components/llm/local-ai-setup-wizard.tsx
git commit -m "refactor: migrate AI surfaces to shared progress + status"

git add frontend/src/lib/llm/features.ts frontend/src/lib/llm/features.test.ts frontend/src/lib/llm/contracts.ts
git commit -m "chore: disable unwired AI features and fix stale contract doc"

git add docs/superpowers/plans/2026-06-28-ai-features-reliability-and-progress-ux.md docs/superpowers/specs/2026-06-29-deferred-ai-features-design.md docs/superpowers/plans/2026-06-29-*.md
git commit -m "docs: AI reliability plan, deferred-features spec and plans"
```

- [ ] **Step 4: Confirm clean tree**

Run: `git status`
Expected: working tree clean (or only intentionally-unstaged files).

---

## Self-review

- **Spec coverage (WS1):** ai-advisor migration (T1) ✓, residual Ollama copy (T2) ✓, dead cloud-wizard branches (T3) ✓, CI + commit (T4) ✓.
- **Placeholders:** none — exact lines/commands given. T3 requires a grep because external callers aren't statically known here; the grep makes it deterministic.
- **Type consistency:** `AiRunStatus` prop names (`progress`, `onCancel`, `className`) match `ai-run-status.tsx`; `WizardProps` removals are paired at definition and call sites.
