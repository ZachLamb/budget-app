from __future__ import annotations

from typing import Optional

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import jwt
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.config import get_settings
from app.models.user import User
from app.services.auth.admin_gate import check_approved
from app.services.auth.session_cookie import COOKIE_NAME

# auto_error=False: don't raise when the Authorization header is absent.
# We need to read the cookie first and only fall back to the header.
# get_current_user raises 401 itself if neither source produces a token.
security = HTTPBearer(auto_error=False)

ALGORITHM = "HS256"


async def get_current_user_any_status(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Resolve the current user from session cookie OR Authorization header,
    WITHOUT the approval-status gate.

    Cookie-first because that's the secure path. Header is the legacy
    fallback used by curl, mobile clients, and any old browser session
    that hasn't logged in again since the cookie migration shipped.

    Only ``/auth/me`` should use this directly — it lets a pending user see
    their own status so the frontend can render an "awaiting approval" page.
    Every data route must depend on ``get_current_user`` instead.
    """
    token: Optional[str] = request.cookies.get(COOKIE_NAME)
    if not token and credentials is not None:
        token = credentials.credentials
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    try:
        payload = jwt.decode(
            token,
            get_settings().secret_key,
            algorithms=[ALGORITHM],
            options={"require": ["exp", "sub"]},
        )
        user_id: str = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
        token_sv = payload.get("sv")
    except jwt.PyJWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    # Tokens issued before session_version was added have no ``sv`` claim — treat
    # as version 0 so existing sessions survive the migration until re-login.
    expected_sv = 0 if token_sv is None else int(token_sv)
    if user.session_version != expected_sv:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired")
    return user


async def get_current_user(
    user: User = Depends(get_current_user_any_status),
) -> User:
    """Authenticated AND approved user — the default auth dependency."""
    check_approved(user)
    return user


def get_household_id(user: User = Depends(get_current_user)) -> str:
    return user.household_id


def require_admin(user: User = Depends(get_current_user)) -> User:
    """Gate a route on role="admin". 403 if the caller isn't an admin.

    Use as a route dependency: ``user: User = Depends(require_admin)``. The
    admin role is bootstrapped via settings.admin_email (see
    services.auth.admin_gate) — there's no in-app promote-to-admin action,
    by design (the env var is the only way to gain admin, which keeps the
    blast radius of a compromised non-admin account small).
    """
    if user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return user
