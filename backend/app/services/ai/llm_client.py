from __future__ import annotations

"""LLM client speaking the OpenAI-compatible /v1/chat/completions API.

Same client serves both ends of Path C:

- **Dev:** local Ollama (which exposes ``/v1/chat/completions`` alongside its
  native ``/api/chat``). Default ``LLM_BACKEND_URL=http://ollama:11434``.
- **Prod:** Modal-hosted vLLM (Qwen 2.5 7B Instruct AWQ). Set
  ``LLM_BACKEND_URL=https://...modal.run`` plus ``LLM_BACKEND_API_KEY``.

The variable name ``ollama_url`` is preserved for back-compat with existing
dev ``.env`` files; the settings layer accepts ``LLM_BACKEND_URL`` as an alias.

Demo mode bypasses the network entirely and returns canned responses. No
prompt or completion content is ever logged — see the privacy contract on
the /privacy page and the redaction in ``log_redact.py``.
"""

import json
import logging
import time
from typing import AsyncIterator, Optional

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

# Connect timeout — if the upstream doesn't accept the TCP connection within
# this window, give up. Keep short so a flaky backend doesn't block users.
_CONNECT_TIMEOUT = 2.0
# Non-streaming completions (insights, budget suggestions, etc.) — small
# local models often need >30s. Modal vLLM cold-start can hit ~90s.
_READ_TIMEOUT = 120.0
_STREAM_TIMEOUT = 120.0


def has_any_backend() -> bool:
    """True when demo mode is on or LLM_BACKEND_URL is configured."""
    settings = get_settings()
    if settings.demo_mode:
        return True
    return bool(settings.ollama_url)


# ── Demo mode canned responses ────────────────────────────────────────────────

_DEMO_LABEL = (
    "[Demo sample — figures below are illustrative, not from your household.]\n\n"
)


_DEMO_RESPONSES = {
    "insight": (
        "Here are some insights based on your recent spending:\n\n"
        "1. **Grocery spending** averaged $480/month over the last 3 months, which is under your $600 budget — nice work!\n"
        "2. **Restaurant & coffee** spending was $245 last month, slightly over your combined $240 budget.\n"
        "3. **Utility costs** have been trending up — Duke Energy was $138 last month vs $112 two months ago.\n"
        "4. You're consistently saving $450/month between your emergency fund and vacation fund. At this rate, you'll hit your emergency fund goal in about 23 months."
    ),
    "budget": (
        "Based on your spending patterns, here are some budget suggestions:\n\n"
        "- **Restaurants**: Consider raising from $200 to $220 — you've been over 3 of the last 4 months.\n"
        "- **Utilities**: Your current $140 budget is tight. With summer coming, consider $160.\n"
        "- **Groceries**: You're consistently under $600. You could lower to $500 and move $100 to debt payoff.\n"
        "- **Savings**: Great consistency! Your $450/month split is on track for your goals."
    ),
    "debt": (
        "Here's your debt payoff analysis:\n\n"
        "**Current Debts:**\n"
        "- Chase Visa: $2,340 at 21.99% APR\n"
        "- Car Loan: $12,800 at 4.50% APR\n\n"
        "**Avalanche Strategy (recommended):** Pay minimums on all debts, put extra $200/month toward the Chase Visa first (highest interest). "
        "You'll be credit-card-debt-free in about 11 months and save approximately $280 in interest vs. the snowball method.\n\n"
        "**After the Visa is paid off**, redirect that $245/month (minimum + extra) to the car loan to accelerate payoff."
    ),
    "fsa": '[{"transaction_id": "demo", "eligible": true, "category": "Medical", "confidence": "high", "reason": "Medical office visit copay"}]',
    "categorize": '{"category": "Groceries", "confidence": 0.92}',
    "action": '{"action": "none", "message": "I can help you with that! What would you like to do?"}',
}


