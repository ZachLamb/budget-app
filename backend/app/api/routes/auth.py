from __future__ import annotations

import base64
import hashlib
import hmac
import json
from typing import Optional
import logging
import secrets
import time
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode, urlparse

import httpx
import jwt as _jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
import jwt
from app.services.auth.passwords import hash_password, verify_password
from app.services.auth.tokens import create_session_token
from webauthn import generate_registration_options, verify_registration_response, generate_authentication_options, verify_authentication_response
from webauthn.helpers import options_to_json, parse_registration_credential_json, parse_authentication_credential_json
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    UserVerificationRequirement,
    ResidentKeyRequirement,
    PublicKeyCredentialDescriptor,
)

from app.database import get_db
from app.config import get_settings
from app.models import User, Household, CategoryGroup, Category, WebAuthnCredential
from app.schemas.user import (
    UserCreate,
    UserLogin,
    UserResponse,
    TokenResponse,
    PasskeyRegisterOptionsRequest,
    PasskeyAuthenticateOptionsRequest,
    PasskeyRegisterVerifyRequest,
    PasskeyAuthenticateVerifyRequest,
    PasskeyCredentialListItem,
)
from app.api.deps import ALGORITHM, get_current_user, get_current_user_any_status
from app.services.auth.session_cookie import (
    COOKIE_NAME,
    set_session_cookie,
    clear_session_cookie,
)
from app.services.auth.admin_gate import apply_admin_bootstrap, check_approved
from app.services.auth import challenges as auth_challenges

router = APIRouter()
logger = logging.getLogger(__name__)

_REGISTRATION_FAILED_DETAIL = "Registration could not be completed"

DEFAULT_CATEGORIES = {
    "Income": {"is_income": True, "cats": ["Salary", "Freelance", "Interest", "Other Income"]},
    "Housing": {"cats": ["Rent/Mortgage", "Utilities", "Internet", "Home Maintenance"]},
    "Food & Drink": {"cats": ["Groceries", "Restaurants", "Coffee"]},
    "Transportation": {"cats": ["Gas", "Car Payment", "Car Insurance", "Public Transit", "Parking"]},
    "Personal": {"cats": ["Clothing", "Haircut", "Subscriptions", "Gym"]},
    "Health": {"cats": ["Medical", "Dental", "Pharmacy", "Vision"]},
    "Entertainment": {"cats": ["Streaming", "Events", "Hobbies", "Vacation"]},
    "Financial": {"cats": ["Savings", "Investments", "Debt Payments"]},
    "Giving": {"cats": ["Charity", "Gifts"]},
}


# Kept as a module-level alias: several routes in this file and historical
# imports refer to ``_create_token``.
_create_token = create_session_token


def _token_response(response: Response, token: str, user: User) -> TokenResponse:
    """Set the session cookie and return the user payload (no JWT in body).

    Browser clients use the httpOnly cookie. Non-browser API clients should
  read the session cookie or use a future dedicated API-token mechanism.
    """
    set_session_cookie(response, token)
    return TokenResponse(user=UserResponse.model_validate(user))


@router.post("/demo-login", response_model=TokenResponse)
async def demo_login(response: Response, db: AsyncSession = Depends(get_db)):
    """One-click login as the demo user. Only available when DEMO_MODE=true."""
    if not get_settings().demo_mode:
        raise HTTPException(status_code=404, detail="Not found")
    result = await db.execute(select(User).where(User.email == "demo@claritybudget.app"))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=503, detail="Demo data not ready")
    token = _create_token(user)
    return _token_response(response, token, user)


@router.post("/register", response_model=TokenResponse)
async def register(data: UserCreate, response: Response, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(User).where(User.email == data.email))
    if existing.scalar_one_or_none():
        logger.info("register_rejected duplicate_email")
        raise HTTPException(status_code=400, detail=_REGISTRATION_FAILED_DETAIL)

    household = Household(name=data.household_name)
    db.add(household)
    await db.flush()

    user = User(
        email=data.email,
        name=data.name,
        password_hash=hash_password(data.password),
        household_id=household.id,
        role="owner",
        status="pending",  # admin gate; bootstrap below may promote to "approved"
    )
    db.add(user)
    await db.flush()

    for sort_idx, (group_name, config) in enumerate(DEFAULT_CATEGORIES.items()):
        group = CategoryGroup(
            household_id=household.id,
            name=group_name,
            sort_order=sort_idx,
            is_income=config.get("is_income", False),
        )
        db.add(group)
        await db.flush()
        for cat_idx, cat_name in enumerate(config["cats"]):
            db.add(Category(group_id=group.id, name=cat_name, sort_order=cat_idx))

    # Promote to admin if email matches ADMIN_EMAIL (no-op otherwise).
    apply_admin_bootstrap(user)
    # Commit BEFORE the gate so a pending user's row persists in the DB
    # even when we deny them a session — the admin needs them in their
    # pending-users panel to approve.
    await db.commit()
    await db.refresh(user)
    check_approved(user)  # raises 403 if pending/rejected
    token = _create_token(user)
    return _token_response(response, token, user)


