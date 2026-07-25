# Deployment security checklist

Operational reference for the Vercel + Fly.io stack. Lists **environment variable names only** — never commit values.

## Architecture

| Component | Platform | App / resource name |
|-----------|----------|---------------------|
| Frontend | Vercel (Next.js) | Linked via `vercel link` in `frontend/` |
| API | Fly.io | `clarity-backend` ([`backend/fly.toml`](../backend/fly.toml)) |
| Postgres | Fly.io | `clarity-db` (attached to backend via `fly postgres attach`) |
| Shared rate limits / auth challenges | Upstash Redis | REST API; same credentials as rate-limit store |
| Cloud LLM (Tier 4) | Modal | See [`infra/modal/README.md`](../infra/modal/README.md) |

## Vercel (frontend)

**Monorepo layout:** Next.js lives in `frontend/`. **Root Directory** = `frontend` is configured in the Vercel project. [`frontend/vercel.json`](../frontend/vercel.json) holds install/build. Before pushing UI changes, run `./scripts/vercel-build-check.sh` or `./scripts/ci-local.sh`.

Verify in the Vercel dashboard or `vercel env ls` (from `frontend/`):

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_API_URL` | Rewrite target for `/api/*` (public Fly API URL in production) |
| `NEXT_PUBLIC_APP_URL` | Canonical app URL for SSR / links |
| `VERCEL_ENV` | `production` / `preview` / `development` (read-only, set by Vercel) |

**Integrations to confirm**

- Upstash (Vercel Marketplace) may provision `KV_REST_API_URL` / `KV_REST_API_TOKEN` on the **Vercel** project. The **Fly backend** must also receive these (or `UPSTASH_REDIS_REST_*` aliases) — rate limits, lockout, and WebAuthn/OAuth ephemeral state do not run on Vercel.

**Hardening**

- Enable Deployment Protection for preview deployments if the repository is public.
- Scope secrets per environment (Production vs Preview); use separate `SECRET_KEY` and databases for previews when possible.
- Confirm no backend secrets appear in `NEXT_PUBLIC_*` variables.

## Fly.io (backend)

```bash
fly secrets list -a clarity-backend   # names only
fly status -a clarity-backend
```

| Secret / env | Purpose |
|--------------|---------|
| `SECRET_KEY` | JWT signing (required, ≥32 chars) |
| `DATABASE_URL` | Postgres (set by `fly postgres attach`) |
| `CORS_ORIGINS` | Comma-separated browser origins (Vercel app URL(s)) |
| `FRONTEND_URL` | OAuth redirects, cookie `Secure` detection |
| `TRUSTED_PROXIES` | CIDRs allowed to set `X-Forwarded-For` (see below) |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Shared rate limit + auth ephemeral store |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Vercel Marketplace alias (accepted by backend config) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Optional Google OAuth |
| `WEBAUTHN_RP_ID` | Passkey RP ID (production hostname) |
| `LLM_BACKEND_URL` / `LLM_BACKEND_API_KEY` | Modal vLLM in production |
| `RESEND_API_KEY` / `EMAIL_FROM_ADDRESS` | Magic-link email |
| `ADMIN_EMAIL` | Bootstrap admin approval |
| `AUTH_RATE_LIMIT_STRICT` | When `true` and Upstash is set, `/api/auth/*` returns 429 if Redis is unreachable (default `false`) |
| `FLY_APP_NAME` | Set automatically on Fly (production marker) |

### `TRUSTED_PROXIES` (required for correct per-IP rate limits)

Without this, Fly’s edge proxy is the rate-limit key and all clients share one bucket.

```bash
fly secrets set TRUSTED_PROXIES='172.16.0.0/12,10.0.0.0/8' -a clarity-backend
```

After deploy, confirm `/api/health` reports `rate_limit_store: upstash` (or `memory` in dev) and `rate_limit_store_status: ok` when Upstash is configured.

### Machine count vs auth challenges

OAuth login codes and WebAuthn challenges use the shared Upstash store when Redis credentials are set. With Upstash configured, multiple Fly machines are safe. Without Upstash, keep **one machine** or accept broken passkey/OAuth during restarts.

## Health verification

```bash
curl -sS "https://<your-fly-app>/api/health" | jq .
```

Expect `components.rate_limit_store` and `components.rate_limit_store_status`.

## Changing the app's domain (login-critical)

Moving the frontend to a new hostname breaks sign-in in three separate ways.
All three are runtime env/secrets — no code change fixes them.

1. **`WEBAUTHN_RP_ID`** — must be the new login-page domain (or a registrable
   suffix of it, e.g. `snacksbudget.app` covers `app.snacksbudget.app`). If it
   still names the old domain the browser aborts the passkey ceremony with
   `SecurityError` and *no request reaches the backend*.
2. **`CORS_ORIGINS`** — must contain the new origin. Otherwise `/api/auth/*`
   rejects the browser origin with `400 Invalid origin`.
3. **`FRONTEND_URL`** — magic-link and OAuth redirects point here; a stale
   value sends users back to the old domain.

```bash
fly secrets set \
  WEBAUTHN_RP_ID='<new-domain>' \
  CORS_ORIGINS='https://<new-domain>' \
  FRONTEND_URL='https://<new-domain>' \
  -a clarity-backend
```

Both mismatches now emit a startup warning (`app/config.py`); check
`fly logs -a clarity-backend` after the deploy.

> **Existing passkeys do not survive a domain change.** A passkey is
> cryptographically bound to the RP ID it was created under, so credentials
> registered on the old domain can never be asserted on the new one — there is
> no migration. Affected users must sign in by another method (magic link) and
> register a new passkey. Keep `RESEND_API_KEY` + `EMAIL_FROM_ADDRESS` working
> before the cutover, or everyone is locked out.

## Incident: production stuck in demo mode (2026-07-25)

**Symptom:** could not sign in or create an account on `snacks-budget.vercel.app`.

**Cause:** the backend had `DEMO_MODE=true` *and* `DEMO_MODE_ALLOW_PRODUCTION=true`
set as Fly secrets. The second is the deliberate escape hatch that bypasses the
hard-fail gate in `app/config.py`, so the app booted normally — but
`DemoGuardMiddleware` was installed, and it 403s every mutation not on its
allowlist. Registration is not on that allowlist:

```
POST /api/auth/register           → 403 "This is a read-only demo"
POST /api/auth/passkey/register/* → 403 "This is a read-only demo"
```

Sign-*in* was permitted; sign-*up* and passkey enrolment were not — so there was
no way to establish an account on the new domain. The frontend was built with
`NEXT_PUBLIC_DEMO_MODE` empty, so the UI never revealed itself as a demo. This
is exactly the build-time/runtime drift the `/api/config` docstring warns about.

**Fix:** `fly secrets unset DEMO_MODE DEMO_MODE_ALLOW_PRODUCTION -a clarity-backend`

**Diagnosis shortcut** — `curl -sS https://<backend>/api/config` is
server-authoritative and answers "is this deploy a demo?" in one request. Check
it first when sign-up misbehaves; the domain/passkey settings below are a
separate failure class with different symptoms.

`app/config.py` now logs a loud `READ-ONLY DEMO` warning whenever the escape
hatch is active, so this state can't sit unnoticed again.

Also cleared in the same pass: `WEBAUTHN_RP_NAME` was still set to `Clarity` on
Fly, overriding the renamed code default, so OS passkey prompts read "Clarity".
Unset it — the `app/config.py` default (`Snack's Budget`) is now authoritative.

## MCP / ops log (2026-05-17)

Executed on production:

| Step | Status |
|------|--------|
| Fly deploy (`clarity-backend`) with security code | Done — migration `0006_add_user_session_version` applied on boot |
| Vercel production deploy (`clarity`) | Done — production alias (see Vercel dashboard) |
| `TRUSTED_PROXIES` on Fly | Done |
| `KV_REST_API_*` synced to Fly | Set from Vercel env — **hostname was NXDOMAIN** (stale uninstalled integration) |
| Upstash reprovision | New store `clarity-rate-limit` created; **project env link needs dashboard finish** |

### Upstash remediation (required for shared rate limits / auth challenges)

The old `budget-app-rate-limit` integration was **Uninstalled** but left dead `KV_*` env vars. Those vars were removed from Vercel; a new store `clarity-rate-limit` was provisioned.

**Finish in Vercel** (one-time): [Upstash integration dashboard](https://vercel.com/zach-lambs-projects/~/integrations/upstash) → connect `clarity-rate-limit` to project **clarity** (or run `vercel integration add upstash/upstash-kv` and complete the browser step).

Then sync to Fly (do not commit pulled env files):

```bash
cd frontend && vercel env pull /tmp/clarity-vercel-prod.env --environment=production --yes
set -a && source /tmp/clarity-vercel-prod.env && set +a
fly secrets set KV_REST_API_URL="$KV_REST_API_URL" KV_REST_API_TOKEN="$KV_REST_API_TOKEN" -a clarity-backend
rm -f /tmp/clarity-vercel-prod.env
```

Confirm: `curl -sS "https://<your-fly-app>/api/health"` shows `rate_limit_store_status: ok` (not `unavailable`).

Until then, rate limiting and OAuth/passkey challenges use **in-memory fallback per Fly machine** (degraded but functional on a single instance).
