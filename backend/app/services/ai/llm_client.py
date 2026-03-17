from __future__ import annotations

"""Unified LLM client that prefers a local Ollama instance and falls back to Claude.

Priority:
  1. Ollama (local, private — no data leaves the machine)
  2. Anthropic Claude API (if ANTHROPIC_API_KEY is set)
  3. Returns None / yields nothing
"""

import json
import logging
from typing import Optional, AsyncIterator

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

# Connect timeout for Ollama — if it doesn't connect within this window, skip it.
# Keep short so failures don't block the request.
_OLLAMA_CONNECT_TIMEOUT = 2.0
_OLLAMA_READ_TIMEOUT = 30.0
_OLLAMA_STREAM_TIMEOUT = 60.0


def has_any_backend() -> bool:
    """Synchronous check — true if at least one backend is configured."""
    settings = get_settings()
    return bool(settings.ollama_url or settings.anthropic_api_key)


# ── Non-streaming ──────────────────────────────────────────────────────────────

async def _try_ollama(prompt: str, system: Optional[str] = None) -> Optional[str]:
    settings = get_settings()
    if not settings.ollama_url:
        return None
    url = f"{settings.ollama_url.rstrip('/')}/api/chat"
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    payload = {
        "model": settings.ollama_model,
        "messages": messages,
        "stream": False,
        "options": {"temperature": 0.3, "num_predict": 1024},
    }
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(_OLLAMA_READ_TIMEOUT, connect=_OLLAMA_CONNECT_TIMEOUT)
        ) as client:
            resp = await client.post(url, json=payload)
            resp.raise_for_status()
            data = resp.json()
            return data["message"]["content"]
    except (httpx.ConnectError, httpx.TimeoutException):
        logger.debug("Ollama not reachable at %s", url)
        return None
    except Exception as e:
        logger.warning("Ollama error: %s", e)
        return None


async def _try_claude(prompt: str, system: Optional[str] = None) -> Optional[str]:
    settings = get_settings()
    if not settings.anthropic_api_key:
        return None
    try:
        import anthropic
        client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
        kwargs: dict = {
            "model": "claude-haiku-4-5-20251001",
            "max_tokens": 1024,
            "messages": [{"role": "user", "content": prompt}],
        }
        if system:
            kwargs["system"] = system
        message = await client.messages.create(**kwargs)
        return message.content[0].text
    except Exception as e:
        logger.warning("Claude API error: %s", e)
        return None


async def complete_with_source(
    prompt: str, system: Optional[str] = None
) -> tuple[Optional[str], str]:
    """Send a prompt to the best available LLM.

    Returns (response_text, source_name) where source_name is one of:
    "ollama", "claude", or "unavailable".
    Only one backend is probed — no double-pinging.
    """
    result = await _try_ollama(prompt, system)
    if result is not None:
        return result, "ollama"

    result = await _try_claude(prompt, system)
    if result is not None:
        return result, "claude"

    return None, "unavailable"


async def complete(prompt: str, system: Optional[str] = None) -> Optional[str]:
    """Convenience wrapper — returns text only (discards source label)."""
    text, _ = await complete_with_source(prompt, system)
    return text


# ── Streaming (for chat endpoint) ─────────────────────────────────────────────

async def _stream_ollama(prompt: str, system: Optional[str] = None) -> AsyncIterator[str]:
    settings = get_settings()
    if not settings.ollama_url:
        return
    url = f"{settings.ollama_url.rstrip('/')}/api/chat"
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    payload = {
        "model": settings.ollama_model,
        "messages": messages,
        "stream": True,
        "options": {"temperature": 0.3, "num_predict": 1024},
    }
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(_OLLAMA_STREAM_TIMEOUT, connect=_OLLAMA_CONNECT_TIMEOUT)
        ) as client:
            async with client.stream("POST", url, json=payload) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line.strip():
                        continue
                    try:
                        data = json.loads(line)
                        chunk = data.get("message", {}).get("content", "")
                        if chunk:
                            yield chunk
                        if data.get("done"):
                            break
                    except json.JSONDecodeError:
                        continue
    except (httpx.ConnectError, httpx.TimeoutException):
        logger.debug("Ollama not reachable for streaming at %s", url)
        return
    except Exception as e:
        logger.warning("Ollama stream error: %s", e)
        return


async def _stream_claude(prompt: str, system: Optional[str] = None) -> AsyncIterator[str]:
    settings = get_settings()
    if not settings.anthropic_api_key:
        return
    try:
        import anthropic
        client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
        kwargs: dict = {
            "model": "claude-haiku-4-5-20251001",
            "max_tokens": 1024,
            "messages": [{"role": "user", "content": prompt}],
        }
        if system:
            kwargs["system"] = system
        async with client.messages.stream(**kwargs) as stream:
            async for text in stream.text_stream:
                yield text
    except Exception as e:
        logger.warning("Claude stream error: %s", e)
        return


async def stream_complete_with_source(
    prompt: str, system: Optional[str] = None
) -> AsyncIterator[tuple[str, str]]:
    """Yields (chunk, source) tuples. Source is set once on first chunk."""
    ollama_yielded = False
    async for chunk in _stream_ollama(prompt, system):
        ollama_yielded = True
        yield chunk, "ollama"
    if not ollama_yielded:
        async for chunk in _stream_claude(prompt, system):
            yield chunk, "claude"


async def stream_complete(prompt: str, system: Optional[str] = None) -> AsyncIterator[str]:
    """Convenience wrapper — yields text chunks only."""
    async for chunk, _ in stream_complete_with_source(prompt, system):
        yield chunk


def is_available() -> bool:
    return has_any_backend()