@router.post("/login", response_model=TokenResponse)
async def login(data: UserLogin, response: Response, db: AsyncSession = Depends(get_db)):
    from app.services.auth import lockout

    email = data.email.strip().lower()
    # Per-email lockout layer on top of the IP-keyed rate limit: after N
    # failed attempts an IP-rotating attacker still can't keep grinding on a
    # single account. The 429 is intentionally vague about remaining
    # attempts so probing the threshold doesn't become a signal.
    if await lockout.is_login_locked(email):
        raise HTTPException(
            status_code=429,
            detail="Too many failed attempts. Try again in a few minutes.",
        )

    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if not user or user.password_hash is None:
        # Run a cheap deterministic hash to reduce obvious timing differences without
        # requiring bcrypt initialization during module import.
        hashlib.sha256((data.password or "").encode("utf-8")).hexdigest()
        await lockout.record_login_failure(email)
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not verify_password(data.password, user.password_hash):
        await lockout.record_login_failure(email)
        raise HTTPException(status_code=401, detail="Invalid credentials")

    await lockout.clear_login_failures(email)
    # Self-healing admin bootstrap: promote ADMIN_EMAIL user on every login
    # so users that registered before the feature shipped still gain admin.
    if apply_admin_bootstrap(user):
        await db.commit()
        await db.refresh(user)
    check_approved(user)  # raises 403 if pending/rejected
    token = _create_token(user)
    return _token_response(response, token, user)


