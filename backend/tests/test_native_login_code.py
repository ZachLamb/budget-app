"""Tests for the native client one-time login code hand-off.

These codes bridge an authenticated browser session (inside the macOS app's
auth sheet) to the native app. They are the only credential that transits a
URL, so single-use and expiry are the security-critical properties.
"""
from __future__ import annotations

import pytest

from app.services.auth import challenges
from app.services.auth.ephemeral_store import InMemoryEphemeralStore


@pytest.fixture(autouse=True)
def _isolated_store():
    """Give each test a fresh store so codes don't leak between tests."""
    original = challenges.get_store()
    challenges.set_store(InMemoryEphemeralStore())
    yield
    challenges.set_store(original)


@pytest.mark.asyncio
async def test_round_trip_returns_user_id() -> None:
    await challenges.put_native_login_code("code-1", "user-abc")
    assert await challenges.pop_native_login_code("code-1") == "user-abc"


@pytest.mark.asyncio
async def test_code_is_single_use() -> None:
    """A replayed code must not yield a second token."""
    await challenges.put_native_login_code("code-2", "user-abc")
    assert await challenges.pop_native_login_code("code-2") == "user-abc"
    assert await challenges.pop_native_login_code("code-2") is None


@pytest.mark.asyncio
async def test_unknown_code_returns_none() -> None:
    assert await challenges.pop_native_login_code("never-issued") is None


@pytest.mark.asyncio
async def test_expired_code_returns_none(monkeypatch: pytest.MonkeyPatch) -> None:
    await challenges.put_native_login_code("code-3", "user-abc")
    real_time = challenges.time.time
    monkeypatch.setattr(
        challenges.time,
        "time",
        lambda: real_time() + challenges.NATIVE_LOGIN_CODE_TTL + 1,
    )
    assert await challenges.pop_native_login_code("code-3") is None


@pytest.mark.asyncio
async def test_native_and_oauth_code_namespaces_are_separate() -> None:
    """A code minted for one flow must not be redeemable by the other."""
    await challenges.put_native_login_code("shared", "native-user")
    await challenges.put_oauth_login_code("shared", "oauth-user")

    assert await challenges.pop_native_login_code("shared") == "native-user"
    assert await challenges.pop_oauth_login_code("shared") == "oauth-user"
