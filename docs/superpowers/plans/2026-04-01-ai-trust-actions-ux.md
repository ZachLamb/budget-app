# AI trust, evidence spine, and UX coherence — Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Phase 1 (deterministic chat evidence + hardened action/errors + aligned offline copy) and Phase 2 (Budget + Transactions entry points + NBA card parity) from `docs/superpowers/specs/2026-04-01-ai-trust-actions-ux-design.md`.

**Architecture:** Reuse data already loaded for `_build_financial_context` by adding a typed **`evidence` payload** (display-only, built server-side) attached to the **final SSE event** of `/api/ai/chat/stream`. The React Advisor parses `evidence` on `done` and renders a small **`ChatEvidencePanel`**. Context entry points open the existing **`AiAdvisor`** via **URL search params** (`ai_prompt`, `ai_open`) read in `providers` or layout — no second chat implementation. NBA stays LLM-free; only **Card** styling/copy** align with Advisor.

**Tech stack:** FastAPI, Pydantic v2, SQLAlchemy async, pytest; Next.js App Router, TanStack Query, Vitest + Testing Library.

---

## File structure (create / modify)

| Path | Responsibility |
|------|------------------|
| `backend/app/api/routes/ai.py` | Pydantic models for `evidence` items; `_build_chat_evidence_list()`; extend `chat_stream` final SSE payload; optional `ParseActionResponse` / `ExecuteActionResponse` fields later |
| `backend/tests/test_ai_chat_evidence.py` | Pure tests for evidence serialization and empty-data edge cases |
| `frontend/src/lib/ai-evidence.ts` | Zod or TypeScript types + `parseChatEvidence()` guard for unknown shapes |
| `frontend/src/components/chat-evidence-panel.tsx` | Renders `category_spending` (and forwards-compatible `unknown`) |
| `frontend/src/components/ai-advisor.tsx` | Store `evidence` on assistant message; parse SSE `done.evidence`; optional confirm-button disable |
| `frontend/src/lib/ai-messages.ts` (optional) | Shared copy for AI disabled / no backend (import from advisor + settings if deduping) |
| `frontend/src/app/budget/page.tsx` | Link or button “Ask about this month” → `/?ai_open=1&ai_prompt=...` (or `/budget?...` if advisor reads route — prefer global `/?` so FAB is one place) |
| `frontend/src/app/transactions/page.tsx` | Same pattern for “Help categorize” prefill |
| `frontend/src/components/next-best-action.tsx` | Card header/button classes to match `chat-evidence-panel` or `Card` patterns from Advisor |
| `frontend/src/lib/providers.tsx` or `frontend/src/app/layout.tsx` | Pass `searchParams` consumer: open advisor + set draft prompt (client-only) |

---

### Task 1: Backend — evidence models and builder

**Files:**
- Modify: `backend/app/api/routes/ai.py`
- Create: `backend/tests/test_ai_chat_evidence.py`

- [ ] **Step 1: Add Pydantic models and builder function**

Place after existing `ChatResponse` / schema section (near line 77). Use a **discriminated union** by `type` string for forward compatibility.

```python
from decimal import Decimal
from typing import Literal
from pydantic import Field

class CategorySpendingLine(BaseModel):
    category: str = Field(..., max_length=200)
    amount: float = Field(..., ge=0)  # display spend as positive

class ChatEvidenceCategorySpending(BaseModel):
    type: Literal["category_spending"] = "category_spending"
    month: str = Field(..., pattern=r"^\d{4}-\d{2}$")
    lines: list[CategorySpendingLine] = Field(default_factory=list, max_length=25)

# Add more *ChatEvidence* models here as phases progress.

ChatEvidenceItem = ChatEvidenceCategorySpending  # Union[...] when >1 type


def build_category_spending_evidence(
    month_key: str, rows: list[tuple[str, Decimal]]
) -> list[dict]:
    """Pure helper — tested without DB. `rows` are (category_name, sum_amount) with negative amounts for spend."""
    lines: list[CategorySpendingLine] = []
    for name, amt in rows:
        lines.append(CategorySpendingLine(category=name, amount=float(abs(amt))))
    item = ChatEvidenceCategorySpending(month=month_key, lines=lines)
    return [item.model_dump()]


async def _build_chat_evidence_list(
    db: AsyncSession, household_id: str
) -> list[dict]:
    """Deterministic, display-only snippets mirroring data in the chat system prompt."""
    today = date.today()
    month_start = today.replace(day=1)
    month_key = month_start.strftime("%Y-%m")

    spend_result = await db.execute(
        select(Category.name, func.sum(Transaction.amount))
        .join(Transaction, Transaction.category_id == Category.id)
        .join(Account, Transaction.account_id == Account.id)
        .where(Account.household_id == household_id)
        .where(Transaction.date >= month_start)
        .where(Transaction.amount < 0)
        .group_by(Category.name)
        .order_by(func.sum(Transaction.amount))
        .limit(12)
    )
    rows = list(spend_result.all())
    return build_category_spending_evidence(month_key, rows)
```

