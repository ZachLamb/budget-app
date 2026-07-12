#!/usr/bin/env bash
# Downloads the FastAPI OpenAPI spec and generates TypeScript types.
#
# If BACKEND_URL is set, fetches the live spec from the running backend.
# Otherwise, falls back to the pre-committed snapshot at frontend/openapi-snapshot.json.
# This lets CI generate types without needing Python in the frontend job.
#
# Usage:
#   bash scripts/generate-api-types.sh                    # use snapshot
#   BACKEND_URL=http://localhost:8000 bash scripts/generate-api-types.sh
set -euo pipefail

OUT="src/lib/api/generated.ts"
SNAPSHOT="openapi-snapshot.json"

if [ -n "${BACKEND_URL:-}" ]; then
  echo "Fetching OpenAPI spec from $BACKEND_URL/openapi.json..."
  curl -sf "$BACKEND_URL/openapi.json" -o /tmp/openapi.json
  SPEC_PATH="/tmp/openapi.json"
else
  echo "BACKEND_URL not set — using snapshot at $SNAPSHOT"
  SPEC_PATH="$SNAPSHOT"
fi

echo "Generating TypeScript types -> $OUT"
npx openapi-typescript "$SPEC_PATH" -o "$OUT"

echo "Done. Generated $OUT"
