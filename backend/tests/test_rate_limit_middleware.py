"""Tests for the per-instance sliding-window RateLimitMiddleware.

These cover the behaviors the middleware's route rules depend on:
- POSTs past the per-IP cap return 429
- GETs are never limited (method filter)
- separate IPs get separate buckets when XFF comes from a trusted peer
- X-Forwarded-For is IGNORED when the peer is not in the trusted-proxy list
- more-specific prefixes win over the generic "/api/ai/" prefix when rules
  overlap (e.g. "/api/auth/login" is tighter than "/api/auth/")
- RFC 9331-draft ``RateLimit-*`` headers appear on both 200 and 429 responses
"""
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import PlainTextResponse
from starlette.routing import Route

from app.middleware.rate_limit import RateLimitMiddleware, _RULES
from app.middleware.rate_limit_store import InMemoryStore


async def _ok(_: Request) -> PlainTextResponse:
    return PlainTextResponse("ok")


def _build_app(*, trusted_proxies: str = "127.0.0.1") -> Starlette:
    """Mount a handful of routes that fall under different rate-limit prefixes.

    Default trusts loopback so tests can spoof X-Forwarded-For through httpx's
    ASGI transport. Tests that want to verify XFF-ignoring behavior pass
    ``trusted_proxies=""``.
    """
    app = Starlette(
        routes=[
            Route("/api/auth/login", _ok, methods=["POST", "GET"]),
            Route("/api/auth/passkey/authenticate/start", _ok, methods=["POST"]),
            Route("/api/ai/insights", _ok, methods=["POST"]),
            Route("/api/llm/cloud", _ok, methods=["POST"]),
        ]
    )
    # Fresh store per app so tests don't cross-contaminate.
    app.add_middleware(
        RateLimitMiddleware,
        store=InMemoryStore(),
        trusted_proxies=trusted_proxies,
    )
    return app


def _rule_cap(prefix: str) -> int:
    for p, cap, _ in _RULES:
        if prefix.startswith(p):
            return cap
    raise AssertionError(f"no rate-limit rule for {prefix}")


@pytest.mark.asyncio
async def test_ai_post_returns_429_after_cap_on_single_ip() -> None:
    app = _build_app()
    cap = _rule_cap("/api/ai/")  # tight AI cap
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # First `cap` requests succeed.
        for _ in range(cap):
            resp = await client.post(
                "/api/ai/insights",
                headers={"x-forwarded-for": "1.2.3.4"},
            )
            assert resp.status_code == 200
        # cap+1 trips the limiter.
        resp = await client.post(
            "/api/ai/insights",
            headers={"x-forwarded-for": "1.2.3.4"},
        )
        assert resp.status_code == 429
        assert resp.headers.get("Retry-After") == "60"
        assert "Too many requests" in resp.text


@pytest.mark.asyncio
async def test_llm_cloud_post_returns_429_after_cap() -> None:
    app = _build_app()
    cap = _rule_cap("/api/llm/cloud")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        for _ in range(cap):
            resp = await client.post(
                "/api/llm/cloud",
                headers={"x-forwarded-for": "4.4.4.4"},
            )
            assert resp.status_code == 200
        resp = await client.post(
            "/api/llm/cloud",
            headers={"x-forwarded-for": "4.4.4.4"},
        )
        assert resp.status_code == 429


@pytest.mark.asyncio
async def test_separate_ips_have_separate_buckets() -> None:
    app = _build_app()
    cap = _rule_cap("/api/ai/")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Fill IP A to the cap.
        for _ in range(cap):
            resp = await client.post("/api/ai/insights", headers={"x-forwarded-for": "1.1.1.1"})
            assert resp.status_code == 200
        # IP B still has full budget.
        resp = await client.post("/api/ai/insights", headers={"x-forwarded-for": "2.2.2.2"})
        assert resp.status_code == 200
        # IP A is now locked out.
        resp = await client.post("/api/ai/insights", headers={"x-forwarded-for": "1.1.1.1"})
        assert resp.status_code == 429


@pytest.mark.asyncio
async def test_get_requests_are_not_rate_limited() -> None:
    """Safe methods bypass the limiter even on a rate-limited prefix."""
    app = _build_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Far above any cap — GET must not 429.
        for _ in range(300):
            resp = await client.get("/api/auth/login", headers={"x-forwarded-for": "9.9.9.9"})
            assert resp.status_code == 200


