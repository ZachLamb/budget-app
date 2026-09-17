# Feature Completeness Plan — September 2026

Status snapshot of Snack's Budget and what's still needed before calling the app feature
complete. Scope note up front: **tax preparation/filing is explicitly not a feature of this
app.** There is existing "deductions" tracking (`frontend/src/app/(app)/deductions/`,
`backend/app/models/tax_settings.py`) for categorizing tax-deductible transactions, but that
is scoped to expense tracking only — no filing, no return generation, no tax-year calculation
beyond deduction totals. Don't expand it into a tax feature.

## What's built

- Envelope-style budgeting, categories, transactions
- SimpleFIN bank sync
- Passkey + password auth
- Deduction/expense tracking (not tax filing — see scope note above)
- AI features across a tiered pipeline: on-device (WebLLM), cloud, and a Tier 4 "bring your
  own model server" path meant for LM Studio/Ollama (`frontend/src/lib/llm/providers/local-server.ts`,
  `backend/app/services/ai/llm_client.py`)
- Desktop app (Swift) — builds via `swift build`; `swift test` needs full Xcode

## Resolved: local LLM (LM Studio) Docker reachability

Root cause confirmed: the backend runs in a Docker container and probes `settings.ollama_url`
(`backend/app/config.py` / `llm_client.py`); when a user sets that to `http://localhost:1234`
for a host-machine LM Studio instance, `localhost` resolves to the container's own network
namespace, not the host. `backend/tests/test_prefer_local_server.py` and `test_llm_backend.py`
only exercise this against a stubbed httpx transport, so they never caught the Docker-vs-host
distinction — that's expected, since it's a networking/config issue, not client logic.

Fix applied:
- `docker-compose.yml`: added `extra_hosts: ["host.docker.internal:host-gateway"]` on the
  `backend` service so `host.docker.internal` resolves on Linux too (Docker Desktop already
  provides it on Mac/Windows).
- `.env.example`: documented using `http://host.docker.internal:1234` instead of `localhost`
  for `LLM_BACKEND_URL`/`OLLAMA_URL` when pointing at a host-machine server.
- `README.md` "Known issues / TODO": added a note pointing at the above.

Not yet done: no automated regression test for the Docker-vs-host case (would need a real
multi-container integration test, not just an httpx transport stub) — manual verification is
the documented path for now.

## Other known issues (carried from README)

- Dashboard "AI Suggestions" card renders empty instead of a real empty state
- Fly.io resource names still say "clarity" (cosmetic, requires care — see README for the
  encryption-salt landmine, do not touch `crypto.py`'s salt string)

## Open items before "feature complete"

- [ ] Fix local LLM (LM Studio) reachability — see above
- [ ] Dashboard AI Suggestions empty state
- [ ] Confirm deductions/tax-settings feature stays scoped to tracking only (no scope creep
      toward filing/calculation)
- [ ] Re-check `docs/audit-and-upgrade-plan-2026-06.md` for any still-open security items from
      that audit before calling things done
