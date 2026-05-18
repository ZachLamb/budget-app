"""OAuth login codes and WebAuthn challenge storage (shared across workers)."""
from __future__ import annotations

import json
import time
from typing import Any, Optional

from app.services.auth.ephemeral_store import EphemeralStore, build_ephemeral_store

_store: EphemeralStore = build_ephemeral_store()

OAUTH_LOGIN_CODE_TTL = 60
CHALLENGE_TTL = 300


def set_store(store: EphemeralStore) -> None:
    global _store
    _store = store


def get_store() -> EphemeralStore:
    return _store


# ── OAuth one-time login codes ────────────────────────────────────────────────


async def put_oauth_login_code(code: str, user_id: str) -> None:
    payload = json.dumps({"user_id": user_id, "issued_ts": time.time()})
    await _store.set(f"oauth:{code}", payload, OAUTH_LOGIN_CODE_TTL)


async def pop_oauth_login_code(code: str) -> Optional[str]:
    """Return user_id if code is valid and not expired, else None."""
    raw = await _store.get_del(f"oauth:{code}")
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    user_id = data.get("user_id")
    issued_ts = float(data.get("issued_ts", 0))
    if not user_id or time.time() - issued_ts > OAUTH_LOGIN_CODE_TTL:
        return None
    return str(user_id)


# ── Passkey registration (new account) ──────────────────────────────────────


async def put_passkey_registration_challenge(challenge_b64: str, pending: dict[str, Any]) -> None:
    await _store.set(
        f"passkey:reg:{challenge_b64}",
        json.dumps(pending),
        CHALLENGE_TTL,
    )


async def pop_passkey_registration_challenge(challenge_b64: str) -> Optional[dict[str, Any]]:
    raw = await _store.get_del(f"passkey:reg:{challenge_b64}")
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


# ── Passkey authentication (sign-in) ─────────────────────────────────────────


async def put_passkey_auth_challenge(challenge_b64: str) -> None:
    await _store.set(f"passkey:auth:{challenge_b64}", "1", CHALLENGE_TTL)


async def has_passkey_auth_challenge(challenge_b64: str) -> bool:
    return await _store.get(f"passkey:auth:{challenge_b64}") is not None


async def pop_passkey_auth_challenge(challenge_b64: str) -> bool:
    raw = await _store.get_del(f"passkey:auth:{challenge_b64}")
    return raw is not None


# ── Passkey add (authenticated user) ──────────────────────────────────────────


async def put_passkey_add_challenge(challenge_b64: str, user_id: str) -> None:
    await _store.set(f"passkey:add:{challenge_b64}", user_id, CHALLENGE_TTL)


async def pop_passkey_add_challenge(challenge_b64: str) -> Optional[str]:
    return await _store.get_del(f"passkey:add:{challenge_b64}")
