from __future__ import annotations

"""LLM client for local Ollama only — no cloud model APIs.

Data stays on your machine when Ollama is reachable. If Ollama is down or
OLLAMA_URL is empty, completions return nothing (callers show a clear error).
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
    """True when demo mode is on or Ollama URL is configured (may still be unreachable)."""
    settings = get_settings()
    if settings.demo_mode:
        return True
    return bool(settings.ollama_url)


# ── Demo mode canned responses ────────────────────────────────────────────────

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
        return _DEMO_RESPONSES["debt"]
    if "budget" in p or "suggest" in p or "assign" in p:
        return _DEMO_RESPONSES["budget"]
    if "insight" in p or "spending" in p or "analyz" in p or "pattern" in p:
        return _DEMO_RESPONSES["insight"]
    # Default: friendly financial advice for chat
    return (
        "Great question! Based on your financial picture, you're in solid shape. "
        "Your emergency fund is over halfway to your $15,000 goal, and your debt-to-income "
        "ratio is manageable. I'd suggest focusing on the Chase Visa first since it has the "
        "highest interest rate at 21.99%. Once that's paid off, you can redirect those payments "
        "to accelerate your savings goals. Would you like me to break down a specific area of "
        "your finances?"
    )


# ── Non-streaming ──────────────────────────────────────────────────────────────

async def _try_ollama(prompt: str, system: Optional[str] = None, max_tokens: int = 1024) -> Optional[str]:
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
        "options": {"temperature": 0.3, "num_predict": max_tokens},
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


async def complete_with_source(
    prompt: str, system: Optional[str] = None, max_tokens: int = 1024
) -> tuple[Optional[str], str]:
    """Send a prompt to Ollama (or demo canned data).

    Returns (response_text, source_name): "demo", "ollama", or "unavailable".
    """
    if get_settings().demo_mode:
        return _demo_response(prompt), "demo"

    result = await _try_ollama(prompt, system, max_tokens=max_tokens)
    if result is not None:
        return result, "ollama"

    return None, "unavailable"


async def complete(prompt: str, system: Optional[str] = None, max_tokens: int = 1024) -> Optional[str]:
    """Convenience wrapper — returns text only (discards source label)."""
    text, _ = await complete_with_source(prompt, system, max_tokens=max_tokens)
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


async def stream_complete_with_source(
    prompt: str, system: Optional[str] = None
) -> AsyncIterator[tuple[str, str]]:
    """Yields (chunk, source) tuples. Source is set once on first chunk."""
    if get_settings().demo_mode:
        import asyncio

        response = _demo_response(prompt)
        # Simulate streaming by yielding word-by-word
        words = response.split(" ")
        for i, word in enumerate(words):
            chunk = word if i == 0 else " " + word
            yield chunk, "demo"
            await asyncio.sleep(0.03)
        return

    async for chunk in _stream_ollama(prompt, system):
        yield chunk, "ollama"


async def stream_complete(prompt: str, system: Optional[str] = None) -> AsyncIterator[str]:
    """Convenience wrapper — yields text chunks only."""
    async for chunk, _ in stream_complete_with_source(prompt, system):
        yield chunk


def is_available() -> bool:
    return has_any_backend()
