#!/usr/bin/env bash
# Simulates Vercel Git deploy when Root Directory is the repo root (clarity today).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FRONTEND="$ROOT/frontend"

if [[ ! -d "$FRONTEND/src/app" ]]; then
  echo "error: expected frontend/src/app" >&2
  exit 1
fi

echo "== vercel-build-check: install =="
npm ci --prefix "$FRONTEND"

echo "== vercel-build-check: build + sync =="
npm run build --prefix "$FRONTEND"
node "$ROOT/scripts/sync-next-output.mjs"

for path in .next/routes-manifest.json public/icons; do
  if [[ ! -e "$ROOT/$path" ]]; then
    echo "error: missing $path at repo root after sync" >&2
    exit 1
  fi
done

echo "== vercel-build-check: OK =="
