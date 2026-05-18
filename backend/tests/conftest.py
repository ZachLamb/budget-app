"""Pytest bootstrap: minimal env so `app.config` loads without a local `.env`."""

import os

# Must satisfy get_settings() before any `from app...` that pulls database/config.
if not os.environ.get("SECRET_KEY"):
    os.environ["SECRET_KEY"] = (
        "pytest-test-secret-key-not-for-production-use-32chars-min"
    )

# Avoid flaky AI route tests when the suite hits many LLM endpoints for one household.
os.environ.setdefault("AI_RATE_LIMIT_PER_MINUTE", "0")

# Use in-memory ephemeral/rate-limit stores in tests — stale Upstash URLs from a
# developer .env must not break OAuth or magic-link suites.
for _k in (
    "KV_REST_API_URL",
    "KV_REST_API_TOKEN",
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
):
    os.environ.pop(_k, None)

# Production deploy markers in a local shell must not trip demo-mode guards during pytest.
os.environ.pop("FLY_APP_NAME", None)
os.environ.pop("VERCEL_ENV", None)
