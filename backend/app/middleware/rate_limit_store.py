"""Pluggable storage backend for rate-limit counters.

Two implementations:
- InMemoryStore: per-process sliding window (dev, single-worker).
- UpstashStore: shared fixed-window via Upstash Redis REST API.

Both expose the same async interface so the middleware can swap without
caring which is active. The factory ``build_store()`` picks the Upstash
backend automatically when both ``UPSTASH_REDIS_REST_URL`` and
``UPSTASH_REDIS_REST_TOKEN`` are configured; otherwise it returns the
in-memory backend.

The sliding-window approximation used by InMemoryStore is tighter, but
the fixed-window used by UpstashStore is atomic over REST in a single
pipelined call (INCR + EXPIRE), which is what we need for correctness
across replicas. Both accept brief over-cap bursts at window boundaries;
that's acceptable for auth/AI rate limiting.
"""
from __future__ import annotations

import logging
import time
from collections import defaultdict, deque
from typing import Deque, Dict, Optional, Protocol

import httpx

logger = logging.getLogger(__name__)


class RateLimitStore(Protocol):
    """Async protocol for the rate-limit / lockout counter storage.

    `check_and_increment` is the sliding-window rate-limit primitive.
    `counter_incr` / `counter_get` / `counter_delete` are generic counters
    used by the per-email login lockout (record failure, read count,
    clear on success).
    """

    async def check_and_increment(self, key: str, max_hits: int, window_seconds: int) -> bool:
        ...

    async def counter_incr(self, key: str, window_seconds: int) -> int:
        ...

    async def counter_get(self, key: str) -> int:
        ...

    async def counter_delete(self, key: str) -> None:
        ...

    @property
    def backend_name(self) -> str:
        """Short string for startup logs and /api/health, e.g. "memory" or "upstash"."""
        ...

    async def ping(self) -> bool:
        """Cheap liveness probe. True when the backend is reachable."""
        ...


# ── In-memory (per-process) ───────────────────────────────────────────────────


class InMemoryStore:
    """Sliding-window counter kept in the ASGI instance's memory.

    Correct for a single worker / single replica. With N workers the
    effective cap is ``N × max_hits``; switch to UpstashStore when that
    matters.
    """

    _MAX_TRACKED_KEYS = 50_000

    def __init__(self) -> None:
        self._hits: Dict[str, Deque[float]] = defaultdict(deque)
        # counter_incr stores (count, expires_at_monotonic)
        self._counters: Dict[str, tuple] = {}

    def _prune(self, key: str, window: float, now: float) -> None:
        dq = self._hits[key]
        while dq and dq[0] < now - window:
            dq.popleft()
        if not dq:
            del self._hits[key]

    async def check_and_increment(self, key: str, max_hits: int, window_seconds: int) -> bool:
        if len(self._hits) > self._MAX_TRACKED_KEYS and key not in self._hits:
            # Shed load rather than grow unboundedly.
            return False
        now = time.monotonic()
        window_f = float(window_seconds)
        self._prune(key, window_f, now)
        dq = self._hits[key]
        if len(dq) >= max_hits:
            return True
        dq.append(now)
        return False

    def _counter_prune(self, key: str, now: float) -> None:
        rec = self._counters.get(key)
        if rec and rec[1] <= now:
            del self._counters[key]

    async def counter_incr(self, key: str, window_seconds: int) -> int:
        now = time.monotonic()
        self._counter_prune(key, now)
        count, _ = self._counters.get(key, (0, 0.0))
        count += 1
        self._counters[key] = (count, now + float(window_seconds))
        return count

    async def counter_get(self, key: str) -> int:
        now = time.monotonic()
        self._counter_prune(key, now)
        rec = self._counters.get(key)
        return rec[0] if rec else 0

    async def counter_delete(self, key: str) -> None:
        self._counters.pop(key, None)

    @property
    def backend_name(self) -> str:
        return "memory"

    async def ping(self) -> bool:
        # In-process storage is "reachable" iff the process is alive.
        return True


