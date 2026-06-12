"""Session JWT minting — shared by every login path (password, passkey,
Google, magic-link, demo). Lives in services to avoid route-module cycles."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import jwt

from app.config import get_settings
from app.models.user import User

ALGORITHM = "HS256"
SESSION_TTL = timedelta(days=30)


def create_session_token(user: User) -> str:
    expire = datetime.now(timezone.utc) + SESSION_TTL
    return jwt.encode(
        {"sub": user.id, "exp": expire, "sv": user.session_version},
        get_settings().secret_key,
        algorithm=ALGORITHM,
    )
