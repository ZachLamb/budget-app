from __future__ import annotations

"""Privacy-preserving audit log for AI calls.

Logs metadata only — user_id, feature, tier, tokens, latency, status, model,
cache_hit. **Never logs prompt text or completion text.** Failures to write
the audit row are logged but do not affect the request outcome.
"""

import logging
from typing import Optional

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.llm import LlmAudit

logger = logging.getLogger(__name__)


async def write(
    db: AsyncSession,
    *,
    user_id: str,
    feature: str,
    tier: int,
    status: int,
    prompt_tokens: Optional[int] = None,
    completion_tokens: Optional[int] = None,
    latency_ms: Optional[int] = None,
    model: Optional[str] = None,
    cache_hit: bool = False,
) -> None:
    row = LlmAudit(
        user_id=user_id,
        feature=feature,
        tier=tier,
        status=status,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        latency_ms=latency_ms,
        model=model,
        cache_hit=cache_hit,
    )
    try:
        db.add(row)
        await db.commit()
    except SQLAlchemyError as e:
        # Audit failure must not break the user's request. Log and roll back.
        logger.warning("llm_audit insert failed: %s", e)
        try:
            await db.rollback()
        except SQLAlchemyError:
            pass
