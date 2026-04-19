#!/usr/bin/env bash
# Container entrypoint: apply pending migrations, then hand off to the server.
# Any args passed to the container are forwarded to uvicorn (e.g. --reload).
set -euo pipefail

echo "[entrypoint] alembic upgrade head"
alembic upgrade head

echo "[entrypoint] starting uvicorn $*"
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 "$@"
