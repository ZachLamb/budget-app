from __future__ import annotations

"""Magic-link sign-in routes.

POST /api/auth/magic-link/request — accept an email, generate a token,
  email it, ALWAYS return 200 (anti-enumeration).
GET  /api/auth/magic-link/verify — exchange the token for a session.
  Redeems single-use, sets the session cookie, redirects to the frontend.

Rate limiting:
  - Per-email cap (anti-spam): 3 requests/hour per email address.
  - Per-IP cap (anti-abuse): the existing IP-based middleware covers
    /api/auth/* generically.
  - Verify is single-use server-side; brute-forcing the 256-bit token is
    infeasible at any sane request rate.
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, Query, Request, Response, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import ALGORITHM  # noqa: F401  (used indirectly by _create_token)
from app.config import get_settings
from app.database import get_db
from app.models import User
from app.services.auth import magic_link as ml_service
from app.services.auth.session_cookie import set_session_cookie
from app.services.email import resend as email_service
from app.services.email.templates import magic_link as magic_link_email

logger = logging.getLogger(__name__)

router = APIRouter()


# ── Schemas ───────────────────────────────────────────────────────────────────


class MagicLinkRequest(BaseModel):
    email: EmailStr = Field(..., max_length=254)


class MagicLinkRequestResponse(BaseModel):
    """Always returned regardless of whether the email exists.

    Privacy: if a probing attacker enumerated "does this email exist on
    Clarity?" by trying both /register and /magic-link/request, the
    /register flow already returns 400 on duplicates. So the only place
    enumeration could leak today IS this route. ``ok=True`` always.
    """

    ok: bool = True


# ── POST /api/auth/magic-link/request ─────────────────────────────────────────


def _client_ip(request: Request) -> Optional[str]:
    """Conservative IP read for the audit field. The TRUSTED_PROXIES allowlist
    is enforced by the rate-limit middleware higher up; here we only record
    a best-effort identifier and the value is intentionally not used for
    authorization decisions."""
    return (request.client.host if request.client else None)


@router.post("/request", response_model=MagicLinkRequestResponse)
async def request_magic_link(
    data: MagicLinkRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Issue a magic link if the email maps to an existing user.

    ALWAYS returns 200 with ``{"ok": true}``. The response shape is
    identical whether or not the email exists in the DB. Combined with
    the existing per-IP rate limit on /api/auth/*, this denies the
    "enumerate which emails have accounts" oracle to any probing client.
    """
    email = data.email.lower().strip()
    settings = get_settings()

    res = await db.execute(select(User).where(User.email == email))
    user = res.scalar_one_or_none()

    if user is None:
        # Real users get an email. Probing requests don't. Same response either way.
        logger.info("magic_link_request unknown_email=%s", "<redacted>")
        return MagicLinkRequestResponse()

    # Issue token (revokes any prior outstanding token for this user).
    token = await ml_service.issue(db, user.id, requested_from_ip=_client_ip(request))

    # Build the URL. The verify endpoint lives on the BACKEND, but for
    # browser-friendly UX (single click from email) we route the click
    # through the FRONTEND so it lands on a real page with branding. The
    # frontend page does a fetch to /api/auth/magic-link/verify on mount.
    frontend_url = settings.frontend_url.rstrip("/")
    sign_in_url = f"{frontend_url}/auth/magic-link?token={token}"

    subject, text, html = magic_link_email(
        sign_in_url=sign_in_url,
        ttl_minutes=int(ml_service.DEFAULT_TTL.total_seconds() // 60),
    )
    result = await email_service.send_email(
        to=user.email, subject=subject, text=text, html=html
    )
    if not result.ok:
        # Don't surface to the caller (would leak existence). Log so the
        # operator sees email delivery is broken.
        logger.warning(
            "magic_link_email_failed user_id=%s error=%s",
            user.id,
            result.error,
        )
    return MagicLinkRequestResponse()


# ── GET /api/auth/magic-link/verify ───────────────────────────────────────────


@router.get("/verify")
async def verify_magic_link(
    response: Response,
    token: str = Query(..., min_length=8, max_length=200),
    db: AsyncSession = Depends(get_db),
):
    """Redeem the token, set the session cookie, return JSON.

    The frontend page calls this via fetch and renders success/failure UI.
    Returns:
        200 {"ok": true} + Set-Cookie session=...  on success
        400 {"detail": "..."} on invalid/expired/used token
    """
    user_id = await ml_service.redeem(db, token)
    if not user_id:
        # Generic message — we don't tell the caller whether the token was
        # never valid, already used, or expired. All three look the same to
        # an attacker; the user just clicks "request a new link."
        return _bad_token_response()

    res = await db.execute(select(User).where(User.id == user_id))
    user = res.scalar_one_or_none()
    if user is None:
        # User was deleted between issuance and redemption.
        return _bad_token_response()

    # Mint a session token and set the same httpOnly cookie every other
    # login flow sets. This makes magic-link sign-in indistinguishable
    # from password / passkey / Google once you're in.
    from app.api.routes.auth import _create_token  # local import avoids cycle

    jwt = _create_token(user.id)
    set_session_cookie(response, jwt)
    logger.info("magic_link_redeemed user_id=%s", user.id)
    return {"ok": True}


def _bad_token_response() -> Response:
    from fastapi.responses import JSONResponse

    return JSONResponse(
        status_code=status.HTTP_400_BAD_REQUEST,
        content={"detail": "Invalid or expired sign-in link"},
    )
