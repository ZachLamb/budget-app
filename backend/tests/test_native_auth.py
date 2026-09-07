"""Tests for POST /api/auth/native/token (native client Bearer auth)."""
from __future__ import annotations

import os

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool
from unittest.mock import AsyncMock, patch

from app.database import Base, get_db
from app.main import app
from app.middleware.rate_limit_store import InMemoryStore


@pytest_asyncio.fixture()
async def client():
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False)

    async def override_db():
        async with Session() as s:
            yield s

    app.dependency_overrides[get_db] = override_db
    app.state.rate_limit_store = InMemoryStore()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c

    app.dependency_overrides.clear()


_VERIFIER = "a" * 43


@pytest.mark.asyncio
async def test_native_token_rejects_unknown_grant(client):
    resp = await client.post("/api/auth/native/token", json={
        "grant_type": "password",
        "code": "x",
        "redirect_uri": "budget://auth/callback",
        "code_verifier": _VERIFIER,
    })
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_native_token_rejects_bad_redirect_uri(client):
    resp = await client.post("/api/auth/native/token", json={
        "grant_type": "google_code",
        "code": "x",
        "redirect_uri": "https://evil.com/callback",
        "code_verifier": _VERIFIER,
    })
    assert resp.status_code == 400
    assert "redirect_uri" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_native_token_rejects_missing_code_verifier(client):
    resp = await client.post("/api/auth/native/token", json={
        "grant_type": "google_code",
        "code": "x",
        "redirect_uri": "budget://auth/callback",
    })
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_native_token_google_code_exchange(client):
    """Happy path: mocked Google exchange returns a user → JWT in response body."""
    fake_user_info = {
        "sub": "google-123",
        "email": "alice@example.com",
        "name": "Alice",
    }
    env_patch = {
        "GOOGLE_CLIENT_ID": "test-client-id.apps.googleusercontent.com",
        "ADMIN_EMAIL": "alice@example.com",
        "DEMO_MODE": "false",
    }
    with patch(
        "app.api.routes.auth._fetch_google_user_info",
        new=AsyncMock(return_value=fake_user_info),
    ), patch.dict(os.environ, env_patch):
        # Clear lru_cache so get_settings picks up the patched env vars
        from app.config import get_settings as _get_settings
        _get_settings.cache_clear()
        try:
            resp = await client.post("/api/auth/native/token", json={
                "grant_type": "google_code",
                "code": "valid-google-code",
                "redirect_uri": "budget://auth/callback",
                "code_verifier": _VERIFIER,
            })
        finally:
            _get_settings.cache_clear()
    assert resp.status_code == 200
    body = resp.json()
    assert body["token_type"] == "bearer"
    assert len(body["access_token"]) > 20
    assert body["user"]["email"] == "alice@example.com"


@pytest.mark.asyncio
async def test_native_token_forwards_code_verifier_to_google_exchange(client):
    """The PKCE code_verifier must reach _fetch_google_user_info so Google can
    validate it against the code_challenge sent in /google/login."""
    fake_user_info = {"sub": "google-456", "email": "bob@example.com", "name": "Bob"}
    env_patch = {
        "GOOGLE_CLIENT_ID": "test-client-id.apps.googleusercontent.com",
        "ADMIN_EMAIL": "bob@example.com",
        "DEMO_MODE": "false",
    }
    mock_fetch = AsyncMock(return_value=fake_user_info)
    with patch(
        "app.api.routes.auth._fetch_google_user_info", new=mock_fetch
    ), patch.dict(os.environ, env_patch):
        from app.config import get_settings as _get_settings
        _get_settings.cache_clear()
        try:
            resp = await client.post("/api/auth/native/token", json={
                "grant_type": "google_code",
                "code": "valid-google-code",
                "redirect_uri": "budget://auth/callback",
                "code_verifier": _VERIFIER,
            })
        finally:
            _get_settings.cache_clear()
    assert resp.status_code == 200
    mock_fetch.assert_awaited_once_with("valid-google-code", "budget://auth/callback", _VERIFIER)


_CHALLENGE = "b" * 43


@pytest.mark.asyncio
async def test_google_native_login_requires_code_challenge(client):
    resp = await client.get(
        "/api/auth/google/login",
        params={"redirect_uri": "budget://auth/callback"},
        follow_redirects=False,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_google_native_login_rejects_bad_redirect_uri(client):
    env_patch = {"GOOGLE_CLIENT_ID": "test-client-id.apps.googleusercontent.com", "DEMO_MODE": "false"}
    with patch.dict(os.environ, env_patch):
        from app.config import get_settings as _get_settings
        _get_settings.cache_clear()
        try:
            resp = await client.get(
                "/api/auth/google/login",
                params={"redirect_uri": "https://evil.com/callback", "code_challenge": _CHALLENGE},
                follow_redirects=False,
            )
        finally:
            _get_settings.cache_clear()
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_google_native_login_blocked_in_demo_mode(client):
    env_patch = {
        "GOOGLE_CLIENT_ID": "test-client-id.apps.googleusercontent.com",
        "DEMO_MODE": "true",
    }
    with patch.dict(os.environ, env_patch):
        from app.config import get_settings as _get_settings
        _get_settings.cache_clear()
        try:
            resp = await client.get(
                "/api/auth/google/login",
                params={"redirect_uri": "budget://auth/callback", "code_challenge": _CHALLENGE},
                follow_redirects=False,
            )
        finally:
            _get_settings.cache_clear()
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_google_native_login_redirects_with_pkce_params(client):
    env_patch = {"GOOGLE_CLIENT_ID": "test-client-id.apps.googleusercontent.com", "DEMO_MODE": "false"}
    with patch.dict(os.environ, env_patch):
        from app.config import get_settings as _get_settings
        _get_settings.cache_clear()
        try:
            resp = await client.get(
                "/api/auth/google/login",
                params={"redirect_uri": "budget://auth/callback", "code_challenge": _CHALLENGE},
                follow_redirects=False,
            )
        finally:
            _get_settings.cache_clear()
    assert resp.status_code == 302
    location = resp.headers["location"]
    assert f"code_challenge={_CHALLENGE}" in location
    assert "code_challenge_method=S256" in location
