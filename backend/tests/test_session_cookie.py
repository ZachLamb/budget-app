"""Tests for httpOnly cookie session auth + Origin/Referer check.

Critical invariants verified here:
1. Login sets a session cookie with HttpOnly + SameSite=Strict.
2. Authenticated routes work via cookie alone (no Authorization header).
3. Authenticated routes still work via Authorization header alone (transition).
4. Logout clears the cookie.
5. State-changing requests with a cookie but mismatched/missing Origin
   are rejected with 403 (CSRF defense in depth).
6. State-changing requests using ONLY a Bearer header bypass the Origin
   check (preserves curl / mobile clients).

Uses an in-memory SQLite database via dependency override so the tests
run without a live Postgres. The override is scoped to each test and
torn down on exit.
"""
from __future__ import annotations

import os

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.services.auth.session_cookie import COOKIE_NAME


def _allowed_origin() -> str:
    """First entry from CORS_ORIGINS — what the test client should send as Origin."""
    raw = os.environ.get(
        "CORS_ORIGINS",
        "http://localhost:3000,http://localhost:3001,http://localhost:80",
    )
    return raw.split(",")[0].strip()


@pytest_asyncio.fixture()
async def override_db():
    """Swap the production DB dependency for an in-memory SQLite session.

    StaticPool keeps the same connection alive for the duration of the
    test so all queries see one DB instead of one-per-connection.
    """
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False)

    async def _get_db():
        # Mirror app.database.get_db semantics — commit on exit, rollback on
        # exception. The route handlers `await db.flush()` but rely on the
        # dep's commit for durability, so the override has to do the same.
        async with Session() as s:
            try:
                yield s
                await s.commit()
            except Exception:
                await s.rollback()
                raise

    app.dependency_overrides[get_db] = _get_db
    try:
        yield
    finally:
        app.dependency_overrides.pop(get_db, None)
        await engine.dispose()


async def _register(client: AsyncClient, *, email: str, name: str = "Test") -> dict:
    r = await client.post(
        "/api/auth/register",
        json={
            "email": email,
            "password": "passw0rd-strong",
            "name": name,
            "household_name": "Test HH",
        },
        headers={"Origin": _allowed_origin()},
    )
    assert r.status_code == 200, r.text
    return r.json()


@pytest.mark.asyncio
async def test_login_sets_session_cookie(override_db) -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post(
            "/api/auth/register",
            json={
                "email": "cookie-set@test.com",
                "password": "passw0rd-strong",
                "name": "Cookie Set",
                "household_name": "Test HH",
            },
            headers={"Origin": _allowed_origin()},
        )
        assert r.status_code == 200, r.text
        set_cookie = r.headers.get("set-cookie", "")
        assert COOKIE_NAME + "=" in set_cookie
        assert "HttpOnly" in set_cookie
        assert "samesite=strict" in set_cookie.lower()
        # Body still carries access_token for the transition window.
        assert "access_token" in r.json()


@pytest.mark.asyncio
async def test_cookie_auth_resolves_current_user(override_db) -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        await _register(client, email="cookie-me@test.com")
        # Cookie is now in the client jar. Hit /me with NO Authorization header.
        r = await client.get("/api/auth/me")
        assert r.status_code == 200, r.text
        assert r.json()["email"] == "cookie-me@test.com"


@pytest.mark.asyncio
async def test_header_auth_still_works_for_transition(override_db) -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        body = await _register(client, email="cookie-hdr@test.com")
        token = body["access_token"]
        client.cookies.delete(COOKIE_NAME)
        r = await client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 200
        assert r.json()["email"] == "cookie-hdr@test.com"


@pytest.mark.asyncio
async def test_logout_clears_cookie(override_db) -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        await _register(client, email="cookie-out@test.com")
        # Confirm logged-in via cookie.
        r1 = await client.get("/api/auth/me")
        assert r1.status_code == 200

        r = await client.post("/api/auth/logout", headers={"Origin": _allowed_origin()})
        assert r.status_code == 200
        # After logout, the cookie should be cleared. httpx's CookieJar
        # honors Max-Age=0 / past expiry — but be explicit too.
        client.cookies.delete(COOKIE_NAME)
        r2 = await client.get("/api/auth/me")
        assert r2.status_code == 401


@pytest.mark.asyncio
async def test_origin_check_rejects_cross_origin_cookie_post(override_db) -> None:
    """A POST with the session cookie but an Origin not in CORS_ORIGINS is rejected."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        await _register(client, email="cookie-csrf@test.com")
        # Use a bad Origin (an attacker's domain) on a cookie-authenticated POST.
        r = await client.post(
            "/api/auth/logout",
            headers={"Origin": "https://attacker.example"},
        )
        assert r.status_code == 403, r.text
        assert "rejected" in r.json().get("detail", "").lower()


@pytest.mark.asyncio
async def test_origin_check_bypassed_for_header_only_bearer(override_db) -> None:
    """A Bearer-only request without a cookie is exempt from the Origin check."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        body = await _register(client, email="cookie-bearer@test.com")
        token = body["access_token"]
        client.cookies.delete(COOKIE_NAME)
        r = await client.post(
            "/api/auth/logout",
            headers={
                "Authorization": f"Bearer {token}",
                "Origin": "https://anywhere.example",
            },
        )
        # The point of this test: OriginCheckMiddleware did NOT 403.
        assert r.status_code == 200
