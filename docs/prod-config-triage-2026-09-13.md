# Production config triage — 2026-09-13

Stack today: **Vercel** (`snacks-budget`, Next.js, root dir `frontend`) → **Render**
(`budget-app-backend`, `srv-daf30te7bikc73cn3i0g`, Docker, free, oregon) → **Neon** Postgres.
`docs/deployment-security-checklist.md` still describes the retired Fly.io stack.

---

## Root cause (confirmed, then corrected)

**The Render service's auto-deploy branch, `feat/ai-features-lm-studio`, was deleted from origin
after PR #117 merged. No deploy ran for six days, so correct configuration sat in Render's config
and never reached the running container.**

### The symptom

The backend rejected the production frontend's origin. `OPTIONS /api/auth/login` against prod:

| `Origin:` sent | Before | After |
|---|---|---|
| `https://snacks-budget.vercel.app` | **`400 Disallowed CORS origin`** | `200` + allow-origin echoed |
| `http://localhost:3000` | `200` + allow-origin echoed | `400` |
| `https://evil.example.com` (control) | `400` | `400` |

Every browser API call from the production frontend was blocked.

### The wrong turn

The first read of this was "`CORS_ORIGINS` was never set on Render" — the two origins it *did*
accept are exactly `Settings.cors_origins`' default in `backend/app/config.py:12`, and `render.yaml`
marks the var `sync: false`, which leaves it blank until someone fills it in.

That inference was wrong. Reading `GET /v1/services/{id}/env-vars` showed **all four vars already
set to exactly the right values**:

```
CORS_ORIGINS    = https://snacks-budget.vercel.app
FRONTEND_URL    = https://snacks-budget.vercel.app
WEBAUTHN_RP_ID  = snacks-budget.vercel.app
ADMIN_EMAIL     = (set)
```

The config was right. The *container* was serving values from 2026-09-07, before those were saved.

### Why the config never reached the container

Render had exactly two deploys, both on 2026-09-07. Auto-deploy was enabled and armed on
`feat/ai-features-lm-studio` — a branch deleted from origin when PR #117 merged. With no branch to
watch, nothing ever triggered, so the env-var changes never got a restart to apply them.

**Lesson:** a deleted deploy branch fails *silently*. The service stays green, serves stale code and
stale env, and the dashboard shows a healthy "live" deploy. Nothing surfaces the drift.

**Second lesson:** `curl` ignores CORS. `/api/health` returned `db: ok` and login returned a normal
`401` throughout. Only browsers were broken — a curl-based uptime check would never have caught this.

---

## Resolution (applied 2026-09-13)

| Step | Action | Result |
|---|---|---|
| 1 | Read env vars via Render REST API | All four already correct — no writes needed |
| 2 | `PATCH /v1/services/{id}` → `branch: main` | `200`, auto-deploy restored |
| 3 | `POST /deploys` (cache cleared) | `dep-dajde9h5efls738gjq9g` → **live** |
| 4 | Verify preflight + controls | Prod origin `200`; localhost and evil both `400` |
| 5 | Verify startup logs | No CORS or WebAuthn warning; `alembic upgrade head` ran |

