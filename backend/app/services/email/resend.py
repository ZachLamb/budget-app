from __future__ import annotations

"""Thin Resend client.

We only need one thing: send transactional emails (currently just magic-link
sign-in). Resend's API is simple enough that pulling in their official SDK
would add more deps than value — a single httpx POST does it.

Errors here are logged but never re-raised: the magic-link request flow
ALWAYS returns 200 to the caller (anti-enumeration), so a Resend outage
should never reveal "this user exists but the email broke" to a probing
attacker.
"""

import logging
from dataclasses import dataclass
from typing import Optional

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

# Resend's REST API
_RESEND_API = "https://api.resend.com/emails"
_CONNECT_TIMEOUT = 2.0
_READ_TIMEOUT = 5.0


@dataclass
class EmailSendResult:
    ok: bool
    provider_id: Optional[str] = None
    error: Optional[str] = None


async def send_email(
    *,
    to: str,
    subject: str,
    text: str,
    html: Optional[str] = None,
) -> EmailSendResult:
    """Send a transactional email via Resend.

    Always returns a result — never raises. The provider id is the Resend
    message id, useful for log correlation with delivery webhooks.

    No request/response bodies are logged. The "subject" and recipient
    are deliberately omitted from logs too — the recipient is PII and
    the subject can leak content (e.g., "Sign in to Clarity from
    <city>"). Operators can correlate via provider_id if needed.
    """
    settings = get_settings()
    if not settings.resend_api_key:
        return EmailSendResult(ok=False, error="RESEND_API_KEY not configured")
    if not settings.email_from_address:
        return EmailSendResult(ok=False, error="EMAIL_FROM_ADDRESS not configured")

    payload: dict = {
        "from": settings.email_from_address,
        "to": [to],
        "subject": subject,
        "text": text,
    }
    if html is not None:
        payload["html"] = html

    headers = {
        "Authorization": f"Bearer {settings.resend_api_key}",
        "Content-Type": "application/json",
    }
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(_READ_TIMEOUT, connect=_CONNECT_TIMEOUT)
        ) as client:
            resp = await client.post(_RESEND_API, json=payload, headers=headers)
        if resp.status_code >= 400:
            # Status only; never echo the response body (can contain the recipient).
            logger.warning("resend_send_failed status=%s", resp.status_code)
            return EmailSendResult(ok=False, error=f"HTTP {resp.status_code}")
        body = resp.json() if resp.content else {}
        return EmailSendResult(ok=True, provider_id=str(body.get("id") or "") or None)
    except (httpx.ConnectError, httpx.TimeoutException) as e:
        logger.warning("resend_send_unreachable: %s", type(e).__name__)
        return EmailSendResult(ok=False, error="Resend unreachable")
    except Exception as e:  # pragma: no cover — defensive
        logger.warning("resend_send_error: %s", type(e).__name__)
        return EmailSendResult(ok=False, error="Send failed")
