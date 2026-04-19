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
    # WebAuthn / passkeys: rp_id must match the host (e.g. localhost in dev)
    webauthn_rp_id: str = "localhost"
    webauthn_rp_name: str = "Budget App"
    webauthn_debug: bool = False  # if True, GET /api/auth/passkey/debug is enabled

    # Local LLM via Ollama (required for AI features outside demo mode)
    # Set ollama_url="" only if you intend to disable LLM calls entirely.
    # Recommended models: qwen2.5:7b (~4.7 GB) or llama3.1:8b (~4.7 GB)
    ollama_url: str = "http://ollama:11434"
    ollama_model: str = "qwen2.5:7b"

    # Demo mode: seeds fake data, mocks AI, enables read-only guard
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

    model_config = {"env_file": ".env"}


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
    return settings
