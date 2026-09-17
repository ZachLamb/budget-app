# Deployment security checklist

Operational reference for the **Vercel + Render + Neon** stack. Lists
**environment variable names only** — never commit values.

> Rewritten 2026-09-13. This document previously described a Fly.io backend with
> Fly Postgres. That stack is retired and its apps are paused. Following the old
> version during an incident actively misled the reader.

## Architecture

| Component | Platform | Resource name | Notes |
|---|---|---|---|
| Frontend | Vercel | `snacks-budget` | Next.js, root directory `frontend`, https://snacks-budget.vercel.app |
| API | Render | `budget-app-backend` | Docker from `backend/Dockerfile`, free plan, oregon, https://budget-app-backend-mdy0.onrender.com (`srv-daf30te7bikc73cn3i0g`) |
| Database | Neon | Postgres free tier | Not managed by Render; connection strings are pasted into Render env vars |
| Blueprint | Render | `render.yaml` (repo root) | Vars marked `sync: false` are **not** auto-populated |

**Auth methods that exist:** password, passkey (WebAuthn), Google OAuth
(currently disabled). There is **no magic-link email sign-in** — `auth.py` has no
such route. `config.py` still warns about `RESEND_API_KEY` on boot; that warning
refers to a feature that does not exist and can be ignored until one is built.
Password sign-in is the account-recovery path.

## Failure modes unique to this stack

| Symptom | Likely cause | Where to look |
|---|---|---|
| API answers `curl` fine but the web app can do nothing | Browser `Origin` not in `CORS_ORIGINS`, **or the running container predates the current env vars** | Preflight assertion below; Render env vars |
| Backend silently frozen on old code | Render auto-deploy branch was deleted from origin, so nothing triggers | Render deploy history — check the date of the newest deploy |
| Passkey prompt fails instantly, no network request | `WEBAUTHN_RP_ID` does not match the login-page domain | Browser console (`SecurityError`); `WEBAUTHN_RP_ID` |
| First request takes ~35s | Free-plan cold start, **not** an outage | Normal; login page shows a wake-up strip |

## Render (backend)

No `render` CLI is installed locally and the Render MCP server's write path
returns `500`, so operate via the REST API with a key from
**dashboard.render.com → Account Settings → API Keys**.

```bash
export RENDER_API_KEY=...            # keep out of shell history / commits
SVC=srv-daf30te7bikc73cn3i0g

# Names + values of every env var
curl -sS -H "Authorization: Bearer $RENDER_API_KEY" \
  "https://api.render.com/v1/services/$SVC/env-vars?limit=100" | jq -r '.[].envVar.key'

# Set ONE var (merge — does not disturb the others)
curl -sS -X PUT -H "Authorization: Bearer $RENDER_API_KEY" \
  -H 'Content-Type: application/json' -d '{"key":"KEY","value":"VALUE"}' \
  "https://api.render.com/v1/services/$SVC/env-vars/KEY"

# Which branch auto-deploy watches, and the newest deploy
curl -sS -H "Authorization: Bearer $RENDER_API_KEY" \
  "https://api.render.com/v1/services/$SVC" | jq '{branch, autoDeploy}'
curl -sS -H "Authorization: Bearer $RENDER_API_KEY" \
  "https://api.render.com/v1/services/$SVC/deploys?limit=1" \
  | jq -r '.[0].deploy | "\(.status) \(.createdAt) \(.commit.id[0:8])"'

# Deploy now (env-var edits alone may not restart the container)
curl -sS -X POST -H "Authorization: Bearer $RENDER_API_KEY" \
  -H 'Content-Type: application/json' -d '{"clearCache":"clear"}' \
  "https://api.render.com/v1/services/$SVC/deploys"
```

> **The whole PUT body replaces that one variable only.** Do not use the
> collection endpoint with a partial list — it replaces every variable.

| Secret / env | Purpose |
|---|---|
| `SECRET_KEY` | JWT signing (required, ≥32 chars) |
| `DATABASE_URL` / `DATABASE_URL_SYNC` | Neon pooled connection strings (async + sync) |
| `CORS_ORIGINS` | Comma-separated browser origins. **Must contain the Vercel app URL.** |
| `FRONTEND_URL` | OAuth redirects, cookie `Secure` detection, WebAuthn RP-ID derivation |
| `WEBAUTHN_RP_ID` | Passkey RP ID — the login-page hostname |
| `TRUSTED_PROXIES` | `10.0.0.0/8` on Render (see below) |
| `ADMIN_EMAIL` | Bootstrap admin approval |
| `DEMO_MODE` | Must be `false` in production |
| `PORT` | `8000` — `entrypoint.sh` hardcodes it; Render needs telling |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | Shared rate-limit + auth ephemeral store (aliases: `KV_REST_API_URL` / `KV_REST_API_TOKEN`) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Optional Google OAuth |

### `TRUSTED_PROXIES`

