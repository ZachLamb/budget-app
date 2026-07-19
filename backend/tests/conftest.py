"""Pytest bootstrap: minimal env so `app.config` loads without a local `.env`."""

import os
import pytest

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

# A developer .env with DEMO_MODE=true must not turn the read-only demo guard on
# during pytest — it would 403 every mutation-route test.
os.environ.pop("DEMO_MODE", None)


@pytest.fixture(autouse=True)
def reset_rate_limit_store():
    """Clear in-memory rate limit counters between tests.

    The InMemoryStore is module-level state on app.state; without this, tests
    that hit the same path prefix accumulate hits across the suite and can
    trigger 429s on routes that should return 404 or another status.
    """
    from app.main import app as _app
    store = getattr(getattr(_app, "state", None), "rate_limit_store", None)
    if store is not None and hasattr(store, "_hits"):
        store._hits.clear()
    yield
    if store is not None and hasattr(store, "_hits"):
        store._hits.clear()
