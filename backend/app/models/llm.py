from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import String, DateTime, ForeignKey, Integer, Index, BigInteger
from sqlalchemy.orm import Mapped, mapped_column, relationship


# SQLite doesn't autoincrement BIGINT. Map BIGINT primary keys to INTEGER on
# SQLite (used in tests) so autoincrement works there too.
_BigPK = BigInteger().with_variant(Integer(), "sqlite")

from app.database import Base


class LlmConsent(Base):
    """Per-user, per-feature consent for cloud (Tier 4) AI calls.

    A row exists once a user has granted cloud consent for a feature; we
    update ``revoked_at`` on revoke instead of deleting so the audit trail
    survives. The application checks ``revoked_at IS NULL`` for "active".
    """

    __tablename__ = "llm_consent"

    id: Mapped[int] = mapped_column(_BigPK, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    feature: Mapped[str] = mapped_column(String(64), nullable=False)
    tier: Mapped[int] = mapped_column(Integer, nullable=False, default=4)
    granted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    # Cloud (Tier 4) consent expires after a window (default 90 days) and the
    # user must re-affirm to keep using the feature. Nullable so that any
    # legacy row that slips through unmigrated is treated as "no expiry"
    # rather than silently broken; new rows always populate this column.
    expires_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )

    user = relationship("User")

    __table_args__ = (
        Index("ix_llm_consent_user_feature", "user_id", "feature"),
    )


class LlmAudit(Base):
    """Privacy-preserving audit log for AI calls.

    Records WHO used WHICH feature on WHICH tier, with token + latency
    metadata. **Does not store prompt or completion text.** Retention is
    handled out-of-band (a periodic delete query keeps the last 30 days).
    """

    __tablename__ = "llm_audit"

    id: Mapped[int] = mapped_column(_BigPK, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    feature: Mapped[str] = mapped_column(String(64), nullable=False)
    tier: Mapped[int] = mapped_column(Integer, nullable=False)
    prompt_tokens: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    completion_tokens: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    latency_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    status: Mapped[int] = mapped_column(Integer, nullable=False)
    model: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    cache_hit: Mapped[bool] = mapped_column(default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc), index=True
    )
