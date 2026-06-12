# Clarity frontend

Next.js 16 App Router UI for the budget app monorepo. Deployed on Vercel with `frontend` as the project root directory.

## Development

From this directory:

```bash
npm ci
npm run dev
```

Open http://localhost:3000. API requests go to `/api/*` and are rewritten to the backend (default `http://localhost:8000`).

When using **Docker Compose** from the repo root, the frontend is exposed on **port 3001** (`docker compose up frontend`).

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test:run` | Vitest unit tests |
| `npm run test:e2e` | Playwright (needs running stack) |
| `npm run quality:check` | lint + tests + fallow dead-code |

## Monorepo context

See the [root README](../README.md) for backend setup, Docker Compose, and CI.
