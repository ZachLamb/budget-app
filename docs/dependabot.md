# Dependabot: configuration and merge practices

How this repo uses Dependabot (`.github/dependabot.yml`) and the rules of thumb
for handling its PRs. Three ecosystems are covered on a weekly schedule:
`npm` (`/frontend`), `pip` (`/backend`), and `github-actions` (`/`).

## Merge rules

1. **The merge gate is the real CI job, not the green wall.** A dependency PR
   merges when the jobs that exercise the change pass — for frontend bumps
   that's *Frontend (lint / test / build)*; for backend bumps the pytest job.
   A failing check that also fails on `main` is an infrastructure problem:
   fix it at the root (or confirm it's pre-existing) rather than blocking or
   force-merging around it. Never merge a red check without knowing *why* it
   is red.
2. **Patch/minor dev-dependency bumps are low-ceremony.** Lint/test tools
   (knip, eslint plugins, vitest) with green CI can merge without deeper
   review — the lockfile diff is the review.
3. **Majors get read before they merge.** Read the changelog for breaking
   changes and check that the ecosystem around it is ready. Real example:
   eslint 9 → 10 (PR #56) breaks because `eslint-config-next` bundles an
   `eslint-plugin-react` that still calls APIs removed in 10 — no amount of
   local fixing helps until Next ships support. For that case, comment
   `@dependabot ignore this major version` and revisit when the ecosystem
   catches up (the ignore is lifted with `@dependabot unignore`).
4. **Merge siblings promptly, oldest-first.** Several PRs touching the same
   manifest (e.g. `backend/requirements.txt`) conflict with each other as
   they land. Dependabot rebases automatically after each merge — or on
   demand with `@dependabot rebase` — so merge them in sequence rather than
   letting them sit and go stale together.
5. **Runtime deps deserve a smoke check.** For non-dev dependencies
   (`cryptography`, `uvicorn`, `radix-ui`, …) skim the changelog even on
   minors, and prefer merging them one at a time so a regression bisects
   itself.

## Configuration practices

- **Group tightly-coupled packages.** We group `next`+`eslint-config-next`
  and the `react`/`react-dom`/`@types/*` family so they bump in lockstep —
  half-upgraded pairs produce confusing breakage. Add a group whenever two
  packages must move together (e.g. a future `@dnd-kit/*` group).
- **Weekly, not daily.** Weekly batching keeps PR noise proportional to the
  attention actually available. Security advisories bypass the schedule
  anyway (Dependabot security updates are separate from version updates).
- **Lockfiles are committed and authoritative.** Never hand-edit a
  Dependabot lockfile diff; if it conflicts, `@dependabot rebase` regenerates
  it.
- **Keep ranges honest in `requirements.txt`.** The backend uses `>=` floors;
  Dependabot PRs there update the floor. That means CI runs against the
  newest allowed version — which is the point: fail in CI, not in prod.
- **Actions are pinned by major** (`actions/checkout@v7` style) and bumped by
  Dependabot's `github-actions` ecosystem — don't update workflow action
  versions by hand in unrelated PRs.

## Useful commands

```bash
gh pr list --author "app/dependabot" --state open   # what's pending
gh pr checks <n>                                    # why is it red
gh pr merge <n> --merge                             # merge (repo uses merge commits)
```

Comment commands on a Dependabot PR: `@dependabot rebase`, `@dependabot
recreate`, `@dependabot ignore this major version`, `@dependabot unignore`.
