from __future__ import annotations

"""Minimal OpenAI-compatible streaming client for opt-in Tier 4 cloud AI."""

import json
import logging
from typing import AsyncIterator, Optional

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

_CONNECT_TIMEOUT = 2.0
_STREAM_TIMEOUT = 120.0


def is_configured() -> bool:
    settings = get_settings()
    return bool(settings.demo_mode or settings.ollama_url)


def _backend_url(path: str) -> str:
    base = get_settings().ollama_url.rstrip("/")
    return f"{base}{path}"


def _build_headers() -> dict[str, str]:
    settings = get_settings()
    headers = {"Content-Type": "application/json"}
    if settings.llm_backend_api_key:
        headers["Authorization"] = f"Bearer {settings.llm_backend_api_key}"
    return headers


def _build_payload(
    prompt: str,
    system: Optional[str],
    *,
    max_tokens: int,
    stream: bool,
) -> dict:
    settings = get_settings()
    messages: list[dict[str, str]] = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})
    return {
        "model": settings.ollama_model,
        "messages": messages,
        "stream": stream,
        "max_tokens": max_tokens,
        "temperature": 0.3,
    }


async def stream_complete(
    prompt: str,
    system: Optional[str] = None,
    *,
    max_tokens: int = 1024,
) -> AsyncIterator[str]:
    """Stream text chunks from /v1/chat/completions."""
    settings = get_settings()
    if settings.demo_mode:
        yield '{"answer":"[Demo cloud response]"}'
        return
    if not settings.ollama_url:
        return

    url = _backend_url("/v1/chat/completions")
    payload = _build_payload(prompt, system, max_tokens=max_tokens, stream=True)
    headers = {**_build_headers(), "Accept": "text/event-stream"}

    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(_STREAM_TIMEOUT, connect=_CONNECT_TIMEOUT)
        ) as client:
            async with client.stream("POST", url, json=payload, headers=headers) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    data_str = line[5:].strip()
                    if not data_str or data_str == "[DONE]":
                        if data_str == "[DONE]":
                            break
                        continue
                    try:
                        event = json.loads(data_str)
                    except json.JSONDecodeError:
                        continue
                    choices = event.get("choices") or []
                    if not choices:
                        continue
                    delta = choices[0].get("delta") or {}
                    chunk = delta.get("content")
                    if isinstance(chunk, str) and chunk:
                        yield chunk
    except httpx.HTTPError as e:
        logger.warning("LLM cloud stream failed: %s", type(e).__name__)
        return
