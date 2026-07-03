# Wire goal_planning + spending_summary — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the already-built `goal_planning` pipeline in the Plan page (per-goal + plan-all), and add a light streaming `spending_summary` card to the Dashboard.

**Architecture:** `goal_planning` is a heavy Nano-only pipeline that already exists and is tested; we add optional goal targeting and wire UI via `useAiPipelineRun`. `spending_summary` is a light **streaming-text** feature — the Dashboard card renders deterministic spending-pattern facts itself and streams only a short narrative, so no schema or parser changes are needed.

**Tech Stack:** Next.js 16 / React / TypeScript, Vitest, React Query, shadcn/ui. Existing AI infra: `useAiPipelineRun`, `AiRunStatus`, `pipelines/goal.ts`, `/api/ai/facts/*`.

**Spec:** [2026-06-29-deferred-ai-features-design.md](../specs/2026-06-29-deferred-ai-features-design.md) § WS3, WS4a.

**Prerequisite:** Plan 1 (`finish-ai-reliability-branch`) committed — this plan depends on the shared `useAiPipelineRun`, `AiRunStatus`, and `prepare-feature-result` infrastructure from that branch.

## Global Constraints

- Heavy features are **Nano-only** (Tier 1); do not add Tier-2 paths for `goal_planning`.
- LLM output is untrusted: `goal_planning` keeps its verifier (`Check<GoalResult>[]`); `spending_summary` renders authoritative numbers from facts and treats streamed prose as text.
- Nano download requires user activation — AI runs only from an explicit button click, never on mount/expand.
- Demo mode must return canned results for every enabled feature (no model call). **Streaming caveat:** `llm.run`/`runStream` do NOT consult `demoStructuredResult` — only `runFeature`/`runStructuredJson` do. So streaming features (`spending_summary`) need an explicit demo path: add an `isDemoMode` short-circuit to `useAiPipelineRun.runStream` emitting `demoStreamText(feature)` (a new helper in `contracts.ts`). Done in Task 6; reused by Plan 3.
- Commit only when the human asks; tasks end at "stage", and a human triggers commits.

---

## File structure

| File | Action | Responsibility |
|------|--------|----------------|
| `frontend/src/lib/llm/pipelines/goal.ts` | Modify | Accept optional `goalId`; constrain prompt + verifier |
| `frontend/src/lib/llm/pipelines/goal.test.ts` | Modify | Targeting test |
| `frontend/src/lib/llm/useLlm.ts` | Modify | Pass `goalId` from params to `runGoalPipeline`; extend `RunFeatureParams` |
| `frontend/src/lib/llm/features.ts` | Modify | `goal_planning.enabled = true`, `spending_summary.enabled = true` |
| `frontend/src/lib/llm/features.test.ts` | Modify | Update enabled-set assertions |
| `frontend/src/lib/llm/contracts.ts` | Modify | Demo results for `goal_planning`, `spending_summary` |
| `frontend/src/app/(app)/plan/page.tsx` | Modify | Per-goal "AI plan" + "Plan my goals" on `GoalsTab` |
| `frontend/src/app/(app)/page.tsx` | Modify | Dashboard `SpendingSummaryCard` |
| `frontend/src/lib/api/ai.ts` (or existing facts client) | Modify | `getSpendingPatterns` reuse for the card (confirm via grep) |

---

### Task 1: Add optional goal targeting to the pipeline

**Files:**
- Modify: `frontend/src/lib/llm/pipelines/goal.ts`
- Modify: `frontend/src/lib/llm/pipelines/goal.test.ts`

**Interfaces:**
- Produces: `runGoalPipeline(ctx: PipelineContext, params?: { goalId?: string }): Promise<GoalResult>`. When `goalId` is set, the returned `plan.goal_id === goalId`.

- [ ] **Step 1: Write the failing test**

Add to `goal.test.ts` (mirror the existing mock setup in that file for `ground` and `ctx.provider`):

```ts
it("plans the requested goal when goalId is provided", async () => {
  // ground() mocked to return two goals: "g1", "g2" (reuse this file's helper)
  // provider mocked to echo a schema-valid plan for whichever goal_id is in the prompt
  const result = await runGoalPipeline(ctx, { goalId: "g2" });
  expect(result.plan.goal_id).toBe("g2");
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd frontend && npm run test:run -- src/lib/llm/pipelines/goal.test.ts`
Expected: FAIL — `runGoalPipeline` does not accept a second argument / ignores `goalId`.

- [ ] **Step 3: Implement targeting**

In `goal.ts`, change the signature and constrain the prompt + checks:

