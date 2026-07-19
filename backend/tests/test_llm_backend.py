"""OpenAI-compatible model-server client (app/services/ai/llm_client.py).

Verifies the app talks to an LM Studio / Ollama style server: the `/v1/models`
probe and the `/v1/chat/completions` SSE stream. LM Studio serves this exact
protocol, so these mocks stand in for a running LM Studio instance.
"""
from __future__ import annotations

from types import SimpleNamespace

import httpx
import pytest

from app.services.ai import llm_client


def _fake_settings(url: str = "http://localhost:1234", model: str = "google/gemma-3-12b"):
    return SimpleNamespace(
        ollama_url=url,
        ollama_model=model,
        llm_backend_api_key="",
        demo_mode=False,
    )


@pytest.fixture(autouse=True)
def _reset_transport():
    yield
    llm_client._TEST_TRANSPORT = None


@pytest.mark.asyncio
async def test_probe_unconfigured(monkeypatch):
    monkeypatch.setattr(llm_client, "get_settings", lambda: _fake_settings(url=""))
    out = await llm_client.probe_backend()
    assert out == {"configured": False, "reachable": False, "models": []}


@pytest.mark.asyncio
async def test_probe_reachable_lists_models(monkeypatch):
    monkeypatch.setattr(llm_client, "get_settings", lambda: _fake_settings())

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/models"
        return httpx.Response(
            200,
            json={"data": [{"id": "google/gemma-3-12b"}, {"id": "llama-3.1-8b"}]},
        )

    llm_client._TEST_TRANSPORT = httpx.MockTransport(handler)
    out = await llm_client.probe_backend()
    assert out["configured"] is True
    assert out["reachable"] is True
    assert out["models"] == ["google/gemma-3-12b", "llama-3.1-8b"]


@pytest.mark.asyncio
async def test_probe_unreachable_reports_configured_but_down(monkeypatch):
    monkeypatch.setattr(llm_client, "get_settings", lambda: _fake_settings())

    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    llm_client._TEST_TRANSPORT = httpx.MockTransport(handler)
    out = await llm_client.probe_backend()
    assert out == {"configured": True, "reachable": False, "models": []}


@pytest.mark.asyncio
async def test_stream_complete_parses_openai_sse(monkeypatch):
    monkeypatch.setattr(llm_client, "get_settings", lambda: _fake_settings())

    sse = (
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'
        'data: {"choices":[{"delta":{"content":", world"}}]}\n\n'
        "data: [DONE]\n\n"
    )

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/chat/completions"
        body = request.read().decode()
        assert '"stream":true' in body.replace(" ", "")
        assert "google/gemma-3-12b" in body
        return httpx.Response(200, content=sse.encode("utf-8"))

    llm_client._TEST_TRANSPORT = httpx.MockTransport(handler)
    chunks = [c async for c in llm_client.stream_complete("hi", "be brief", max_tokens=32)]
    assert "".join(chunks) == "Hello, world"


@pytest.mark.asyncio
async def test_stream_complete_empty_raises(monkeypatch):
    monkeypatch.setattr(llm_client, "get_settings", lambda: _fake_settings())

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"data: [DONE]\n\n")

    llm_client._TEST_TRANSPORT = httpx.MockTransport(handler)
    with pytest.raises(llm_client.LlmStreamError):
        [c async for c in llm_client.stream_complete("hi")]


@pytest.mark.asyncio
async def test_cloud_route_streams_from_backend(monkeypatch):
    """Full path: /api/llm/cloud → stream_complete → mocked LM Studio SSE."""
    from httpx import ASGITransport, AsyncClient

    from app.api.deps import get_current_user
    from app.api.routes import llm as llm_route
    from app.database import get_db
    from app.main import app

    monkeypatch.setattr(llm_client, "get_settings", lambda: _fake_settings())

    async def _reply(request: httpx.Request) -> httpx.Response:  # noqa: ARG001
        return httpx.Response(
            200,
            content=(
                'data: {"choices":[{"delta":{"content":"Paid off"}}]}\n\n'
                'data: {"choices":[{"delta":{"content":" faster."}}]}\n\n'
                "data: [DONE]\n\n"
            ).encode(),
        )

    llm_client._TEST_TRANSPORT = httpx.MockTransport(_reply)

    async def _user():
        return SimpleNamespace(id="user-1", household_id=None)

    async def _db():
        yield None

    async def _has_consent(_db, _uid, _feature):
        return True

    async def _noop_audit(*args, **kwargs):
        return None

    monkeypatch.setattr(llm_route.consent_service, "has_active_consent", _has_consent)
    monkeypatch.setattr(llm_route.audit, "write", _noop_audit)
    app.dependency_overrides[get_current_user] = _user
    app.dependency_overrides[get_db] = _db
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.post(
                "/api/llm/cloud",
                json={"feature": "financial_advice", "prompt": "help", "system": "be brief", "max_tokens": 64},
            )
        assert resp.status_code == 200
        body = resp.text
        assert "Paid off" in body and "faster." in body
        assert '"done":true' in body.replace(" ", "")
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_db, None)
