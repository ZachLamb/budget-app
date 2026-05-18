#!/usr/bin/env bash
# Simulates Vercel when Root Directory is the repo root (clarity project today).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$ROOT"

if [[ ! -d "$ROOT/frontend/src/app" ]]; then
  echo "error: expected frontend/src/app" >&2
  exit 1
fi

echo "== vercel-build-check: install =="
npm ci --prefix frontend

echo "== vercel-build-check: vercel-build (build + sync to repo root) =="
npm run vercel-build

for path in .next/routes-manifest.json node_modules/next/package.json public/icons; do
  if [[ ! -e "$ROOT/$path" ]]; then
    echo "error: missing $path at repo root after vercel-build" >&2
    exit 1
  fi
done

echo "== vercel-build-check: OK =="