Set to `10.0.0.0/8` — Render's proxy addresses the app sees are in that range
(observed: `10.213.25.181`, `10.28.241.110`, `10.31.110.3`). Without it, Render's
edge is the rate-limit key and **all clients share one bucket**.

### Rate-limit store

`rate_limit_store.py` speaks the **Upstash REST API only** (`rest_url` +
`rest_token`) — not the Redis wire protocol. Render's own Key Value product is
therefore **not** a drop-in; it would need a new store class. Provision Upstash
(directly, or via the Vercel Marketplace which supplies `KV_REST_API_*`) and copy
both values to Render.

Until then `/api/health` reports `rate_limit_store: memory`: limits and
WebAuthn/OAuth challenges are per-instance and lost on restart. Safe only at one
instance.

## Vercel (frontend)

Root Directory is `frontend`; `frontend/vercel.json` holds install/build.

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_API_URL` | Rewrite target for `/api/*` — the public Render URL |
| `NEXT_PUBLIC_APP_URL` | Canonical app URL for SSR / links |
| `NEXT_PUBLIC_DEMO_MODE` | Build-time demo flag |

**Backend variables do not belong here.** `CORS_ORIGINS` and `FRONTEND_URL` were
found set on the Vercel project on 2026-09-13, where they are inert; they were
removed. The backend reads them from Render and nowhere else.

## Health verification

`curl` ignores CORS, so a green health check proves nothing about whether the
browser can talk to the API. **Assert the preflight separately** — this is the
check that would have caught the 2026-09-07 outage:

```bash
API=https://budget-app-backend-mdy0.onrender.com
APP=https://snacks-budget.vercel.app

curl -sS --max-time 90 "$API/api/health" | jq .     # status + db + rate_limit_store
curl -sS --max-time 90 "$API/api/config" | jq .     # server-authoritative demo_mode

curl -sS -o /dev/null -D - --max-time 90 -X OPTIONS "$API/api/auth/login" \
  -H "Origin: $APP" -H 'Access-Control-Request-Method: POST' \
  | grep -i access-control-allow-origin     # MUST echo $APP
```

`.github/workflows/prod-health.yml` runs all three every 30 minutes.

## Changing the app's domain (login-critical)

Moving the frontend to a new hostname breaks sign-in in three ways. All three are
runtime env vars on Render — no code change fixes them.

1. **`WEBAUTHN_RP_ID`** — must be the new login-page domain (or a registrable
   suffix). Otherwise the browser aborts the passkey ceremony with
   `SecurityError` and *no request reaches the backend*.
2. **`CORS_ORIGINS`** — must contain the new origin, or `/api/auth/*` rejects the
   browser with `400 Invalid origin`.
3. **`FRONTEND_URL`** — OAuth redirects point here.

Set all three, then **deploy** — editing env vars does not reliably restart the
container (see the 2026-09-13 incident). `config.py` logs a startup warning for
each mismatch; check the logs after deploying.

> **Existing passkeys do not survive a domain change.** A passkey is bound to the
> RP ID it was created under. Affected users must sign in with their password and
> register a new passkey.

## Incident: prod unreachable from the browser for six days (2026-09-13)

**Symptom:** the app loaded at `snacks-budget.vercel.app` but nothing worked.
`/api/health` returned `status: ok, db: ok` throughout.

**Cause:** PR #117 merged and its branch `feat/ai-features-lm-studio` was deleted.
Render's auto-deploy still watched that branch, so **no deploy ran for six days**.
Correct `CORS_ORIGINS` had been saved to Render, but the container still running
predated it and served the compiled-in default (`localhost:3000,3001`). It
rejected the production origin as `400 Disallowed CORS origin` — identically to a
hostile one.

**Why it went unnoticed:** `prod-health.yml` still probed the paused Fly app, so
it had been failing every run for weeks. A permanently-red alert carries no
signal.

**Fix:** repointed the service to `main`, deployed. Verified by preflight —
the production origin echoed back, and `localhost` flipped to `400`, proving the
container had restarted with real config.

**Lessons:**
- A deleted deploy branch fails *silently*: green dashboard, stale code, no alert.
- Curl-based health checks cannot see CORS. Assert the preflight.
- Env vars saved but never deployed are not in effect. Confirm from the outside.

## Incident: production stuck in demo mode (2026-07-25)

**Symptom:** could not sign in or create an account.

**Cause:** `DEMO_MODE=true` *and* `DEMO_MODE_ALLOW_PRODUCTION=true` were set. The
second bypasses the hard-fail gate in `config.py`, so the app booted normally —
but `DemoGuardMiddleware` 403s every mutation not on its allowlist, and
registration is not on it. Sign-*in* was permitted; sign-*up* was not.

**Fix:** unset both. `curl -sS "$API/api/config"` is server-authoritative and
answers "is this deploy a demo?" in one request — check it first when sign-up
misbehaves.
