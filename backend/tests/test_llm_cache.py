"""Tests for the per-user LLM content cache.

The Upstash path requires real network; we exercise the in-memory fallback
which the test environment uses by default (no UPSTASH_* vars set).

The critical invariant being tested: cache keys MUST include the user id
so two users with identical prompts cannot read each other's cached output.
"""
from __future__ import annotations

import pytest

from app.services.ai import cache


@pytest.mark.asyncio
async def test_set_then_get_returns_value():
    await cache.set("u1", "explain_charge", "system", "prompt", "answer")
    assert await cache.get("u1", "explain_charge", "system", "prompt") == "answer"


@pytest.mark.asyncio
async def test_different_user_does_not_see_cached_value():
    """If this fails, you have a critical privacy bug — fix immediately."""
    await cache.set("u1", "explain_charge", "system", "prompt", "user-1-private")
    assert await cache.get("u2", "explain_charge", "system", "prompt") is None


@pytest.mark.asyncio
async def test_different_feature_does_not_collide():
    await cache.set("u1", "explain_charge", "sys", "p", "A")
    await cache.set("u1", "spending_summary", "sys", "p", "B")
    assert await cache.get("u1", "explain_charge", "sys", "p") == "A"
    assert await cache.get("u1", "spending_summary", "sys", "p") == "B"


@pytest.mark.asyncio
async def test_purge_user_removes_all_their_keys():
    await cache.set("u1", "explain_charge", "s", "p1", "A")
    await cache.set("u1", "spending_summary", "s", "p2", "B")
    await cache.set("u2", "explain_charge", "s", "p1", "C")
    await cache.purge_user("u1")
    assert await cache.get("u1", "explain_charge", "s", "p1") is None
    assert await cache.get("u1", "spending_summary", "s", "p2") is None
    # u2's entry is untouched.
    assert await cache.get("u2", "explain_charge", "s", "p1") == "C"


@pytest.mark.asyncio
async def test_miss_returns_none():
    assert await cache.get("nobody", "explain_charge", "s", "p") is None
