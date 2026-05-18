from __future__ import annotations

"""Cloud (Tier 4) consent helpers.

Consent is per-(user, feature). A row is created on grant; revocation
flips ``revoked_at``. ``has_active_consent`` checks both states.
"""

from datetime import datetime, timedelta, timezone
from typing import Iterable, Optional, Sequence

from sqlalchemy import and_, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.llm import LlmConsent

# Cloud consent grants expire after this window and must be re-affirmed.
# 90 days is a common privacy-regime default (re-consent cadence).
DEFAULT_EXPIRATION_DAYS = 90

# Default look-ahead for the renewal-window UI affordance ("Renew" button).
DEFAULT_RENEWAL_WINDOW_DAYS = 7

_ALLOWED_FEATURES: frozenset[str] = frozenset(
    {
        "explain_charge",
        "categorize_transaction",
        "spending_summary",
        "anomaly_explanation",
        "budget_recommendations",
        "goal_planning",
        "free_form_qa",
        "financial_advice",
        "fsa_review",
    }
)


def is_known_feature(feature: str) -> bool:
    return feature in _ALLOWED_FEATURES


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _new_expiry(now: Optional[datetime] = None) -> datetime:
    return (now or _now()) + timedelta(days=DEFAULT_EXPIRATION_DAYS)


def _as_utc(dt: datetime) -> datetime:
    """Coerce a (possibly tz-naive) datetime to UTC.

    SQLite drops tzinfo on read even when the column is ``DateTime(timezone=True)``,
    so we treat any naive value coming back as already-UTC. Postgres preserves
    tzinfo so this is a no-op there.
    """
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def is_within_renewal_window(
    grant: LlmConsent, days: int = DEFAULT_RENEWAL_WINDOW_DAYS
) -> bool:
    """Return True if the grant is active and within ``days`` of expiring.

    A grant that is already expired or revoked is *not* in the renewal
    window — its UI affordance is "Re-grant," not "Renew." A grant with
    no expiration (legacy/unmigrated row) never enters the renewal window.
    """
    if grant.revoked_at is not None:
        return False
    if grant.expires_at is None:
        return False
    now = _now()
    expires = _as_utc(grant.expires_at)
    if expires <= now:
        return False
    return expires - now <= timedelta(days=days)


async def has_active_consent(db: AsyncSession, user_id: str, feature: str) -> bool:
    if not is_known_feature(feature):
        return False
    now = _now()
    row = await db.execute(
        select(LlmConsent.id).where(
            and_(
                LlmConsent.user_id == user_id,
                LlmConsent.feature == feature,
                LlmConsent.revoked_at.is_(None),
                # Treat NULL expires_at as "no expiry" (back-compat for any
                # row that slipped through unmigrated). Real grants always
                # populate expires_at via grant_consent.
                or_(
                    LlmConsent.expires_at.is_(None),
                    LlmConsent.expires_at > now,
                ),
            )
        )
    )
    return row.scalar_one_or_none() is not None


async def grant_consent(db: AsyncSession, user_id: str, feature: str, tier: int = 4) -> LlmConsent:
    if not is_known_feature(feature):
        raise ValueError(f"Unknown feature: {feature}")
    # Re-activate any revoked grant for the same (user, feature) before creating a new row.
    existing = await db.execute(
        select(LlmConsent).where(
            and_(LlmConsent.user_id == user_id, LlmConsent.feature == feature)
        )
    )
    rows = list(existing.scalars())
    now = _now()
    new_expiry = _new_expiry(now)
    active = next((r for r in rows if r.revoked_at is None), None)
    if active is not None:
        # Idempotent grant on an active row resets the expiry window. This
        # is also the path that powers the "Renew" button — calling
        # grant_consent on an active-but-expiring grant pushes expires_at
        # forward another 90 days.
        active.expires_at = new_expiry
        await db.commit()
        await db.refresh(active)
        return active
    revoked = next(iter(rows), None)
    if revoked is not None:
        revoked.revoked_at = None
        revoked.granted_at = now
        revoked.tier = tier
        revoked.expires_at = new_expiry
        await db.commit()
        await db.refresh(revoked)
        return revoked
    row = LlmConsent(user_id=user_id, feature=feature, tier=tier, expires_at=new_expiry)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


async def revoke_consent(db: AsyncSession, user_id: str, feature: str) -> int:
    """Revoke active consent for a single feature. Returns rows affected."""
    res = await db.execute(
        update(LlmConsent)
        .where(
            and_(
                LlmConsent.user_id == user_id,
                LlmConsent.feature == feature,
                LlmConsent.revoked_at.is_(None),
            )
        )
        .values(revoked_at=datetime.now(timezone.utc))
    )
    await db.commit()
    return int(res.rowcount or 0)


async def revoke_all(db: AsyncSession, user_id: str) -> int:
    res = await db.execute(
        update(LlmConsent)
        .where(and_(LlmConsent.user_id == user_id, LlmConsent.revoked_at.is_(None)))
        .values(revoked_at=datetime.now(timezone.utc))
    )
    await db.commit()
    return int(res.rowcount or 0)


async def list_for_user(db: AsyncSession, user_id: str) -> Sequence[LlmConsent]:
    rows = await db.execute(
        select(LlmConsent).where(LlmConsent.user_id == user_id).order_by(LlmConsent.granted_at.desc())
    )
    return list(rows.scalars())


def known_features() -> Iterable[str]:
    return iter(_ALLOWED_FEATURES)
