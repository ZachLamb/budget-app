#!/usr/bin/env bash
# Run the same checks CI runs, in one command, from the repo root.
#
# This mirrors .github/workflows/ci.yml step for step, in the same order, so
# that "ci-local: OK" actually predicts a green CI run. If you add a step to
# ci.yml, add it here too.
#
# The Playwright smoke job (.github/workflows/e2e.yml) is opt-in via --e2e:
# it needs Docker and takes several minutes, which is too slow for a routine
# pre-push check. That job is path-filtered in CI and only runs when
# frontend/src, frontend/e2e, backend/app, docker-compose.yml or .env.demo
# changed — run --e2e yourself when you touch those.
set -euo pipefail

RUN_E2E=0

usage() {
  cat <<'USAGE'
Usage: ./scripts/ci-local.sh [--e2e]

  --e2e     Also run the Playwright smoke suite (mirrors e2e.yml).
            Requires Docker; takes several minutes. Brings up a demo
            stack via docker compose and tears it down afterwards.
  -h,--help Show this help.

Mirrors .github/workflows/ci.yml. Without --e2e this covers both CI jobs
that run on every PR: "Backend (pytest / audit)" and
"Frontend (lint / test / build)".
USAGE
}

for arg in "$@"; do
  case "$arg" in
    --e2e) RUN_E2E=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "error: unknown option '$arg'" >&2; usage >&2; exit 2 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ---------------------------------------------------------------- backend job
# ci.yml: "Backend (pytest / audit)"

echo "== backend: dependency audit (pip-audit) =="
if ! command -v pip-audit > /dev/null 2>&1; then
  echo "error: pip-audit is not installed, but CI runs it — skipping it here" >&2
  echo "       would make a green local run meaningless. Install it with:" >&2
  echo "         pip install pip-audit" >&2
  exit 1
fi
# The --ignore-vuln must stay in sync with ci.yml. Starlette 0.52.1 (via
# FastAPI) — PYSEC-2026-161 has no 0.52.x fix yet.
( cd "$ROOT/backend" && pip-audit -r requirements.txt --ignore-vuln PYSEC-2026-161 )

echo "== backend: pytest =="
( cd "$ROOT/backend" && python -m pytest tests/ -v )

# --------------------------------------------------------------- frontend job
# ci.yml: "Frontend (lint / test / build)"

# CI always starts from a clean `npm ci`. Locally we only install when
# node_modules is absent — the vercel-build-check step at the end runs a real
# `npm ci`, which is what catches package.json/package-lock.json drift.
if [[ ! -d "$ROOT/frontend/node_modules" ]]; then
  echo "== frontend: install (node_modules missing) =="
  npm ci --prefix "$ROOT/frontend"
fi

echo "== frontend: dependency audit (npm) =="
( cd "$ROOT/frontend" && npm audit --audit-level=high )

echo "== frontend: generate API types (from snapshot) =="
( cd "$ROOT/frontend" && bash scripts/generate-api-types.sh )
# CI regenerates this file before linting, so CI is green either way. But if
# regeneration changes the committed copy, the checked-in types are stale and
# should be committed — warn without failing, so local stays no stricter than CI.
if ! git -C "$ROOT" diff --quiet -- frontend/src/lib/api/generated.ts 2>/dev/null; then
  echo "warning: frontend/src/lib/api/generated.ts changed after regeneration —" >&2
  echo "         the committed API types are stale. Review and commit them." >&2
fi

echo "== frontend: lint =="
( cd "$ROOT/frontend" && npm run lint )

echo "== frontend: typecheck =="
( cd "$ROOT/frontend" && npm run typecheck )

echo "== frontend: static analysis (fallow) =="
( cd "$ROOT/frontend" && npm run quality:static )

echo "== frontend: tests =="
( cd "$ROOT/frontend" && npm run test:run )

echo "== frontend: production build (Vercel Root Directory = frontend) =="
( "$ROOT/scripts/vercel-build-check.sh" )

# --------------------------------------------------------------------- e2e job
# e2e.yml: "Playwright smoke" — opt-in, see --e2e above.

if [[ "$RUN_E2E" == "1" ]]; then
  echo "== e2e: Playwright smoke (mirrors e2e.yml) =="

  if ! docker compose version > /dev/null 2>&1; then
    echo "error: 'docker compose' is unavailable — cannot run the e2e job." >&2
    exit 1
  fi

  # e2e.yml does `cp .env.demo .env` on a throwaway runner. Locally that would
  # clobber a real .env, so stash any existing one and always put it back.
  ENV_BACKUP=""
  if [[ -f "$ROOT/.env" ]]; then
    ENV_BACKUP="$ROOT/.env.ci-local.bak.$$"
    cp "$ROOT/.env" "$ENV_BACKUP"
    echo "   (stashed your existing .env — it will be restored on exit)"
  fi

  cleanup_e2e() {
    ( cd "$ROOT" && docker compose down -v > /dev/null 2>&1 ) || true
    if [[ -n "$ENV_BACKUP" && -f "$ENV_BACKUP" ]]; then
      mv -f "$ENV_BACKUP" "$ROOT/.env"
      echo "   (restored your .env)"
    else
      rm -f "$ROOT/.env"
    fi
  }
  trap cleanup_e2e EXIT

  cp "$ROOT/.env.demo" "$ROOT/.env"

  # CI uses --with-deps to apt-install system libs on the ubuntu runner; that
  # flag is Linux-only, so locally we just fetch the browser.
  ( cd "$ROOT/frontend" && npx playwright install chromium )

  ( cd "$ROOT" && docker compose up -d --build postgres backend frontend )

  echo "   waiting for backend..."
  for i in $(seq 1 60); do
    if curl -fsS http://localhost:8000/api/health > /dev/null 2>&1; then
      echo "   backend up"; break
    fi
    if [[ "$i" == "60" ]]; then
      echo "error: backend did not come up in time" >&2
      ( cd "$ROOT" && docker compose logs backend ) || true
      exit 1
    fi
    sleep 5
  done

  echo "   waiting for frontend..."
  for i in $(seq 1 60); do
    if curl -fsS http://localhost:3001/login > /dev/null 2>&1; then
      echo "   frontend up"; break
    fi
    if [[ "$i" == "60" ]]; then
      echo "error: frontend did not come up in time" >&2
      ( cd "$ROOT" && docker compose logs frontend backend ) || true
      exit 1
    fi
    sleep 5
  done

  # Turbopack compiles routes on first request; pre-warm so Playwright's
  # toHaveURL assertion doesn't time out on a cold container.
  curl -fsS http://localhost:3001/ > /dev/null 2>&1 || true

  ( cd "$ROOT/frontend" && npm run test:e2e )

  echo "== e2e: OK =="
else
  echo "== e2e: SKIPPED (run with --e2e; mirrors the path-filtered e2e.yml job) =="
fi

echo "== ci-local: OK =="
