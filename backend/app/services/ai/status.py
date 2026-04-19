from __future__ import annotations

"""AI backend status probe.

Kept separate from the route so tests and other callers can probe
availability without going through HTTP. When ``demo_mode`` is on, we
report ``active_backend="demo"`` rather than hitting Ollama — the real
Ollama instance might be reachable but the demo serves canned responses.
"""

import logging

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)


async def get_ai_status() -> dict[str, object]:
    """Return which AI backend is available.

    Returns a payload shaped for the `/api/ai/status` route:
    ``{"ollama_available": bool, "active_backend": "ollama"|"demo"|"none"}``.
    """
    settings = get_settings()
    if settings.demo_mode:
        return {"ollama_available": False, "active_backend": "demo"}

    ollama_ok = False
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get(f"{settings.ollama_url.rstrip('/')}/api/tags")
            ollama_ok = r.status_code == 200
    except Exception as e:
        logger.debug("Ollama /api/tags probe failed: %s", e, exc_info=True)

    return {
        "ollama_available": ollama_ok,
        "active_backend": "ollama" if ollama_ok else "none",
    }
