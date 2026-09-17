"""Google OAuth behavior when DEMO_MODE is on (no DB required for these tests)."""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.database import get_db
from app.main import app
from app.models import User


class _ScalarResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _FakeSession:
    """Minimal session: two User lookups (google_id, then email), both None by default."""

    def __init__(self, user: User | None = None, second_lookup_user: User | None = None):
        self._n = 0
        self._user_first = user
        self._user_second = second_lookup_user

    async def execute(self, query):  # noqa: ARG002
        self._n += 1
        if self._n == 1:
            return _ScalarResult(self._user_first)
        if self._n == 2:
            return _ScalarResult(self._user_second)
        return _ScalarResult(None)

    async def commit(self) -> None:
        pass

    async def refresh(self, _obj) -> None:
        pass

    def add(self, _obj) -> None:
        pass

    async def flush(self) -> None:
        pass


def _demo_oauth_settings(*, demo_mode: bool = True) -> SimpleNamespace:
    return SimpleNamespace(
        google_client_id="test.apps.googleusercontent.com",
        google_client_secret="test-secret",
        frontend_url="http://localhost:3001",
        demo_mode=demo_mode,
    )


@pytest.mark.asyncio
@patch("app.api.routes.auth.get_settings")
async def test_google_start_redirects_when_demo_mode(mock_get_settings: MagicMock) -> None:
    mock_get_settings.return_value = _demo_oauth_settings()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/api/auth/google", follow_redirects=False)
    assert r.status_code == 302, r.text
    loc = r.headers.get("location", "")
    assert "localhost:3001/login" in loc.replace("http://", "")
    assert "error=demo_oauth_disabled" in loc


@pytest.mark.asyncio
@patch("app.api.routes.auth.httpx.AsyncClient")
@patch("app.api.routes.auth.get_settings")
async def test_google_callback_demo_mode_blocks_new_google_user(
    mock_get_settings: MagicMock,
    mock_async_client_class: MagicMock,
) -> None:
    mock_get_settings.return_value = _demo_oauth_settings()

    token_resp = MagicMock()
    token_resp.status_code = 200
    token_resp.json.return_value = {"access_token": "fake-access"}

    userinfo_resp = MagicMock()
    userinfo_resp.status_code = 200
    userinfo_resp.json.return_value = {
        "id": "google-new-1",
        "email": "brandnew@example.com",
        "name": "Brand New",
        "verified_email": True,
    }

    mock_client = MagicMock()
    mock_client.post = AsyncMock(return_value=token_resp)
    mock_client.get = AsyncMock(return_value=userinfo_resp)
    mock_async_client_class.return_value.__aenter__ = AsyncMock(return_value=mock_client)
    mock_async_client_class.return_value.__aexit__ = AsyncMock(return_value=False)

    async def _fake_get_db():
        yield _FakeSession()

    app.dependency_overrides[get_db] = _fake_get_db
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
            cookies={"oauth_state": "s1"},
        ) as client:
            r = await client.get(
                "/api/auth/google/callback?code=abc&state=s1",
                follow_redirects=False,
            )
    finally:
        app.dependency_overrides.pop(get_db, None)

    assert r.status_code == 302, r.text
    loc = r.headers.get("location", "")
    assert "error=demo_oauth_signup_disabled" in loc


