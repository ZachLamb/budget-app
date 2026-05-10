from __future__ import annotations

"""Dependencies that bring legacy AI routes under the tiered LLM consent +
audit umbrella.

The newer ``/api/llm/cloud`` endpoint already gates on per-feature consent +
per-user daily rate limit + audit. The legacy ``/api/ai/*`` and
``/api/categorization/*`` routes pre-date that work and historically called
Ollama directly. Wrapping them with the same gate without rewriting the
handler bodies is the goal of this module.

Use ``require_cloud_feature(feature_id)`` as a FastAPI dependency on a route
that calls an LLM. It:
    1. Resolves the current user (reusing ``get_current_user``).
    2. Verifies the household has AI enabled (reusing ``_require_ai_enabled``).
    3. Checks per-(user, feature) consent (403 if missing).
    4. Charges the per-user daily rate limit (429 if over).

It returns an ``LlmCallContext`` with the bits the route needs to write a
metadata-only audit row at the end of the request — see ``write_audit``.
"""

import logging
import time
from dataclasses import dataclass
from typing import Optional

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.config import get_settings
from app.database import get_db
from app.middleware.rate_limit_store import RateLimitStore
from app.models.user import User
from app.services.ai import audit as audit_service
from app.services.ai import consent as consent_service
from app.services.ai import llm_rate_limit

logger = logging.getLogger(__name__)


@dataclass
class LlmCallContext:
    """Per-request bag of LLM gating context handed to legacy routes.

    ``user_id`` and ``household_id`` are surfaced for ergonomic access in
    handlers that need them; the route can also pull the full ``User`` if
    needed.
    """

    user: User
    feature: str
    started_at: float

    @property
    def user_id(self) -> str:
        return self.user.id

    @property
    def household_id(self) -> str:
        return self.user.household_id


def _get_rate_limit_store(request: Request) -> RateLimitStore:
    """Typed accessor for the shared rate-limit store on app.state.

    Same pattern as in ``app.api.routes.llm`` — fail loudly if main.py was
    changed in a way that drops the store wiring.
    """
    store = getattr(request.app.state, "rate_limit_store", None)
    if store is None:  # pragma: no cover — only reachable on misconfigured app
        raise RuntimeError("rate_limit_store is not configured on app.state")
    return store


def require_cloud_feature(feature_id: str):
    """Build a FastAPI dependency that gates a route on per-(user, feature) consent
    and the per-user daily rate limit, then returns an ``LlmCallContext``.

    The household-level "AI enabled" check is intentionally left to the route's
    existing ``_require_ai_enabled`` dependency — composing it here would couple
    this module to a route-specific helper. The legacy routes already chain that
    in; we sit alongside it.
    """
    if not consent_service.is_known_feature(feature_id):
        raise ValueError(
            f"require_cloud_feature: unknown feature id {feature_id!r}; "
            f"add it to consent._ALLOWED_FEATURES first"
        )

    async def _dep(
        request: Request,
        user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ) -> LlmCallContext:
        # 1. Per-feature consent. 403 stays the canonical "not authorised"
        # response across the cloud + legacy surfaces — keep them in lockstep.
        if not await consent_service.has_active_consent(db, user.id, feature_id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    f"Cloud AI not authorized for '{feature_id}'. "
                    "Grant consent in Settings → Privacy first."
                ),
            )

        # 2. Per-user daily rate limit. Same store + key scheme as the cloud
        # endpoint, so the legacy and cloud surfaces share one budget rather
        # than letting a user double-spend by alternating between them.
        store = _get_rate_limit_store(request)
        try:
            await llm_rate_limit.check_and_charge(store, user.id)
        except llm_rate_limit.RateLimitExceeded as e:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Daily cloud AI limit reached ({e.limit}). Resets in 24h.",
            ) from e

        return LlmCallContext(
            user=user,
            feature=feature_id,
            started_at=time.perf_counter(),
        )

    return _dep


def _approx_tokens(text: Optional[str]) -> Optional[int]:
    """Crude 4-chars-per-token approximation. Mirrors ``app.api.routes.llm``."""
    if not text:
        return None
    return max(1, len(text) // 4)


async def write_audit(
    db: AsyncSession,
    ctx: LlmCallContext,
    *,
    status_code: int = 200,
    prompt_text: Optional[str] = None,
    completion_text: Optional[str] = None,
) -> None:
    """Metadata-only audit row for a legacy LLM call.

    Tier is hard-coded to 4 (the cloud tier) so legacy calls land in the same
    auditing bucket as the new ``/api/llm/cloud`` route. Token counts are
    approximated from text length — the route never logs the text itself.
    Failures of the underlying ``audit.write`` are swallowed inside the audit
    service, so this never breaks the user request.
    """
    settings = get_settings()
    latency_ms = int((time.perf_counter() - ctx.started_at) * 1000)
    await audit_service.write(
        db,
        user_id=ctx.user_id,
        feature=ctx.feature,
        tier=4,
        status=status_code,
        prompt_tokens=_approx_tokens(prompt_text),
        completion_tokens=_approx_tokens(completion_text),
        latency_ms=latency_ms,
        model=settings.ollama_model,
        cache_hit=False,
    )
