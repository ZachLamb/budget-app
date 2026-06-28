from __future__ import annotations

"""Magic-link sign-in routes.

POST /api/auth/magic-link/request — accept an email, generate a token,
  email it, ALWAYS return 200 (anti-enumeration).
POST /api/auth/magic-link/verify — exchange the token (in the JSON body, not
  the query string, so it stays out of access logs) for a session. Redeems
  single-use, sets the httpOnly session cookie, returns {"ok": true}. The
  frontend landing page renders success/failure from that JSON.

Rate limiting:
  - Per-email cap (anti-spam): 3 requests/hour per email address.
  - Per-IP cap (anti-abuse): the existing IP-based middleware covers
    /api/auth/* generically.
  - Verify is single-use server-side; brute-forcing the 256-bit token is
    infeasible at any sane request rate.
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, Request, Response, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.models import User
from app.services.auth import magic_link as ml_service
from app.services.auth import magic_link_rate
from app.services.auth.admin_gate import apply_admin_bootstrap, check_approved
from app.services.auth.session_cookie import set_session_cookie
from app.services.auth.tokens import create_session_token
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

    if await magic_link_rate.is_email_rate_limited(email):
        logger.info("magic_link_request rate_limited email=%s", "<redacted>")
        return MagicLinkRequestResponse()

    res = await db.execute(select(User).where(User.email == email))
    user = res.scalar_one_or_none()

    if user is None:
        # Real users get an email. Probing requests don't. Same response either way.
        logger.info("magic_link_request unknown_email=%s", "<redacted>")
        return MagicLinkRequestResponse()

    # Treat non-approved users like unknown emails: same response, no email
    # sent. This avoids two leaks: (1) attackers can't enumerate which
    # emails are "registered but pending" vs. "registered and approved";
    # (2) pending users don't receive emails with links that would just 403
    # on verify (confusing UX). The admin bootstrap fires on the verify
    # path too — so if this user is the configured admin who hasn't yet
    # been auto-promoted, their FIRST login through any other path (e.g.
    # the Google button) will promote them and unblock magic-link for the
    # next request.
    if user.status != "approved":
        logger.info("magic_link_request blocked_unapproved=%s", "<redacted>")
        return MagicLinkRequestResponse()

    # Issue token (revokes any prior outstanding token for this user).
    token = await ml_service.issue(db, user.id, requested_from_ip=_client_ip(request))

    # Build the URL. The verify endpoint lives on the BACKEND, but for
    # browser-friendly UX (single click from email) we route the click
    # through the FRONTEND so it lands on a real page with branding. The
    # frontend page POSTs the token to /api/auth/magic-link/verify on mount.
    #
    # The token rides in the URL FRAGMENT (#token=…), not the query string:
    # fragments are never sent to servers, never appear in access logs or
    # Referer headers, and aren't forwarded by analytics that capture URLs.
    frontend_url = settings.frontend_url.rstrip("/")
    sign_in_url = f"{frontend_url}/auth/magic-link#token={token}"

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
        # Local-dev ergonomics: with delivery unconfigured (no Resend key),
        # the sign-in link is otherwise unobtainable, so magic-link login
        # can't be exercised locally or in a local demo. Log it — but ONLY
        # on a non-HTTPS host. Production and the hosted demo are always
        # HTTPS, so a usable token can never reach logs there. This is the
        # load-bearing guard: never log a redeemable token on an
        # internet-facing deployment.
        if not frontend_url.lower().startswith("https://"):
            logger.warning(
                "magic_link_dev_signin_url=%s "
                "(email delivery unavailable; logged only on a non-HTTPS dev host)",
                sign_in_url,
            )
    return MagicLinkRequestResponse()


# ── POST /api/auth/magic-link/verify ──────────────────────────────────────────


class MagicLinkVerifyRequest(BaseModel):
    token: str = Field(..., min_length=8, max_length=200)


@router.post("/verify")
async def verify_magic_link(
    body: MagicLinkVerifyRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Redeem the token, set the session cookie, return JSON.

    POST with the token in the body (not the query string) so the token never
    lands in server access logs. The frontend page calls this via fetch and
    renders success/failure UI.
    Returns:
        200 {"ok": true} + Set-Cookie session=...  on success
        400 {"detail": "..."} on invalid/expired/used token
    """
    token = body.token
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

    # Self-healing admin bootstrap + gate. Mirrors every other login path.
    if apply_admin_bootstrap(user):
        await db.commit()
        await db.refresh(user)
    check_approved(user)  # raises 403 if pending/rejected

    # Mint a session token and set the same httpOnly cookie every other
    # login flow sets. This makes magic-link sign-in indistinguishable
    # from password / passkey / Google once you're in.
    session_jwt = create_session_token(user)
    set_session_cookie(response, session_jwt)
    logger.info("magic_link_redeemed user_id=%s", user.id)
    return {"ok": True}


def _bad_token_response() -> Response:
    from fastapi.responses import JSONResponse

    return JSONResponse(
        status_code=status.HTTP_400_BAD_REQUEST,
        content={"detail": "Invalid or expired sign-in link"},
    )
