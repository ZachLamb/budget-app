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


def test_webauthn_debug_refused_in_production(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SECRET_KEY", "x" * 40)
    monkeypatch.setenv("WEBAUTHN_DEBUG", "true")
    monkeypatch.setenv("FLY_APP_NAME", "clarity-backend")
    get_settings.cache_clear()
    with pytest.raises(RuntimeError, match="WEBAUTHN_DEBUG"):
        get_settings()
    get_settings.cache_clear()


def _prod_settings_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Minimum env for get_settings() to run its production warning block."""
    monkeypatch.setenv("SECRET_KEY", "x" * 40)
    monkeypatch.setenv("FLY_APP_NAME", "clarity-backend")
    monkeypatch.delenv("DEMO_MODE", raising=False)
    monkeypatch.delenv("WEBAUTHN_DEBUG", raising=False)


def test_warns_when_rp_id_does_not_cover_frontend_host(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """A domain change that updates FRONTEND_URL but not WEBAUTHN_RP_ID breaks
    passkeys client-side, so startup is the only place it can surface."""
    _prod_settings_env(monkeypatch)
    monkeypatch.setenv("FRONTEND_URL", "https://snacksbudget.app")
    monkeypatch.setenv("WEBAUTHN_RP_ID", "clarity.example.com")
    monkeypatch.setenv("CORS_ORIGINS", "https://snacksbudget.app")
    get_settings.cache_clear()
    with caplog.at_level("WARNING"):
        get_settings()
    get_settings.cache_clear()
    assert "WEBAUTHN_RP_ID" in caplog.text
    assert "SecurityError" in caplog.text


def test_no_rp_id_warning_when_rp_id_is_registrable_suffix(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """An apex RP ID legitimately covers a subdomain login page."""
    _prod_settings_env(monkeypatch)
    monkeypatch.setenv("FRONTEND_URL", "https://app.snacksbudget.app")
    monkeypatch.setenv("WEBAUTHN_RP_ID", "snacksbudget.app")
    monkeypatch.setenv("CORS_ORIGINS", "https://app.snacksbudget.app")
    get_settings.cache_clear()
    with caplog.at_level("WARNING"):
        get_settings()
    get_settings.cache_clear()
    assert "WEBAUTHN_RP_ID" not in caplog.text


def test_warns_when_frontend_url_missing_from_cors_origins(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    _prod_settings_env(monkeypatch)
    monkeypatch.setenv("FRONTEND_URL", "https://snacksbudget.app")
    monkeypatch.setenv("WEBAUTHN_RP_ID", "snacksbudget.app")
    monkeypatch.setenv("CORS_ORIGINS", "https://clarity-zach.vercel.app")
    get_settings.cache_clear()
    with caplog.at_level("WARNING"):
        get_settings()
    get_settings.cache_clear()
    assert "CORS_ORIGINS" in caplog.text
    assert "Invalid origin" in caplog.text


def test_no_cors_warning_when_origin_differs_only_by_trailing_slash(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """A cosmetic trailing slash must not be reported as a real mismatch."""
    _prod_settings_env(monkeypatch)
    monkeypatch.setenv("FRONTEND_URL", "https://snacksbudget.app")
    monkeypatch.setenv("WEBAUTHN_RP_ID", "snacksbudget.app")
    monkeypatch.setenv("CORS_ORIGINS", "https://snacksbudget.app/")
    get_settings.cache_clear()
    with caplog.at_level("WARNING"):
        get_settings()
    get_settings.cache_clear()
    assert "Invalid origin" not in caplog.text


def test_demo_mode_in_production_still_hard_fails_without_override(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _prod_settings_env(monkeypatch)
    monkeypatch.setenv("DEMO_MODE", "true")
    monkeypatch.delenv("DEMO_MODE_ALLOW_PRODUCTION", raising=False)
    get_settings.cache_clear()
    with pytest.raises(RuntimeError, match="DEMO_MODE"):
        get_settings()
    get_settings.cache_clear()


def test_demo_mode_in_production_warns_loudly_when_override_set(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """The escape hatch must start the app but never do so silently — a prod
    deploy stuck in demo mode 403s every sign-up and reads as 'login broken'."""
    _prod_settings_env(monkeypatch)
    monkeypatch.setenv("DEMO_MODE", "true")
    monkeypatch.setenv("DEMO_MODE_ALLOW_PRODUCTION", "true")
    get_settings.cache_clear()
    with caplog.at_level("WARNING"):
        get_settings()  # must not raise
    get_settings.cache_clear()
    assert "READ-ONLY DEMO" in caplog.text
    assert "DEMO_MODE_ALLOW_PRODUCTION" in caplog.text


def test_upstash_primary_name_wins_over_alias(monkeypatch: pytest.MonkeyPatch) -> None:
    """When both names are set, UPSTASH_* takes precedence over KV_REST_API_*."""
    monkeypatch.setenv("UPSTASH_REDIS_REST_URL", "https://primary.example")
    monkeypatch.setenv("KV_REST_API_URL", "https://alias.example")
    assert Settings().upstash_redis_rest_url == "https://primary.example"
