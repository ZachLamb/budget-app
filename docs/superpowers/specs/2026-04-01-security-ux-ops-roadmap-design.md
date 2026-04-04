# Design: Security, UX, and operations roadmap (phased)

**Status:** Approved direction (dependency-aware phased roadmap).  
**Date:** 2026-04-01  
**Scope:** Hardening from the 2026 security review, product/UX follow-through, and production operations—prioritized in one document with explicit **blocking** vs **parallel-safe** work.

---

## Goals

1. **Phase 1:** Reduce abuse risk and realistic exposure (auth, AI cost, SimpleFIN outbound, debug surfaces, browser security headers, honest multi-worker story).
2. **Phase 2:** Improve trust and task completion in the product without weakening Phase 1 controls.
3. **Phase 3:** Make running and scaling the stack boring—observability, health, data continuity, shared state for auth challenges when multi-instance.

Non-goals for this roadmap: formal penetration testing, SOC2, payment/fraud ML, CAPTCHA (unless promoted from stretch).

---

## Structural approach: dependency-based phases

Phases are **priority-ordered**, not necessarily strictly sequential gates. The spec uses:

- **Blocking (Phase 1):** Should ship before widening access or running multiple stateless API workers in production.
- **Parallel-safe:** UX, copy, and features that do not add unauthenticated mutations or bypass household scoping can proceed alongside Phase 1 when teams/files are disjoint.

This matches a small team: security work does not freeze all product progress, but **nothing in Phase 2 may weaken Phase 1**.

---

## Alignment with repository rules (Cursor / AGENTS)

Implementation and review **must** follow tracked guidance. This section maps the roadmap to those rules so agents and humans do not drift.

### `AGENTS.md` — verification commands

After substantive changes in each phase, use the matrix in **`AGENTS.md`**:

| Area touched | Minimum verification (from repo root / as documented) |
|--------------|--------------------------------------------------------|
| Backend only | `cd backend && python -m pytest tests/ -v` |
| Frontend only | From `frontend/`: `npm run lint`, `npm run test:run` |
| Both | Both stacks; for merge/release-ready UI also `npm run build` |

Optional env-gated tests (e.g. passkey): see `backend/tests/README.md`.

### `.cursor/rules/verify-quality-and-git.mdc`

- **New behavior or bugfixes:** add or update tests in the same change when the repo already covers that layer (`backend/tests/`, frontend Vitest), unless the user explicitly defers tests.
- **Security as product logic:** auth, sessions, cookies, CORS, redirects, and upload paths get the same rigor as business logic; validate and normalize API input; avoid logging tokens, full cookies, passwords, or recovery codes.
- **Commits:** small, coherent commits; before commit, review `git diff --staged` for debug noise and secrets.
- **Push:** do not force-push `main` / default branch without explicit maintainer instruction; push only after lint/tests pass for touched stacks (or document exceptions).

### `.cursor/rules/secrets-and-credentials.mdc`

- **Specs, plans, and examples:** document **environment variable names** and placeholders only—never real `SECRET_KEY`, OAuth secrets, tokens, production hostnames, or cloud fingerprints.
- **Implementation of Phase 1–3:** no secrets in tests, scripts, or docs; use env vars. If a secret was ever committed, rotate and purge history—do not rely on a follow-up commit alone.

### `.cursor/rules/backend-fastapi.mdc`

- Prefer targeted changes; **do not widen public API or auth/session behavior** without tests and clear need.
- New startup hooks (e.g. middleware) stay consistent with `backend/app/main.py` patterns.

### `.cursor/rules/frontend-nextjs.mdc`

- Match App Router and client-boundary conventions; no new lint violations in touched files; `npm run build` before claiming merge-ready UI.

### `.cursor/rules/subagents-and-parallel-work.mdc`

- **Parallel Task/sub-agents:** only for **disjoint** domains (e.g. unrelated test files, non-overlapping paths). After parallel work, run **full** lint/test for touched stacks and resolve overlapping edits.
- **Auth, session, and security-hardening slices:** prefer **sequential** implementation and review unless tasks are strictly isolated (e.g. separate packages/paths).
- **Prompts:** self-contained; never paste tokens, `.env` values, or production URLs into sub-agent prompts.

---

## Phase 1 — Security & abuse resistance (blocking for scale / widened access)

