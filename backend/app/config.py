import logging

from pydantic_settings import BaseSettings
from functools import lru_cache

class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://budget:budget@localhost:5432/budget_app"
    database_url_sync: str = "postgresql://budget:budget@localhost:5432/budget_app"
    secret_key: str = ""
    cors_origins: str = "http://localhost:3000,http://localhost:3001,http://localhost:80"
    anthropic_api_key: str = ""
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

    # Local LLM via Ollama (preferred — keeps all data on your machine)
    # Set ollama_url="" to disable and fall back to Anthropic Claude API only.
    # Recommended models: qwen2.5:7b (~4.7 GB) or llama3.1:8b (~4.7 GB)
    ollama_url: str = "http://ollama:11434"
    ollama_model: str = "qwen2.5:7b"

    # Demo mode: seeds fake data, mocks AI, enables read-only guard
    demo_mode: bool = False

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
    return settings