@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Clear the session cookie and invalidate the current JWT server-side.

    Safe to call without a valid session — we still clear the cookie. When a
    token is present (even expired), bump ``session_version`` so stolen cookies
    cannot be reused after logout.
    """
    clear_session_cookie(response)
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        auth_header = request.headers.get("authorization") or ""
        if auth_header.lower().startswith("bearer "):
            token = auth_header[7:].strip()
    if token:
        try:
            payload = jwt.decode(
                token,
                get_settings().secret_key,
                algorithms=[ALGORITHM],
                options={"verify_exp": False, "require": ["sub"]},
            )
            user_id = payload.get("sub")
            if user_id:
                result = await db.execute(select(User).where(User.id == user_id))
                user = result.scalar_one_or_none()
                if user is not None:
                    user.session_version += 1
                    await db.commit()
        except jwt.PyJWTError:
            pass
    return {"ok": True}


@router.get("/me", response_model=UserResponse)
async def get_me(user: User = Depends(get_current_user_any_status)):
    """Return the caller's own profile.

    Intentionally skips the approval gate: a pending user must be able to
    learn their own status so the frontend can show the "awaiting approval"
    page instead of a bare 403. All data routes still require approval.
    """
    return UserResponse.model_validate(user)


# --- Passkey (WebAuthn) / OAuth ephemeral state ---
# Stored in Upstash when configured (see app.services.auth.challenges).

_OAUTH_LOGIN_CODE_TTL = float(auth_challenges.OAUTH_LOGIN_CODE_TTL)
_OAUTH_LOGIN_CODE_COOKIE = "oauth_login_code"
_OAUTH_LOGIN_CODE_COOKIE_PATH = "/api/auth/google/exchange"


def get_webauthn_rp_id() -> str:
    """Effective WebAuthn RP ID.

    Explicit WEBAUTHN_RP_ID always wins. When it's unset, derive the RP ID
    from FRONTEND_URL's hostname — the RP ID must equal (or suffix) the
    domain the login page is served from, so a deploy that sets FRONTEND_URL
    correctly gets working passkeys without a second secret. The old
    hardcoded "localhost" fallback made browsers throw SecurityError on
    every hosted deploy that forgot the WEBAUTHN_RP_ID secret.
    """
    settings = get_settings()
    rp_id = (settings.webauthn_rp_id or "").strip()
    if rp_id:
        return rp_id
    host = urlparse(settings.frontend_url).hostname
    return host or "localhost"


def _get_origin(request: Request) -> str:
    origin = request.headers.get("origin") or request.headers.get("referer")
    if origin:
        return origin.rstrip("/").split("?")[0]
    return get_settings().frontend_url.rstrip("/")


def _get_allowed_origins() -> list[str]:
    """Return the list of allowed origins (cors_origins or frontend_url fallback), normalized (no trailing slash)."""
    allowed = [o.strip().rstrip("/") for o in get_settings().cors_origins.split(",") if o.strip()]
    if not allowed:
        allowed = [get_settings().frontend_url.rstrip("/")]
    return allowed


def _validate_origin(request: Request) -> str:
    """Validate request origin against cors_origins allowlist. Returns validated origin or raises 400."""
    candidate = _get_origin(request)
    if candidate not in _get_allowed_origins():
        raise HTTPException(status_code=400, detail="Invalid origin")
    return candidate


def _validate_origin_from_credential(origin_from_credential: str) -> str:
    """Validate that the origin (e.g. from clientDataJSON) is in the allowlist. Returns it or raises 400."""
    candidate = (origin_from_credential or "").split("?")[0].rstrip("/")
    if not candidate:
        raise HTTPException(status_code=400, detail="Invalid origin")
    if candidate not in _get_allowed_origins():
        raise HTTPException(status_code=400, detail="Invalid origin")
    return candidate


def _safe_error_detail(e: Exception) -> str:
    """Return a generic error message for the client; log the real one server-side."""
    return "An internal error occurred. Please try again."


def _decode_client_data_json(cd_raw: str | bytes | bytearray | None) -> dict:
    """Decode clientDataJSON from either base64 str or raw bytes (py_webauthn can return bytes)."""
    if cd_raw is None:
        raise ValueError("client_data_json is None")
    if isinstance(cd_raw, str):
        pad = (4 - len(cd_raw) % 4) % 4
        decoded = base64.urlsafe_b64decode(cd_raw + ("=" * pad))
        return json.loads(decoded.decode("utf-8"))
    raw = bytes(cd_raw)
    return json.loads(raw.decode("utf-8"))


@router.get("/passkey/debug")
async def passkey_debug(db: AsyncSession = Depends(get_db)):
    """Help debug passkey 500s: checks webauthn import, config, and DB. Only available when WEBAUTHN_DEBUG=true."""
    if not get_settings().webauthn_debug:
        raise HTTPException(status_code=404, detail="Not found")
    out: dict = {}
    try:
        out["webauthn"] = "imported"
        s = get_settings()
        out["rp_id"] = s.webauthn_rp_id or "(empty)"
        out["effective_rp_id"] = get_webauthn_rp_id()
        out["rp_name"] = s.webauthn_rp_name or "(empty)"
    except Exception as e:
        out["config_error"] = _safe_error_detail(e)
    try:
        opts = generate_registration_options(
            rp_id="localhost",
            rp_name="Test",
            user_id=b"test",
            user_name="test@test.com",
        )
        out["generate_options"] = "ok"
        out["options_to_json"] = "ok" if options_to_json(opts) else "empty"
    except Exception as e:
        out["webauthn_error"] = _safe_error_detail(e)
    try:
        await db.execute(select(User).limit(1))
        out["db_users"] = "ok"
    except Exception as e:
        out["db_error"] = _safe_error_detail(e)
    try:
        await db.execute(select(WebAuthnCredential).limit(1))
        out["db_webauthn"] = "ok"
    except Exception as e:
        out["db_webauthn_error"] = _safe_error_detail(e)
    return out


@router.post("/passkey/register/options")
async def passkey_register_options(
    data: PasskeyRegisterOptionsRequest,
    db: AsyncSession = Depends(get_db),
):
    """Return WebAuthn options for creating a new account with a passkey."""
    try:
        email = data.email
        name = data.name
        existing = await db.execute(select(User).where(User.email == email))
        if existing.scalar_one_or_none():
            logger.info("passkey_register_options_rejected duplicate_email")
            raise HTTPException(status_code=400, detail=_REGISTRATION_FAILED_DETAIL)
        settings = get_settings()
        rp_id = get_webauthn_rp_id()
        rp_name = (settings.webauthn_rp_name or "Budget App").strip() or "Budget App"
        user_id = str(uuid.uuid4())
        options = generate_registration_options(
            rp_id=rp_id,
            rp_name=rp_name,
            user_id=user_id.encode("utf-8"),
            user_name=email,
            user_display_name=name,
            authenticator_selection=AuthenticatorSelectionCriteria(
                resident_key=ResidentKeyRequirement.PREFERRED,
                user_verification=UserVerificationRequirement.PREFERRED,
            ),
        )
        challenge_b64 = base64.urlsafe_b64encode(options.challenge).rstrip(b"=").decode("ascii")
        await auth_challenges.put_passkey_registration_challenge(
            challenge_b64,
            {
                "user_id": user_id,
                "email": email,
                "name": name,
                "household_name": data.household_name or "My Household",
            },
        )
        options_json = options_to_json(options)
        # Ensure we return a JSON-serializable string (some webauthn versions return dict)
        if isinstance(options_json, dict):
            options_str = json.dumps(options_json)
        else:
            options_str = str(options_json)
        return {"options": options_str}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Passkey register options failed: %s", e)
        raise HTTPException(status_code=500, detail=_safe_error_detail(e)) from e


@router.post("/passkey/register/verify", response_model=TokenResponse)
async def passkey_register_verify(
    data: PasskeyRegisterVerifyRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Verify passkey registration and create user + credential. Body: { credential: <JSON from navigator.credentials.create> }."""
    try:
        credential_json = data.credential
        credential = parse_registration_credential_json(credential_json)
        client_data = _decode_client_data_json(credential.response.client_data_json)
        challenge_b64 = client_data.get("challenge", "")
        if not isinstance(challenge_b64, str):
            raise HTTPException(status_code=400, detail="Invalid passkey credential")
        pending = await auth_challenges.pop_passkey_registration_challenge(challenge_b64)
        if not pending:
            raise HTTPException(status_code=400, detail="Invalid or expired challenge")
        pad = (4 - len(challenge_b64) % 4) % 4
        expected_challenge = base64.urlsafe_b64decode(challenge_b64 + ("=" * pad))
        settings = get_settings()
        origin_from_client = client_data.get("origin", "")
        origin = _validate_origin_from_credential(origin_from_client)
        rp_id = get_webauthn_rp_id()
        try:
            verification = verify_registration_response(
                credential=credential_json,
                expected_challenge=expected_challenge,
                expected_rp_id=rp_id,
                expected_origin=origin,
            )
        except Exception as e:
            logger.warning("Passkey registration verify failed: %s", e)
            raise HTTPException(status_code=400, detail="Invalid passkey response")
        household = Household(name=pending["household_name"])
        db.add(household)
        await db.flush()
        user = User(
            id=pending["user_id"],
            email=pending["email"],
            name=pending["name"],
            password_hash=None,
            household_id=household.id,
            role="owner",
            status="pending",  # admin gate; bootstrap below may promote to "approved"
        )
        db.add(user)
        await db.flush()
        db.add(
            WebAuthnCredential(
                user_id=user.id,
                credential_id=verification.credential_id,
                public_key=verification.credential_public_key,
                sign_count=verification.sign_count,
            )
        )
        for sort_idx, (group_name, config) in enumerate(DEFAULT_CATEGORIES.items()):
            group = CategoryGroup(
                household_id=household.id,
                name=group_name,
                sort_order=sort_idx,
                is_income=config.get("is_income", False),
            )
            db.add(group)
            await db.flush()
            for cat_idx, cat_name in enumerate(config["cats"]):
                db.add(Category(group_id=group.id, name=cat_name, sort_order=cat_idx))
        apply_admin_bootstrap(user)  # idempotent — no-op unless email matches ADMIN_EMAIL
        await db.commit()  # persist user (and any bootstrap promotion) before the gate
        await db.refresh(user)
        check_approved(user)  # 403 for pending/rejected; admin bootstrap auto-passes
        token = _create_token(user)
        return _token_response(response, token, user)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Passkey register verify failed: %s", e)
        raise HTTPException(status_code=500, detail="Invalid passkey response") from e