```ts
export async function runGoalPipeline(
  ctx: PipelineContext,
  params?: { goalId?: string },
): Promise<GoalResult> {
  return withNanoSlot(async () => {
    ctx.onProgress?.({ step: "ground", label: "Checking your goals…" });
    const facts = await ground<GoalFacts>("/ai/facts/goal", ctx.signal);

    const byId = new Map(facts.goals.map((g) => [g.goal_id, g]));
    const targetId = params?.goalId;
    const candidates =
      targetId && byId.has(targetId)
        ? facts.goals.filter((g) => g.goal_id === targetId)
        : facts.goals;

    const checks: Check<GoalResult>[] = [
      ({ plan }) => byId.has(plan.goal_id),
      ({ plan }) => (targetId ? plan.goal_id === targetId : true),
      ({ plan }) => plan.monthly_contribution >= 0,
      ({ plan }) => plan.note.trim().length > 0,
      ({ plan }) => {
        if (plan.monthly_contribution <= 0) return true;
        const goal = byId.get(plan.goal_id)!;
        const expected = Math.ceil(
          Math.max(0, goal.target_amount - goal.current_amount) /
            plan.monthly_contribution,
        );
        return Math.abs(plan.months_to_target - expected) <= 1;
      },
    ];

    const system =
      "You are a careful savings-planning assistant. Only use the provided goal IDs and the given amounts. Do not invent numbers.";
    const prompt =
      `Propose a contribution plan for ${targetId ? "this goal" : "ONE of these goals"}.\n` +
      `Use ONLY these goal_id values: ${candidates.map((g) => g.goal_id).join(", ")}.\n` +
      `Facts: ${JSON.stringify(candidates)}`;

    ctx.onProgress?.({ step: "generate", label: "Building a plan…" });
    const result = await generateVerified<GoalResult>(
      ctx.provider,
      { system, prompt, schema: schemaForFeature("goal_planning")!, signal: ctx.signal },
      checks,
      { signal: ctx.signal },
    );
    ctx.onProgress?.({ step: "done", label: "Done" });
    return result;
  });
}
```

- [ ] **Step 4: Run — expect PASS** (and existing goal tests still pass)

Run: `cd frontend && npm run test:run -- src/lib/llm/pipelines/goal.test.ts`
Expected: PASS.

- [ ] **Step 5: Stage**

```bash
git add frontend/src/lib/llm/pipelines/goal.ts frontend/src/lib/llm/pipelines/goal.test.ts
```

---

### Task 2: Thread `goalId` through `runFeature`

**Files:**
- Modify: `frontend/src/lib/llm/useLlm.ts:135-172` and the `RunFeatureParams` type (same file or its import).

**Interfaces:**
- Consumes: Task 1's `runGoalPipeline(ctx, { goalId })`.
- Produces: `runFeature("goal_planning", { goalId }, opts)` forwards `goalId`.

- [ ] **Step 1: Extend `RunFeatureParams`**

Find the `RunFeatureParams` interface (grep `RunFeatureParams` in `frontend/src/lib/llm/`) and add:

```ts
/** Optional target for goal_planning; plans this specific goal. */
goalId?: string;
```

- [ ] **Step 2: Forward it in the dispatch switch**

In `useLlm.ts`, change the `goal_planning` case:

