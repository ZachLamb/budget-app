from __future__ import annotations

from typing import Optional

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.config import get_settings
from app.models.user import User
from app.services.auth.session_cookie import COOKIE_NAME

# auto_error=False: don't raise when the Authorization header is absent.
# We need to read the cookie first and only fall back to the header.
# get_current_user raises 401 itself if neither source produces a token.
security = HTTPBearer(auto_error=False)

ALGORITHM = "HS256"


async def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Resolve the current user from session cookie OR Authorization header.

    Cookie-first because that's the secure path. Header is the legacy
    fallback used by curl, mobile clients, and any old browser session
    that hasn't logged in again since the cookie migration shipped.
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
            options={"require_exp": True, "require_sub": True},
        )
        user_id: str = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


def get_household_id(user: User = Depends(get_current_user)) -> str:
    return user.household_id
