#!/usr/bin/env bash
# Simulates a Vercel build with Root Directory = frontend.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND="$(cd "$SCRIPT_DIR/../frontend" && pwd)"

if [[ ! -d "$FRONTEND/src/app" ]]; then
  echo "error: expected frontend/src/app" >&2
  exit 1
fi

echo "== vercel-build-check: install =="
npm ci --prefix "$FRONTEND"

echo "== vercel-build-check: build =="
npm run build --prefix "$FRONTEND"

for path in .next/routes-manifest.json node_modules/next/package.json public/icons; do
  if [[ ! -e "$FRONTEND/$path" ]]; then
    echo "error: missing frontend/$path after build" >&2
    exit 1
  fi
done

echo "== vercel-build-check: OK =="
