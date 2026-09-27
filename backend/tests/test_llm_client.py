"""LlmStreamError propagation for the cloud client."""

from __future__ import annotations

import pytest

from app.services.ai import llm_client


@pytest.mark.asyncio
async def test_stream_complete_raises_when_backend_unconfigured(monkeypatch) -> None:
    from app.config import get_settings

    get_settings.cache_clear()
    monkeypatch.setenv("OLLAMA_URL", "")
    monkeypatch.setenv("DEMO_MODE", "false")

    chunks: list[str] = []
    with pytest.raises(llm_client.LlmStreamError):
        async for chunk in llm_client.stream_complete("hello"):
            chunks.append(chunk)
    assert chunks == []


def _sse(*events: str) -> bytes:
    return "".join(f"data: {e}\n\n" for e in events).encode()


@pytest.mark.asyncio
async def test_budget_exhausted_by_reasoning_says_so(monkeypatch) -> None:
    """A reasoning model thinks and answers out of one token budget.

    Its thinking arrives as `reasoning_content`, which this stream never
    forwards — so running out mid-thought produced a clean, empty, and
    entirely baffling "empty response". The cause has to reach the user,
    because the fix (raise the limit, or load a different model) is theirs.
    """
    import httpx
    from app.config import get_settings

    get_settings.cache_clear()
    monkeypatch.setenv("OLLAMA_URL", "http://127.0.0.1:1234")
    monkeypatch.setenv("DEMO_MODE", "false")

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            content=_sse(
                '{"choices":[{"delta":{"reasoning_content":"thinking..."}}]}',
                '{"choices":[{"delta":{},"finish_reason":"length"}]}',
            ),
            headers={"Content-Type": "text/event-stream"},
        )

    monkeypatch.setattr(
        llm_client,
        "_make_client",
        lambda *a, **k: httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    )

    with pytest.raises(llm_client.LlmStreamError) as err:
        async for _ in llm_client.stream_complete("hello"):
            pass
    assert "budget thinking" in str(err.value)


@pytest.mark.asyncio
async def test_empty_response_without_truncation_keeps_the_plain_message(monkeypatch) -> None:
    import httpx
    from app.config import get_settings

    get_settings.cache_clear()
    monkeypatch.setenv("OLLAMA_URL", "http://127.0.0.1:1234")
    monkeypatch.setenv("DEMO_MODE", "false")

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            content=_sse('{"choices":[{"delta":{},"finish_reason":"stop"}]}'),
            headers={"Content-Type": "text/event-stream"},
        )

    monkeypatch.setattr(
        llm_client,
        "_make_client",
        lambda *a, **k: httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    )

    with pytest.raises(llm_client.LlmStreamError) as err:
        async for _ in llm_client.stream_complete("hello"):
            pass
    assert "empty response" in str(err.value)
