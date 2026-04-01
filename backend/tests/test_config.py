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


def test_get_settings_rejects_cors_wildcard(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SECRET_KEY", "x" * 40)
    monkeypatch.setenv("CORS_ORIGINS", "*")
    get_settings.cache_clear()
    with pytest.raises(RuntimeError, match="CORS_ORIGINS"):
        get_settings()
    get_settings.cache_clear()
