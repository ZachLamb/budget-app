---
name: budget-app-verify
description: Run the budget-app full CI gate from repo root (pytest, frontend lint/tests/fallow, Vercel build). Use before merge-ready claims, PRs, or when the user asks if CI will pass.
---

# Budget app — full verification

**Announce:** "Using budget-app-verify to run the repo CI gate."

## Command

From repository root:

```bash
./scripts/ci-local.sh
```

This runs, in order:

1. `backend` — `python -m pytest tests/ -v`
2. `frontend` — `npm run lint`
3. `frontend` — `npm run quality:static` (fallow dead-code, hard fail)
4. `frontend` — `npm run test:run`
5. Repo root — `./scripts/vercel-build-check.sh`

## Evidence before claims

Do not say tests or builds pass without running this command in the current session and reading the exit code and output. For the discipline around completion claims, follow the superpowers `verification-before-completion` skill when available.

## Partial checks

| Scope | Command |
|-------|---------|
| Backend only | `cd backend && python -m pytest tests/ -v` |
| Frontend only | `cd frontend && npm run quality:check` |
| Vercel gate only | `./scripts/vercel-build-check.sh` |
| UI flows (manual) | `cd frontend && npm run test:e2e` |
