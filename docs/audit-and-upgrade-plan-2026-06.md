# Audit & Upgrade Plan — June 2026

Consolidated from a full audit of the backend (FastAPI/Fly.io), frontend (Next.js 16/Vercel),
and infra/CI, plus live `npm audit` / `npm outdated` scans. Items are ordered into phases by
risk and dependency; each item lists the file(s) involved and acceptance criteria where useful.

**Overall posture:** strong foundation — httpOnly cookie sessions, origin/CSRF checks, rate
limiting, SimpleFIN SSRF allowlist, admin approval gate, security headers on both stacks, good
LLM consent/privacy tooling. The plan below closes the remaining gaps.

---

## Phase 0 — Urgent security fixes (do first, small diffs)

### 0.1 Upgrade Next.js 16.1.6 → 16.2.9 (HIGH, confirmed by npm audit)
11 advisories against 16.1.6 incl. middleware/proxy bypass via dynamic route parameter
injection (GHSA-492v-c6pp-mqqv), RSC cache poisoning (GHSA-wfc6-r584-vfw7), CSP-nonce XSS,
image-optimization DoS, and a vulnerable bundled postcss. Bump `next` + `eslint-config-next`
in `frontend/package.json`, run full CI gate.

### 0.2 Cross-household SimpleFIN account hijack (CRITICAL, backend)
`backend/app/services/sync/manager.py:89-109` resolves `Account` by globally-unique
`simplefin_id` without filtering `household_id`. Household B syncing an ID owned by household
A mutates A's account and imports transactions into it.
- Filter by `household_id` in the lookup; create-on-miss for the current household only.
- Migration: change unique constraints on `accounts.simplefin_id` (`models/account.py:22`)
  and `transactions.simplefin_transaction_id` (`models/transaction.py:45`) to be scoped
  `(household_id, …)`.
- Add regression test: two households, same simplefin_id, no cross-writes.

### 0.3 Legacy SimpleFIN endpoint bypasses SSRF allowlist (HIGH)
`POST /api/settings/simplefin` (`backend/app/api/routes/settings.py:420-437`) stores a raw
URL without `validate_simplefin_url`. Apply the same host validation as the claim flow, or
remove the legacy route if the frontend no longer calls it.

### 0.4 Error toasts copy full API response bodies to clipboard (HIGH, frontend)
`frontend/src/lib/toast-error.ts:11-38` + `providers.tsx:214-228`. Sanitize to status +
user-safe message; strip raw response bodies in production. Also map FastAPI `detail[]`
arrays to a human message instead of `JSON.stringify` (`lib/api/client.ts:73-75`).

### 0.5 Finish Upstash Redis remediation (CRITICAL, ops — no code)
Per `docs/deployment-security-checklist.md:92-112`, prod `KV_*` vars are stale (NXDOMAIN), so
rate limits and passkey/OAuth challenges fall back to per-machine memory with scale-to-zero.
Reprovision Upstash, sync creds to Fly, verify `/api/health` shows `rate_limit_store_status: ok`,
then set `AUTH_RATE_LIMIT_STRICT=true` in prod. Until fixed: `min_machines_running = 1`.

---

## Phase 1 — Security hardening

1. **Harden `POST /api/ai/execute-action`** (`api/routes/ai.py:772-785`, `services/ai/action.py`):
   require a server-issued confirmation nonce from `/parse-action`; rate-limit mutations.
2. **Server-side route protection in Next.js**: add `middleware.ts` (or proxy check) that
   verifies the session cookie before serving `(app)/*`; today protection is client-only
   (`auth-guard.tsx`). Pair with a `user.status === "approved"` gate + `/pending-approval` page.
3. **Migrate `python-jose` → `PyJWT`** (`requirements.txt:13`, `api/deps.py`, `routes/auth.py`):
   unmaintained dep on the hot auth path; keep explicit `algorithms=["HS256"]`,
   `require=["exp","sub"]`.
4. **Replace `passlib` with direct `bcrypt`** (`requirements.txt:14-15`, `routes/auth.py:55`):
   passlib unmaintained since ~2020.
5. **Magic-link token out of the URL query** (`routes/magic_link.py:122`,
   `app/auth/magic-link/page.tsx:23`): use hash fragment or POST exchange so the token never
   hits history/referrer logs.
6. **Sync scheduler race** (`tasks/scheduler.py:55-73`, `routes/sync.py:78-94`): make the
   in-progress check + `SyncLog` insert atomic (partial unique index or `FOR UPDATE`).
7. **Encrypt `simplefin_access_url` at rest** (`models/household.py:16`): app-level
   encryption (e.g. Fernet keyed from env secret) for stored bank credentials.
8. **Passkey hardening**: avoid email enumeration via `allowCredentials`
   (`routes/auth.py:468-477`); consider `user_verification=REQUIRED`.
9. **Misc**: restrict `/api/hosting` health card to admins; generic 500 message instead of
   `str(e)[:200]` in SimpleFIN claim (`settings.py:108-110`); fail startup when approval gate
   is on but `ADMIN_EMAIL` unset; shorter session TTL or refresh rotation (currently 30-day JWT).

---

## Phase 2 — Dependency, CI/CD, and container hygiene

1. **Dependency updates** (after 0.1): minor bumps for axios, @tanstack/react-query,
   tailwindcss 4.3, vitest, playwright, fallow, knip, recharts, web-llm, radix.
   Hold majors (eslint 10, typescript 6, lucide-react 1.x, @types/node 25, shadcn 4) for a
   separate pass.
2. **Vulnerability scanning in CI** (`.github/workflows/ci.yml`): add
   `npm audit --audit-level=high` and `pip-audit -r backend/requirements.txt`; add Dependabot
   config for npm + pip + GitHub Actions.
