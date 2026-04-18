from __future__ import annotations

import base64
import hashlib
import json
from typing import Optional
import logging
import secrets
import time
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from jose import jwt
from passlib.context import CryptContext
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
    GoogleOAuthExchangeRequest,
)
from app.api.deps import ALGORITHM, get_current_user

router = APIRouter()
logger = logging.getLogger(__name__)
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

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


def _create_token(user_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=30)
    return jwt.encode({"sub": user_id, "exp": expire}, get_settings().secret_key, algorithm=ALGORITHM)


@router.post("/demo-login", response_model=TokenResponse)
async def demo_login(db: AsyncSession = Depends(get_db)):
    """One-click login as the demo user. Only available when DEMO_MODE=true."""
    if not get_settings().demo_mode:
        raise HTTPException(status_code=404, detail="Not found")
    result = await db.execute(select(User).where(User.email == "demo@claritybudget.app"))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=503, detail="Demo data not ready")
    token = _create_token(user.id)
    return TokenResponse(
        access_token=token,
        user=UserResponse.model_validate(user),
    )


@router.post("/register", response_model=TokenResponse)
async def register(data: UserCreate, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(User).where(User.email == data.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")

    household = Household(name=data.household_name)
    db.add(household)
    await db.flush()

    user = User(
        email=data.email,
        name=data.name,
        password_hash=pwd_context.hash(data.password),
        household_id=household.id,
        role="owner",
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

    token = _create_token(user.id)
    return TokenResponse(
        access_token=token,
        user=UserResponse.model_validate(user),
    )


@router.post("/login", response_model=TokenResponse)
async def login(data: UserLogin, db: AsyncSession = Depends(get_db)):
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
    if not pwd_context.verify(data.password, user.password_hash):
        await lockout.record_login_failure(email)
        raise HTTPException(status_code=401, detail="Invalid credentials")

    await lockout.clear_login_failures(email)
    token = _create_token(user.id)
    return TokenResponse(
        access_token=token,
        user=UserResponse.model_validate(user),
    )


@router.get("/me", response_model=UserResponse)
async def get_me(user: User = Depends(get_current_user)):
    return UserResponse.model_validate(user)


# --- Passkey (WebAuthn) ---
# In-memory challenge store; key = base64url(challenge), value = { user_id, email, name, household_name } or user_id for add.
# TTL 5 minutes. For production with multiple backend instances or restarts, use a shared store (e.g. Redis) with the same TTL.
_passkey_registration_challenges: dict[str, tuple[dict, float]] = {}
_passkey_auth_challenges: dict[str, float] = {}
_passkey_add_challenges: dict[str, tuple[str, float]] = {}  # challenge_b64 -> (user_id, timestamp)

# One-time OAuth login code handed back via the `/auth/callback?code=…` redirect.
# Short TTL because the browser redirect is immediate; 10-minute windows left a
# long replay opportunity for a code that lands in browser history, Referer
# headers, and proxy logs. Phase-2 work should move this value out of the URL
# (HttpOnly cookie handoff) and into a shared store (Redis) to survive
# multi-worker deploys.
_OAUTH_LOGIN_CODE_TTL = 60.0
_oauth_login_codes: dict[str, tuple[str, float]] = {}  # code -> (user_id, issued_ts)


def _clean_oauth_login_codes() -> None:
    now = time.time()
    for k in list(_oauth_login_codes):
        if now - _oauth_login_codes[k][1] > _OAUTH_LOGIN_CODE_TTL:
            del _oauth_login_codes[k]
_CHALLENGE_TTL = 300


def _clean_challenges():
    now = time.time()
    for k in list(_passkey_registration_challenges):
        if now - _passkey_registration_challenges[k][1] > _CHALLENGE_TTL:
            del _passkey_registration_challenges[k]
    for k in list(_passkey_auth_challenges):
        if now - _passkey_auth_challenges[k] > _CHALLENGE_TTL:
            del _passkey_auth_challenges[k]
    for k in list(_passkey_add_challenges):
        if now - _passkey_add_challenges[k][1] > _CHALLENGE_TTL:
            del _passkey_add_challenges[k]


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
            raise HTTPException(status_code=400, detail="Email already registered")
        settings = get_settings()
        rp_id = (settings.webauthn_rp_id or "localhost").strip() or "localhost"
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
        _clean_challenges()
        _passkey_registration_challenges[challenge_b64] = (
            {"user_id": user_id, "email": email, "name": name, "household_name": data.household_name or "My Household"},
            time.time(),
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
        _clean_challenges()
        if challenge_b64 not in _passkey_registration_challenges:
            raise HTTPException(status_code=400, detail="Invalid or expired challenge")
        pending, _ = _passkey_registration_challenges.pop(challenge_b64)
        pad = (4 - len(challenge_b64) % 4) % 4
        expected_challenge = base64.urlsafe_b64decode(challenge_b64 + ("=" * pad))
        settings = get_settings()
        origin_from_client = client_data.get("origin", "")
        origin = _validate_origin_from_credential(origin_from_client)
        rp_id = (settings.webauthn_rp_id or "localhost").strip() or "localhost"
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
        await db.commit()
        await db.refresh(user)
        token = _create_token(user.id)
        return TokenResponse(access_token=token, user=UserResponse.model_validate(user))
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Passkey register verify failed: %s", e)
        raise HTTPException(status_code=500, detail="Invalid passkey response") from e


@router.post("/passkey/authenticate/options")
async def passkey_authenticate_options(
    data: PasskeyAuthenticateOptionsRequest,
    db: AsyncSession = Depends(get_db),
):
    """Return WebAuthn options for signing in with a passkey."""
    try:
        settings = get_settings()
        rp_id = (settings.webauthn_rp_id or "localhost").strip() or "localhost"
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
        options = generate_authentication_options(
            rp_id=rp_id,
            allow_credentials=allow_credentials,
        )
        challenge_b64 = base64.urlsafe_b64encode(options.challenge).rstrip(b"=").decode("ascii")
        _clean_challenges()
        _passkey_auth_challenges[challenge_b64] = time.time()
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
    _clean_challenges()
    if challenge_b64 not in _passkey_auth_challenges:
        raise HTTPException(status_code=400, detail="Invalid or expired challenge")
    _passkey_auth_challenges.pop(challenge_b64, None)
    pad = (4 - len(challenge_b64) % 4) % 4
    expected_challenge = base64.urlsafe_b64decode(challenge_b64 + ("=" * pad))
    settings = get_settings()
    rp_id = (settings.webauthn_rp_id or "localhost").strip() or "localhost"
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
    token = _create_token(user.id)
    return TokenResponse(access_token=token, user=UserResponse.model_validate(user))


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
        rp_id = (settings.webauthn_rp_id or "localhost").strip() or "localhost"
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
        _clean_challenges()
        _passkey_add_challenges[challenge_b64] = (user.id, time.time())
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
    _clean_challenges()
    if challenge_b64 not in _passkey_add_challenges:
        raise HTTPException(status_code=400, detail="Invalid or expired challenge")
    pending_user_id, _ = _passkey_add_challenges.pop(challenge_b64)
    if pending_user_id != user.id:
        raise HTTPException(status_code=400, detail="Challenge does not match current user")
    pad = (4 - len(challenge_b64) % 4) % 4
    expected_challenge = base64.urlsafe_b64decode(challenge_b64 + ("=" * pad))
    settings = get_settings()
    origin_from_client = client_data.get("origin", "")
    origin = _validate_origin_from_credential(origin_from_client)
    rp_id = (settings.webauthn_rp_id or "localhost").strip() or "localhost"
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

        _clean_oauth_login_codes()
        login_code = secrets.token_urlsafe(32)
        _oauth_login_codes[login_code] = (user.id, time.time())
        return _oauth_complete_redirect(
            frontend_url,
            f"/auth/callback?code={login_code}",
            is_secure=oauth_cookie_secure,
        )
    except Exception:
        logger.exception("Google OAuth callback failed")
        return _oauth_complete_redirect(frontend_url, "/login?error=server_error", is_secure=oauth_cookie_secure)


@router.post("/google/exchange", response_model=TokenResponse)
async def google_oauth_exchange(data: GoogleOAuthExchangeRequest, db: AsyncSession = Depends(get_db)):
    """Exchange a one-time code from Google OAuth redirect for a JWT (avoids long-lived tokens in URLs)."""
    _clean_oauth_login_codes()
    code = (data.code or "").strip()
    rec = _oauth_login_codes.pop(code, None)
    if not rec:
        raise HTTPException(status_code=400, detail="Invalid or expired login code")
    user_id, ts = rec
    if time.time() - ts > _OAUTH_LOGIN_CODE_TTL:
        raise HTTPException(status_code=400, detail="Invalid or expired login code")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=400, detail="Invalid or expired login code")
    token = _create_token(user.id)
    return TokenResponse(access_token=token, user=UserResponse.model_validate(user))
