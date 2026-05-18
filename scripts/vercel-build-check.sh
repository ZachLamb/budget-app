#!/usr/bin/env bash
# Simulates a Vercel build when the linked project root is the repository root
# (not frontend/). Catches "Couldn't find any pages or app directory" before push.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$ROOT"

if [[ -d "$ROOT/frontend/src/app" ]]; then
  :
else
  echo "error: expected frontend/src/app — is the Next.js app still under frontend/?" >&2
  exit 1
fi

if [[ -d "$ROOT/app" || -d "$ROOT/pages" ]]; then
  echo "error: repo root must not contain app/ or pages/ (use frontend/ only)" >&2
  exit 1
fi

echo "== vercel-build-check: install (frontend) =="
npm ci --prefix frontend

echo "== vercel-build-check: build (from repo root, like Vercel) =="
npm run vercel-build

if [[ ! -f "$ROOT/.next/routes-manifest.json" ]]; then
  echo "error: .next/routes-manifest.json missing at repo root (Vercel expects it here)" >&2
  exit 1
fi

echo "== vercel-build-check: OK =="
