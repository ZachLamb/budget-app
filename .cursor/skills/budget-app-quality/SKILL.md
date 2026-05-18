---
name: budget-app-quality
description: Run frontend lint, tests, and fallow dead-code for budget-app after substantive UI or TypeScript changes. Use when finishing frontend work or cleaning up AI-generated code in frontend/.
disable-model-invocation: true
---

# Budget app — frontend quality

**Announce:** "Using budget-app-quality to verify frontend changes."

## When to run

After substantive edits under `frontend/` (components, app routes, lib, API client types).

## Standard check

```bash
cd frontend && npm run quality:check
```

Runs: ESLint → Vitest → `fallow dead-code` (errors fail CI; export noise is warn-only per `fallow.toml`).

## Deeper audit (pre-release / post–vibe-coding)

```bash
cd frontend && npm run quality:audit
```

Adds **knip** on top of `quality:check`. Use the personal `code-quality-audit` skill for full fallow + jscpd + bundle review.

## Fixing findings

1. Present fallow/knip output to the user when impact is large.
2. Prefer **minimal** fixes (remove dead code, add missing deps, dedupe types).
3. Do not auto-delete large swaths of shadcn exports without confirmation.
4. Re-run `npm run quality:check` until exit 0 or the user defers.

## Config

- [frontend/fallow.toml](frontend/fallow.toml) — CI runs `fallow dead-code` only
- [frontend/knip.json](frontend/knip.json) — used by `quality:audit`