Prod now runs `4b26154` (PR #118), up from `56cba84` — six days and four PRs of drift closed.

The `localhost -> 400` flip is the load-bearing evidence: it proves the container restarted with the
real config rather than the compiled-in default.

**Note:** the Render MCP server could not do this job. Its `update_environment_variables` tool
returned `500` on every call, it exposes no tool to *read* env vars, and none to change a service's
deploy branch. The REST API with an API key handled all three.

---
## Checklist

Legend: ✅ verified good · ❌ broken · ⚠️ degraded/needs confirming · ❓ can't read without a Render API key

### A. Blocking — ALL RESOLVED 2026-09-13

| # | Item | Status | Detail |
|---|---|---|---|
| A1 | `CORS_ORIGINS` on Render | ✅ | Was already correct; stale container was serving the default. Fixed by redeploy. |
| A2 | `FRONTEND_URL` on Render | ✅ | Already correct. Applied by redeploy. |
| A3 | `WEBAUTHN_RP_ID` | ✅ | Already set to `snacks-budget.vercel.app`. Live as of the redeploy — passkeys need a real browser test. |
| A4 | Render auto-deploy branch | ✅ | **The actual root cause.** Repointed to `main`; prod now on `4b26154`. |

### B. Degraded — fix in the same pass

| # | Item | Status | Detail |
|---|---|---|---|
| B1 | Upstash / shared rate-limit store | ⚠️ | `/api/health` reports `rate_limit_store: memory`. OAuth codes + WebAuthn challenges are per-instance and lost on restart. Safe only at 1 instance. |
| B2 | `TRUSTED_PROXIES` | ⚠️ | Not in `render.yaml`. Behind Render's proxy, every client shares one rate-limit bucket. |
| B3 | `ADMIN_EMAIL` | ✅ | Confirmed set. |
| B4 | `RESEND_API_KEY` / `EMAIL_FROM_ADDRESS` | ⚠️ | Confirmed **unset** (startup warning). **Corrected 2026-09-17:** the original entry claimed there is no magic-link route and that the warning was therefore harmless. That was wrong — it only checked `auth.py`. The route lives in `backend/app/api/routes/magic_link.py` (plus `models/magic_link.py`, a rate-limit entry, and `services/email/resend.py`), and the live OpenAPI exposes `/api/auth/magic-link/request` and `/verify`. The login page offered the button gated on `!isDemo` only, so it was a reachable path failing with `RESEND_API_KEY not configured`. The button is now gated on `auth_methods.magic_link`; it returns on its own if an email sender is ever configured. Password + passkey remain the recovery paths. |
| B5 | Free-plan cold start | ⚠️ | First request measured **35.7 s**. Reads as "app is broken" to a user. |
| B6 | `docs/deployment-security-checklist.md` | ⚠️ | Documents Fly.io + Fly Postgres. Actively misleading during an incident. |

### C. Verified good — do not touch

| # | Item | Status | Detail |
|---|---|---|---|
| C1 | `NEXT_PUBLIC_API_URL` | ✅ | `https://budget-app-backend-mdy0.onrender.com` — correct. |
| C2 | Neon connectivity | ✅ | `/api/health` → `db: ok`. The asyncpg `sslmode` fix in `56cba84` is holding. |
| C3 | Demo mode | ✅ | `/api/config` → `demo_mode: false`. Not a repeat of the 2026-07-25 incident. |
| C4 | Vercel production deploy | ✅ | Ready, serves `/login` at `200`. |
| C5 | Health endpoint + TLS | ✅ | `200`, security headers present (`x-frame-options`, `nosniff`). |

---

## Fix order

Do **B4 before A3** — confirm magic-link email works before changing anything passkey-related,
or a failed passkey change locks everyone out with no recovery path.

1. **B4** — confirm `RESEND_API_KEY` + `EMAIL_FROM_ADDRESS` are set on Render.
2. **A1–A3** — set on the Render service in one update:
   - `CORS_ORIGINS=https://snacks-budget.vercel.app`
   - `FRONTEND_URL=https://snacks-budget.vercel.app`
   - `WEBAUTHN_RP_ID=snacks-budget.vercel.app`
   - `ADMIN_EMAIL=<zach's address>` (B3)
   This triggers a redeploy. Watch logs for the `config.py` startup warnings — they name
   exactly these mismatches and should be **silent** afterward.
3. **A4** — repoint auto-deploy to `main`, then deploy. Prod picks up PR #118.
4. **Verify** (the real gate — curl proves nothing here):
   ```bash
   curl -s -I -X OPTIONS https://budget-app-backend-mdy0.onrender.com/api/auth/login \
     -H 'Origin: https://snacks-budget.vercel.app' \
     -H 'Access-Control-Request-Method: POST' | grep -i access-control-allow-origin
   ```
   Must echo back `https://snacks-budget.vercel.app`. Then sign in for real in a browser.
5. **B1/B2** — provision Upstash, set `UPSTASH_REDIS_REST_*` + `TRUSTED_PROXIES` on Render.
   Confirm `/api/health` flips to `rate_limit_store: upstash`.
6. **B6** — rewrite the checklist doc for Render/Neon.
7. **Remove** the inert `CORS_ORIGINS` / `FRONTEND_URL` from the Vercel project so the next
   person doesn't read them as authoritative.

---

## Delegation to the local model (LM Studio, `google/gemma-4-12b-qat`)

**Safe to delegate:** B6 doc rewrite, changelog/PR text for the fix, drafting the Upstash
provisioning notes.

**Do not delegate:** anything in section A or B1–B4. Those write production secrets, and a wrong
value here locks users out with no recovery path.

Verified in practice on 2026-09-13: the model produced a correct architecture table but invented
`render secrets list` and `render status` — **neither is a real Render CLI command**. Delegate
prose; verify every command it emits.

Note it is a reasoning model: budget ≥4000 `max_tokens` or it spends the entire allowance on
reasoning tokens and returns an empty string.

---

## Gap

Render env var *values* were never read directly — the MCP server exposes no read tool for them and
no `RENDER_API_KEY` is present locally. Everything above is inferred from the service's own
behaviour, which is stronger evidence than a var listing, but confirm A2/B3/B4 in the dashboard
before assuming them unset.
