---
name: Multi-discipline app review
overview: Consolidated recommendations from seven disciplines—v3 refined by a second pass (sub-agents) for factual accuracy, edge cases, acceptance criteria, and deduplicated workstreams.
todos:
  - id: splits-budget-reports-ai
    content: "Backend: shared predicate for category sums—include split children with category_id; exclude split parents; keep parent-only for month cashflow/balances to avoid double-count. Apply in budget.py, reports category endpoints, _build_financial_context, _build_budget_context, budget-suggestions; grep other Transaction+Category sums. Tests with split fixture."
    status: pending
  - id: split-staging-audit-comms
    content: "After split semantics change: staging audit of historical UI deltas; release notes; optional data migration only if schema/parent amounts change."
    status: pending
  - id: ai-goal-context-align
    content: "Backend/AI: enrich FinancialGoal in _build_financial_context to match list_goals (linked account, debt_payoff math) or document in UI that chat may lag Goals tab."
    status: pending
  - id: debt-sim-guardrails
    content: "Debt: API flags for assumed APR/min; converged false if balance remains after MAX_MONTHS; detect payment < interest (negative amortization); UI illustration disclaimer; tests for edge cases."
    status: pending
  - id: disclosures-copy
    content: "Product/copy: month-local budget vs all-accounts reports; YNAB no-rollover; multi-currency sums unconverted; as-of sync; educational-not-advice; debt/AI disclaimers."
    status: pending
  - id: disclosure-pack-stakeholders
    content: "PM: disclosure pack sign-off; support macros; changelog for material string changes; single copy source of truth."
    status: pending
  - id: query-keys-invalidation
    content: "Frontend: queryKeys factory + prefix invalidate on sync for reports keys AND dashboard (spending-by-month dash vs reports shapes), imports, balance-history, top-payees; aiInsights, recurring, budgetInsights, payoffPlan, fsa-review as needed. Remove dead ['reports']-only fix mindset."
    status: pending
  - id: fe-next-api-proxy-env
    content: "Frontend: review app/api/ai/* routes (errors, streaming, BACKEND_URL); document NEXT_PUBLIC_* vs server env per environment."
    status: pending
  - id: fe-tests-smoke
    content: "Frontend: Vitest/RTL + MSW or fetch mock for hooks; Playwright smoke (login→dashboard→transactions); gate merge on CI."
    status: pending
  - id: txn-mobile-a11y
    content: "UX: overflow-x on main txn + FSA tables (<md); responsive filters/sheet; row kebab aria-label with context; sortable headers aria-sort; demo mutate UX (403 vs banner)."
    status: pending
  - id: empty-states-audit
    content: "UX: audit checklist—Accounts, Categories, Reports per tab, txns (no rows vs filtered empty), Budget, Plan—with title, why, primary CTA."
    status: pending
  - id: budget-ai-panel-states
    content: "UX: Budget spending/AI block—distinct copy for no history vs AI off/unavailable vs error; link Settings."
    status: pending
  - id: security-auth-rl
    content: "Security: rate-limit auth routes (IP + optional identifier); constant-time or safe failure messaging where appropriate."
    status: pending
  - id: security-csv-limits
    content: "Security: max upload bytes + row cap/streaming parse on CSV (prod/DoS); note demo already blocks upload path."
    status: pending
  - id: security-demo-ai-allowlist
    content: "Security: replace blanket /api/ai/ demo allowlist—allow chat/parse only; block execute-action writes in DEMO_MODE; document matrix."
    status: pending
  - id: security-ollama-ssrf
    content: "Security: validate OLLAMA_URL (scheme/host rules) for httpx calls; deployment doc—no user-controlled URL."
    status: pending
  - id: security-ai-threat-cors-logs
    content: "Security: prompt injection + execute-action abuse policy (beyond truncation); CORS prod review; logging audit—no JWT/passwords/full prompts in prod."
    status: pending
  - id: security-sca-sast-disclosure
    content: "Security/DevOps: pip+npm audit in CI; lightweight SAST; .well-known/security.txt + coordinated disclosure stance."
    status: pending
  - id: health-503-ready-live
    content: "DevOps: health returns 503 when DB down (today 200+degraded JSON); optional /live vs /ready split; document probes."
    status: pending
  - id: ci-pipeline
    content: "DevOps: add .github/workflows—frontend npm ci lint build; backend pip install -r backend/requirements.txt pytest; Postgres service; branch protection."
    status: pending
  - id: migrations-alembic
    content: "Backend/DevOps: Alembic; move lifespan SQL to revisions; migrate as deploy step not only web startup."
    status: pending
  - id: sync-batch-n1
    content: "Backend: batch SimpleFIN import; target p95/query count vs baseline fixture."
    status: pending
  - id: get-sync-status-readonly
    content: "Backend: remove commit from GET /sync/status stuck repair—scheduler or POST reconcile; test GET is read-only."
    status: pending
  - id: session-commit-policy
    content: "Backend: commit only on mutating routes; eliminate commit-after-read (align with sync status fix)."
    status: pending
  - id: ai-idempotency-limits
    content: "Backend: Idempotency-Key on execute-action; rate limits/batch caps on heavy AI routes (complements auth RL)."
    status: pending
  - id: fe-charts-tabs-perf
    content: "Frontend: dynamic import Recharts; lazy-mount Reports tabs (note Spending tab runs 2+ queries); split transactions page."
    status: pending
  - id: jwt-storage-csp
    content: "Security (phased): threat model + HttpOnly/BFF or short TTL; CSP report-only then enforce—do not stack with active correctness churn."
    status: pending
  - id: compose-prod-parity
    content: "DevOps: env_file or map OAuth/WebAuthn/CORS; prod frontend image (next build start); scheduler single-replica or lock doc; Ollama depends_on/health or degraded AI."
    status: pending
  - id: devops-ops-baseline
    content: "DevOps: secrets rotation runbook; pin Docker/Python/Node + lockfiles; SBOM or image scan on release; pool sizing vs workers; graceful shutdown."
    status: pending
  - id: activation-analytics
    content: "Product: server-side or analytics funnel events (steps + timestamps)—beyond budget_first_outcome_at."
    status: pending
  - id: clarity-ia-copy
    content: "Product/UX: Clarity wedge in nav; Plan vs Budget; payoff LLM secondary to /payoff-plan (outcome-linked todo)."
    status: pending
  - id: simplefin-first-sync-ux
    content: "Product/UX: first sync progress, partial success, retry—state survives navigation."
    status: pending
  - id: suggest-goals-ai
    content: "Product: suggest-goals AI endpoint + Goals UI—only after A+B+disclosures baseline (not immediately after A alone)."
    status: pending
  - id: qa-regression-matrix
    content: "QA: matrix—splits×budget×reports×post-sync invalidation×demo mode; run before shipping security items atop moving correctness."
    status: pending
  - id: transfers-reporting-policy
    content: "Product/backend: define whether transfers appear in spending narratives (reports/AI); apply consistently."
    status: pending
  - id: webhooks-scope
    content: "Product: mark bank webhooks out of scope OR add ingress design (signature, idempotency, SyncLog)."
    status: pending
