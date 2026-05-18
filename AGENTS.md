# Agent / contributor context

Monorepo: **Next.js** UI in `frontend/`, **FastAPI** API in `backend/`. Persistent AI guidance lives in **`.cursor/rules/`** (`.mdc` files).

## Layout

| Path | Role |
|------|------|
| `frontend/src/app/` | App Router pages and layouts |
| `frontend/src/components/` | React components (shadcn-style UI) |
| `backend/app/` | FastAPI app, API routes, models, middleware |
| `backend/tests/` | `pytest` suite |

API entry: `backend/app/main.py` (`FastAPI`, routers under `/api`). Local backend commonly run with **uvicorn** on `app.main:app` (see `backend/Dockerfile`).

## Commands (verify after substantive changes)

Run everything CI runs, in one step (from repo root):

```bash
./scripts/ci-local.sh
```

Or individually:

**Backend** (from repo root):

```bash
cd backend && python -m pytest tests/ -v
```

Optional integration-style tests need Postgres and `RUN_PASSKEY_API_TESTS=1`—see `backend/tests/README.md`.

**Frontend** (from `frontend/`):

```bash
npm run lint
npm run test:run
npm run build
```

Dev server: `npm run dev` (default `http://localhost:3000`).

GitHub Actions runs the backend and frontend jobs on every PR (see `.github/workflows/ci.yml`).

## Database migrations

Schema is managed by **Alembic** (`backend/alembic/`). The container
entrypoint runs `alembic upgrade head` before uvicorn, so a normal
`docker compose up` applies pending migrations automatically.

```bash
# Run migrations locally (outside Docker):
cd backend && alembic upgrade head

# Create a new migration after changing app/models/*:
cd backend && alembic revision --autogenerate -m "short description"
#   Review the generated file in alembic/versions/ before committing.

# One-time, on an existing deployed DB that predates Alembic:
cd backend && alembic stamp head
#   Marks the current schema as baselined without re-running DDL.
```

`app/main.py` no longer runs inline migrations.

## Conventions

- Prefer **small, task-scoped diffs**; match existing patterns in neighboring files.
- **Lint, tests, commits, push:** see `.cursor/rules/verify-quality-and-git.mdc` (always-on).
- **Secrets:** never commit tokens, keys, real `.env` values, or production URLs—see `.cursor/rules/secrets-and-credentials.mdc`.
- **Sub-agents / Task tool:** when to parallelize and how to prompt—see `.cursor/rules/subagents-and-parallel-work.mdc`.

## MCP (optional)

Fly.io and Docker MCP servers are configured in [`.cursor/mcp.json`](.cursor/mcp.json) — see [`.cursor/README-MCP.md`](.cursor/README-MCP.md). Prefer **Cursor user settings** only for personal MCP servers you do not want in the repo.
