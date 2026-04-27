from __future__ import annotations

"""Tiered LLM cloud endpoint.

POST /api/llm/cloud — streaming SSE proxy to the upstream model (Ollama in
dev, Modal vLLM in prod). Auth + per-feature consent + per-user rate limit
+ content cache + circuit breaker + privacy-preserving audit.

GET    /api/llm/consent             — list grants for the current user
POST   /api/llm/consent             — grant cloud consent for one feature
DELETE /api/llm/consent             — revoke ALL cloud consent + purge cache
DELETE /api/llm/consent/{feature}   — revoke one feature
"""

import json
import logging
import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.config import get_settings
from app.database import get_db
from app.models.user import User
from app.services.ai import audit, cache, circuit
from app.services.ai import consent as consent_service
from app.services.ai import llm_client, llm_rate_limit
from app.services.ai.prompt_safety import sanitize_user_text

logger = logging.getLogger(__name__)

router = APIRouter()


# ── Schemas ───────────────────────────────────────────────────────────────────


class CloudGenerateRequest(BaseModel):
    feature: str = Field(..., min_length=1, max_length=64)
    prompt: str = Field(..., min_length=1, max_length=8_000)
    system: Optional[str] = Field(default=None, max_length=2_000)
    maxTokens: Optional[int] = Field(default=512, ge=1, le=2_048)

    @field_validator("feature")
    @classmethod
    def _known_feature(cls, v: str) -> str:
        if not consent_service.is_known_feature(v):
            raise ValueError("Unknown feature")
        return v


class ConsentGrantRequest(BaseModel):
    feature: str = Field(..., min_length=1, max_length=64)
    tier: int = Field(default=4, ge=4, le=4)


class ConsentResponse(BaseModel):
    id: int
    feature: str
    tier: int
    grantedAt: str
    revokedAt: Optional[str]


# ── Cloud generate ────────────────────────────────────────────────────────────


def _sse(data: dict) -> bytes:
    return f"data: {json.dumps(data, separators=(',', ':'))}\n\n".encode("utf-8")


def _approx_tokens(text: str) -> int:
    # Crude approximation — we don't have the tokenizer at this layer.
    # 4 chars per token is a reasonable English-text estimate.
    return max(1, len(text) // 4)


@router.post("/cloud")
async def cloud_generate(
    body: CloudGenerateRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    """Stream a Tier 4 (cloud) completion. Requires per-feature consent."""

    # 1. Consent gate — server-authoritative; client-side check is informational.
    if not await consent_service.has_active_consent(db, user.id, body.feature):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cloud AI not authorized for this feature. Grant consent first.",
        )

    # 2. Circuit breaker — global cost cap.
    try:
        if await circuit.is_open(db):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Cloud AI is temporarily unavailable due to high load. Try again shortly.",
            )
    except HTTPException:
        raise
    except Exception as e:
        # Failure to check the breaker should not block the request — log and continue.
        logger.warning("circuit check failed: %s", e)

    # 3. Per-user daily rate limit.
    store = request.app.state.rate_limit_store
    try:
        await llm_rate_limit.check_and_charge(store, user.id)
    except llm_rate_limit.RateLimitExceeded as e:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Daily cloud AI limit reached ({e.limit}). Resets in 24h.",
        ) from e

    # 4. Sanitize the system prompt; the user-supplied prompt is enforced at the
    # input schema (length cap). System prompts are limited but treated as potentially
    # user-influenced in the future.
    system_prompt = sanitize_user_text(body.system or "", max_len=2_000) if body.system else ""
    user_prompt = body.prompt  # Already capped to 8000 chars by Pydantic.

    settings = get_settings()
    model_name = settings.ollama_model

    # 5. Cache lookup (per user + content hash). Stream the cached value as one chunk.
    cached = await cache.get(user.id, body.feature, system_prompt, user_prompt)
    if cached is not None:
        async def cached_iter():
            t0 = time.perf_counter()
            yield _sse({"chunk": cached})
            yield _sse({"done": True, "cached": True})
            await audit.write(
                db,
                user_id=user.id,
                feature=body.feature,
                tier=4,
                status=200,
                prompt_tokens=_approx_tokens(user_prompt),
                completion_tokens=_approx_tokens(cached),
                latency_ms=int((time.perf_counter() - t0) * 1000),
                model=model_name,
                cache_hit=True,
            )

        return StreamingResponse(
            cached_iter(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    # 6. Live call — stream from Ollama (dev) / vLLM-on-Modal (prod, when LLM_BACKEND_URL is set).
    async def gen():
        t0 = time.perf_counter()
        completion_buf: list[str] = []
        try:
            async for chunk, _src in llm_client.stream_complete_with_source(user_prompt, system_prompt or None):
                completion_buf.append(chunk)
                yield _sse({"chunk": chunk})
            yield _sse({"done": True})
            full = "".join(completion_buf)
            await cache.set(user.id, body.feature, system_prompt, user_prompt, full)
            await audit.write(
                db,
                user_id=user.id,
                feature=body.feature,
                tier=4,
                status=200,
                prompt_tokens=_approx_tokens(user_prompt),
                completion_tokens=_approx_tokens(full),
                latency_ms=int((time.perf_counter() - t0) * 1000),
                model=model_name,
                cache_hit=False,
            )
        except Exception as e:
            logger.warning("cloud_generate stream error: %s", e)
            yield _sse({"error": "Stream interrupted."})
            await audit.write(
                db,
                user_id=user.id,
                feature=body.feature,
                tier=4,
                status=500,
                latency_ms=int((time.perf_counter() - t0) * 1000),
                model=model_name,
                cache_hit=False,
            )

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Consent endpoints ─────────────────────────────────────────────────────────


def _to_response(row) -> ConsentResponse:
    return ConsentResponse(
        id=row.id,
        feature=row.feature,
        tier=row.tier,
        grantedAt=row.granted_at.isoformat(),
        revokedAt=row.revoked_at.isoformat() if row.revoked_at else None,
    )


@router.get("/consent", response_model=list[ConsentResponse])
async def list_consent(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = await consent_service.list_for_user(db, user.id)
    return [_to_response(r) for r in rows]


@router.post("/consent", response_model=ConsentResponse, status_code=status.HTTP_201_CREATED)
async def grant_consent(
    body: ConsentGrantRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not consent_service.is_known_feature(body.feature):
        raise HTTPException(status_code=400, detail="Unknown feature")
    row = await consent_service.grant_consent(db, user.id, body.feature, tier=body.tier)
    return _to_response(row)


@router.delete("/consent/{feature}")
async def revoke_one(
    feature: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not consent_service.is_known_feature(feature):
        raise HTTPException(status_code=400, detail="Unknown feature")
    n = await consent_service.revoke_consent(db, user.id, feature)
    # Purge cache for this feature too — best-effort.
    await cache.purge_user(user.id)
    return {"ok": True, "revoked": n}


@router.delete("/consent")
async def revoke_all(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    n = await consent_service.revoke_all(db, user.id)
    await cache.purge_user(user.id)
    return {"ok": True, "revoked": n}
