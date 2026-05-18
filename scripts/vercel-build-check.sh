#!/usr/bin/env bash
# Validates the Next.js production build for Vercel (app in frontend/).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FRONTEND="$ROOT/frontend"

if [[ ! -d "$FRONTEND/src/app" ]]; then
  echo "error: expected frontend/src/app" >&2
  exit 1
fi

if [[ ! -f "$ROOT/.vercel/repo.json" ]]; then
  echo "error: missing .vercel/repo.json (maps clarity → frontend/)" >&2
  exit 1
fi

echo "== vercel-build-check: install (frontend) =="
npm ci --prefix "$FRONTEND"

echo "== vercel-build-check: build (frontend) =="
npm run build --prefix "$FRONTEND"

if [[ ! -f "$FRONTEND/.next/routes-manifest.json" ]]; then
  echo "error: frontend/.next/routes-manifest.json missing after build" >&2
  exit 1
fi

echo "== vercel-build-check: OK =="