def _fake_credential_descriptors(email: str) -> list[PublicKeyCredentialDescriptor]:
    """Deterministic decoy credential ids for unknown emails.

    Without these, /passkey/authenticate/options is an account-enumeration
    oracle: a known email returns allowCredentials entries, an unknown one
    returns an empty list. The decoys are HMAC-derived from the email so the
    same address always yields the same (useless) descriptors — repeated
    probes can't even use response instability as a signal.
    """
    digest = hmac.new(
        get_settings().secret_key.encode("utf-8"),
        f"passkey-decoy:{email.lower()}".encode("utf-8"),
        hashlib.sha256,
    ).digest()
    return [PublicKeyCredentialDescriptor(id=digest + digest[:16])]


@router.post("/passkey/authenticate/options")
async def passkey_authenticate_options(
    data: PasskeyAuthenticateOptionsRequest,
    db: AsyncSession = Depends(get_db),
):
    """Return WebAuthn options for signing in with a passkey."""
    try:
        settings = get_settings()
        rp_id = get_webauthn_rp_id()
        allow_credentials: list[PublicKeyCredentialDescriptor] = []
        if data.email:
            result = await db.execute(select(User).where(User.email == data.email))
            user = result.scalar_one_or_none()
            if user:
                try:
                    creds_result = await db.execute(
                        select(WebAuthnCredential).where(WebAuthnCredential.user_id == user.id)
                    )
                    creds_list = creds_result.scalars().all()
                    allow_credentials = [PublicKeyCredentialDescriptor(id=c.credential_id) for c in creds_list]
                except Exception:
                    # Table might not exist yet or other DB issue; continue with empty list
                    logger.warning(
                        "Passkey auth options: could not load credentials for user (continuing with empty allowCredentials)",
                        exc_info=True,
                    )
            # Anti-enumeration: unknown email or passkey-less account gets
            # indistinguishable decoy descriptors instead of an empty list.
            if not allow_credentials:
                allow_credentials = _fake_credential_descriptors(data.email)
        options = generate_authentication_options(
            rp_id=rp_id,
            allow_credentials=allow_credentials,
        )
        challenge_b64 = base64.urlsafe_b64encode(options.challenge).rstrip(b"=").decode("ascii")
        await auth_challenges.put_passkey_auth_challenge(challenge_b64)
        options_json = options_to_json(options)
        options_str = json.dumps(options_json) if isinstance(options_json, dict) else str(options_json)
        return {"options": options_str}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Passkey authenticate options failed: %s", e)
        raise HTTPException(status_code=500, detail=_safe_error_detail(e)) from e


