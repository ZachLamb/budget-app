"""Tests for the per-instance sliding-window RateLimitMiddleware.

These cover the behaviors the middleware's route rules depend on:
- POSTs past the per-IP cap return 429
- GETs are never limited (method filter)
- separate IPs get separate buckets
- more-specific prefixes win over the generic "/api/ai/" prefix when rules
  overlap (e.g. "/api/auth/login" is tighter than "/api/auth/")
"""
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import PlainTextResponse
from starlette.routing import Route

from app.middleware.rate_limit import RateLimitMiddleware, _RULES


async def _ok(_: Request) -> PlainTextResponse:
    return PlainTextResponse("ok")


def _build_app() -> Starlette:
    """Mount a handful of routes that fall under different rate-limit prefixes."""
    app = Starlette(
        routes=[
            Route("/api/auth/login", _ok, methods=["POST", "GET"]),
            Route("/api/auth/passkey/authenticate/start", _ok, methods=["POST"]),
            Route("/api/ai/insights", _ok, methods=["POST"]),
        ]
    )
    app.add_middleware(RateLimitMiddleware)
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
