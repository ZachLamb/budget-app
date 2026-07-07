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
