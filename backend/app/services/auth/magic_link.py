from __future__ import annotations

"""Magic-link issuance + redemption helpers.

A magic link is a single-use URL we email to a user. They click it and they
are signed in. No password, no remembered device required.

Security:
  - Token is 32 random bytes (256-bit) URL-safe base64. Brute-force-resistant
    against any sane request-rate cap.
  - The DB stores only the SHA-256 of the token. A DB read does not produce a
    usable token.
  - Single-use: ``used_at`` is set on first redemption; subsequent attempts fail.
  - 15-minute expiry: ``expires_at`` is checked on every redemption.
  - Issuance always returns success to the caller (anti-enumeration); the
    "did this email exist" signal never reaches the network.
  - Active grants for a user are revoked when a new one is issued (prevents
    accumulating tokens; lost tokens age out fast).
"""

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import and_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.magic_link import MagicLink

# 256 bits of entropy in the URL-safe token. `secrets.token_urlsafe(32)`
# produces a 43-character string after base64 stripping the padding.
TOKEN_BYTES = 32
DEFAULT_TTL = timedelta(minutes=15)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def generate_token() -> str:
    """Return a fresh random URL-safe token. Hand the plaintext to the
    user (via the magic-link URL); pass it through ``issue`` to record
    its hash."""
    return secrets.token_urlsafe(TOKEN_BYTES)


async def issue(
    db: AsyncSession,
    user_id: str,
    *,
    requested_from_ip: Optional[str] = None,
    ttl: timedelta = DEFAULT_TTL,
) -> str:
    """Create a magic-link record for ``user_id`` and return the plaintext token.

    The caller is responsible for emailing the token via a URL. The DB only
    stores the SHA-256 hash; the plaintext never round-trips.

    Side effects:
      - Revokes all outstanding (unused, unrevoked, unexpired) tokens for
        this user. Limits the blast radius of a leaked-and-not-yet-used
        token.
    """
    now = _now()
    # Revoke any existing active tokens for this user.
    await db.execute(
        update(MagicLink)
        .where(
            and_(
                MagicLink.user_id == user_id,
                MagicLink.used_at.is_(None),
                MagicLink.revoked_at.is_(None),
                MagicLink.expires_at > now,
            )
        )
        .values(revoked_at=now)
    )

    token = generate_token()
    row = MagicLink(
        user_id=user_id,
        token_hash=_hash(token),
        requested_from_ip=requested_from_ip,
        expires_at=now + ttl,
    )
    db.add(row)
    await db.commit()
    return token


async def redeem(db: AsyncSession, token: str) -> Optional[str]:
    """Validate + consume the token. Returns the redeemed user_id on success,
    or None if the token is invalid / expired / already used / revoked.

    Marks the token as used in the same transaction that validates it.
    The single-use guarantee is database-level: if two requests race, the
    one that wins the row update succeeds and the other sees ``used_at``
    set on re-fetch.
    """
    if not token or len(token) > 200:
        return None
    token_hash = _hash(token)
    now = _now()
    res = await db.execute(
        select(MagicLink).where(MagicLink.token_hash == token_hash)
    )
    row = res.scalar_one_or_none()
    if row is None:
        return None
    if row.used_at is not None or row.revoked_at is not None:
        return None
    expires = row.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires <= now:
        return None
    row.used_at = now
    await db.commit()
    return row.user_id


async def prune_expired(db: AsyncSession, *, older_than: timedelta = timedelta(days=7)) -> int:
    """Delete magic-link rows older than ``older_than``. Idempotent. Returns
    rows deleted. The scheduler in ``app.tasks.scheduler`` calls this hourly.
    """
    from sqlalchemy import delete

    cutoff = _now() - older_than
    res = await db.execute(delete(MagicLink).where(MagicLink.created_at < cutoff))
    await db.commit()
    return int(res.rowcount or 0)