@router.post("/passkey/authenticate/verify", response_model=TokenResponse)
async def passkey_authenticate_verify(
    data: PasskeyAuthenticateVerifyRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Verify passkey assertion and return token. Body: { credential: <JSON from navigator.credentials.get> }."""
    credential_json = data.credential
    try:
        credential = parse_authentication_credential_json(credential_json)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid passkey credential")
    raw_id = getattr(credential, "raw_id", None) or credential_json.get("rawId") or credential_json.get("id", "")
    if isinstance(raw_id, str):
        pad = (4 - len(raw_id) % 4) % 4
        credential_id_raw = base64.urlsafe_b64decode(raw_id + ("=" * pad))
    else:
        credential_id_raw = raw_id
    result = await db.execute(
        select(WebAuthnCredential).where(WebAuthnCredential.credential_id == credential_id_raw)
    )
    webauthn_cred = result.scalar_one_or_none()
    if not webauthn_cred:
        raise HTTPException(status_code=401, detail="Unknown passkey")
    try:
        client_data = _decode_client_data_json(credential.response.client_data_json)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid passkey credential")
    challenge_b64 = client_data.get("challenge", "")
    if not isinstance(challenge_b64, str):
        raise HTTPException(status_code=400, detail="Invalid passkey credential")
    if not await auth_challenges.pop_passkey_auth_challenge(challenge_b64):
        raise HTTPException(status_code=400, detail="Invalid or expired challenge")
    pad = (4 - len(challenge_b64) % 4) % 4
    expected_challenge = base64.urlsafe_b64decode(challenge_b64 + ("=" * pad))
    settings = get_settings()
    rp_id = get_webauthn_rp_id()
    # Use origin from the credential (clientDataJSON) so verification works when the HTTP request
    # does not send Origin (e.g. same-origin proxy). We only allowlist-check it.
    origin_from_client = client_data.get("origin", "")
    origin = _validate_origin_from_credential(origin_from_client)
    try:
        verification = verify_authentication_response(
            credential=credential_json,
            expected_challenge=expected_challenge,
            expected_rp_id=rp_id,
            expected_origin=origin,
            credential_public_key=webauthn_cred.public_key,
            credential_current_sign_count=webauthn_cred.sign_count,
        )
    except Exception as e:
        logger.warning("Passkey auth verify failed: %s", e)
        raise HTTPException(status_code=401, detail="Invalid passkey")
    webauthn_cred.sign_count = verification.new_sign_count
    await db.commit()
    result = await db.execute(select(User).where(User.id == webauthn_cred.user_id))
    user = result.scalar_one()
    if apply_admin_bootstrap(user):
        await db.commit()
        await db.refresh(user)
    check_approved(user)
    token = _create_token(user)
    return _token_response(response, token, user)


@router.get("/passkey/credentials", response_model=list[PasskeyCredentialListItem])
async def list_passkey_credentials(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List passkey credentials for the current user (id and created_at only)."""
    result = await db.execute(
        select(WebAuthnCredential).where(WebAuthnCredential.user_id == user.id)
    )
    credentials = result.scalars().all()
    return [PasskeyCredentialListItem.model_validate(c) for c in credentials]


@router.delete("/passkey/credentials/{id}")
async def delete_passkey_credential(
    id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove a passkey credential. id is the row UUID (WebAuthnCredential.id)."""
    result = await db.execute(
        select(WebAuthnCredential).where(
            and_(
                WebAuthnCredential.id == id,
                WebAuthnCredential.user_id == user.id,
            )
        )
    )
    cred = result.scalar_one_or_none()
    if not cred:
        raise HTTPException(status_code=404, detail="Passkey not found")
    await db.delete(cred)
    await db.commit()
    return {"ok": True}


@router.post("/passkey/add/options")
async def passkey_add_options(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return WebAuthn registration options for adding a passkey to the current user (authenticated)."""
    try:
        settings = get_settings()
        rp_id = get_webauthn_rp_id()
        rp_name = (settings.webauthn_rp_name or "Budget App").strip() or "Budget App"
        options = generate_registration_options(
            rp_id=rp_id,
            rp_name=rp_name,
            user_id=user.id.encode("utf-8"),
            user_name=user.email or "",
            user_display_name=user.name or "",
            authenticator_selection=AuthenticatorSelectionCriteria(
                resident_key=ResidentKeyRequirement.PREFERRED,
                user_verification=UserVerificationRequirement.PREFERRED,
            ),
        )
        challenge_b64 = base64.urlsafe_b64encode(options.challenge).rstrip(b"=").decode("ascii")
        await auth_challenges.put_passkey_add_challenge(challenge_b64, user.id)
        options_json = options_to_json(options)
        options_str = json.dumps(options_json) if isinstance(options_json, dict) else str(options_json)
        return {"options": options_str}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Passkey add options failed: %s", e)
        raise HTTPException(status_code=500, detail=_safe_error_detail(e)) from e


@router.post("/passkey/add/verify")
async def passkey_add_verify(
    data: PasskeyRegisterVerifyRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Verify passkey registration and add credential to current user. Returns 200 with { ok: true }."""
    credential_json = data.credential
    try:
        credential = parse_registration_credential_json(credential_json)
        client_data = _decode_client_data_json(credential.response.client_data_json)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid passkey credential")
    challenge_b64 = client_data.get("challenge", "")
    if not isinstance(challenge_b64, str):
        raise HTTPException(status_code=400, detail="Invalid passkey credential")
    pending_user_id = await auth_challenges.pop_passkey_add_challenge(challenge_b64)
    if not pending_user_id:
        raise HTTPException(status_code=400, detail="Invalid or expired challenge")
    if pending_user_id != user.id:
        raise HTTPException(status_code=400, detail="Challenge does not match current user")
    pad = (4 - len(challenge_b64) % 4) % 4
    expected_challenge = base64.urlsafe_b64decode(challenge_b64 + ("=" * pad))
    settings = get_settings()
    origin_from_client = client_data.get("origin", "")
    origin = _validate_origin_from_credential(origin_from_client)
    rp_id = get_webauthn_rp_id()
    try:
        verification = verify_registration_response(
            credential=credential_json,
            expected_challenge=expected_challenge,
            expected_rp_id=rp_id,
            expected_origin=origin,
        )
    except Exception as e:
        logger.warning("Passkey add verify failed: %s", e)
        raise HTTPException(status_code=400, detail="Invalid passkey response")
    db.add(
        WebAuthnCredential(
            user_id=user.id,
            credential_id=verification.credential_id,
            public_key=verification.credential_public_key,
            sign_count=verification.sign_count,
        )
    )
    await db.commit()
    return {"ok": True}


# --- Google OAuth ---

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"


def _build_redirect_uri(request: Request) -> str:
    """Build the callback URL that Google will redirect to (this backend)."""
    base = str(request.base_url).rstrip("/")
    return f"{base}/api/auth/google/callback"


def _oauth_complete_redirect(frontend_url: str, rel_path: str, *, is_secure: bool) -> RedirectResponse:
    """Redirect to the frontend and clear the one-time OAuth state cookie (must match set_cookie attrs)."""
    base = frontend_url.rstrip("/")
    path = rel_path if rel_path.startswith("/") else f"/{rel_path}"
    r = RedirectResponse(url=f"{base}{path}", status_code=302)
    r.delete_cookie(key="oauth_state", path="/", secure=is_secure, samesite="lax")
    return r


@router.get("/google")
async def google_start(request: Request):
    """Redirect the user to Google's OAuth consent screen."""
    settings = get_settings()
    if not settings.google_client_id:
        raise HTTPException(status_code=501, detail="Google sign-in is not configured")
    if settings.demo_mode:
        oauth_cookie_secure = not settings.frontend_url.startswith("http://localhost")
        return _oauth_complete_redirect(
            settings.frontend_url.rstrip("/"),
            "/login?error=demo_oauth_disabled",
            is_secure=oauth_cookie_secure,
        )
    state = secrets.token_urlsafe(32)
    redirect_uri = _build_redirect_uri(request)
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
    }
    url = f"{GOOGLE_AUTH_URL}?{urlencode(params)}"
    response = RedirectResponse(url=url, status_code=302)
    is_secure = not settings.frontend_url.startswith("http://localhost")
    response.set_cookie(
        key="oauth_state",
        value=state,
        httponly=True,
        secure=is_secure,
        samesite="lax",
        max_age=600,
        path="/",
    )
    return response


@router.get("/google/callback")
async def google_callback(
    request: Request,
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """Exchange code for tokens, get user info, create/update user, redirect to frontend with JWT."""
    settings = get_settings()
    frontend_url = settings.frontend_url.rstrip("/")
    oauth_cookie_secure = not settings.frontend_url.startswith("http://localhost")

    if error:
        return _oauth_complete_redirect(frontend_url, "/login?error=access_denied", is_secure=oauth_cookie_secure)
    if not code or not state:
        return _oauth_complete_redirect(frontend_url, "/login?error=missing_params", is_secure=oauth_cookie_secure)

    cookie_state = request.cookies.get("oauth_state")
    if not cookie_state or cookie_state != state:
        return _oauth_complete_redirect(frontend_url, "/login?error=invalid_state", is_secure=oauth_cookie_secure)

    redirect_uri = _build_redirect_uri(request)
    async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=5.0)) as client:
        token_resp = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
            headers={"Accept": "application/json"},
        )
        if token_resp.status_code != 200:
            return _oauth_complete_redirect(frontend_url, "/login?error=token_failed", is_secure=oauth_cookie_secure)
        data = token_resp.json()
        access_token = data.get("access_token")
        if not access_token:
            return _oauth_complete_redirect(frontend_url, "/login?error=token_failed", is_secure=oauth_cookie_secure)

        userinfo_resp = await client.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if userinfo_resp.status_code != 200:
            return _oauth_complete_redirect(frontend_url, "/login?error=userinfo_failed", is_secure=oauth_cookie_secure)
        profile = userinfo_resp.json()

    google_id = profile.get("id")
    email = profile.get("email")
    name = (profile.get("name") or profile.get("given_name") or email or "User").strip()
    if not google_id or not email:
        return _oauth_complete_redirect(frontend_url, "/login?error=invalid_profile", is_secure=oauth_cookie_secure)
    email = (email or "").strip().lower()
    verified_email = profile.get("verified_email") is True
    if not verified_email:
        return _oauth_complete_redirect(
            frontend_url,
            "/login?error=email_not_verified",
            is_secure=oauth_cookie_secure,
        )

    try:
        # Find existing user by google_id or email
        result = await db.execute(select(User).where(User.google_id == google_id))
        user = result.scalar_one_or_none()
        if not user:
            result = await db.execute(select(User).where(User.email == email))
            user = result.scalar_one_or_none()
        if settings.demo_mode and not user:
            return _oauth_complete_redirect(
                frontend_url,
                "/login?error=demo_oauth_signup_disabled",
                is_secure=oauth_cookie_secure,
            )
        if user:
            if user.google_id and user.google_id != google_id:
                return _oauth_complete_redirect(
                    frontend_url,
                    "/login?error=account_conflict",
                    is_secure=oauth_cookie_secure,
                )
            if not user.google_id:
                user.google_id = google_id
                user.name = name
                await db.commit()
                await db.refresh(user)
        else:
            household = Household(name="My Household")
            db.add(household)
            await db.flush()
            user = User(
                email=email,
                name=name,
                password_hash=None,
                google_id=google_id,
                household_id=household.id,
                role="owner",
                status="pending",  # admin gate; bootstrap below may promote
            )
            db.add(user)
            await db.flush()
            for sort_idx, (group_name, config) in enumerate(DEFAULT_CATEGORIES.items()):
                group = CategoryGroup(
                    household_id=household.id,
                    name=group_name,
                    sort_order=sort_idx,
                    is_income=config.get("is_income", False),
                )
                db.add(group)
                await db.flush()
                for cat_idx, cat_name in enumerate(config["cats"]):
                    db.add(Category(group_id=group.id, name=cat_name, sort_order=cat_idx))
            await db.commit()
            await db.refresh(user)

        # Admin bootstrap + gate. The callback runs in a browser top-level
        # navigation, so a 403 here can't surface as JSON — redirect back to
        # /login with an error param the page can render.
        if apply_admin_bootstrap(user):
            await db.commit()
            await db.refresh(user)
        if user.status != "approved":
            err = "pending_approval" if user.status == "pending" else "access_denied"
            return _oauth_complete_redirect(
                frontend_url, f"/login?error={err}", is_secure=oauth_cookie_secure
            )

        login_code = secrets.token_urlsafe(32)
        await auth_challenges.put_oauth_login_code(login_code, user.id)
        # Hand the login code to the frontend via an HttpOnly cookie instead
        # of a URL query param (no leak to history/Referer/proxy logs).
        # Path-scoped to the exchange endpoint, SameSite=Lax so the same-site
        # POST from /auth/callback picks it up.
        redirect = _oauth_complete_redirect(
            frontend_url,
            "/auth/callback",
            is_secure=oauth_cookie_secure,
        )
        redirect.set_cookie(
            key=_OAUTH_LOGIN_CODE_COOKIE,
            value=login_code,
            max_age=int(_OAUTH_LOGIN_CODE_TTL),
            path=_OAUTH_LOGIN_CODE_COOKIE_PATH,
            httponly=True,
            secure=oauth_cookie_secure,
            samesite="lax",
        )
        return redirect
    except Exception:
        logger.exception("Google OAuth callback failed")
        return _oauth_complete_redirect(frontend_url, "/login?error=server_error", is_secure=oauth_cookie_secure)


