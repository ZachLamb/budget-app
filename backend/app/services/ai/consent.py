from __future__ import annotations

"""Cloud (Tier 4) consent helpers.

Consent is per-(user, feature). A row is created on grant; revocation
flips ``revoked_at``. ``has_active_consent`` checks both states.
"""

from datetime import datetime, timezone
from typing import Iterable, Sequence

from sqlalchemy import and_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.llm import LlmConsent

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
    }
)


def is_known_feature(feature: str) -> bool:
    return feature in _ALLOWED_FEATURES


async def has_active_consent(db: AsyncSession, user_id: str, feature: str) -> bool:
    if not is_known_feature(feature):
        return False
    row = await db.execute(
        select(LlmConsent.id).where(
            and_(
                LlmConsent.user_id == user_id,
                LlmConsent.feature == feature,
                LlmConsent.revoked_at.is_(None),
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
    active = next((r for r in rows if r.revoked_at is None), None)
    if active is not None:
        return active
    revoked = next(iter(rows), None)
    if revoked is not None:
        revoked.revoked_at = None
        revoked.granted_at = datetime.now(timezone.utc)
        revoked.tier = tier
        await db.commit()
        await db.refresh(revoked)
        return revoked
    row = LlmConsent(user_id=user_id, feature=feature, tier=tier)
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
