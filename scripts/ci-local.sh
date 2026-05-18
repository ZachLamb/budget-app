#!/usr/bin/env bash
# Run the same checks CI runs, in one command, from the repo root.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "== backend: pytest =="
( cd "$ROOT/backend" && python -m pytest tests/ -v )

echo "== frontend: lint =="
( cd "$ROOT/frontend" && npm run lint )

echo "== frontend: tests =="
( cd "$ROOT/frontend" && npm run test:run )

echo "== frontend + vercel: production build (from repo root) =="
( "$ROOT/scripts/vercel-build-check.sh" )

echo "== ci-local: OK =="
