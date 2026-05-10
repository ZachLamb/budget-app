"""Tests for the per-user daily rate limit on cloud LLM calls."""
from __future__ import annotations

import pytest

from app.middleware.rate_limit_store import InMemoryStore
from app.services.ai import llm_rate_limit


@pytest.mark.asyncio
async def test_under_limit_passes():
    store = InMemoryStore()
    n = await llm_rate_limit.check_and_charge(store, "u1", daily_limit=3)
    assert n == 1


@pytest.mark.asyncio
async def test_over_limit_raises():
    store = InMemoryStore()
    for _ in range(3):
        await llm_rate_limit.check_and_charge(store, "u1", daily_limit=3)
    with pytest.raises(llm_rate_limit.RateLimitExceeded) as ei:
        await llm_rate_limit.check_and_charge(store, "u1", daily_limit=3)
    assert ei.value.limit == 3


@pytest.mark.asyncio
async def test_users_have_independent_buckets():
    store = InMemoryStore()
    for _ in range(3):
        await llm_rate_limit.check_and_charge(store, "u1", daily_limit=3)
    # u2 still has their full budget.
    n = await llm_rate_limit.check_and_charge(store, "u2", daily_limit=3)
    assert n == 1


@pytest.mark.asyncio
async def test_zero_limit_is_disabled():
    store = InMemoryStore()
    # daily_limit=0 means "disabled" — never raise.
    for _ in range(100):
        n = await llm_rate_limit.check_and_charge(store, "u1", daily_limit=0)
        assert n == 0
