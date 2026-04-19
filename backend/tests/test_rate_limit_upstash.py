"""Tests for the Upstash Redis HTTP-REST rate-limit backend.

These don't hit Upstash — they intercept the httpx client so we can verify
the wire format (pipelined INCR + EXPIRE, bearer token header) and the
failure-mode contract (fail open on network error).
"""
from __future__ import annotations

import pytest
import httpx

from app.middleware.rate_limit_store import UpstashStore


def _make_store_with_handler(handler) -> UpstashStore:
    """Wire a MockTransport into UpstashStore's httpx client."""
    store = UpstashStore("https://example.upstash.io", "test-token")
    # Prime the lazy client so we can replace its transport.
    client = store._client_or_create()
    # Rebuild the client with the same headers but a MockTransport.
    store._client = httpx.AsyncClient(
        timeout=client.timeout,
        headers=dict(client.headers),
        transport=httpx.MockTransport(handler),
    )
    return store


@pytest.mark.asyncio
async def test_check_and_increment_sends_pipelined_incr_expire_with_bearer_token() -> None:
    seen_requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_requests.append(request)
        # Pretend this is the first hit in the window.
        return httpx.Response(200, json=[{"result": 1}, {"result": 1}])

    store = _make_store_with_handler(handler)
    result = await store.check_and_increment("rl:/api/auth/login:1.1.1.1", 3, 60)
    assert result.over is False
    assert result.count == 1
    assert len(seen_requests) == 1
    req = seen_requests[0]
    assert req.url.path == "/pipeline"
    assert req.headers.get("authorization") == "Bearer test-token"
    import json as _json
    body = _json.loads(req.content)
    assert body == [
        ["INCR", "rl:/api/auth/login:1.1.1.1"],
        ["EXPIRE", "rl:/api/auth/login:1.1.1.1", "60"],
    ]


@pytest.mark.asyncio
async def test_check_and_increment_returns_true_when_incr_exceeds_cap() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        # 4th hit — over the cap of 3.
        return httpx.Response(200, json=[{"result": 4}, {"result": 1}])

    store = _make_store_with_handler(handler)
    result = await store.check_and_increment("k", 3, 60)
    assert result.over is True
    # Count is the post-INCR value from Upstash, needed by the middleware
    # to emit RateLimit-Remaining (which will be 0 here via max(0, cap - count)).
    assert result.count == 4


@pytest.mark.asyncio
async def test_check_and_increment_fails_open_on_network_error() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("unreachable")

    store = _make_store_with_handler(handler)
    # Availability beats strict enforcement when the limiter is down.
    # On failure we report count=0 so the middleware emits a full-budget
    # RateLimit-Remaining (conservative from the client's perspective).
    result = await store.check_and_increment("k", 3, 60)
    assert result.over is False
    assert result.count == 0


@pytest.mark.asyncio
async def test_check_and_increment_surfaces_post_incr_count_for_headers() -> None:
    """The middleware derives RateLimit-Remaining from ``result.count``.

    Verify that an under-cap hit returns the Upstash post-INCR value so
    clients see Remaining shrink toward 0 before a 429.
    """
    def handler(_: httpx.Request) -> httpx.Response:
        # 2nd hit in a 3-request window — still under cap.
        return httpx.Response(200, json=[{"result": 2}, {"result": 1}])

    store = _make_store_with_handler(handler)
    result = await store.check_and_increment("k", 3, 60)
    assert result.over is False
    assert result.count == 2


@pytest.mark.asyncio
async def test_counter_incr_returns_post_increment_count() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=[{"result": 2}, {"result": 1}])

    store = _make_store_with_handler(handler)
    assert await store.counter_incr("lockout:login:alice@example.com", 600) == 2


@pytest.mark.asyncio
async def test_counter_get_reads_null_as_zero() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"result": None})

    store = _make_store_with_handler(handler)
    assert await store.counter_get("lockout:login:new@example.com") == 0


@pytest.mark.asyncio
async def test_counter_get_reads_numeric_string_count() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"result": "3"})

    store = _make_store_with_handler(handler)
    assert await store.counter_get("lockout:login:alice@example.com") == 3


@pytest.mark.asyncio
async def test_ping_returns_true_on_pong_and_false_on_error() -> None:
    """Used by /api/health. A flaky PING must not be reported as healthy."""
    def pong_handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"result": "PONG"})

    def sad_handler(_: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("unreachable")

    store_ok = _make_store_with_handler(pong_handler)
    assert await store_ok.ping() is True

    store_bad = _make_store_with_handler(sad_handler)
    assert await store_bad.ping() is False


def test_upstash_backend_name_constant() -> None:
    from app.middleware.rate_limit_store import UpstashStore

    assert UpstashStore("https://x.upstash.io", "tok").backend_name == "upstash"


@pytest.mark.asyncio
async def test_counter_delete_sends_del_command() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"result": 1})

    store = _make_store_with_handler(handler)
    await store.counter_delete("lockout:login:alice@example.com")
    assert len(seen) == 1
    import json as _json
    body = _json.loads(seen[0].content)
    assert body == ["DEL", "lockout:login:alice@example.com"]
