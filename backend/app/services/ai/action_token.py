"""Single-use confirmation tokens for AI data-entry actions.

``/advisor-turn`` and ``/parse-action`` are the LLM-gated routes that decide an
action intent exists; ``/execute-action`` performs the write. Without a token,
``/execute-action`` would be an ungated mutation endpoint any authenticated
client could call with arbitrary payloads. The token proves the write follows
a server-side parse for the same household and action type, and is single-use.

Field-level edits between parse and execute are allowed by design (the user
can correct the LLM's extraction before confirming); the executed data is
re-validated in ``execute_parsed_action``.
"""
from __future__ import annotations

import json
import secrets

from app.services.auth.challenges import get_store

ACTION_TOKEN_TTL = 600  # seconds — generous, the user may edit fields first

_KEY_PREFIX = "ai:action:"


async def issue_action_token(household_id: str, action_type: str) -> str:
    token = secrets.token_urlsafe(32)
    payload = json.dumps({"household_id": household_id, "action_type": action_type})
    await get_store().set(f"{_KEY_PREFIX}{token}", payload, ACTION_TOKEN_TTL)
    return token


async def redeem_action_token(token: str, household_id: str, action_type: str) -> bool:
    """Consume the token; True only if it matches the household and action type."""
    if not token:
        return False
    raw = await get_store().get_del(f"{_KEY_PREFIX}{token}")
    if not raw:
        return False
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return False
    return (
        data.get("household_id") == household_id
        and data.get("action_type") == action_type
    )
