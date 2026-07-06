import logging

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings
from functools import lru_cache

class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://budget:budget@localhost:5432/budget_app"
    database_url_sync: str = "postgresql://budget:budget@localhost:5432/budget_app"
    secret_key: str = ""
    cors_origins: str = "http://localhost:3000,http://localhost:3001,http://localhost:80"
    sync_interval_hours: int = 4
    sync_stale_minutes: int = 30
    db_pool_size: int = 10
    db_max_overflow: int = 20
    # Google OAuth (optional; leave empty to disable "Sign in with Google")
    google_client_id: str = ""
    google_client_secret: str = ""
    # Frontend URL for OAuth redirect after login (e.g. http://localhost:3001)
    frontend_url: str = "http://localhost:3001"
    # WebAuthn / passkeys: rp_id must match the host the login page is served
    # from. Empty means "derive from FRONTEND_URL's hostname" (see
    # app.api.routes.auth.get_webauthn_rp_id) with a final localhost fallback.
    webauthn_rp_id: str = ""
    webauthn_rp_name: str = "Budget App"
    webauthn_debug: bool = False  # if True, GET /api/auth/passkey/debug is enabled

    # Demo mode: seeds fake data, enables read-only guard
    demo_mode: bool = False

    # Comma-separated allowlist of IPs/CIDRs that are trusted to set
    # X-Forwarded-For (e.g. your reverse proxy). When empty, XFF is
    # ignored and the direct peer IP is used — prevents header spoofing
    # from untrusted clients.
    trusted_proxies: str = ""

    # Optional Upstash Redis (HTTP REST) for rate-limit state. When both
    # are set, the rate limiter shares buckets across workers/replicas.
    # When empty, the limiter falls back to per-instance in-memory state.
    #
    # Accepts either naming so we work with raw Upstash credentials
    # (UPSTASH_REDIS_REST_*) and with the Vercel Marketplace integration,
    # which provisions the same REST endpoint under KV_REST_API_*
    # (legacy Vercel KV naming). If a Vercel-linked env re-syncs later,
    # the KV_* names stick — we can't rename them without getting
    # overwritten.
    upstash_redis_rest_url: str = Field(
        default="",
        validation_alias=AliasChoices("UPSTASH_REDIS_REST_URL", "KV_REST_API_URL"),
    )
    upstash_redis_rest_token: str = Field(
        default="",
        validation_alias=AliasChoices("UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_TOKEN"),
    )

    # Per-household cap on AI route calls per rolling 60s window (0 = disabled).
    # Reserved for future server-side AI routes; on-device inference does not use this.
    ai_rate_limit_per_minute: int = 120

    # Opt-in Tier 4 cloud backend (OpenAI-compatible, e.g. Ollama). Empty = disabled.
    ollama_url: str = Field(
        default="",
        validation_alias=AliasChoices("OLLAMA_URL", "LLM_BACKEND_URL"),
    )
    ollama_model: str = Field(
        default="qwen2.5:7b",
        validation_alias=AliasChoices("OLLAMA_MODEL", "LLM_BACKEND_MODEL"),
    )
    llm_backend_api_key: str = Field(
        default="",
        validation_alias=AliasChoices("LLM_BACKEND_API_KEY",),
    )

    # Fly.io API token for the Hosting health card. Read-only-ish PAT or
    # org-scoped token. Empty in dev → the route returns available=false
    # and the card renders a friendly "unavailable" placeholder rather
    # than erroring.
    fly_api_token: str = ""

    # Resend (transactional email). resend_api_key: send-scoped API key
    # from resend.com/api-keys. email_from_address: must be on a domain
    # you've verified in Resend. Both empty in dev → /api/auth/magic-link/
    # request still returns 200 (anti-enumeration); the route logs a
    # warning so operators see delivery is broken without an attacker
    # learning anything.
    resend_api_key: str = ""
    email_from_address: str = ""

    # Bootstrap admin: the first user whose email matches ADMIN_EMAIL is
    # auto-promoted to role="admin" + status="approved" on registration
    # OR on next login if they already exist. Self-healing.
    #
    # All other new registrations land at status="pending" and are blocked
    # by the auth gate until the admin approves them via the Settings →
    # Pending Users panel.
    #
    # Comparison is case-insensitive on the local-part + domain. Empty
    # means the bootstrap is disabled — every user gets "pending" with no
    # way out, which is intentional for the open-registration default.
    admin_email: str = ""

    # When true and Upstash is configured, /api/auth/* rate limits fail closed
    # (429) if Redis is unreachable instead of fail-open.
    auth_rate_limit_strict: bool = False

    model_config = {"env_file": ".env"}