- [ ] **Step 2: Run Python syntax check**

Run: `cd /Users/zach/Code/budget-app/backend && python -c "from app.api.routes import ai"`

Expected: no `ImportError` (fix circular imports if any by moving models to `app/schemas/ai_evidence.py` only if `ai.py` import cycle appears).

- [ ] **Step 3: Unit test the pure helper**

Create `backend/tests/test_ai_chat_evidence.py`:

```python
from decimal import Decimal

import pytest

from app.api.routes.ai import build_category_spending_evidence, ChatEvidenceCategorySpending


def test_build_category_spending_evidence_one_line():
    out = build_category_spending_evidence(
        "2026-04", [("Groceries", Decimal("-120.50"))]
    )
    assert len(out) == 1
    parsed = ChatEvidenceCategorySpending.model_validate(out[0])
    assert parsed.type == "category_spending"
    assert parsed.month == "2026-04"
    assert parsed.lines[0].category == "Groceries"
    assert parsed.lines[0].amount == pytest.approx(120.50)


def test_build_category_spending_evidence_empty_rows():
    out = build_category_spending_evidence("2026-04", [])
    parsed = ChatEvidenceCategorySpending.model_validate(out[0])
    assert parsed.lines == []
```

Run: `cd backend && pytest tests/test_ai_chat_evidence.py -v`

Expected: PASS after Step 1 implementation.

- [ ] **Step 4: Commit**

```bash
git add backend/app/api/routes/ai.py backend/tests/test_ai_chat_evidence.py
git commit -m "feat(ai): add deterministic chat evidence payload and tests"
```

---

### Task 2: Backend — attach evidence to SSE `done` event

**Files:**
- Modify: `backend/app/api/routes/ai.py` (`chat_stream`)

- [ ] **Step 1: Build evidence once per request**

Inside `chat_stream`, after `ctx = await _build_financial_context(...)` add:

```python
    evidence_list = await _build_chat_evidence_list(db, household_id)
```

- [ ] **Step 2: Include evidence in final yield**

Find the generator in `chat_stream` where it emits `done`. Change the final JSON payload to include `evidence`:

```python
        yield f"data: {json.dumps({'done': True, 'model_source': detected_source, 'evidence': evidence_list})}\n\n"
```

Ensure `evidence_list` is in closure scope of `generate()`.

- [ ] **Step 3: Manual smoke (optional)**

Run API with Ollama stopped: expect existing `error` event; with Ollama up: capture last SSE line and verify JSON contains `evidence` array.

- [ ] **Step 4: Commit**

```bash
git add backend/app/api/routes/ai.py
git commit -m "feat(ai): include evidence in chat stream completion event"
```

---

### Task 3: Frontend — types and SSE handling

**Files:**
- Create: `frontend/src/lib/ai-evidence.ts`
- Modify: `frontend/src/components/ai-advisor.tsx`

- [ ] **Step 1: Add TypeScript types and parser**

`frontend/src/lib/ai-evidence.ts`:

```typescript
export type ChatEvidenceCategorySpending = {
  type: "category_spending";
  month: string;
  lines: { category: string; amount: number }[];
};

export type ChatEvidenceItem = ChatEvidenceCategorySpending;

export function parseChatEvidence(raw: unknown): ChatEvidenceItem[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatEvidenceItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (o.type === "category_spending" && typeof o.month === "string" && Array.isArray(o.lines)) {
      out.push({
        type: "category_spending",
        month: o.month,
        lines: o.lines
          .filter((l): l is Record<string, unknown> => !!l && typeof l === "object")
          .map((l) => ({
            category: String(l.category ?? ""),
            amount: Number(l.amount) || 0,
          })),
      });
    }
  }
  return out;
}
```

- [ ] **Step 2: Extend `Message` interface**

In `ai-advisor.tsx`, add optional `evidence?: ChatEvidenceItem[]` to the `Message` interface.

- [ ] **Step 3: On SSE `evt.done`, attach evidence**

