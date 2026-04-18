"""Tests for the per-email login-failure lockout service.

The lockout service guards against slow, IP-rotating credential stuffing on
a single account that the IP-keyed rate limiter can't stop by itself.
"""
from __future__ import annotations

import pytest

from app.middleware.rate_limit_store import InMemoryStore
from app.services.auth import lockout


@pytest.fixture(autouse=True)
def _fresh_store():
    """Each test runs against a clean InMemoryStore so counters don't leak."""
    lockout.set_store_for_tests(InMemoryStore())
    yield
    lockout.set_store_for_tests(None)


@pytest.mark.asyncio
async def test_fresh_email_is_not_locked() -> None:
    assert await lockout.is_login_locked("new@example.com") is False


@pytest.mark.asyncio
async def test_locks_after_configured_threshold() -> None:
    email = "target@example.com"
    for _ in range(lockout._MAX_FAILURES - 1):
        await lockout.record_login_failure(email)
    # Still one attempt short of the threshold.
    assert await lockout.is_login_locked(email) is False
    await lockout.record_login_failure(email)
    assert await lockout.is_login_locked(email) is True


@pytest.mark.asyncio
async def test_clear_resets_counter() -> None:
    email = "target@example.com"
    for _ in range(lockout._MAX_FAILURES):
        await lockout.record_login_failure(email)
    assert await lockout.is_login_locked(email) is True
    await lockout.clear_login_failures(email)
    assert await lockout.is_login_locked(email) is False


@pytest.mark.asyncio
async def test_lockout_is_case_insensitive_on_email() -> None:
    # A user typing mixed-case variants on each attempt must not dodge
    # the counter: all _MAX_FAILURES attempts go into the same bucket.
    variants = ["User@Example.com", "user@example.com", "USER@example.com",
                "uSeR@Example.COM", "user@EXAMPLE.com"]
    assert len(variants) == lockout._MAX_FAILURES
    for variant in variants:
        await lockout.record_login_failure(variant)
    assert await lockout.is_login_locked("user@example.com") is True


@pytest.mark.asyncio
async def test_one_emails_failures_dont_affect_another() -> None:
    for _ in range(lockout._MAX_FAILURES):
        await lockout.record_login_failure("a@example.com")
    assert await lockout.is_login_locked("a@example.com") is True
    assert await lockout.is_login_locked("b@example.com") is False