isProject: false
---

# Multi-discipline review — implementation plan (v3)

**v3** incorporates a **second review** by the same seven roles against this document + codebase. **Corrections:** split bug severity (category totals can be **omitted**, not only inconsistent); invalidation scope beyond `["reports"]`; DEMO_MODE **allows** `execute-action` today; health is **200 + degraded**, not 503 yet; spending-by-month is **parent-only by design** (do not naïvely “add children” without double-count analysis). **Added:** acceptance hooks, stakeholder disclosure pack, QA matrix, DevOps/security depth, mermaid disclaimer.

## Cross-discipline consensus (refined)

| Theme | Action |
|--------|--------|
| Trust & disclosure | Month-local envelope; **no YNAB-style category rollover** in current API; reports often **all accounts** vs budget **budget accounts**; **multi-currency** summed without FX; debt sim assumptions; **not advice**; AI goal context may **diverge** from Goals tab until aligned. |
| Data correctness | **Splits:** category paths today **drop** split children; some AI paths **include** them—unify with explicit rules; **month totals** stay parent-level to match movements. |
| Stale UI after sync | Invalidate **all** money-viz keys: report queries **and** dashboard (`spending-by-month` has **two key shapes**), plus `aiInsights`, `recurring`, `budgetInsights`, `payoffPlan`, `fsa-review` as needed. |
| Security / ops | **Demo:** `/api/ai/` allowlist is **overbroad** (`execute-action` writes). **Health:** implement **503**. **CI:** add workflow (none in repo). **CSV:** cap size/rows (demo upload already blocked). |

## Phase A — Correctness & trust (Financial + Backend)

1. **Splits & category aggregates** — Implement shared rule (see `splits-budget-reports-ai` todo): typically **sum lines with `category_id` set** including **split children**; **exclude** uncategorized split **parents** from category rolls; **keep** parent-only for **month-level** rollups and balances to avoid double-counting. Grep all `Transaction` + `Category` aggregates. Add **fixtures + integration tests**.
2. **Debt simulation** — Flags for defaults; **non-convergence** after cap; **negative amortization** warning; UI disclaimer; deterministic `/payoff-plan` **primary** vs LLM copy.
3. **AI context** — Align goal enrichment with `list_goals` **or** disclose mismatch in-product.
4. **Copy / disclosures** — As-of sync; budget vs reports scope; multi-currency label; transfers policy once defined.