In the loop where `if (evt.done)` is handled, after `setModelSource`, merge `parseChatEvidence(evt.evidence)` into `copy[assistantIdx]`:

```typescript
import { parseChatEvidence, type ChatEvidenceItem } from "@/lib/ai-evidence";
// ...
            if (evt.done) {
              setModelSource(evt.model_source ?? "");
              const evidence = parseChatEvidence(
                (evt as { evidence?: unknown }).evidence
              );
              setMessages((prev) => {
                const copy = [...prev];
                copy[assistantIdx] = {
                  ...copy[assistantIdx],
                  streaming: false,
                  ...(evidence.length ? { evidence } : {}),
                };
                return copy;
              });
            }
```

- [ ] **Step 4: Run frontend unit tests (if any added) or `npm run lint`**

Run: `cd frontend && npm run lint`

Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/ai-evidence.ts frontend/src/components/ai-advisor.tsx
git commit -m "feat(ai): parse chat evidence from SSE done event"
```

---

### Task 4: Frontend — `ChatEvidencePanel` component

**Files:**
- Create: `frontend/src/components/chat-evidence-panel.tsx`
- Modify: `frontend/src/components/ai-advisor.tsx`

- [ ] **Step 1: Implement panel**

```tsx
"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ChatEvidenceItem } from "@/lib/ai-evidence";
import { formatCurrency } from "@/lib/format";

