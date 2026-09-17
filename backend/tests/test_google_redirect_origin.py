"""The Google redirect_uri must be same-origin with the oauth_state cookie.

The login button navigates the browser to the FRONTEND origin
(`/api/auth/google`), which Vercel rewrites to this service. The 302 to Google
carries `Set-Cookie: oauth_state=...` with no Domain attribute, so the browser
scopes it host-only to the frontend origin.

If redirect_uri points at the backend's own origin, Google sends the browser to
a different host, the browser does not send oauth_state, and google_callback
sees cookie_state=None and bails to /login?error=invalid_state. That is a total
failure of Google sign-in, not an edge case.

So the callback must live on the same origin the flow started from.
"""
from __future__ import annotations

from types import SimpleNamespace

from app.api.routes.auth import _build_redirect_uri


def _request(base_url: str):
    return SimpleNamespace(base_url=base_url)


def test_redirect_uri_uses_the_frontend_origin(monkeypatch):
    monkeypatch.setenv("FRONTEND_URL", "https://snacks-budget.vercel.app")
    from app.config import get_settings

    get_settings.cache_clear()
    # The request arrives at the backend's own host (via the proxy); the
    # redirect must still be the browser-facing frontend origin.
    assert _build_redirect_uri(_request("https://budget-app-backend-mdy0.onrender.com/")) == (
        "https://snacks-budget.vercel.app/api/auth/google/callback"
    )
    get_settings.cache_clear()


def test_trailing_slash_does_not_double_up(monkeypatch):
    monkeypatch.setenv("FRONTEND_URL", "https://example.test/")
    from app.config import get_settings

    get_settings.cache_clear()
    assert _build_redirect_uri(_request("http://ignored/")) == (
        "https://example.test/api/auth/google/callback"
    )
    get_settings.cache_clear()


def test_local_dev_uses_the_frontend_port_not_the_backend_port(monkeypatch):
    # Locally the page is on :3001 and next.config proxies /api to :8000, so
    # the cookie is scoped to :3001 — the redirect must match.
    monkeypatch.setenv("FRONTEND_URL", "http://localhost:3001")
    from app.config import get_settings

    get_settings.cache_clear()
    assert _build_redirect_uri(_request("http://localhost:8000/")) == (
        "http://localhost:3001/api/auth/google/callback"
    )
    get_settings.cache_clear()
