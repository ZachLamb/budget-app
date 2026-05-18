"""Tests for shared ephemeral auth storage."""
from __future__ import annotations

import pytest

from app.services.auth.ephemeral_store import InMemoryEphemeralStore


@pytest.mark.asyncio
async def test_in_memory_set_get_del() -> None:
    store = InMemoryEphemeralStore()
    await store.set("k1", "v1", 60)
    assert await store.get("k1") == "v1"
    assert await store.get_del("k1") == "v1"
    assert await store.get("k1") is None


@pytest.mark.asyncio
async def test_in_memory_ttl_expiry() -> None:
    store = InMemoryEphemeralStore()
    await store.set("k2", "v2", 0)
    assert await store.get("k2") is None
