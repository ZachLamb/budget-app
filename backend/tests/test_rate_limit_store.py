"""Tests for the pluggable rate-limit store primitives.

Covers both the sliding-window `check_and_increment` and the generic
counter (`counter_incr`, `counter_get`, `counter_delete`) used by the
login-lockout layer.
"""
from __future__ import annotations

import pytest

from app.middleware.rate_limit_store import InMemoryStore, build_store


@pytest.mark.asyncio
async def test_check_and_increment_returns_true_when_over_cap() -> None:
    store = InMemoryStore()
    for i in range(3):
        result = await store.check_and_increment("k", 3, 60)
        assert result.over is False
        # Count tracks the post-increment hit count so the middleware can
        # render RateLimit-Remaining without a second round-trip.
        assert result.count == i + 1
    # Fourth hit trips.
    result = await store.check_and_increment("k", 3, 60)
    assert result.over is True
    # Over-cap calls report the stored count but do not rack up more hits.
    assert result.count == 3
    # And the limiter stays tripped without racking up more hits.
    result = await store.check_and_increment("k", 3, 60)
    assert result.over is True
    assert result.count == 3


@pytest.mark.asyncio
async def test_counter_incr_returns_post_increment_count() -> None:
    store = InMemoryStore()
    assert await store.counter_incr("c", 600) == 1
    assert await store.counter_incr("c", 600) == 2
    assert await store.counter_incr("c", 600) == 3


@pytest.mark.asyncio
async def test_counter_get_returns_current_count_without_mutating() -> None:
    store = InMemoryStore()
    assert await store.counter_get("c") == 0
    await store.counter_incr("c", 600)
    await store.counter_incr("c", 600)
    assert await store.counter_get("c") == 2
    # Confirm no side effect.
    assert await store.counter_get("c") == 2


@pytest.mark.asyncio
async def test_counter_delete_resets_count_to_zero() -> None:
    store = InMemoryStore()
    await store.counter_incr("c", 600)
    await store.counter_incr("c", 600)
    await store.counter_delete("c")
    assert await store.counter_get("c") == 0


def test_build_store_picks_upstash_when_both_env_set() -> None:
    from app.middleware.rate_limit_store import UpstashStore

    store = build_store(rest_url="https://example.upstash.io", rest_token="tok")
    assert isinstance(store, UpstashStore)


def test_build_store_falls_back_to_memory_when_url_is_empty() -> None:
    store = build_store(rest_url="", rest_token="tok")
    assert isinstance(store, InMemoryStore)


def test_build_store_falls_back_to_memory_when_token_is_empty() -> None:
    store = build_store(rest_url="https://example.upstash.io", rest_token="")
    assert isinstance(store, InMemoryStore)


@pytest.mark.asyncio
async def test_memory_store_reports_backend_name_and_pings_true() -> None:
    """/api/health reads these; regressions here would silently mislabel the store."""
    store = InMemoryStore()
    assert store.backend_name == "memory"
    assert await store.ping() is True
