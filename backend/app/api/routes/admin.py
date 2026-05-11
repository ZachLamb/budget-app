"""Admin endpoints: list users + approve / reject for the preview-app gate.

All routes here are gated on ``require_admin`` (i.e. role="admin"). Admin
role is granted only via the ``ADMIN_EMAIL`` setting bootstrap — there's
no in-app promote-to-admin action, by design. Keeps the blast radius of
a compromised non-admin account small.

Endpoints:
- ``GET  /api/admin/users?status=...``     List users, optional status filter.
- ``POST /api/admin/users/{id}/approve``  Flip status → "approved".
- ``POST /api/admin/users/{id}/reject``   Flip status → "rejected".

The admin can't modify their OWN status (avoid the foot-gun of locking
themselves out). They also can't approve/reject users in their own
household differently — the gate is system-wide.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from pydantic import BaseModel
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin
from app.database import get_db
from app.models import User

logger = logging.getLogger(__name__)
router = APIRouter()


class AdminUserItem(BaseModel):
    """Schema for an admin listing of a user. Includes status and role so the
    admin UI can render filtering + role badges."""

    id: str
    email: str
    name: str
    role: str
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


@router.get("/users", response_model=list[AdminUserItem])
async def list_users(
    status_filter: Optional[Literal["pending", "approved", "rejected"]] = Query(
        None,
        alias="status",
        description="Filter by status. Omit to return all users.",
    ),
    _admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> list[AdminUserItem]:
    """Return all users, newest first. Optional status filter for the
    common "show me pending users" admin workflow."""
    q = select(User).order_by(desc(User.created_at))
    if status_filter is not None:
        q = q.where(User.status == status_filter)
    res = await db.execute(q)
    return [AdminUserItem.model_validate(u) for u in res.scalars().all()]


async def _set_status(
    db: AsyncSession,
    admin: User,
    user_id: str,
    new_status: str,
) -> AdminUserItem:
    """Shared logic for approve / reject. Guards against the admin
    accidentally locking themselves out by changing their own status."""
    if user_id == admin.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You can't change your own approval status.",
        )
    res = await db.execute(select(User).where(User.id == user_id))
    user = res.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.status == new_status:
        # Idempotent — return current state without committing.
        return AdminUserItem.model_validate(user)
    user.status = new_status
    await db.commit()
    await db.refresh(user)
    logger.info(
        "admin_user_status_change admin=%s target=%s new_status=%s",
        admin.id,
        user.id,
        new_status,
    )
    return AdminUserItem.model_validate(user)


@router.post("/users/{user_id}/approve", response_model=AdminUserItem)
async def approve_user(
    user_id: str = Path(..., min_length=1, max_length=64),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> AdminUserItem:
    """Flip the user's status to ``approved``. The next login attempt
    (any path) will succeed instead of 403'ing."""
    return await _set_status(db, admin, user_id, "approved")


@router.post("/users/{user_id}/reject", response_model=AdminUserItem)
async def reject_user(
    user_id: str = Path(..., min_length=1, max_length=64),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> AdminUserItem:
    """Flip the user's status to ``rejected``. They keep their account row
    but can never log in until an admin re-approves. Useful to deny without
    permanently deleting (audit trail + appeal path)."""
    return await _set_status(db, admin, user_id, "rejected")
