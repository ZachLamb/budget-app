# Snack's Budget

Personal budgeting and debt planning: envelope-style budgets, SimpleFIN bank sync, optional on-device or cloud AI, and passkey/password auth.

| Stack | Path | Deploy target |
|-------|------|---------------|
| Next.js 16 UI | `frontend/` | Vercel |
| FastAPI API | `backend/` | Fly.io |
| Postgres | Alembic migrations | Fly Postgres / Docker |

## Quick start (Docker)

```bash
cp .env.example .env
# Edit .env — at minimum set POSTGRES_PASSWORD and SECRET_KEY

docker compose up --build
```

| Service | URL |
|---------|-----|
| Frontend (dev) | http://localhost:3001 |
| Backend API | http://localhost:8000 |
| Caddy proxy (optional) | http://localhost |

Minimal stack without Caddy/Ollama:

```bash
docker compose up postgres backend frontend
```

Demo mode (for smoke tests or public demos):

```bash
cp .env.demo .env
docker compose up --build postgres backend frontend
```

## Local development (host)

**Backend** (from `backend/`):

```bash
pip install -r requirements.txt -r requirements-dev.txt
alembic upgrade head
uvicorn app.main:app --reload
```

**Frontend** (from `frontend/`):

```bash
npm ci
npm run dev   # http://localhost:3000 — rewrites /api to localhost:8000
```

## Verify before push

```bash
./scripts/ci-local.sh
```

## Docs

- [AGENTS.md](AGENTS.md) — contributor / agent context
- [docs/deployment-security-checklist.md](docs/deployment-security-checklist.md) — production ops
- [docs/audit-and-upgrade-plan-2026-06.md](docs/audit-and-upgrade-plan-2026-06.md) — upgrade roadmap
- [infra/modal/README.md](infra/modal/README.md) — Tier 4 cloud LLM (Modal vLLM)

## Known issues / TODO

- **Dashboard "AI Suggestions" card is empty**: The collapsible card renders with no content when no AI suggestions are available. It should either be hidden when there's nothing to show, or display a meaningful empty state (e.g. "No suggestions yet — connect a bank account to get started"). Currently it just shows an empty collapsed box with a chevron.
- **Fly.io app names still use "clarity"**: `clarity-backend` and `clarity-db` are the live Fly.io resource identifiers and can't be renamed by a code change alone. If the apps are ever migrated/recreated, update `backend/fly.toml`, `backend/app/services/hosting/fly.py`, and the test fixtures in `backend/tests/test_hosting_fly.py`.
- **Encryption salt references "clarity"**: `b"clarity-column-encryption-v1"` in `backend/app/services/crypto.py` must never be changed — it's baked into all existing encrypted values in the database. If ever rotated, a full re-encryption migration is required.
