"""`/api/config` must only advertise sign-in methods that actually work.

The login page renders each affordance from this payload. Magic-link was
previously offered whenever the app was not in demo mode, but the route needs
RESEND_API_KEY + EMAIL_FROM_ADDRESS; without them `services/email/resend.py`
returns `ok=False, error="RESEND_API_KEY not configured"` and the user gets a
dead button. Same defect class as Google sign-in before PR #120.
"""
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


async def _config() -> dict:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/api/config")
    assert r.status_code == 200, r.text
    return r.json()["auth_methods"]


@pytest.mark.asyncio
async def test_magic_link_false_when_email_unconfigured(monkeypatch) -> None:
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    monkeypatch.delenv("EMAIL_FROM_ADDRESS", raising=False)
    from app.config import get_settings

    get_settings.cache_clear()
    assert (await _config())["magic_link"] is False
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_magic_link_true_when_both_are_set(monkeypatch) -> None:
    monkeypatch.setenv("RESEND_API_KEY", "re_test_key")
    monkeypatch.setenv("EMAIL_FROM_ADDRESS", "no-reply@example.test")
    from app.config import get_settings

    get_settings.cache_clear()
    assert (await _config())["magic_link"] is True
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_magic_link_needs_both_not_just_the_key(monkeypatch) -> None:
    # A key with no from-address still cannot send.
    monkeypatch.setenv("RESEND_API_KEY", "re_test_key")
    monkeypatch.delenv("EMAIL_FROM_ADDRESS", raising=False)
    from app.config import get_settings

    get_settings.cache_clear()
    assert (await _config())["magic_link"] is False
    get_settings.cache_clear()
