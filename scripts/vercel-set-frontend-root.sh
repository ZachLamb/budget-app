#!/usr/bin/env bash
# One-time: point the linked Vercel project at frontend/ (fixes deploy without sync hacks).
# Requires a personal access token: https://vercel.com/account/tokens
#   export VERCEL_TOKEN=...
set -euo pipefail

TEAM_ID="${VERCEL_TEAM_ID:-team_7Wdec06u4uFnTMZpYbv5KQCF}"
PROJECT_ID="${VERCEL_PROJECT_ID:-prj_oRWy22DqEB3ht2Cl9MQngCMArA7V}"

if [[ -z "${VERCEL_TOKEN:-}" ]]; then
  echo "Set VERCEL_TOKEN (https://vercel.com/account/tokens), then re-run." >&2
  exit 1
fi

curl -fsS -X PATCH "https://api.vercel.com/v9/projects/${PROJECT_ID}?teamId=${TEAM_ID}" \
  -H "Authorization: Bearer ${VERCEL_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"rootDirectory":"frontend"}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('rootDirectory:', d.get('rootDirectory', d))"

echo "Done. Redeploy the branch; Vercel should run npm run build inside frontend/."