```ts
case "goal_planning":
  return runGoalPipeline(pctx, { goalId: params?.goalId });
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Stage**

```bash
git add frontend/src/lib/llm/useLlm.ts
```

---

### Task 3: Enable the features + demo results

**Files:**
- Modify: `frontend/src/lib/llm/features.ts`
- Modify: `frontend/src/lib/llm/features.test.ts`
- Modify: `frontend/src/lib/llm/contracts.ts`

- [ ] **Step 1: Update the disabled-features test**

In `features.test.ts`, the existing test asserts `goal_planning`, `spending_summary`, `anomaly_explanation` are disabled. Change it to expect only `anomaly_explanation` disabled (it is wired in a later plan):

```ts
it("leaves only not-yet-wired features disabled", () => {
  expect(getFeaturePolicy("goal_planning").enabled).toBe(true);
  expect(getFeaturePolicy("spending_summary").enabled).toBe(true);
  expect(getFeaturePolicy("anomaly_explanation").enabled).toBe(false);
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd frontend && npm run test:run -- src/lib/llm/features.test.ts`
Expected: FAIL (still disabled).

- [ ] **Step 3: Flip the flags**

In `features.ts`, set `enabled: true` for `goal_planning` and `spending_summary`.

- [ ] **Step 4: Add demo results**

In `contracts.ts`, extend `demoStructuredResult` so `demoStructuredResult("goal_planning")` returns a valid `GoalResult`. (`spending_summary` streams, so its demo is handled in Task 6 via `runStream`, not through `demoStructuredResult`.) Match the existing demo entries' shape. Example for goal:

```ts
goal_planning: { plan: { goal_id: "demo-goal", monthly_contribution: 200, months_to_target: 10, note: "Steady $200/mo reaches this goal in about 10 months." } },
```

- [ ] **Step 5: Run — expect PASS**

Run: `cd frontend && npm run test:run -- src/lib/llm/features.test.ts src/lib/llm/contracts.test.ts`
Expected: PASS.

- [ ] **Step 6: Stage**

```bash
git add frontend/src/lib/llm/features.ts frontend/src/lib/llm/features.test.ts frontend/src/lib/llm/contracts.ts
```

---

### Task 4: Per-goal "AI plan" action on `GoalCard`

**Files:**
- Modify: `frontend/src/app/(app)/plan/page.tsx` (`GoalCard` + `GoalsTab`)

**Interfaces:**
- Consumes: `useAiPipelineRun<GoalResult>("goal_planning")`, `AiRunStatus`, `MaybeAiErrorWithSettings`.

- [ ] **Step 1: Add per-goal plan state + handler in `GoalCard`**

`GoalCard` currently receives `goal: FinancialGoal`. Add an AI run scoped to the card:

```tsx
const ai = useAiPipelineRun<GoalResult>("goal_planning");
const [plan, setPlan] = useState<GoalPlan | null>(null);

const handlePlan = async () => {
  setPlan(null);
  ai.clearError();
  try {
    const result = await ai.run({ goalId: goal.id });
    setPlan(result.plan);
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    // ai.error is already set by the hook; rendered below
  }
};
```

(Import `GoalResult`/`GoalPlan` types from `@/lib/llm/pipelines/goal`.)

- [ ] **Step 2: Render the action + result**

Inside the card body add:

```tsx
<Button size="sm" variant="outline" onClick={() => void handlePlan()} disabled={ai.running}>
  <Sparkles className={cn("mr-2 h-3 w-3", ai.running && "animate-pulse")} />
  {ai.running ? "Planning…" : "AI plan"}
</Button>
{ai.running ? <AiRunStatus progress={ai.progress} onCancel={ai.cancel} /> : null}
{ai.error ? <MaybeAiErrorWithSettings message={ai.error} /> : null}
{plan ? (
  <p className="text-xs text-muted-foreground">
    Contribute ${plan.monthly_contribution}/mo → about {plan.months_to_target} months. {plan.note}
  </p>
) : null}
```

- [ ] **Step 3: Manual check**

Run: `cd frontend && npm run dev`, open Plan → Goals, click "AI plan" on a goal (or use demo mode). Expect step progress then a contribution line; cancel aborts.

- [ ] **Step 4: Typecheck + stage**

```bash
cd frontend && npm run typecheck
git add "src/app/(app)/plan/page.tsx"
```

---

### Task 5: "Plan my goals" (plan-all) on `GoalsTab`

**Files:**
- Modify: `frontend/src/app/(app)/plan/page.tsx` (`GoalsTab`)

- [ ] **Step 1: Add a sequential plan-all handler**

In `GoalsTab`, over `activeGoals`:

```tsx
const ai = useAiPipelineRun<GoalResult>("goal_planning");
const [plans, setPlans] = useState<Record<string, GoalPlan>>({});

const planAll = async () => {
  ai.clearError();
  setPlans({});
  for (const g of activeGoals) {
    if (ai.cancelled) break;
    try {
      const result = await ai.run({ goalId: g.id });
      setPlans((prev) => ({ ...prev, [g.id]: result.plan }));
    } catch (err) {
      if ((err as Error).name === "AbortError") return; // user cancelled the loop
      break; // stop on first hard error; ai.error is shown
    }
  }
};
```

(The gate's wizard must not reopen mid-loop: `prepareFeature` returns ready quickly once set up, so successive `ai.run` calls do not reopen it.)

- [ ] **Step 2: Render the button + shared status**

Near the tab header:

```tsx
<Button size="sm" variant="outline" onClick={() => void planAll()} disabled={ai.running || activeGoals.length === 0}>
  <Sparkles className={cn("mr-2 h-4 w-4", ai.running && "animate-pulse")} /> Plan my goals
</Button>
{ai.running ? <AiRunStatus progress={ai.progress} onCancel={ai.cancel} /> : null}
{ai.error ? <MaybeAiErrorWithSettings message={ai.error} /> : null}
```

Pass `plans[goal.id]` down to each `GoalCard` (or render a small per-goal line under each card) so plan-all results are visible.

- [ ] **Step 3: Manual check + stage**

Run dev, click "Plan my goals" with 2+ active goals (demo mode is deterministic). Expect each goal to get a plan in order; cancel stops the loop.

```bash
cd frontend && npm run typecheck
git add "src/app/(app)/plan/page.tsx"
```

---

### Task 6: Dashboard `SpendingSummaryCard` (light streaming)

**Files:**
- Modify: `frontend/src/app/(app)/page.tsx`

**Interfaces:**
- Consumes: `useAiPipelineRun("spending_summary").runStream`, the existing spending-patterns facts client (grep `getSpendingPatterns` — reuse it), `AiRunStatus`, `MaybeAiErrorWithSettings`.

- [ ] **Step 1: Fetch + render deterministic facts**

Add a `SpendingSummaryCard` component:

```tsx
function SpendingSummaryCard() {
  const ai = useAiPipelineRun("spending_summary");
  const [summary, setSummary] = useState("");
  const { data: patterns } = useQuery({
    queryKey: ["spending-patterns"],
    queryFn: aiApi.getSpendingPatterns, // reuse existing client; confirm name via grep
  });

  const topMovers = (patterns?.patterns ?? [])
    .filter((p) => p.trend !== "stable")
    .slice(0, 4);
```

Render `topMovers` deterministically (category + pct_change) — these are the authoritative numbers.

- [ ] **Step 2: Add demo support to `runStream`, then stream the narrative on demand**

First, in `useAiPipelineRun.runStream` (`frontend/src/hooks/use-ai-pipeline-run.ts`), short-circuit demo mode before gating:

```ts
// at the top of runStream, after import { isDemoMode } from "@/lib/demo-mode";
if (isDemoMode) {
  for (const ch of demoStreamText(feature)) onChunk(ch);
  return;
}
```

Add `demoStreamText(feature: FeatureId): string[]` to `contracts.ts` returning a short canned string (split into a few chunks) per streaming feature. Then implement the card's streaming call:

```tsx
  const summarize = async () => {
    setSummary("");
    ai.clearError();
    const facts = JSON.stringify(topMovers);
    try {
      await ai.runStream(
        `In 1-2 sentences, summarize these category spending changes for the user. ` +
          `Use only these facts; do not invent numbers.\nFacts: ${facts}`,
        (chunk) => setSummary((s) => s + chunk),
        { maxTokens: 160 },
      );
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
    }
  };

  return (
    <Card>
      {/* deterministic topMovers list here */}
      <Button size="sm" variant="outline" onClick={() => void summarize()} disabled={ai.running || topMovers.length === 0}>
        <Sparkles className={cn("mr-2 h-3 w-3", ai.running && "animate-pulse")} /> AI summary
      </Button>
      {ai.running ? <AiRunStatus progress={ai.progress} onCancel={ai.cancel} /> : null}
      {ai.error ? <MaybeAiErrorWithSettings message={ai.error} /> : null}
      {summary ? <p className="text-sm whitespace-pre-wrap">{summary}</p> : null}
    </Card>
  );
}
```

- [ ] **Step 3: Mount it on the Dashboard**

Add `<SpendingSummaryCard />` to the dashboard layout in `page.tsx` (near the other insight panels).

- [ ] **Step 4: Manual check**

Run dev, open Dashboard, click "AI summary". Expect deterministic top movers always visible; the narrative streams in on click; cancel works; empty state when no movers.

- [ ] **Step 5: Typecheck + stage**

```bash
cd frontend && npm run typecheck
git add "src/app/(app)/page.tsx"
```

---

### Task 7: Verify + commit

- [ ] **Step 1: Full CI**

Run: `./scripts/ci-local.sh`
Expected: PASS.

- [ ] **Step 2: Stage docs + present commit** (human triggers)

```bash
git add docs/superpowers/plans/2026-06-29-wire-goal-planning-and-spending-summary.md
git commit -m "feat: wire goal_planning UI (per-goal + plan-all) and Dashboard spending summary"
```

---

## Self-review

- **Spec coverage:** WS3 pipeline targeting (T1-2) ✓, enable+demo (T3) ✓, per-goal UI (T4) ✓, plan-all (T5) ✓; WS4a streaming card with deterministic facts (T6) ✓.
- **Placeholders:** UI tasks reference exact components (`GoalCard`, `GoalsTab`, `aiApi.getSpendingPatterns`) and provide concrete handler code. The two grep notes (`RunFeatureParams`, `getSpendingPatterns`) resolve names that exist in-repo but whose exact location varies — deterministic, not vague.
- **Type consistency:** `runGoalPipeline(ctx, { goalId })` matches T1↔T2; `GoalResult`/`GoalPlan` imported from `pipelines/goal`; `useAiPipelineRun` returns `{ run, runStream, progress, running, error, cancelled, cancel, clearError }` as used.
- **Gate/UX:** all AI runs are button-triggered (user activation); demo mode covered in T3.
