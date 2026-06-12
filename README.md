# Clarity — Budget App

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
