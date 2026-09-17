"""Tests for the Google OAuth redirect URI.

Google matches `redirect_uri` as an exact string, so it must be stable and it
must be https in production. Deriving it from `request.base_url` does not
satisfy either: behind Render's proxy uvicorn only trusts X-Forwarded-Proto
from 127.0.0.1 by default, so base_url comes back as http:// and Google
rejects the request.

Widening uvicorn's `--forwarded-allow-ips` to "*" would fix the scheme but let
a client rewrite `request.client.host` via X-Forwarded-For. The rate limiter
buckets on that value and, with TRUSTED_PROXIES unset, falls straight through
to it — so every spoofed header would get a fresh bucket and auth rate limiting
would be bypassable. An explicit configured base URL avoids that entirely.
"""
from __future__ import annotations

from types import SimpleNamespace

from app.api.routes.auth import _build_redirect_uri


def _request(base_url: str):
    return SimpleNamespace(base_url=base_url)


def test_uses_configured_backend_url_over_the_request(monkeypatch):
    monkeypatch.setenv("BACKEND_PUBLIC_URL", "https://budget-app-backend-mdy0.onrender.com")
    from app.config import get_settings

    get_settings.cache_clear()
    # The request claims http; configuration must win.
    assert _build_redirect_uri(_request("http://budget-app-backend-mdy0.onrender.com/")) == (
        "https://budget-app-backend-mdy0.onrender.com/api/auth/google/callback"
    )
    get_settings.cache_clear()


def test_trailing_slash_in_config_does_not_double_up(monkeypatch):
    monkeypatch.setenv("BACKEND_PUBLIC_URL", "https://example.test/")
    from app.config import get_settings

    get_settings.cache_clear()
    assert _build_redirect_uri(_request("http://ignored/")) == (
        "https://example.test/api/auth/google/callback"
    )
    get_settings.cache_clear()


def test_falls_back_to_request_when_unset(monkeypatch):
    monkeypatch.delenv("BACKEND_PUBLIC_URL", raising=False)
    from app.config import get_settings

    get_settings.cache_clear()
    # Local dev: no configured URL, so the request is the only source.
    assert _build_redirect_uri(_request("http://localhost:8000/")) == (
        "http://localhost:8000/api/auth/google/callback"
    )
    get_settings.cache_clear()