| Theme | Intent | Rule-sensitive notes |
|--------|--------|----------------------|
| **Rate limiting** | Reduce credential stuffing and AI/LLM cost abuse. Targets: login, register, passkey option endpoints, high-cost `POST /api/ai/*` (and any BFF proxies). Prefer per-IP; optional per-user when authenticated. | Add tests where behavior is deterministic (e.g. limit exceeded → 429). Do not log raw client secrets or tokens when debugging. |
| **SimpleFIN outbound policy** | Mitigate stored SSRF: restrict HTTP targets from tokens/URLs to an allowlist (e.g. `*.simplefin.org`) plus explicit **dev-only** overrides via env. | Document **names** of env vars only in-repo; no real bridge URLs in tracked files. |
| **Passkey debug** | `WEBAUTHN_DEBUG` must never be enabled in production; document hazard. Optional: second gate (e.g. secret header) if endpoint must exist outside localhost. | Align with env-gated tests in `backend/tests/README.md`. |
| **CSP / security headers** | Incremental CSP (e.g. report-only first, then tighten); keep header story documented next to `next.config.ts` / middleware. | Frontend changes: lint + build for release-ready work. |
| **Session model (decision record)** | Capture tradeoff: JWT in `localStorage` vs future `HttpOnly` cookies and CSRF strategy—**decision and criteria**, not necessarily full migration in Phase 1. | Any session change is **auth behavior**: tests + no silent widening of API surface. |
| **Multi-worker honesty** | In-memory OAuth and passkey challenge stores are **single-process**; document as blocker for horizontal scale until Phase 3 shared store or sticky sessions. | Document in spec/runbook; implementation in Phase 3. |

**Phase 1 exit criteria (documentation + behavior):**

- Rate limits enforced (or explicitly scoped env-flag) with tests where feasible.
- SimpleFIN outbound checks enforced or explicitly documented exception path for self-hosted bridges (if product allows—if not, allowlist only).
- No production deployment checklist includes `WEBAUTHN_DEBUG=true`.
- CSP path documented (report-only or enforced—state which).
- Session tradeoff written; multi-worker limitation explicit.

**Stretch (promote only if time allows):** account lockout / backoff, reduced email enumeration surface—only with tests and without breaking legitimate flows.

---

## Phase 2 — Product & UX (parallel-safe when non-conflicting)

**Goal:** Trust, clarity, and job completion without new unauthenticated mutation paths or weaker scoping.

- **Existing specs:** Implement and iterate against current design docs (e.g. AI trust/actions, paycheck-cycle observation) rather than duplicating them here.
- **Visual north star:** `docs/mockups/ux-phases-1-4.html` — roadmap references **themes** (onboarding, plan, recurring, etc.), not pixel-level spec duplication.
- **Cross-cutting UX:** Clear failure states for AI and sync; demo → real-account messaging; mobile-friendly high-traffic pages.
- **Guardrail:** No feature ships that bypass `get_household_id` / auth patterns or demo guard semantics without an explicit security review.

**Phase 2 exit criteria:** Prioritized theme list with links to specs/mockups; shipped or scheduled items do not contradict Phase 1 controls.

---

## Phase 3 — Reliability & operations

- **Observability:** Structured logs, correlation/request IDs, sync outcome visibility—**no PII or tokens in log lines** (per secrets rule).
- **Health:** Liveness vs readiness (DB; optional Ollama) for orchestrators—document in AGENTS or ops doc by reference.
- **Data:** Postgres backup/restore expectations; optional restore drill checklist.
- **Scaling:** Redis (or equivalent) for OAuth codes and passkey challenges **or** documented sticky-session requirement—closes Phase 1 multi-worker gap.

**Phase 3 exit criteria:** Runbook sketch + health endpoints behavior documented + challenge storage story resolved for chosen deployment shape.

---

## Testing expectations by phase

| Phase | Backend | Frontend |
|-------|---------|----------|
| 1 | New limits and validation paths covered in `pytest` where deterministic; optional integration tests per `README.md`. | Header/CSP-related changes: lint; any UI for errors: tests if pattern exists. |
| 2 | Follow feature specs; regression tests for touched APIs. | Vitest + lint for changed components/pages. |
| 3 | Health checks and any new middleware tested. | N/A unless new status UI. |

---

## Out of scope (this roadmap)

- Formal penetration test or compliance certification.
- CAPTCHA / fraud scoring (unless added later as its own spec).
- Documenting or embedding **production** URLs, tokens, or keys in any tracked file.

---

## Self-review (spec quality)

- **Placeholders:** None intended; “stretch” and “optional” are explicit scopes, not TBDs.
- **Consistency:** Phase 2 cannot weaken Phase 1; rules section applies to all phases.
- **Scope:** Single roadmap spec; large features still defer to feature-specific specs under `docs/superpowers/specs/`.
- **Ambiguity:** “Allowlist” for SimpleFIN may need a follow-on one-pager if self-hosted SimpleFIN bridges become a supported scenario—call that out in implementation plan if product confirms.

---

## Next step

After maintainer review of this file, use the **writing-plans** skill to produce an implementation plan with ordered tasks, file-level hints, and verification commands drawn from **`AGENTS.md`** and **`.cursor/rules/verify-quality-and-git.mdc`**.
