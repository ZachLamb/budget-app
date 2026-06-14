"""Removed cloud LLM routes return 404 after the nano-only migration."""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app

_REMOVED = [
    ("POST", "/api/llm/cloud"),
    ("POST", "/api/ai/insights"),
    ("POST", "/api/ai/budget-insights"),
    ("POST", "/api/ai/budget-suggestions"),
    ("POST", "/api/ai/chat/stream"),
    ("POST", "/api/ai/advisor-turn"),
    ("POST", "/api/ai/debt-plan-suggestion"),
    ("POST", "/api/ai/parse-action"),
    ("POST", "/api/ai/suggest-interest-rates"),
    ("POST", "/api/ai/fsa-review"),
    ("GET", "/api/ai/status"),
    ("POST", "/api/categorization/suggest"),
]


@pytest.mark.asyncio
@pytest.mark.parametrize("method,path", _REMOVED)
async def test_removed_routes_404(method: str, path: str) -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.request(method, path)
    assert resp.status_code == 404
