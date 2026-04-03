# Backend tests

Run all tests (no DB required for default set). New tests were added **before** implementing the related fixes (LLM parsing helpers, Google OAuth code exchange); run this suite after changes to stay green.

```bash
cd backend && python -m pytest tests/ -v
```

Run with optional passkey API test (requires running Postgres):

```bash
RUN_PASSKEY_API_TESTS=1 python -m pytest tests/ -v
```

## Regression coverage

| Area | Tests | What they catch |
|------|--------|------------------|
| **Auth / passkey origin** | `test_auth_origin.py` | Origin validation using credential's `clientDataJSON.origin` (not HTTP header); allowlist normalization; `_decode_client_data_json` behavior. Would have caught the passkey sign-in regression. |
| **Config** | `test_config.py` | Presence and type of `cors_origins`, `frontend_url`, `webauthn_rp_id`, `secret_key`, `database_url`. Catches accidental removal or rename. |
| **Goals** | `test_goals_*.py` | Schema validation, progress/debt payoff math, completion state, toggle behavior. |
| **Passkey API** | `test_auth_passkey_api.py` | Optional: `POST /api/auth/passkey/authenticate/options` returns 200 and options (skipped unless `RUN_PASSKEY_API_TESTS=1`). |
| **AI LLM parsing** | `test_ai_llm_parsing.py` | Debt-plan JSON / `priority_order` list coercion; insights normalization; budget “no category data” source constant. |
| **Google OAuth exchange** | `test_google_oauth_exchange.py` | `POST /api/auth/google/exchange` rejects unknown codes (400) and validates body (422). |

## Other tests that could be added

- **Password login**: Unit test with mocked DB that invalid credentials return 401 and valid return token.
- **CORS**: Assert that `main.app` uses `cors_origins` from config so allowlist changes are applied.
- **E2E passkey flow**: Full sign-in with a real browser/Playwright and test backend (needs test DB + seeded user with passkey).
- **Rate limiting / timing**: If you add constant-time compare for challenges, add a test that comparison time is not data-dependent.
- **Dependencies**: `test_goals_api_integration.py` is skipped; wiring a test DB and `TestClient`/`AsyncClient` in `conftest.py` would enable goals (and other) API integration tests.
