"""Tests for Google OAuth one-time login-code exchange.

Since the cookie handoff landed, the exchange endpoint reads
`oauth_login_code` from an HttpOnly cookie (not a JSON body). These tests
cover missing cookie, unknown value, expired code, and the happy path.
"""
from __future__ import annotations

import time
from datetime import datetime, timezone

import pytest
from httpx import ASGITransport, AsyncClient

from app.api.routes import auth as auth_routes
from app.database import get_db
from app.main import app
from app.models import User


def _make_user(idx: int) -> User:
    return User(
        id=f"user-exchange-{idx}",
        email=f"exchange{idx}@example.com",
        name=f"Exchange {idx}",
        password_hash=None,
        google_id=f"google-exchange-{idx}",
        household_id=f"hh-exchange-{idx}",
        role="owner",
        status="approved",
        created_at=datetime.now(timezone.utc),
    )


class _ScalarResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _FakeSession:
    def __init__(self, user: User | None = None):
        self._user = user

    async def execute(self, query):  # noqa: ARG002
        return _ScalarResult(self._user)


def _seed_user_in_dict(user_id: str, *, issued_ts: float | None = None) -> str:
    """Insert a login-code → user_id mapping and return the code to use."""
    code = "test-login-code-" + str(int(time.time() * 1000))
    auth_routes._oauth_login_codes[code] = (
        user_id,
        issued_ts if issued_ts is not None else time.time(),
    )
    return code


@pytest.mark.asyncio
async def test_google_exchange_missing_cookie_returns_400() -> None:
    """No cookie means no code to look up — 400 (matches old missing-body behavior)."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post("/api/auth/google/exchange")
    assert r.status_code == 400, r.text
    assert "Invalid or expired" in r.json().get("detail", "")


@pytest.mark.asyncio
async def test_google_exchange_unknown_cookie_returns_400() -> None:
    """A cookie the server never issued is rejected."""
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        cookies={"oauth_login_code": "definitely-not-a-valid-code-12345"},
    ) as client:
        r = await client.post("/api/auth/google/exchange")
    assert r.status_code == 400, r.text


@pytest.mark.asyncio
async def test_google_exchange_valid_cookie_returns_token_and_deletes_cookie() -> None:
    """Happy path: valid code → JWT returned and cookie cleared (single-use)."""
    user = _make_user(1)
    code = _seed_user_in_dict(user.id)

    async def _fake_get_db():
        yield _FakeSession(user=user)

    app.dependency_overrides[get_db] = _fake_get_db
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
            cookies={"oauth_login_code": code},
        ) as client:
            r = await client.post("/api/auth/google/exchange")
    finally:
        app.dependency_overrides.pop(get_db, None)
        auth_routes._oauth_login_codes.pop(code, None)

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["access_token"]
    assert body["user"]["id"] == user.id

    # delete_cookie emits Set-Cookie with an empty value + Max-Age=0 (or expires).
    set_cookie = r.headers.get("set-cookie", "").lower()
    assert "oauth_login_code=" in set_cookie
    assert "path=/api/auth/google/exchange" in set_cookie
    # Max-Age=0 or expires in the past — either is a delete signal.
    assert "max-age=0" in set_cookie or "expires=thu, 01 jan 1970" in set_cookie


@pytest.mark.asyncio
async def test_google_exchange_expired_code_returns_400() -> None:
    """Code older than TTL is rejected even if still in the dict before cleanup."""
    user = _make_user(2)
    # Issued 10 minutes ago — well past the 60s TTL.
    old_ts = time.time() - (auth_routes._OAUTH_LOGIN_CODE_TTL + 600)
    code = _seed_user_in_dict(user.id, issued_ts=old_ts)

    async def _fake_get_db():
        yield _FakeSession(user=user)

    app.dependency_overrides[get_db] = _fake_get_db
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
            cookies={"oauth_login_code": code},
        ) as client:
            r = await client.post("/api/auth/google/exchange")
    finally:
        app.dependency_overrides.pop(get_db, None)
        auth_routes._oauth_login_codes.pop(code, None)

    assert r.status_code == 400, r.text


@pytest.mark.asyncio
async def test_google_exchange_code_is_single_use() -> None:
    """A second exchange with the same code fails even if issued seconds ago.

    The first /exchange POST sets the session cookie via _token_response.
    The second POST then carries it, which trips OriginCheckMiddleware
    unless we send a matching Origin — same as a real browser would.
    """
    user = _make_user(3)
    code = _seed_user_in_dict(user.id)

    async def _fake_get_db():
        yield _FakeSession(user=user)

    app.dependency_overrides[get_db] = _fake_get_db
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
            cookies={"oauth_login_code": code},
            headers={"Origin": "http://localhost:3001"},
        ) as client:
            first = await client.post("/api/auth/google/exchange")
            second = await client.post("/api/auth/google/exchange")
    finally:
        app.dependency_overrides.pop(get_db, None)
        auth_routes._oauth_login_codes.pop(code, None)

    assert first.status_code == 200
    assert second.status_code == 400