def _demo_response(prompt: str) -> str:
    """Return a contextually appropriate canned response for demo mode."""
    p = prompt.lower()
    if "fsa" in p or "flexible spending" in p:
        return _DEMO_RESPONSES["fsa"]
    if "categori" in p:
        return _DEMO_RESPONSES["categorize"]
    if "action" in p or "parse" in p or "execute" in p:
        return _DEMO_RESPONSES["action"]
    if "debt" in p or "payoff" in p or "paydown" in p:
        return _DEMO_LABEL + _DEMO_RESPONSES["debt"]
    if "budget" in p or "suggest" in p or "assign" in p:
        return _DEMO_LABEL + _DEMO_RESPONSES["budget"]
    if "insight" in p or "spending" in p or "analyz" in p or "pattern" in p:
        return _DEMO_LABEL + _DEMO_RESPONSES["insight"]
    # Default: friendly financial advice for chat
    return _DEMO_LABEL + (
        "Great question! Based on your financial picture, you're in solid shape. "
        "Your emergency fund is over halfway to your $15,000 goal, and your debt-to-income "
        "ratio is manageable. I'd suggest focusing on the Chase Visa first since it has the "
        "highest interest rate at 21.99%. Once that's paid off, you can redirect those payments "
        "to accelerate your savings goals. Would you like me to break down a specific area of "
        "your finances?"
    )


# ── Wire format helpers ───────────────────────────────────────────────────────


def _build_payload(
    prompt: str,
    system: Optional[str],
    *,
    max_tokens: int,
    json_format: bool,
    stream: bool,
) -> dict:
    """Compose the OpenAI-compatible /v1/chat/completions request body.

    Both Ollama (>=0.5) and vLLM accept this identical shape — the model
    string is the only environment-specific bit.
    """
    settings = get_settings()
    messages: list[dict] = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    body: dict = {
        "model": settings.ollama_model,
        "messages": messages,
        "stream": stream,
        "max_tokens": max_tokens,
        "temperature": 0.3,
    }
    if json_format:
        # Both Ollama and vLLM honor this OpenAI-style hint and constrain
        # generation to parseable JSON. Small models otherwise drift into
        # markdown fences or chatty prose around the payload.
        body["response_format"] = {"type": "json_object"}
    return body


def _build_headers() -> dict[str, str]:
    """Return request headers, including Authorization when a key is set.

    Ollama in dev has no auth; ``llm_backend_api_key`` is empty and we skip
    the header. Modal vLLM in prod requires Bearer auth — set the key via
    ``LLM_BACKEND_API_KEY``.
    """
    settings = get_settings()
    h = {"Content-Type": "application/json"}
    if settings.llm_backend_api_key:
        h["Authorization"] = f"Bearer {settings.llm_backend_api_key}"
    return h


def _backend_url(path: str) -> str:
    """Compose the full URL for an OpenAI-API path under the configured backend."""
    base = get_settings().ollama_url.rstrip("/")
    return f"{base}{path}"


# ── Non-streaming ─────────────────────────────────────────────────────────────


async def _try_backend(
    prompt: str,
    system: Optional[str] = None,
    max_tokens: int = 1024,
    *,
    json_format: bool = False,
) -> Optional[str]:
    """Single non-streaming POST to ``/v1/chat/completions``.

    Returns the assistant's reply text, or ``None`` if the backend is
    unreachable or returned an error. Errors are logged WITHOUT the request
    body — the prompt may contain user content and the privacy contract is
    "we don't log your requests."
    """
    settings = get_settings()
    if not settings.ollama_url:
        return None
    url = _backend_url("/v1/chat/completions")
    payload = _build_payload(
        prompt, system, max_tokens=max_tokens, json_format=json_format, stream=False
    )
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(_READ_TIMEOUT, connect=_CONNECT_TIMEOUT)
        ) as client:
            resp = await client.post(url, json=payload, headers=_build_headers())
            resp.raise_for_status()
            data = resp.json()
            choices = data.get("choices") or []
            if not choices:
                logger.warning("LLM backend returned no choices")
                return None
            msg = choices[0].get("message") or {}
            content = msg.get("content")
            return content if isinstance(content, str) else None
    except (httpx.ConnectError, httpx.TimeoutException):
        logger.debug("LLM backend not reachable at %s", url)
        return None
    except httpx.HTTPStatusError as e:
        # Log status only — the response body might echo our prompt.
        logger.warning("LLM backend HTTP %s", e.response.status_code)
        return None
    except Exception as e:  # pragma: no cover — defensive
        # Log the exception class only; safe_error_message is in the cloud
        # route, but at this layer the prompt isn't in the exception either.
        logger.warning("LLM backend error: %s", type(e).__name__)
        return None


