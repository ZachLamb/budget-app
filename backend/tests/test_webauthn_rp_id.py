"""RP ID derivation: explicit WEBAUTHN_RP_ID wins; otherwise FRONTEND_URL's
hostname; localhost as the final dev fallback. The old hardcoded "localhost"
default broke passkeys on every hosted deploy that forgot the secret."""
from __future__ import annotations

from unittest.mock import patch

from app.api.routes.auth import get_webauthn_rp_id
from app.config import Settings, get_settings


def _settings(**overrides) -> Settings:
    s = get_settings().model_copy(update=overrides)
    return s


def _patched(settings: Settings):
    return patch("app.api.routes.auth.get_settings", return_value=settings)


def test_explicit_rp_id_wins() -> None:
    s = _settings(webauthn_rp_id="clarity.example.com", frontend_url="https://other.example.org")
    with _patched(s):
        assert get_webauthn_rp_id() == "clarity.example.com"


def test_derives_from_frontend_url_when_unset() -> None:
    s = _settings(webauthn_rp_id="", frontend_url="https://clarity-zach.vercel.app")
    with _patched(s):
        assert get_webauthn_rp_id() == "clarity-zach.vercel.app"


def test_derivation_strips_port_and_path() -> None:
    s = _settings(webauthn_rp_id="", frontend_url="http://localhost:3000/app")
    with _patched(s):
        assert get_webauthn_rp_id() == "localhost"


def test_whitespace_rp_id_falls_through_to_frontend_url() -> None:
    s = _settings(webauthn_rp_id="   ", frontend_url="https://budget.example.com")
    with _patched(s):
        assert get_webauthn_rp_id() == "budget.example.com"


def test_localhost_fallback_when_nothing_usable() -> None:
    s = _settings(webauthn_rp_id="", frontend_url="")
    with _patched(s):
        assert get_webauthn_rp_id() == "localhost"
