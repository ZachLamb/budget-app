#!/usr/bin/env bash
# Container entrypoint: apply pending migrations, then hand off to the server.
# Any args passed to the container are forwarded to uvicorn (e.g. --reload).
set -euo pipefail

echo "[entrypoint] alembic upgrade head"
alembic upgrade head

echo "[entrypoint] starting uvicorn $*"
# --log-config adds an `app.*` logger at INFO so our startup banner (rate-limit
# store) and timing lines (ai_llm op=... duration_ms=...) reach stdout/stderr.
# Without it, uvicorn's default config only honors `uvicorn.*` loggers and app
# INFO lines are silently dropped.
exec uvicorn app.main:app \
    --host 0.0.0.0 \
    --port 8000 \
    --log-config /app/log_config.json \
    "$@"