export function ChatEvidencePanel({ items }: { items: ChatEvidenceItem[] }) {
  if (!items.length) return null;
  return (
    <div className="space-y-2 mt-2" data-testid="chat-evidence-panel">
      {items.map((ev, i) =>
        ev.type === "category_spending" ? (
          <Card key={i} className="border-dashed bg-muted/30">
            <CardHeader className="py-2 pb-0">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                Top spending ({ev.month})
              </CardTitle>
            </CardHeader>
            <CardContent className="py-2 text-sm">
              <ul className="space-y-0.5">
                {ev.lines.slice(0, 8).map((line, j) => (
                  <li key={j} className="flex justify-between gap-2">
                    <span className="truncate">{line.category}</span>
                    <span className="tabular-nums shrink-0">
                      {formatCurrency(line.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null
      )}
    </div>
  );
}
```

- [ ] **Step 2: Render below assistant bubble**

In the message map, after assistant `content` for non-streaming messages, render `<ChatEvidencePanel items={m.evidence ?? []} />` when `m.role === "assistant"`.

- [ ] **Step 3: Vitest component test**

Create `frontend/src/components/chat-evidence-panel.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChatEvidencePanel } from "./chat-evidence-panel";

describe("ChatEvidencePanel", () => {
  it("renders category spending", () => {
    render(
      <ChatEvidencePanel
        items={[
          {
            type: "category_spending",
            month: "2026-04",
            lines: [{ category: "Groceries", amount: 50 }],
          },
        ]}
      />
    );
    expect(screen.getByTestId("chat-evidence-panel")).toBeInTheDocument();
    expect(screen.getByText(/Groceries/)).toBeInTheDocument();
  });
});
```

Run: `cd frontend && npm run test:run -- src/components/chat-evidence-panel.test.tsx`

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/chat-evidence-panel.tsx frontend/src/components/chat-evidence-panel.test.tsx frontend/src/components/ai-advisor.tsx
git commit -m "feat(ai): render evidence cards in advisor transcript"
```

---

### Task 5: Hardening — confirm action once + error copy

**Files:**
- Modify: `frontend/src/components/ai-advisor.tsx`

- [ ] **Step 1: Prevent double execute**

In `executeAction`, at the start of the try block after resolving `msgIdx`, if `copy[msgIdx].actionStatus !== "pending"` return early (guard).

Add `useRef` map or set `actionStatus` to `"confirmed"` optimistically only on success — already partially there; ensure **Confirm** button is `disabled={m.actionStatus !== "pending"}`.

- [ ] **Step 2: Verify button disabled states**

In JSX for the pending action card, set `disabled={streaming || m.actionStatus !== "pending"}` on Confirm.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ai-advisor.tsx
git commit -m "fix(ai): disable confirm after action completes or twice"
```

---

### Task 6: Messaging alignment — no backend / disabled

**Files:**
- Modify: `frontend/src/components/ai-advisor.tsx`
- Modify: `frontend/src/app/settings/page.tsx` (only if copy diverges)

- [ ] **Step 1: Centralize strings (optional file)**

Create `frontend/src/lib/ai-copy.ts`:

```typescript
export const AI_COPY = {
  noBackend:
    "No AI backend available. Start Ollama and ensure your backend points to it.",
  disabledShort: "AI is turned off in Settings.",
} as const;
```

Use `AI_COPY.noBackend` when `status.active_backend === "none"` inline banner matches backend `_NO_AI_MSG` meaning (shorten for UI if needed).

- [ ] **Step 2: Replace duplicate inline strings in Advisor**

Search `ai-advisor.tsx` for offline / unavailable text and replace with `AI_COPY`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/ai-copy.ts frontend/src/components/ai-advisor.tsx
git commit -m "refactor(ai): centralize offline and disabled copy"
```

---

### Task 7: Phase 2 — URL-driven open + prompt

**Files:**
- Modify: `frontend/src/components/ai-advisor.tsx` (read `useSearchParams` from `next/navigation`)
- Modify: `frontend/src/app/page.tsx` or root layout wrapper — **only if** `AiAdvisor` is not under a component that already has `Suspense` for `useSearchParams`

**Pattern:** In `AiAdvisor`, on mount:

```typescript
const searchParams = useSearchParams();
useEffect(() => {
  const open = searchParams.get("ai_open") === "1";
  const prompt = searchParams.get("ai_prompt");
  if (open) setOpen(true);
  if (prompt) setInput(decodeURIComponent(prompt));
}, [searchParams]);
```

Wrap export in `Suspense` boundary in parent if Next.js requires it for static pages.

- [ ] **Step 1: Implement search param handling in `AiAdvisor`**

- [ ] **Step 2: Add Budget page button**

In `frontend/src/app/budget/page.tsx`, add a small `Button` or `Link`:

```tsx
<Link
  href={`/?ai_open=1&ai_prompt=${encodeURIComponent(
    "Help me understand my spending for this budget month and what to adjust."
  )}`}
>
  Ask AI about this month
</Link>
```

Place near month header / AI insights already on page.

- [ ] **Step 3: Transactions page prefill**

`frontend/src/app/transactions/page.tsx`: similar link with prompt like `"Help me categorize uncategorized transactions and suggest rules."`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ai-advisor.tsx frontend/src/app/budget/page.tsx frontend/src/app/transactions/page.tsx
git commit -m "feat(ai): open advisor from Budget and Transactions via URL params"
```

---

### Task 8: NBA card parity

**Files:**
- Modify: `frontend/src/components/next-best-action.tsx`

- [ ] **Step 1: Match Card chrome**

Import the same `Card` padding / title size as `chat-evidence-panel` or Advisor suggestion cards: e.g. `className` on `CardHeader` / `CardTitle` to align font sizes (`text-xs` / `text-sm`).

- [ ] **Step 2: Copy pass**

Ensure primary button uses verbs like “Review” / “Go to” per spec; do **not** add sparkles or “AI” wording.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/next-best-action.tsx
git commit -m "style(nba): align card styling with AI advisor panels"
```

---

### Task 9: Regression sweep

- [ ] **Step 1: Backend tests**

Run: `cd /Users/zach/Code/budget-app/backend && pytest tests/test_ai_chat_evidence.py tests/test_ai_llm_parsing.py -v`

Expected: All PASS

- [ ] **Step 2: Frontend tests**

Run: `cd frontend && npm run test:run`

Expected: All PASS

- [ ] **Step 3: Lint**

Run: `cd frontend && npm run lint`

Expected: PASS

- [ ] **Step 4: Final commit** (only if fixes needed)

```bash
git commit -am "chore: fix lint issues from AI UX plan"
```

---

## Plan self-review

**1. Spec coverage**

| Spec section | Task(s) |
|--------------|---------|
| Evidence in assistant replies (2.1) | Task 1–4 |
| Actions / confirmation (2.2) | Task 5 |
| Error categories / toasts (2.3) | Task 6 |
| Context entry points (3.1) | Task 7 |
| NBA vs Advisor coherence (3.2) | Task 8 |
| Empty/offline (3.3) | Task 6 |
| Phase 1 / 2 from spec §4 | Tasks 1–8 |
| Phase 3 depth / analytics | Explicitly **not** in this plan (per spec out-of-scope) |

**2. Placeholder scan:** No TBD steps; open extension points are “add models to union” in Task 1 comment.

**3. Type consistency:** `ChatEvidenceCategorySpending` field names match `parseChatEvidence` and `ChatEvidencePanel`; SSE uses `evidence_list` → `evidence` key in JSON → `parseChatEvidence`.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-01-ai-trust-actions-ux.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration.

2. **Inline execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach do you want?**