## Phase B — Frontend reliability

1. **`queryKeys` + prefix invalidation** — One module; invalidate families after sync (not a single dead `["reports"]` key).
2. **Tests** — Vitest + **MSW/mock** for RQ hooks; Playwright smoke; **CI required for merge** (policy).
3. **Reports** — Lazy tabs; note **multiple queries per tab** (e.g. spending + top payees).
4. **Charts** — Dynamic import Recharts; tighten TypeScript on optimistic updates.

## Phase C — Security & DevOps quick wins

1. **Auth rate limits** — Separate from AI quotas (`ai-idempotency-limits`).
2. **CSV limits** — Bytes + rows (production abuse); clarify **not** about demo (upload blocked there).
3. **Demo allowlist** — Narrow to non-mutating AI paths; **block `execute-action`** in demo.
4. **Health** — **Implement** 503 when DB down (document **current** 200+JSON degraded).
5. **CI pipeline** — Create workflow; `backend/requirements.txt` + Postgres service; correct working directories.
6. **Ollama URL** — SSRF-hardening via env validation.
7. **SCA/SAST + security.txt** — Dependency scan + lightweight SAST; disclosure contact.

**Parallel work:** Phase C items can run **alongside** late Phase A **if** `qa-regression-matrix` passes for splits/debt—avoid masking correctness bugs.

## Phase D — UX & product polish

See todos: `txn-mobile-a11y`, `empty-states-audit`, `budget-ai-panel-states`, `simplefin-first-sync-ux`, `clarity-ia-copy`, `activation-analytics`. **UX edge cases** to respect: filtered-empty vs true-empty txns; **mermaid node letters ≠ Phase D/E** (diagram is logical flow only).

## Phase E — Platform depth

Alembic; sync batching; GET sync read-only; session commits; JWT/CSP **phased**; prod Docker; backups + restore drill (in `devops-ops-baseline` or explicit runbook); feature flags optional; staging pipeline optional.

## Phase F — Product features

- **Suggest goals AI** — After **A + B + disclosures** baseline.
- **Optional** — Create payoff goal from Debt tab; goal reorder; webhooks (or mark **out of scope** in `webhooks-scope`).

## Acceptance criteria (Definition of Done hooks)

| Initiative | Accept when |
|------------|-------------|
| Splits fix | Golden cases: budget category activity = reports category = chosen AI aggregates; documented predicate; tests green. |
| Debt guardrails | Missing APR/min visible; non-convergent plans flagged; disclaimer shipped. |
| Disclosures | Plan/AI/debt/report surfaces audited; support macros ready; sign-off recorded if legal involved. |
| Query invalidation | After sync: reports **and** dashboard money widgets refresh without hard reload (E2E or scripted). |
| Demo AI | Automated check: demo cannot persist via `execute-action` (once narrowed). |
| Health | Probe gets **503** when DB unreachable. |
| CI | Required checks green on PR; documented branch protection. |

## Dependencies (mermaid)

**Note:** Node labels **A–I** are **not** the same as “Phase A/B/…”. **CI** is a **horizontal** enabler—not strictly after UX.

```mermaid
flowchart TD
  subgraph correctness [Correctness]
    A[splits + debt guardrails]
    C[disclosures + stakeholder pack]
  end
  subgraph fe [Frontend]
    B[queryKeys + full invalidation]
    D[FE tests in CI]
    E[txn mobile + empty states]
  end
  subgraph secops [Security and Ops]
    F[auth RL + CSV + demo allowlist]
    G[health 503 + CI workflow]
    H[Alembic + prod compose]
  end
  A --> B
  A --> C
  B --> D
  C --> D
  D --> E
  A --> F
  F --> G
  G --> H
  B --> I[suggest-goals AI]
  C --> I
```

## Risks called out in review

- **Security before correctness:** Rate limits and demo masking can **hide** reproduction of split/debt bugs—use **`qa-regression-matrix`**.
- **CSP/JWT early:** High blast-radius—**do not** combine with heavy correctness churn in one release.
- **Duplicate sprint work:** Rate limits appear in auth + AI—**coordinate** thresholds; **one CI epic** (`ci-pipeline`).

## Document history

- **v1**: Initial merge of seven discipline reviews.
- **v2**: (Superseded) partial FE agent note—fully merged into v3.
- **v3**: Second pass by seven sub-agents—factual fixes, edge cases, new todos, acceptance criteria, diagram disclaimer, deduplication.
