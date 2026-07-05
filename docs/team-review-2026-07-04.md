# Team review — Clarity audit (2026-07-04)

Multi-persona audit (PM, UX, FE, BE, Architect, AI Engineer, Financial-Advisor SME, QA + meta-review) of the full app. Read-only pass; no changes made. Citations verified against the working tree at commit `740bbf3` (branch `fix/prod-console-csp-manifest-and-nano-lang` = main + CSP/Nano fixes).

Standing context at audit time: prod Fly backend (`clarity-backend`) is a stale manual deploy missing all `/api/ai/facts/*` routes (live incident, fix = `cd backend && fly deploy`); PRs #42 (dependency upgrades) and #43 (CSP manifest-src + Nano output language) open.

## Summary

Overall health is good: security fundamentals (household scoping, single-use token-gated AI writes, SimpleFIN SSRF allowlists, rate limits, idempotent sync claims, bounded uploads) were verified clean by multiple personas. Dominant themes: **(1) release engineering is the biggest live risk** (manual backend deploy already caused a prod incident; no pre-merge e2e), **(2) migration debris** from the Ollama→on-device AI transition (dead routes/schemas/docstrings), **(3) financial-math edge cases** (debt payoff timing, reports/budget inconsistency, transfer double-counting).

## Team top picks (cross-persona consensus)

1. CI/CD: path-filtered e2e on PRs + automated Fly backend deploy on merge — [QA, BE, Architect] — [M]
2. Abort-handling cluster in AI advisor (unmount abort + intent abort swallow + false-positive test) — [FE, AI] — [S×3]
3. Route magic-link/OAuth signups into onboarding — [PM] — [S–M]
4. Financial-math fixes: debt freed-minimum lag, reports budget-account filter, transfer exclusion — [SME] — [S+S+M]

## Blind spots (meta-review)

- **Release engineering owned by nobody** — BE and QA both flagged the deploy gap as out-of-lane; it caused the current prod incident. Promoted to Phase 1.
- **Backup/restore posture unknown** — Fly Postgres snapshot cadence and restore path never verified. Open question.
- **Multi-user household concurrency** — concurrent budget edits (optimistic updates vs server state) untested.
- **PWA service-worker staleness** — cache invalidation across deploys unchecked (stale JS hitting new APIs).

## Test & regression plan

**Coverage signal:** frontend vitest 322 tests, strong in `lib/llm`, **zero page-level tests** (all 18 `page.tsx` untested); backend pytest 358, strong on routes/services, but `debt.py` and `reports.py` have **zero tests**; one e2e spec (demo smoke), not run on PRs; promptfoo evals manual-only.
**Currently failing:** none. Known flake: `web-llm-download.test.ts` under parallel vitest — likely cross-file `vi.stubGlobal` bleed from sibling web-llm tests (file itself is pure functions).
**Phase-1 tests required:**
- Unmount-abort → rewrite `frontend/src/components/ai-advisor.test.tsx:115-149` (current test asserts an unrelated controller; guards nothing) [Regression risk: Med]
- Aborted-signal case → `frontend/src/lib/llm/pipelines/intent.test.ts` [Low]
- Debt payoff → new `backend/tests/test_debt_payoff.py` (avalanche/snowball, freed-minimum reallocation, zero-APR, min-payment-below-interest) [Low]
- Reports budget-account filter → new `backend/tests/test_reports.py` [Low]
- Condense-path grounding → `qa.test.ts` fixture >4,000 chars serialized [Low]
- Splits cap 422 → `backend/tests/test_transactions_routes.py` [Low]
**Backfill:** page-smoke RTL (budget, transactions, accounts); e2e for budget-assign + CSV import; `engine-busy.ts` (no test file); FSA keyword list; goals sign-math; same-account transfer.
**CI gate:** lint/type/test/build solid; missing e2e-on-PR and any deploy step; `ci.yml` pip-audit ignores PYSEC-2026-161 unconditionally (no expiry note); npm audit gate high-only; no vitest coverage thresholds.

## Critical

None after calibration. (The prod-backend staleness is the standing incident, remedied by deploy + the CI/CD item below.)

## High

| Persona | Finding | Fix | Where | Effort |
|---|---|---|---|---|
| QA/BE/Arch | No pre-merge e2e; no automated backend deploy — CI green has no causal link to prod | Path-filtered e2e job in ci.yml; Fly deploy job on main merges touching `backend/` | `.github/workflows/{ci,e2e}.yml` | M |
| FE | No unmount abort in AI advisor — leaked streams hold Nano slot/engine lock | `useEffect(() => () => abortRef.current?.abort(), [])` | `frontend/src/components/ai-advisor.tsx:63-206` | S |
| FE | "Unmount abort" test is a false positive (asserts unrelated controller) | Rewrite to observe the real in-flight controller | `frontend/src/components/ai-advisor.test.tsx:115-149` | S |
| FE/AI | `detectIntent` swallows AbortError → cancelled request runs a full second ground+generate | Rethrow when `signal?.aborted` in the catch | `frontend/src/lib/llm/pipelines/intent.ts:56-58` | S |
| AI | Condense path (facts >4,000 chars → uncontrolled `summarize()` LLM rewrite) has zero test coverage; hallucinated summary silently becomes the answer's only context | Forced-condense test asserting grounding + citations hold; consider structured (JSON) condense output | `qa.ts:99-105`, `specialized.ts:36-49` | S |
| SME | Debt payoff: freed-up minimum from a debt paid off in month N joins the extra pool only in month N+1 → timelines pessimistic by design error; possible transient double-application on priority re-scan [verify with 3-debt case] | Add freed minimum to live pool same-month; new `test_debt_payoff.py` | `backend/app/api/routes/debt.py:269-296` | S |
| PM | Magic-link (primary CTA) and Google OAuth signups skip `/onboarding` entirely — only passkey registrants see it; new users land on an empty dashboard | First-session signal on verify/callback → route to `/onboarding` | `auth/magic-link/page.tsx:67`, `auth/callback/page.tsx:43`, cf. `login/page.tsx:154` | S–M |
| Arch | Dead `/api/ai/chat` proxy posts to a backend route that no longer exists (guaranteed 404); zero callers | Delete the route file | `frontend/src/app/api/ai/chat/route.ts` | S |

