"""Pytest bootstrap: minimal env so `app.config` loads without a local `.env`."""

import os

# Must satisfy get_settings() before any `from app...` that pulls database/config.
if not os.environ.get("SECRET_KEY"):
    os.environ["SECRET_KEY"] = (
        "pytest-test-secret-key-not-for-production-use-32chars-min"
    )

# Avoid flaky AI route tests when the suite hits many LLM endpoints for one household.
os.environ.setdefault("AI_RATE_LIMIT_PER_MINUTE", "0")
