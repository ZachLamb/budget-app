"""Tests for Google OAuth one-time code exchange (invalid / missing codes)."""
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.mark.asyncio
async def test_google_exchange_unknown_code_returns_400() -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post("/api/auth/google/exchange", json={"code": "definitely-not-a-valid-code-12345"})
    assert r.status_code == 400, r.text


@pytest.mark.asyncio
async def test_google_exchange_missing_code_validation() -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post("/api/auth/google/exchange", json={})
    assert r.status_code == 422, r.text
