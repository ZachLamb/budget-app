"""Opt-in Tier 4 cloud generate route."""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.mark.asyncio
async def test_cloud_generate_unconfigured_returns_503(monkeypatch) -> None:
    from app.api.deps import get_current_user
    from app.database import get_db

    class _User:
        id = "user-test"

    async def _user() -> _User:
        return _User()

    async def _db():
        yield None

    monkeypatch.setattr("app.api.routes.llm.llm_client.is_configured", lambda: False)

    app.dependency_overrides[get_current_user] = _user
    app.dependency_overrides[get_db] = _db
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/api/llm/cloud",
                json={
                    "feature": "free_form_qa",
                    "prompt": "hello",
                    "system": "test",
                    "max_tokens": 64,
                },
            )
        assert resp.status_code == 503
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_db, None)
