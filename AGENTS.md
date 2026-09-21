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
./scripts/ci-local.sh          # both per-PR CI jobs
./scripts/ci-local.sh --e2e    # ...plus the Playwright smoke suite (needs Docker, slow)
```

This mirrors `.github/workflows/ci.yml` step for step, including the
`pip-audit` and `npm audit --audit-level=high` dependency gates — a step
missing here means CI can fail on a change that looked green locally. Keep the
two in sync when editing either. Requires `pip-audit` (`pip install pip-audit`).

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
npm run quality:check   # lint + tests + fallow dead-code
npm run build
```

Dev server: `npm run dev` (default `http://localhost:3000`).

GitHub Actions runs the backend and frontend jobs on every PR (see `.github/workflows/ci.yml`).

**Vercel (frontend):** The Next.js app lives in `frontend/`. **Root Directory** is set to `frontend` in the Vercel project (Settings → General). `frontend/vercel.json` configures install/build. Before pushing UI changes, run from repo root:

```bash
./scripts/ci-local.sh
# or only the Vercel gate:
./scripts/vercel-build-check.sh
```

## Local test users

Driving the real UI needs a real account with real rows behind it.
`scripts/dev-test-user.py` creates and destroys throwaway ones. It needs the
backend running (`:8001` here, not the canonical `:8000` — see
`frontend/.env.local`) and the backend virtualenv, which supplies SQLAlchemy.

```bash
cd backend && source .venv/bin/activate && cd ..

python scripts/dev-test-user.py create                    # uitest@local.test, fully set up
python scripts/dev-test-user.py create \
    --email newbie@local.test --profile empty             # nothing set up: first-run UX
python scripts/dev-test-user.py list
python scripts/dev-test-user.py destroy --email uitest@local.test
python scripts/dev-test-user.py destroy --all
```

Password for every test account is `LocalUiTest!2026` (override with
`DEV_TEST_USER_PASSWORD`). Sign in at `http://localhost:3000/login` — use
"More sign-in options" for the email/password form.

`--profile full` seeds an account, two deductible Schedule E categories and
one Schedule A category, four transactions, a single filing status, a
September paystub with year-to-date figures, last year's return, and a
biweekly pay schedule — enough for `/taxes` and `/deductions` to show a
complete picture. `--profile empty` gives a household with nothing in it,
which is what you want for testing the setup checklist and empty states.

**Two guards, because `destroy` deletes households:** every address it
touches must end in `@local.test`, so a real account cannot be named; and
the database must be on localhost, so pointing it at Neon refuses. Both are
worth keeping if you extend the script.

Registration answers `403 "awaiting approval"` on success — the admin gate.
The script writes the approval directly, which is also why it needs the
database and not just the API.

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

## Skills (Cursor / Claude)

| Location | Purpose |
|----------|---------|
| `.cursor/skills/` | **Project:** `budget-app-verify` (full CI), `budget-app-quality` (frontend lint/test/fallow) |
| `~/.cursor/skills/` | **Personal:** copies of `~/.claude/skills/` — edit Claude dir first, then re-copy to Cursor |

**Frontend quality (after UI/TS changes):** `cd frontend && npm run quality:check` (lint, Vitest, fallow dead-code).

**Full CI gate:** `./scripts/ci-local.sh` from repo root (add `--e2e` for the
Playwright smoke suite). Mirrors `ci.yml` step for step, dependency audits
included.

**Deeper audit (periodic):** `cd frontend && npm run quality:audit` or personal `code-quality-audit` skill.

Config: `frontend/fallow.toml`, `frontend/knip.json`.

## MCP (optional)

Fly.io and Docker MCP servers are configured in [`.cursor/mcp.json`](.cursor/mcp.json) — see [`.cursor/README-MCP.md`](.cursor/README-MCP.md). Prefer **Cursor user settings** only for personal MCP servers you do not want in the repo.
