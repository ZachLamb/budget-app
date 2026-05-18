"""Tests for Google OAuth one-time login-code exchange.

Since the cookie handoff landed, the exchange endpoint reads
`oauth_login_code` from an HttpOnly cookie (not a JSON body). These tests
cover missing cookie, unknown value, expired code, and the happy path.
"""
from __future__ import annotations

import json
import time
from datetime import datetime, timezone

import pytest
from httpx import ASGITransport, AsyncClient

from app.database import get_db
from app.main import app
from app.models import User
from app.services.auth import challenges as auth_challenges


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
        session_version=0,
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


async def _seed_login_code(user_id: str, *, issued_ts: float | None = None) -> str:
    code = "test-login-code-" + str(int(time.time() * 1000))
    payload = json.dumps(
        {"user_id": user_id, "issued_ts": issued_ts if issued_ts is not None else time.time()}
    )
    await auth_challenges.get_store().set(f"oauth:{code}", payload, auth_challenges.OAUTH_LOGIN_CODE_TTL)
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
async def test_google_exchange_valid_cookie_returns_user_and_deletes_cookie() -> None:
    """Happy path: valid code → session cookie set; body has user, not access_token."""
    user = _make_user(1)
    code = await _seed_login_code(user.id)

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

    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("access_token") is None
    assert body["user"]["id"] == user.id
    assert "session=" in r.headers.get("set-cookie", "")

    set_cookie = r.headers.get("set-cookie", "").lower()
    assert "oauth_login_code=" in set_cookie
    assert "path=/api/auth/google/exchange" in set_cookie
    assert "max-age=0" in set_cookie or "expires=thu, 01 jan 1970" in set_cookie


@pytest.mark.asyncio
async def test_google_exchange_expired_code_returns_400() -> None:
    """Code older than TTL is rejected."""
    user = _make_user(2)
    old_ts = time.time() - (auth_challenges.OAUTH_LOGIN_CODE_TTL + 600)
    code = await _seed_login_code(user.id, issued_ts=old_ts)

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

    assert r.status_code == 400, r.text


@pytest.mark.asyncio
async def test_google_exchange_code_is_single_use() -> None:
    """A second exchange with the same code fails even if issued seconds ago."""
    user = _make_user(3)
    code = await _seed_login_code(user.id)

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

    assert first.status_code == 200
    assert second.status_code == 400
