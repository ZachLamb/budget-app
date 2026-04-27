from __future__ import annotations

"""Per-user content cache for cloud LLM responses.

Keyed on ``user_id + sha256(feature + system + prompt)``. Cross-user cache
leaks are impossible because the user id is part of the key — never cache
on bare prompt hash.

Storage:
  - Upstash Redis when configured (string SET with TTL).
  - In-memory dict otherwise (per-process, dev only).
"""

import asyncio
import hashlib
import json
import logging
import time
from typing import Optional

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

_DEFAULT_TTL_SECONDS = 24 * 3600  # 24h


def _key(user_id: str, feature: str, system: str, prompt: str) -> str:
    h = hashlib.sha256()
    h.update(feature.encode("utf-8"))
    h.update(b"\0")
    h.update(system.encode("utf-8"))
    h.update(b"\0")
    h.update(prompt.encode("utf-8"))
    return f"llm:cache:{user_id}:{h.hexdigest()}"


# ── In-memory fallback ────────────────────────────────────────────────────────


_memory: dict[str, tuple[str, float]] = {}
_memory_lock = asyncio.Lock()


async def _memory_get(key: str) -> Optional[str]:
    async with _memory_lock:
        rec = _memory.get(key)
        if rec is None:
            return None
        value, expires = rec
        if expires <= time.monotonic():
            del _memory[key]
            return None
        return value


async def _memory_set(key: str, value: str, ttl_seconds: int) -> None:
    async with _memory_lock:
        _memory[key] = (value, time.monotonic() + ttl_seconds)


async def _memory_delete_prefix(prefix: str) -> int:
    async with _memory_lock:
        keys = [k for k in _memory if k.startswith(prefix)]
        for k in keys:
            del _memory[k]
        return len(keys)


# ── Upstash REST ──────────────────────────────────────────────────────────────


async def _upstash_request(commands: list[list[str]]) -> Optional[list[dict]]:
    settings = get_settings()
    if not settings.upstash_redis_rest_url or not settings.upstash_redis_rest_token:
        return None
    url = settings.upstash_redis_rest_url.rstrip("/")
    headers = {"Authorization": f"Bearer {settings.upstash_redis_rest_token}"}
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(2.0, connect=1.5)) as client:
            resp = await client.post(f"{url}/pipeline", json=commands, headers=headers)
            resp.raise_for_status()
            return resp.json()
    except Exception as e:
        logger.warning("Upstash cache call failed: %s", e)
        return None


async def get(user_id: str, feature: str, system: str, prompt: str) -> Optional[str]:
    key = _key(user_id, feature, system, prompt)
    settings = get_settings()
    if settings.upstash_redis_rest_url and settings.upstash_redis_rest_token:
        results = await _upstash_request([["GET", key]])
        if results is None:
            # Fall through to in-memory on Upstash error — better-than-nothing locality.
            return await _memory_get(key)
        try:
            value = results[0].get("result")
            return value if isinstance(value, str) else None
        except (IndexError, AttributeError):
            return None
    return await _memory_get(key)


async def set(
    user_id: str,
    feature: str,
    system: str,
    prompt: str,
    value: str,
    *,
    ttl_seconds: int = _DEFAULT_TTL_SECONDS,
) -> None:
    key = _key(user_id, feature, system, prompt)
    settings = get_settings()
    if settings.upstash_redis_rest_url and settings.upstash_redis_rest_token:
        # SET key value EX ttl
        results = await _upstash_request([["SET", key, value, "EX", str(ttl_seconds)]])
        if results is not None:
            return
        # Upstash transient failure → fall back to in-memory so this request still benefits later.
    await _memory_set(key, value, ttl_seconds)


async def purge_user(user_id: str) -> int:
    """Best-effort purge of all cache entries for a user.

    Upstash REST doesn't support pattern DEL atomically; we use SCAN and
    delete in batches. Returns count of keys deleted across both stores.
    """
    prefix = f"llm:cache:{user_id}:"
    deleted = 0
    settings = get_settings()
    if settings.upstash_redis_rest_url and settings.upstash_redis_rest_token:
        url = settings.upstash_redis_rest_url.rstrip("/")
        headers = {"Authorization": f"Bearer {settings.upstash_redis_rest_token}"}
        cursor = "0"
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(3.0, connect=1.5)) as client:
                while True:
                    resp = await client.post(
                        url, json=["SCAN", cursor, "MATCH", f"{prefix}*", "COUNT", "200"], headers=headers
                    )
                    resp.raise_for_status()
                    payload = resp.json().get("result")
                    if not isinstance(payload, list) or len(payload) != 2:
                        break
                    cursor, keys = str(payload[0]), payload[1] or []
                    if keys:
                        del_resp = await client.post(url, json=["DEL", *keys], headers=headers)
                        del_resp.raise_for_status()
                        deleted += int(del_resp.json().get("result") or 0)
                    if cursor == "0":
                        break
        except Exception as e:
            logger.warning("Upstash purge_user failed: %s", e)
    deleted += await _memory_delete_prefix(prefix)
    return deleted
