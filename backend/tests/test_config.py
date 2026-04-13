"""
Config/settings regression tests.

Ensures critical settings exist and have expected types so that
removing or renaming them is caught.
"""
from __future__ import annotations

import pytest

from app.config import Settings, get_settings


def test_settings_has_cors_origins() -> None:
    s = Settings()
    assert hasattr(s, "cors_origins")
    assert isinstance(s.cors_origins, str)
    assert "localhost" in s.cors_origins or s.cors_origins == ""


def test_settings_has_frontend_url() -> None:
    s = Settings()
    assert hasattr(s, "frontend_url")
    assert isinstance(s.frontend_url, str)


def test_settings_has_webauthn_rp_id() -> None:
    s = Settings()
    assert hasattr(s, "webauthn_rp_id")
    assert isinstance(s.webauthn_rp_id, str)


def test_settings_has_secret_key() -> None:
    s = Settings()
    assert hasattr(s, "secret_key")
    assert isinstance(s.secret_key, str)


def test_settings_has_database_url() -> None:
    s = Settings()
    assert hasattr(s, "database_url")
    assert isinstance(s.database_url, str)
    assert "postgresql" in s.database_url or "sqlite" in s.database_url


def test_settings_has_ai_rate_limit_per_minute() -> None:
    s = Settings()
    assert hasattr(s, "ai_rate_limit_per_minute")
    assert isinstance(s.ai_rate_limit_per_minute, int)
    assert s.ai_rate_limit_per_minute >= 0


def test_get_settings_rejects_cors_wildcard(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SECRET_KEY", "x" * 40)
    monkeypatch.setenv("CORS_ORIGINS", "*")
    get_settings.cache_clear()
    with pytest.raises(RuntimeError, match="CORS_ORIGINS"):
        get_settings()
    get_settings.cache_clear()


def test_upstash_url_reads_upstash_env_var(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("KV_REST_API_URL", raising=False)
    monkeypatch.setenv("UPSTASH_REDIS_REST_URL", "https://u.example")
    assert Settings().upstash_redis_rest_url == "https://u.example"


def test_upstash_url_falls_back_to_vercel_kv_name(monkeypatch: pytest.MonkeyPatch) -> None:
    """Vercel Marketplace provisions Redis under KV_REST_API_URL; backend must pick it up."""
    monkeypatch.delenv("UPSTASH_REDIS_REST_URL", raising=False)
    monkeypatch.setenv("KV_REST_API_URL", "https://kv.example")
    assert Settings().upstash_redis_rest_url == "https://kv.example"


def test_upstash_token_falls_back_to_vercel_kv_name(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("UPSTASH_REDIS_REST_TOKEN", raising=False)
    monkeypatch.setenv("KV_REST_API_TOKEN", "tok-kv")
    assert Settings().upstash_redis_rest_token == "tok-kv"


def test_upstash_primary_name_wins_over_alias(monkeypatch: pytest.MonkeyPatch) -> None:
    """When both names are set, UPSTASH_* takes precedence over KV_REST_API_*."""
    monkeypatch.setenv("UPSTASH_REDIS_REST_URL", "https://primary.example")
    monkeypatch.setenv("KV_REST_API_URL", "https://alias.example")
    assert Settings().upstash_redis_rest_url == "https://primary.example"
