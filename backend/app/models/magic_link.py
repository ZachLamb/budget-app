from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


# SQLite doesn't autoincrement BIGINT — same trick used for llm_consent/audit.
_BigPK = BigInteger().with_variant(Integer(), "sqlite")


class MagicLink(Base):
    """One-time sign-in token sent to a user's email.

    Lifecycle:
      - Created by ``POST /api/auth/magic-link/request``: token generated,
        SHA-256 hash stored (never the plaintext), expires_at = now + 15 min.
      - Redeemed by ``GET /api/auth/magic-link/verify``: ``used_at`` set on
        first hit, second hit fails (single-use).
      - Pruned out-of-band: rows older than 7 days are deleted by a
        scheduled job to keep the table small.

    Security notes:
      - Only the SHA-256 hash of the token is stored. DB compromise doesn't
        reveal valid tokens.
      - Tokens are 32 random bytes (256-bit) URL-safe base64. Brute-force
        infeasible at sane request rates; rate limiting covers the rest.
      - ``revoked_at`` lets us invalidate all outstanding tokens for a
        user at once (e.g., on account-takeover suspicion).
    """

    __tablename__ = "magic_links"

    id: Mapped[int] = mapped_column(_BigPK, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # SHA-256 hex digest of the URL-safe token. Lookup happens by hash, so
    # raw tokens never round-trip to the DB after issuance.
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    # IP that requested the link — for abuse forensics. Stored as a string
    # to handle both IPv4 and IPv6; redacted/dropped on prune.
    requested_from_ip: Mapped[Optional[str]] = mapped_column(String(45), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    used_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    user = relationship("User")

    __table_args__ = (
        Index("ix_magic_links_user_created", "user_id", "created_at"),
    )