@pytest.mark.asyncio
async def test_login_prefix_takes_precedence_over_bare_auth_prefix() -> None:
    """More-specific /api/auth/login rule must fire before a generic one."""
    app = _build_app()
    login_cap = _rule_cap("/api/auth/login")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        for _ in range(login_cap):
            resp = await client.post(
                "/api/auth/login",
                headers={"x-forwarded-for": "3.3.3.3"},
            )
            assert resp.status_code == 200
        resp = await client.post("/api/auth/login", headers={"x-forwarded-for": "3.3.3.3"})
        assert resp.status_code == 429


@pytest.mark.asyncio
async def test_xff_is_ignored_when_peer_is_not_a_trusted_proxy() -> None:
    """Without a trusted-proxy allowlist entry, XFF must not partition buckets.

    Two different X-Forwarded-For values from the same (untrusted) peer share
    the same bucket, so flooding with rotating XFF cannot bypass the limit.
    """
    # Empty trusted list → XFF ignored, all requests key on the peer IP.
    app = _build_app(trusted_proxies="")
    cap = _rule_cap("/api/ai/")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Spoof one XFF per request up to cap — should still trip the limiter.
        for i in range(cap):
            resp = await client.post(
                "/api/ai/insights",
                headers={"x-forwarded-for": f"10.0.0.{i}"},
            )
            assert resp.status_code == 200
        resp = await client.post(
            "/api/ai/insights",
            headers={"x-forwarded-for": "10.0.0.254"},
        )
        assert resp.status_code == 429


@pytest.mark.asyncio
async def test_rate_limit_headers_on_happy_path_decrement_remaining() -> None:
    """Every 2xx under a matched rule must carry RateLimit-* draft headers.

    The client needs to see ``Remaining`` drop toward 0 so it can back off
    before hitting the 429.
    """
    app = _build_app()
    cap = _rule_cap("/api/ai/")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        for i in range(1, cap + 1):
            resp = await client.post(
                "/api/ai/insights",
                headers={"x-forwarded-for": "7.7.7.7"},
            )
            assert resp.status_code == 200
            assert resp.headers.get("RateLimit-Limit") == str(cap)
            # Remaining is cap - count, clamped at 0 on the final allowed hit.
            expected_remaining = max(0, cap - i)
            assert resp.headers.get("RateLimit-Remaining") == str(expected_remaining)
            # Reset == the configured window for this prefix (60s for /api/ai/).
            assert resp.headers.get("RateLimit-Reset") == "60"


@pytest.mark.asyncio
async def test_rate_limit_headers_on_429_block() -> None:
    """The 429 itself must also carry RateLimit-* headers with Remaining=0."""
    app = _build_app()
    cap = _rule_cap("/api/ai/")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Exhaust the bucket.
        for _ in range(cap):
            resp = await client.post(
                "/api/ai/insights",
                headers={"x-forwarded-for": "8.8.8.8"},
            )
            assert resp.status_code == 200
        # Next request trips the limiter.
        resp = await client.post(
            "/api/ai/insights",
            headers={"x-forwarded-for": "8.8.8.8"},
        )
        assert resp.status_code == 429
        # Existing Retry-After behavior is unchanged.
        assert resp.headers.get("Retry-After") == "60"
        # And the new RFC-9331 draft headers appear alongside it.
        assert resp.headers.get("RateLimit-Limit") == str(cap)
        assert resp.headers.get("RateLimit-Remaining") == "0"
        assert resp.headers.get("RateLimit-Reset") == "60"
        # Body shape unchanged — the parent session's contract.
        assert "Too many requests" in resp.text


@pytest.mark.asyncio
async def test_rate_limit_headers_absent_for_unmatched_routes() -> None:
    """Routes outside _RULES must not carry RateLimit-* headers.

    Emitting them on every response would be misleading (no limit is
    actually enforced) and balloon header size on unrelated endpoints.
    """
    app = _build_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # GET is never matched (method filter) — no headers.
        resp = await client.get("/api/auth/login", headers={"x-forwarded-for": "1.1.1.1"})
        assert resp.status_code == 200
        assert resp.headers.get("RateLimit-Limit") is None
        assert resp.headers.get("RateLimit-Remaining") is None
        assert resp.headers.get("RateLimit-Reset") is None