# ── Upstash Redis (HTTP REST) ─────────────────────────────────────────────────


class UpstashStore:
    """Fixed-window counter shared via Upstash Redis REST API.

    Each ``check_and_increment`` call sends one pipelined request:
    ``INCR key; EXPIRE key window_seconds``. The INCR return is the
    current count in this window. If the backend is unreachable, we
    log a warning and fail open (return False) — availability beats
    strict rate-limit enforcement for an auth endpoint.
    """

    # Keep a short connect timeout so a broken Upstash doesn't block
    # every request by the full default httpx timeout.
    _CONNECT_TIMEOUT = 1.5
    _READ_TIMEOUT = 2.0

    def __init__(self, rest_url: str, rest_token: str) -> None:
        self._url = rest_url.rstrip("/")
        self._token = rest_token
        self._client: Optional[httpx.AsyncClient] = None

    def _client_or_create(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(self._READ_TIMEOUT, connect=self._CONNECT_TIMEOUT),
                headers={"Authorization": f"Bearer {self._token}"},
            )
        return self._client

    async def check_and_increment(self, key: str, max_hits: int, window_seconds: int) -> bool:
        client = self._client_or_create()
        # Pipeline: INCR returns the post-increment count; EXPIRE is NX-style
        # idempotent when the key already has a TTL.
        body = [["INCR", key], ["EXPIRE", key, str(window_seconds)]]
        try:
            resp = await client.post(f"{self._url}/pipeline", json=body)
            resp.raise_for_status()
            results = resp.json()
        except Exception as e:
            logger.warning("Upstash rate-limit call failed (%s); failing open", e)
            return False

        # results shape: [{"result": 1}, {"result": 1}] — pick first.
        try:
            count = int(results[0].get("result"))
        except (IndexError, AttributeError, TypeError, ValueError):
            logger.warning("Unexpected Upstash pipeline response: %r", results)
            return False
        return count > max_hits

    async def counter_incr(self, key: str, window_seconds: int) -> int:
        client = self._client_or_create()
        body = [["INCR", key], ["EXPIRE", key, str(window_seconds)]]
        try:
            resp = await client.post(f"{self._url}/pipeline", json=body)
            resp.raise_for_status()
            results = resp.json()
            return int(results[0].get("result"))
        except Exception as e:
            logger.warning("Upstash counter_incr failed (%s); returning 0", e)
            return 0

    async def counter_get(self, key: str) -> int:
        client = self._client_or_create()
        try:
            resp = await client.post(self._url, json=["GET", key])
            resp.raise_for_status()
            result = resp.json().get("result")
            return int(result) if result is not None else 0
        except Exception as e:
            logger.warning("Upstash counter_get failed (%s); returning 0", e)
            return 0

    async def counter_delete(self, key: str) -> None:
        client = self._client_or_create()
        try:
            resp = await client.post(self._url, json=["DEL", key])
            resp.raise_for_status()
        except Exception as e:
            logger.warning("Upstash counter_delete failed (%s); continuing", e)

    @property
    def backend_name(self) -> str:
        return "upstash"

    async def ping(self) -> bool:
        client = self._client_or_create()
        try:
            resp = await client.post(self._url, json=["PING"])
            resp.raise_for_status()
            # Upstash returns {"result": "PONG"} for PING.
            return (resp.json() or {}).get("result") == "PONG"
        except Exception as e:
            logger.warning("Upstash ping failed: %s", e)
            return False

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None


# ── Factory ───────────────────────────────────────────────────────────────────


def build_store(*, rest_url: str = "", rest_token: str = "") -> RateLimitStore:
    """Return an UpstashStore when both args are set, else an InMemoryStore.

    Accepts explicit args for test isolation; production callers read from
    ``app.config.get_settings()`` and pass those values in.
    """
    if rest_url and rest_token:
        return UpstashStore(rest_url, rest_token)
    return InMemoryStore()