async def _fetch_google_user_info(code: str, redirect_uri: str) -> dict:
    """Exchange a Google auth code for user info. Raises HTTPException on failure."""
    settings = get_settings()
    async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=5.0)) as client:
        token_resp = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code": code,
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
        )
    if not token_resp.is_success:
        raise HTTPException(status_code=400, detail="Google token exchange failed")
    id_token = token_resp.json().get("id_token")
    if not id_token:
        raise HTTPException(status_code=400, detail="No id_token from Google")
    # Decode without verification (Google already signed it; we validated via exchange)
    try:
        claims = _jwt.decode(id_token, options={"verify_signature": False})
    except Exception:
        raise HTTPException(status_code=400, detail="Could not decode Google id_token")
    if claims.get("email_verified") is not True:
        raise HTTPException(status_code=400, detail="Google account email is not verified")
    return claims


@router.post("/google/exchange", response_model=TokenResponse)
async def google_oauth_exchange(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Exchange the one-time login code (HttpOnly cookie set by /google/callback) for a JWT.

    The code used to ride on the /auth/callback URL query — that leaks into
    browser history, Referer headers, and proxy access logs. Reading it from
    a path-scoped, HttpOnly, short-TTL cookie keeps it out of all three.

    On success, ``_token_response`` ALSO sets the session cookie (HttpOnly,
    SameSite=Strict) so the user is logged in immediately — same as every
    other login path (password / passkey / demo).
    """
    code = (request.cookies.get(_OAUTH_LOGIN_CODE_COOKIE) or "").strip()
    user_id = await auth_challenges.pop_oauth_login_code(code) if code else None
    if not user_id:
        raise HTTPException(status_code=400, detail="Invalid or expired login code")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=400, detail="Invalid or expired login code")
    # Defense-in-depth: callback already gates, but exchange is the load-bearing
    # check if the callback ever loosens or is bypassed.
    if apply_admin_bootstrap(user):
        await db.commit()
        await db.refresh(user)
    check_approved(user)
    # Single-use — clear the cookie now that it's redeemed. Delete attrs
    # must match the set_cookie in /google/callback (key + path).
    response.delete_cookie(
        key=_OAUTH_LOGIN_CODE_COOKIE,
        path=_OAUTH_LOGIN_CODE_COOKIE_PATH,
    )
    token = _create_token(user)
    return _token_response(response, token, user)


# --- Native client auth ---


class NativeTokenRequest(BaseModel):
    grant_type: str = Field(..., min_length=1, max_length=64)
    code: str = Field(..., min_length=1, max_length=2048)
    redirect_uri: str = Field(..., min_length=1, max_length=512)


class NativeTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


@router.post("/native/token", response_model=NativeTokenResponse)
async def native_token(
    data: NativeTokenRequest,
    db: AsyncSession = Depends(get_db),
):
    """Exchange a Google auth code for a Bearer JWT — for native (non-browser) clients.

    Unlike /google/exchange (which uses an httpOnly cookie dance designed for
    browsers), this endpoint accepts the auth code directly in the JSON body
    and returns the JWT in the response body for storage in the OS Keychain.

    The redirect_uri must match the NATIVE_CLIENT_REDIRECT_URIS allowlist to
    prevent code injection from an attacker-controlled redirect target.
    """
    if data.grant_type != "google_code":
        raise HTTPException(status_code=400, detail="Unsupported grant_type")

    settings = get_settings()

    allowed = {u.strip() for u in settings.native_client_redirect_uris.split(",") if u.strip()}
    if data.redirect_uri not in allowed:
        raise HTTPException(status_code=400, detail="redirect_uri not in allowed list")

    if not settings.google_client_id:
        raise HTTPException(status_code=503, detail="Google OAuth not configured")

    user_info = await _fetch_google_user_info(data.code, data.redirect_uri)
    email = user_info.get("email", "").lower().strip()
    google_id = user_info.get("sub", "")
    name = user_info.get("name", email)

    if not email or not google_id:
        raise HTTPException(status_code=400, detail="Incomplete user info from Google")

    result = await db.execute(
        select(User).where(
            (User.google_id == google_id) | (User.email == email)
        )
    )
    user = result.scalar_one_or_none()

    if user is None:
        household = Household(name=f"{name}'s Household")
        db.add(household)
        await db.flush()
        user = User(
            email=email,
            name=name,
            google_id=google_id,
            household_id=household.id,
            role="owner",
            status="pending",
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
        apply_admin_bootstrap(user)
        if user.status == "approved":
            await db.commit()
    elif user.google_id is None:
        user.google_id = google_id
        await db.commit()

    check_approved(user)
    token = _create_token(user)
    return NativeTokenResponse(access_token=token, user=UserResponse.model_validate(user))
