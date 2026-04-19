"""Tests for GET /api/config — the pre-auth public runtime config.

This endpoint is load-bearing: the frontend uses it to decide which login
affordances to show. A regression that hides a real sign-in method, or
exposes Google sign-in in demo mode, is user-visible.
"""
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.config import get_settings


@pytest.fixture
def _clean_settings_cache():
    """Cached settings leak across tests if we change env mid-run."""
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


async def _get_config(
    monkeypatch: pytest.MonkeyPatch,
    **env: str,
) -> dict:
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    # Re-import main so `app` is built against the patched env + fresh settings.
    get_settings.cache_clear()
    import importlib
    import app.main as main_module
    importlib.reload(main_module)

    transport = ASGITransport(app=main_module.app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/config")
        assert resp.status_code == 200
        return resp.json()


@pytest.mark.asyncio
async def test_reports_demo_mode_true_when_backend_demo(
    monkeypatch: pytest.MonkeyPatch, _clean_settings_cache
) -> None:
    body = await _get_config(monkeypatch, DEMO_MODE="true", SECRET_KEY="x" * 40)
    assert body["demo_mode"] is True


@pytest.mark.asyncio
async def test_reports_demo_mode_false_when_backend_not_demo(
    monkeypatch: pytest.MonkeyPatch, _clean_settings_cache
) -> None:
    body = await _get_config(monkeypatch, DEMO_MODE="false", SECRET_KEY="x" * 40)
    assert body["demo_mode"] is False


@pytest.mark.asyncio
async def test_password_and_passkey_are_always_available(
    monkeypatch: pytest.MonkeyPatch, _clean_settings_cache
) -> None:
    body = await _get_config(monkeypatch, SECRET_KEY="x" * 40)
    assert body["auth_methods"]["password"] is True
    assert body["auth_methods"]["passkey"] is True


@pytest.mark.asyncio
async def test_google_requires_client_id_and_non_demo(
    monkeypatch: pytest.MonkeyPatch, _clean_settings_cache
) -> None:
    # No client id → Google hidden.
    body = await _get_config(
        monkeypatch, SECRET_KEY="x" * 40, GOOGLE_CLIENT_ID="", DEMO_MODE="false"
    )
    assert body["auth_methods"]["google"] is False

    # Client id present + not demo → Google visible.
    body = await _get_config(
        monkeypatch,
        SECRET_KEY="x" * 40,
        GOOGLE_CLIENT_ID="some-client-id.apps.googleusercontent.com",
        DEMO_MODE="false",
    )
    assert body["auth_methods"]["google"] is True


@pytest.mark.asyncio
async def test_google_is_hidden_in_demo_even_with_client_id(
    monkeypatch: pytest.MonkeyPatch, _clean_settings_cache
) -> None:
    """Demo has no real sign-up path for a new Google user, so the button
    would dead-end — the public config reflects that."""
    body = await _get_config(
        monkeypatch,
        SECRET_KEY="x" * 40,
        GOOGLE_CLIENT_ID="real-id.apps.googleusercontent.com",
        DEMO_MODE="true",
    )
    assert body["auth_methods"]["google"] is False


@pytest.mark.asyncio
async def test_endpoint_is_pre_auth(
    monkeypatch: pytest.MonkeyPatch, _clean_settings_cache
) -> None:
    """Regression guard: /api/config must return 200 with no Authorization."""
    # No auth header set — default.
    body = await _get_config(monkeypatch, SECRET_KEY="x" * 40)
    assert "demo_mode" in body
