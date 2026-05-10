"""Session cookie helpers for httpOnly + SameSite=Strict auth.

The app is moving from "JWT in localStorage + Authorization: Bearer header"
to "JWT in httpOnly cookie." Reasons:

- localStorage is reachable from any JavaScript that runs on the page. Any
  XSS bug becomes an account-takeover. httpOnly cookies are not reachable
  from JS at all, so XSS no longer = stolen session.
- SameSite=Strict means the browser will not attach the cookie to any
  cross-origin request — that's the primary CSRF mitigation. We also do an
  explicit Origin/Referer check on state-changing routes for defense in
  depth (see ``app.middleware.origin_check``).

We dual-stack with header-based auth during the transition. ``get_current_user``
reads from the cookie first, falls back to the Authorization header.
Any non-browser client (curl, mobile, server-to-server) keeps working
through the header until we explicitly remove it later.

Cookie attributes:
  - name: ``session``
  - HttpOnly: True (JS cannot read it)
  - Secure: True over HTTPS, False on http://localhost dev
  - SameSite: ``strict``
  - Path: ``/``
  - Max-Age: matches the JWT's 30-day exp window
"""
from __future__ import annotations

from fastapi import Response

from app.config import get_settings

#: Single source of truth for the cookie name. Used by routes that set/clear
#: it AND by ``deps.get_current_user`` when reading it.
COOKIE_NAME = "session"

#: Matches ``_create_token`` in ``app.api.routes.auth`` (30 days).
DEFAULT_MAX_AGE_SECONDS = 30 * 24 * 3600


def _is_secure_context() -> bool:
    """True when the configured frontend is HTTPS.

    The browser silently discards ``Secure`` cookies sent over plain HTTP.
    In local dev the frontend is ``http://localhost:3001`` and we MUST omit
    Secure or the user can never log in. In prod the frontend is HTTPS and
    we want Secure on.
    """
    return get_settings().frontend_url.lower().startswith("https://")


def set_session_cookie(
    response: Response,
    token: str,
    *,
    max_age: int = DEFAULT_MAX_AGE_SECONDS,
) -> None:
    """Attach the session cookie to ``response``.

    Call this from any route that mints a fresh JWT (login, register,
    Google OAuth callback, passkey verify, demo-login).
    """
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        secure=_is_secure_context(),
        samesite="strict",
        max_age=max_age,
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    """Tell the browser to drop the session cookie.

    Used by ``POST /api/auth/logout``. Cookie attributes must match the
    ones used at set-time (Path + Domain + Secure + SameSite) or the
    delete-cookie no-ops in some browsers.
    """
    response.delete_cookie(
        key=COOKIE_NAME,
        path="/",
        httponly=True,
        secure=_is_secure_context(),
        samesite="strict",
    )
