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

if [[ -d "$ROOT/app" || -d "$ROOT/pages" ]]; then
  echo "error: repo root must not contain app/ or pages/ (use frontend/ only)" >&2
  exit 1
fi

if [[ ! -f "$ROOT/vercel.json" ]] || ! grep -q '"rootDirectory"[[:space:]]*:[[:space:]]*"frontend"' "$ROOT/vercel.json"; then
  echo "warning: root vercel.json should set rootDirectory to frontend" >&2
fi

echo "== vercel-build-check: install (frontend) =="
npm ci --prefix "$FRONTEND"

echo "== vercel-build-check: build (frontend) =="
npm run build --prefix "$FRONTEND"

if [[ ! -f "$FRONTEND/.next/routes-manifest.json" ]]; then
  echo "error: frontend/.next/routes-manifest.json missing after build" >&2
  exit 1
fi

echo "== vercel-build-check: root vercel-build (monorepo fallback) =="
npm run vercel-build --prefix "$ROOT"

echo "== vercel-build-check: OK =="
