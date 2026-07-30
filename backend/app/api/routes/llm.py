from __future__ import annotations

"""Cloud LLM consent CRUD and opt-in Tier 4 generate proxy."""

import asyncio
import json
import logging
import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.config import get_settings
from app.database import async_session, get_db
from app.models.household import Household
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


async def _write_stream_audit(
    *,
    user_id: str,
    feature: str,
    status_code: int,
    prompt: str,
    completion: str,
    t_request: float,
    model: Optional[str],
) -> None:
    """Write the Tier-4 audit row after the stream ends. Never raises.

    Deliberately opens its own session instead of reusing the request's: when
    the client disconnects mid-stream the request session is already being torn
    down and rolled back, so the row would be lost in precisely the case the
    audit log needs to record. A failed audit write is logged and dropped — it
    must never turn into an error for the user.
    """
    try:
        async with async_session() as session:
            await audit.write(
                session,
                user_id=user_id,
                feature=feature,
                tier=4,
                status=status_code,
                prompt_tokens=_approx_tokens(prompt),
                completion_tokens=_approx_tokens(completion),
                latency_ms=int((time.perf_counter() - t_request) * 1000),
                model=model,
                cache_hit=False,
            )
    except Exception as e:  # pragma: no cover — defensive
        logger.warning("cloud_generate audit write failed: %s", type(e).__name__)


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

    # "prefer local server" is blanket consent for this tier ONLY when the server
    # is verifiably loopback/private — i.e. data stays on the user's machine/LAN.
    # A remote LLM_BACKEND_URL falls back to requiring explicit per-feature consent
    # so financial data can't leave the machine under a "private" opt-in.
    prefer_local = False
    if user.household_id:
        household = (
            await db.execute(
                select(Household).where(Household.id == user.household_id)
            )
        ).scalar_one_or_none()
        prefer_local = bool(household and household.prefer_local_server)
    blanket_consent = prefer_local and llm_client.is_local_backend_url(
        get_settings().ollama_url
    )

    if not blanket_consent and not await consent_service.has_active_consent(
        db, user.id, body.feature
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cloud AI not authorized for this feature. Grant consent first.",
        )

    system_prompt = sanitize_user_text(body.system or "", max_len=2_000) if body.system else ""
    # The prompt carries interpolated user-authored text (payee names, memos)
    # assembled client-side, so it gets the same structural cleaning as the
    # system prompt. The cap matches the field's own max_length.
    user_prompt = sanitize_user_text(body.prompt, max_len=8_000)
    if not user_prompt:
        # Literal 422 — starlette's HTTP_422_UNPROCESSABLE_ENTITY is deprecated
        # and its replacement isn't in every supported version.
        raise HTTPException(
            status_code=422,
            detail="Prompt is empty after sanitization.",
        )
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
        except llm_client.LlmStreamError:
            status_code = 502
            logger.warning("cloud_generate stream failed")
            yield _sse({"error": "Cloud AI stream interrupted or unavailable."})
        except (asyncio.CancelledError, GeneratorExit):
            # Client hung up mid-stream (pressed Stop, closed the tab). Both
            # forms show up in practice: Starlette cancels the request task, and
            # closing the generator raises GeneratorExit at the yield. Neither is
            # an `Exception` subclass, so both need naming explicitly. Record the
            # disconnect, then let it propagate.
            status_code = 499
            raise
        except Exception as e:
            status_code = 500
            logger.warning("cloud_generate failed: %s", type(e).__name__)
            yield _sse({"error": "Cloud AI request failed."})
        finally:
            # Runs on every exit path, disconnects included — a cancelled
            # request is one the model server still did work for, so it belongs
            # in the audit log. `_write_stream_audit` opens its own session
            # (the request's is being torn down by now) and never raises.
            #
            # `shield` is belt-and-braces: the first cancellation is already
            # delivered by the time we get here, but uvicorn can cancel again on
            # a shutdown timeout, and that would abandon the write mid-flight.
            await asyncio.shield(
                _write_stream_audit(
                    user_id=user.id,
                    feature=body.feature,
                    status_code=status_code,
                    prompt=user_prompt,
                    completion="".join(completion_buf),
                    t_request=t_request,
                    model=model_name,
                )
            )

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


class BackendStatusResponse(BaseModel):
    """State of the configured OpenAI-compatible model server (LM Studio, Ollama…)."""

    configured: bool
    reachable: bool
    active_model: Optional[str] = None
    models: list[str] = []
    # True only when the server resolves to a loopback/private address. When
    # false the server is remote — data would leave the machine — so the local
    # tier is not blanket-consented and the UI must not call it "private".
    is_local: bool = False


@router.get("/backend-status", response_model=BackendStatusResponse)
async def backend_status(
    user: User = Depends(get_current_user),
):
    """Report whether the local/self-hosted model server is set up and reachable.

    Powers the Settings display ("Local server: connected — gemma-3-12b") and lets
    the client decide whether the local-server tier can be offered.
    """
    settings = get_settings()
    probe = await llm_client.probe_backend()
    return BackendStatusResponse(
        configured=probe["configured"],
        reachable=probe["reachable"],
        active_model=settings.ollama_model or None,
        models=probe["models"],
        is_local=probe.get("is_local", False),
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
