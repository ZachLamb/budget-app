from __future__ import annotations

"""Cloud LLM consent CRUD (legacy table preserved; cloud generate removed).

Consent rows are no longer written by the app in normal use — on-device AI
does not require server consent. These endpoints remain for existing grants
and admin tooling until Phase 3 drops the tables.
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.user import User
from app.services.ai import consent as consent_service

router = APIRouter()


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