## Medium

- [SME] Reports (`spending-by-category`, `top-payees`, `spending-by-month`) lack `is_budget_account` filter that Budget uses → tabs disagree — `backend/app/api/routes/reports.py:24-155` — [S]
- [SME] Transfers excluded from spend only by `category_id NULL` convention; `Payee.transfer_account_id` never filtered — categorized transfer (CSV import or AI add_transaction) double-counts as spend — [M]
- [BE] `SplitRequest.splits` unbounded → self-DoS/data bloat — cap `Field(min_length=1, max_length=50)` — `backend/app/api/routes/transactions.py:291` — [S]
- [Arch] ~8 dead schemas in `backend/app/schemas/ai.py` (ChatRequest, AdvisorTurnResponse, InsightsResponse, ParseAction*, BudgetSuggestions*, InterestRate*) + stale `action_token.py:1-9` docstring citing deleted routes — prune — [S]
- [Arch] No FE↔BE contract test — TS interfaces hand-mirror pydantic; renames break silently at runtime — [M]
- [AI] Nano session cache module-global, keyed `system::temp::topK`, no household scoping — latent cross-household leak on shared browser profiles if system prompts ever personalize — `frontend/src/lib/llm/providers/nano.ts:45-53` — [S]
- [AI] Zero AI telemetry: verify-failure rate, retry exhaustion, schema-parse failures invisible in prod — [M]
- [UX] AI action confirm card renders only the preview string, never the structured `data` payload being executed — render key fields — `frontend/src/components/ai-advisor.tsx:389-417` — [S]
- [FE] `session-pool.ts` / `engine-busy.ts` queues are abort-blind (aborted callers hold slots) — early-return on aborted signal — [S]
- [QA] Zero page-level tests (18 pages); e2e journey gaps: onboarding, budget assign, sync, CSV import, AI action confirm — [M]
- [PM] No re-entry to onboarding after skip; SimpleFIN popup copy-paste flow has drop-off risk (popup-blocker fallback easy to miss) — [M]

## Low

- 404 copy says "your budget app" not "Clarity" (`(app)/not-found.tsx:9`); two divergent 404 pages — unify [S]
- Dead debt-math functions `_months_to_payoff`/`_build_schedule` (`debt.py:82-129`) — delete or wire in [S]
- `SplitItem.notes` missing max_length [S]; sync history hardcoded `limit(20)` no pagination [S]
- Dead `useDemoGuard` mock + stale docstrings in `ai-advisor.test.tsx` [S]
- FE optimistic budget math uses float vs backend Decimal (self-healing on refetch) [—]
- No vitest coverage thresholds [S]; `PayoffPlanRequest.extra_monthly` accepts negatives [S]
- Semimonthly pay-cycle 1st/15th vs 15th/last ambiguity deserves a setup-time UI hint [S]
- Three uncoordinated first-run surfaces (onboarding, WelcomeBanner, SetupChecklist) [M]

## Resolved contradictions

- **"Delete all 3 AI proxy routes" (Architect) vs reality:** Next.js route handlers take precedence over the `/api/:path*` rewrite, so `execute-action`/`prepare-action` proxies ARE live in the request path. → Delete only `chat`; consolidating the other two onto the rewrite is a deliberate Medium follow-up requiring header-forwarding parity verification.
- **e2e gap severity:** QA called it Critical; the workflow comment shows a deliberate, documented deferral pending flake-proofing. → High (top position); the path-filter approach addresses the flake concern.

## Dropped / deferred

- "Legacy Ollama routes live in prod" — digest error, corrected by AI Engineer: routes already removed from `routes/ai.py`.
- UX aria-label finding — retracted by its own author on review.
- `[unverified]` items requiring product/authoritative confirmation: USD-only assumption (`formatCurrency` hardcodes USD; no currency column found — Critical if multi-currency is intended); FSA `_FSA_HINT_KEYWORDS` vs IRS Publication 502; `$25` flat minimum-payment default vs issuer formulas (CFPB).

## Recommended sequence

- **Phase 1 (must-fix now, ~2–3 days):** CI/CD deploy + e2e jobs; abort cluster (unmount abort, intent rethrow, test rewrite); condense-path test; debt-payoff fix + `test_debt_payoff.py`; delete dead chat proxy.
- **Phase 2 (before next release, ~2 days):** onboarding routing for magic-link/OAuth; reports budget-account filter; transfer exclusion guard; splits cap; confirm-card data rendering; dead-schema pruning.
- **Phase 3 (soon, ~3–4 days):** FE↔BE contract test; Nano session-key household scoping; AI telemetry counters; page-smoke RTL tests; budget-assign + CSV-import e2e.
- **Phase 4 (polish):** all Low items.

## Open questions

1. Is Clarity intentionally USD-only? (If multi-currency is planned, its absence is Critical, not a nit.)
2. What is the Fly Postgres backup/restore posture — and has a restore ever been tested?
3. Should Reports intentionally include non-budget accounts, or match the Budget tab?
4. Deploy cadence preference: auto-deploy backend on every main merge, or manual with a CI reminder check?
