from __future__ import annotations

"""Cloud LLM consent CRUD and opt-in Tier 4 generate proxy."""

import json
import logging
import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.config import get_settings
from app.database import get_db
from app.models.user import User
from app.services.ai import audit
from app.services.ai import consent as consent_service
from app.services.ai import llm_client
from app.services.ai.prompt_safety import sanitize_user_text

logger = logging.getLogger(__name__)

router = APIRouter()


class CloudGenerateRequest(BaseModel):
    feature: str = Field(..., min_length=1, max_length=64)
    prompt: str = Field(..., min_length=1, max_length=8_000)
    system: Optional[str] = Field(default=None, max_length=2_000)
    max_tokens: int = Field(default=1024, ge=1, le=2_048, alias="maxTokens")

    model_config = {"populate_by_name": True}

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
    expiresAt: Optional[str] = None


def _to_response(row) -> ConsentResponse:
    return ConsentResponse(
        id=row.id,
        feature=row.feature,
        tier=row.tier,
        grantedAt=row.granted_at.isoformat(),
        revokedAt=row.revoked_at.isoformat() if row.revoked_at else None,
        expiresAt=row.expires_at.isoformat() if row.expires_at else None,
    )


def _sse(data: dict) -> bytes:
    return f"data: {json.dumps(data, separators=(',', ':'))}\n\n".encode("utf-8")


def _approx_tokens(text: str) -> int:
    return max(1, len(text) // 4)


@router.post("/cloud")
async def cloud_generate(
    body: CloudGenerateRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    """Stream a Tier 4 (opt-in cloud) completion. Requires per-feature consent."""
    t_request = time.perf_counter()

    if not llm_client.is_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Cloud AI is not configured on this server.",
        )

    if not await consent_service.has_active_consent(db, user.id, body.feature):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cloud AI not authorized for this feature. Grant consent first.",
        )

    system_prompt = sanitize_user_text(body.system or "", max_len=2_000) if body.system else ""
    user_prompt = body.prompt
    settings = get_settings()
    model_name = settings.ollama_model

    async def gen():
        completion_buf: list[str] = []
        status_code = 200
        try:
            async for chunk in llm_client.stream_complete(
                user_prompt,
                system_prompt or None,
                max_tokens=body.max_tokens,
            ):
                completion_buf.append(chunk)
                yield _sse({"content": chunk})
            if not completion_buf:
                status_code = 502
                yield _sse({"error": "Cloud model returned an empty response."})
            else:
                yield _sse({"done": True})
        except Exception as e:
            status_code = 500
            logger.warning("cloud_generate failed: %s", type(e).__name__)
            yield _sse({"error": "Cloud AI request failed."})
        finally:
            completion = "".join(completion_buf)
            await audit.write(
                db,
                user_id=user.id,
                feature=body.feature,
                tier=4,
                status=status_code,
                prompt_tokens=_approx_tokens(user_prompt),
                completion_tokens=_approx_tokens(completion),
                latency_ms=int((time.perf_counter() - t_request) * 1000),
                model=model_name,
                cache_hit=False,
            )

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
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
    return {"ok": True, "revoked": n}


@router.delete("/consent")
async def revoke_all(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    n = await consent_service.revoke_all(db, user.id)
    return {"ok": True, "revoked": n}