@pytest.mark.asyncio
@patch("app.api.routes.auth.httpx.AsyncClient")
@patch("app.api.routes.auth.get_settings")
async def test_google_callback_demo_mode_allows_existing_user_by_google_id(
    mock_get_settings: MagicMock,
    mock_async_client_class: MagicMock,
) -> None:
    mock_get_settings.return_value = _demo_oauth_settings()

    token_resp = MagicMock()
    token_resp.status_code = 200
    token_resp.json.return_value = {"access_token": "fake-access"}

    userinfo_resp = MagicMock()
    userinfo_resp.status_code = 200
    userinfo_resp.json.return_value = {
        "id": "google-existing-1",
        "email": "existing@example.com",
        "name": "Existing User",
        "verified_email": True,
    }

    mock_client = MagicMock()
    mock_client.post = AsyncMock(return_value=token_resp)
    mock_client.get = AsyncMock(return_value=userinfo_resp)
    mock_async_client_class.return_value.__aenter__ = AsyncMock(return_value=mock_client)
    mock_async_client_class.return_value.__aexit__ = AsyncMock(return_value=False)

    existing = User(
        id="user-1",
        email="existing@example.com",
        name="Existing User",
        password_hash=None,
        google_id="google-existing-1",
        household_id="hh-1",
        role="owner",
        status="approved",
    )

    async def _fake_get_db():
        yield _FakeSession(user=existing)

    app.dependency_overrides[get_db] = _fake_get_db
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
            cookies={"oauth_state": "s2"},
        ) as client:
            r = await client.get(
                "/api/auth/google/callback?code=abc&state=s2",
                follow_redirects=False,
            )
    finally:
        app.dependency_overrides.pop(get_db, None)

    assert r.status_code == 302, r.text
    loc = r.headers.get("location", "")
    assert loc.endswith("/auth/callback"), loc  # login code is in the cookie, not the URL
    set_cookie = r.headers.get("set-cookie", "").lower()
    assert "oauth_login_code=" in set_cookie
    assert "httponly" in set_cookie
    assert "path=/api/auth/google/exchange" in set_cookie


@pytest.mark.asyncio
@patch("app.api.routes.auth.httpx.AsyncClient")
@patch("app.api.routes.auth.get_settings")
async def test_google_callback_non_demo_still_allows_new_user_with_mock_db(
    mock_get_settings: MagicMock,
    mock_async_client_class: MagicMock,
    monkeypatch,
) -> None:
    """Regression: without demo_mode, new-user branch still runs (session is fake but covers happy path)."""
    s = _demo_oauth_settings(demo_mode=False)
    mock_get_settings.return_value = s
    # apply_admin_bootstrap (in services.auth.admin_gate) reads admin_email
    # from the *real* settings, not the mock above (different import path).
    # Bootstrap-to-admin for the new user so the post-callback approval gate
    # doesn't redirect this happy-path test to /login?error=pending_approval.
    from app.config import get_settings as real_get_settings
    monkeypatch.setenv("ADMIN_EMAIL", "new2@example.com")
    real_get_settings.cache_clear()

    token_resp = MagicMock()
    token_resp.status_code = 200
    token_resp.json.return_value = {"access_token": "fake-access"}

    userinfo_resp = MagicMock()
    userinfo_resp.status_code = 200
    userinfo_resp.json.return_value = {
        "id": "google-new-2",
        "email": "new2@example.com",
        "name": "New Two",
        "verified_email": True,
    }

    mock_client = MagicMock()
    mock_client.post = AsyncMock(return_value=token_resp)
    mock_client.get = AsyncMock(return_value=userinfo_resp)
    mock_async_client_class.return_value.__aenter__ = AsyncMock(return_value=mock_client)
    mock_async_client_class.return_value.__aexit__ = AsyncMock(return_value=False)

    async def _fake_get_db():
        yield _FakeSession()

    app.dependency_overrides[get_db] = _fake_get_db
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
            cookies={"oauth_state": "s3"},
        ) as client:
            r = await client.get(
                "/api/auth/google/callback?code=abc&state=s3",
                follow_redirects=False,
            )
    finally:
        app.dependency_overrides.pop(get_db, None)

    assert r.status_code == 302, r.text
    loc = r.headers.get("location", "")
    assert loc.endswith("/auth/callback"), loc  # login code is in the cookie, not the URL
    set_cookie = r.headers.get("set-cookie", "").lower()
    assert "oauth_login_code=" in set_cookie
    assert "httponly" in set_cookie
    assert "path=/api/auth/google/exchange" in set_cookie