async def complete_with_source(
    prompt: str,
    system: Optional[str] = None,
    max_tokens: int = 1024,
    *,
    json_format: bool = False,
    log_label: Optional[str] = None,
) -> tuple[Optional[str], str]:
    """Send a prompt to the LLM backend (or demo canned data).

    Set ``json_format=True`` when the caller expects a JSON response —
    constrains generation server-side so small models don't drift into
    markdown fences or chatty prose around the payload.

    Set ``log_label`` to record an INFO-level timing entry under that op
    name. No prompts or responses are logged — just duration / source / ok.

    Returns ``(response_text, source_name)``: source is ``"demo"``,
    ``"ollama"`` (or ``"vllm"`` in prod — kept as a string for backward
    compat with existing callers and audit logging), or ``"unavailable"``.
    """
    t0 = time.perf_counter()
    if get_settings().demo_mode:
        text, source = _demo_response(prompt), "demo"
    else:
        result = await _try_backend(
            prompt, system, max_tokens=max_tokens, json_format=json_format
        )
        text, source = (result, "ollama") if result is not None else (None, "unavailable")

    if log_label:
        logger.info(
            "ai_llm op=%s duration_ms=%.0f source=%s ok=%s",
            log_label,
            (time.perf_counter() - t0) * 1000,
            source,
            text is not None,
        )
    return text, source


async def complete(
    prompt: str,
    system: Optional[str] = None,
    max_tokens: int = 1024,
    *,
    json_format: bool = False,
) -> Optional[str]:
    """Convenience wrapper — returns text only (discards source label)."""
    text, _ = await complete_with_source(
        prompt, system, max_tokens=max_tokens, json_format=json_format
    )
    return text


# ── Streaming (for chat endpoint + Tier 4 cloud route) ────────────────────────


async def _stream_backend(prompt: str, system: Optional[str] = None) -> AsyncIterator[str]:
    """Stream chunks from /v1/chat/completions (SSE format)."""
    settings = get_settings()
    if not settings.ollama_url:
        return
    url = _backend_url("/v1/chat/completions")
    payload = _build_payload(prompt, system, max_tokens=1024, json_format=False, stream=True)
    headers = {**_build_headers(), "Accept": "text/event-stream"}

    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(_STREAM_TIMEOUT, connect=_CONNECT_TIMEOUT)
        ) as client:
            async with client.stream("POST", url, json=payload, headers=headers) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line:
                        continue
                    if not line.startswith("data:"):
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
    except (httpx.ConnectError, httpx.TimeoutException):
        logger.debug("LLM backend not reachable for streaming at %s", url)
        return
    except httpx.HTTPStatusError as e:
        logger.warning("LLM stream HTTP %s", e.response.status_code)
        return
    except Exception as e:  # pragma: no cover — defensive
        logger.warning("LLM stream error: %s", type(e).__name__)
        return


async def stream_complete_with_source(
    prompt: str, system: Optional[str] = None
) -> AsyncIterator[tuple[str, str]]:
    """Yields ``(chunk, source)`` tuples. Source is set on every chunk."""
    if get_settings().demo_mode:
        import asyncio

        response = _demo_response(prompt)
        words = response.split(" ")
        for i, word in enumerate(words):
            chunk = word if i == 0 else " " + word
            yield chunk, "demo"
            await asyncio.sleep(0.03)
        return

    async for chunk in _stream_backend(prompt, system):
        yield chunk, "ollama"


async def stream_complete(prompt: str, system: Optional[str] = None) -> AsyncIterator[str]:
    """Convenience wrapper — yields text chunks only."""
    async for chunk, _ in stream_complete_with_source(prompt, system):
        yield chunk


def is_available() -> bool:
    return has_any_backend()