3. **Split backend dev deps**: move pytest/aiosqlite out of prod `requirements.txt` into
   `requirements-dev.txt`; slim the Fly image.
4. **Container hardening**: non-root `USER` in both Dockerfiles; add `.dockerignore` files;
   bind compose ports to `127.0.0.1`; pin `ollama/ollama` tag; add backend healthcheck to
   compose; drop unused `443:443` Caddy mapping.
5. **CI improvements**: add `tsc --noEmit` script + CI step; add backend `ruff check`;
   add `concurrency` cancel-in-progress; merge the duplicate frontend/vercel build jobs;
   add knip to a weekly audit workflow.
6. **E2E in CI**: wire `DEMO_MODE`/`NEXT_PUBLIC_DEMO_MODE` through docker-compose so
   `.github/workflows/e2e.yml` actually works; add backend `/api/health` readiness poll and
   `if: always()` teardown; then schedule e2e on main pushes or nightly.
7. **Fly health check**: return 503 from `/api/health` when degraded (or add a readiness
   route) so Fly probes mean something (`main.py:153-179`, `fly.toml:29-34`).

---

## Phase 3 — Test coverage (close the gaps the audit found)

**Backend (integration-style, household-scoped):**
- Core CRUD routes: accounts, payees, categories, transactions, rules, budget, recurring.
- Sync: trigger route + manager (incl. the Phase 0.2 cross-tenant regression test).
- Settings: SimpleFIN claim/legacy validation, plan prefs.
- Admin approve/reject incl. `session_version` bump; upload CSV (size/encoding/dedup);
  `execute-action` authorization; password login/register happy paths.

**Frontend:**
- Vitest for `login`, `auth/magic-link`, `auth/callback`, `onboarding`, `navigation`.
- Component tests for `transaction-list-section`, settings cards (bank-sync, admin, ai).
- Playwright: budget edit flow, transaction categorize flow, settings bank-sync flow
  (beyond the single demo smoke test).

---

## Phase 4 — UI/UX upgrades and frontend architecture

**Quick wins:**
1. Dark-mode FOUC fix: blocking theme script in `<head>` (`providers.tsx:186-195`).
2. `prefers-reduced-motion` overrides in `globals.css`.
3. AI advisor dialog: real focus trap (Radix Dialog), `aria-label` on clear-chat button,
   try/catch around `decodeURIComponent(ai_prompt)`.
4. Login page redirects authenticated users; `/onboarding` requires session.
5. PWA polish: align manifest branding to "Clarity", maskable icon, SW update flow
   (`skipWaiting` + reload prompt), offline page retry button, optional install prompt.
6. AuthGuard: show loading shell instead of blank frame before redirect.

**Architecture/performance:**
7. Split monolithic pages: `plan/page.tsx` (1238 lines), `transactions/page.tsx` (874),
   `settings/page.tsx` (795), dashboard (776) into route-local components/hooks.
8. Lazy-load Recharts per chart section (`next/dynamic`, gate on `useInView`).
9. Lazy-load `AiAdvisor` (currently in every authed page's bundle via `auth-guard.tsx:63`).
10. Extract shared `SimplefinConnectWizard` (duplicated ~150 lines in onboarding + settings).
11. Adopt `QueryState` + `inlineErrorQueryMeta` on plan page queries and remaining dashboard
    queries for consistent loading/error states.

**Feature-level UX enhancements (pick per taste):**
12. Pending-approval holding page (pairs with Phase 1.2).
13. Budget "quick assign remaining income" one-tap row.
14. Transaction swipe actions on mobile (cleared toggle, categorize).
15. Dashboard "Today" strip (net worth + uncategorized count + next sync ETA).
16. Sync progress in mobile header; plan tab persistence; reports empty-states with CTAs;
    dark-mode toggle in mobile sheet; settings scroll-spy active indicator;
    "explain this transaction" deep link into the AI advisor.

---

## Phase 5 — Backend performance & code quality

1. CSV import N+1 (`routes/upload.py:54-76`): batch payee lookup, bulk insert, single dedup query.
2. Stream or cap transaction CSV export (`routes/transactions.py:243-245`).
3. Use batch enrichment on single-transaction paths (`transactions.py:36-44`).
4. Standardize commit pattern: dependency-level commit only (today `get_db()` auto-commits and
   routes also call `db.commit()`).
5. Split `api/routes/ai.py` (~880 lines) into schemas/services modules.
6. Use UTC date in sync window (`services/sync/manager.py:57`).
7. Remove unused `ofxparse` dep; move token minting out of `magic_link.py` local import.

---

## Phase 6 — Documentation & DX

1. Root `README.md`: compose quickstart (`cp .env.example .env`, `docker compose up`,
   ports 3001/80), links to deployment checklist and Modal docs.
2. Rewrite `frontend/README.md` (currently create-next-app boilerplate with wrong port).
3. Align `.env.example` with all compose-referenced vars (`DEMO_MODE`, `OLLAMA_*`, `CORS_ORIGINS`).
4. Root `package.json` convenience scripts (`dev:up`, `dev:down`); `engines` field in frontend.
5. Optional: pre-commit hooks (ruff + eslint).

---

## Suggested sequencing

| Order | Work | Why first |
|-------|------|-----------|
| 1 | Phase 0 (five items) | Active vulnerabilities / cross-tenant data bug |
| 2 | Phase 1.1–1.6 | Auth/session hardening builds on 0.x |
| 3 | Phase 2 | CI guardrails before larger refactors |
| 4 | Phase 3 | Tests lock in behavior before refactors |
| 5 | Phase 4 + 5 | Refactors and UX with tests as a safety net |
| 6 | Phase 6 | Docs/DX cleanup |

Each phase should land as small, coherent PRs gated by `./scripts/ci-local.sh`.