_PROD_ENV_MARKERS = (
    # Hosted platform indicators that mean "this is production, don't seed
    # demo data, don't relax security." Add new ones here as we add hosts.
    ("VERCEL_ENV", "production"),
    ("RAILWAY_ENVIRONMENT", "production"),
    ("FLY_APP_NAME", None),  # any value present means a Fly deploy
    ("RENDER", "true"),
    ("NODE_ENV", "production"),
    ("APP_ENV", "production"),
    ("ENVIRONMENT", "production"),
)


def _looks_like_production() -> bool:
    """True when at least one well-known prod env marker is set.

    Used as a refuse-to-start gate against demo-mode-in-prod accidents.
    Matched against either an exact value or simply "is set" depending on
    the marker convention.
    """
    import os

    for name, expected in _PROD_ENV_MARKERS:
        v = os.environ.get(name)
        if v is None:
            continue
        if expected is None:
            return True
        if v.strip().lower() == expected:
            return True
    return False


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    if not settings.secret_key:
        raise RuntimeError(
            "SECRET_KEY is not set. Generate one with: "
            "python -c \"import secrets; print(secrets.token_urlsafe(64))\""
        )
    if len(settings.secret_key) < 32:
        logging.warning("SECRET_KEY is shorter than 32 characters — consider using a longer key.")
    _origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
    if not _origins or any(o == "*" for o in _origins):
        raise RuntimeError(
            "CORS_ORIGINS must list explicit origins (wildcard '*' is not allowed with credential-bearing requests)."
        )
    # Refuse to start with demo data on a production-marked deploy. Demo mode
    # seeds fake data and mocks AI; if it ever lands in prod the user sees
    # someone else's "data" and the AI returns canned responses. Hard fail.
    if settings.demo_mode and _looks_like_production():
        raise RuntimeError(
            "DEMO_MODE=true is set, but a production environment marker is "
            "also set (one of VERCEL_ENV, RAILWAY_ENVIRONMENT, FLY_APP_NAME, "
            "RENDER, NODE_ENV, APP_ENV, ENVIRONMENT). Refusing to start. "
            "Demo mode seeds fake data and mocks AI — it must never run in "
            "production. If this is intentional, unset the prod marker; "
            "otherwise unset DEMO_MODE."
        )
    # Loud warning (not a hard fail — the lock-everyone-out default is
    # documented as intentional): with no ADMIN_EMAIL, every new registration
    # stays "pending" forever because nobody can approve them.
    if not settings.admin_email and not settings.demo_mode and _looks_like_production():
        logging.warning(
            "ADMIN_EMAIL is not set on a production deploy: new sign-ups will "
            "remain 'pending' with no way to approve them. Set ADMIN_EMAIL to "
            "the bootstrap admin's email if registrations should be usable."
        )
    # Loud warnings for the two silent production login-breakers. Neither is
    # a hard fail — a deploy may legitimately run passkey-only or
    # magic-link-only — but both failure modes are invisible to end users
    # (no email ever arrives; the passkey prompt throws before any request
    # reaches us), so the operator log is the only place they can surface.
    if not settings.demo_mode and _looks_like_production():
        if not settings.resend_api_key or not settings.email_from_address:
            logging.warning(
                "RESEND_API_KEY and/or EMAIL_FROM_ADDRESS is not set on a "
                "production deploy: magic-link sign-in emails will silently "
                "never send. Set both to enable email sign-in."
            )
        if not settings.webauthn_rp_id and "localhost" in settings.frontend_url:
            logging.warning(
                "WEBAUTHN_RP_ID is not set and FRONTEND_URL points at "
                "localhost on a production deploy: passkey prompts will fail "
                "in the browser with SecurityError. Set WEBAUTHN_RP_ID to the "
                "domain the login page is served from (or set FRONTEND_URL "
                "correctly to derive it)."
            )
    if settings.webauthn_debug and _looks_like_production():
        raise RuntimeError(
            "WEBAUTHN_DEBUG=true is set alongside a production environment "
            "marker. Refusing to start — the passkey debug endpoint must not "
            "be exposed in production."
        )
    return settings
