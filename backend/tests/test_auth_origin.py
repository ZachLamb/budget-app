"""
Unit tests for auth origin validation (passkey / WebAuthn).

These tests would have caught the regression where passkey sign-in failed
because we used Origin header (or frontend_url fallback) instead of the
origin from the credential's clientDataJSON.
"""
from __future__ import annotations

import base64
import json
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from app.api.routes.auth import (
    _decode_client_data_json,
    _get_allowed_origins,
    _get_origin,
    _validate_origin,
    _validate_origin_from_credential,
)


def _make_settings(cors_origins: str = "http://localhost:3000,http://localhost:3001", frontend_url: str = "http://localhost:3001"):
    s = MagicMock()
    s.cors_origins = cors_origins
    s.frontend_url = frontend_url
    return s


@patch("app.api.routes.auth.get_settings")
def test_get_allowed_origins_from_cors(mock_get_settings: MagicMock) -> None:
    mock_get_settings.return_value = _make_settings("https://app.example.com,https://admin.example.com")
    assert _get_allowed_origins() == ["https://app.example.com", "https://admin.example.com"]


@patch("app.api.routes.auth.get_settings")
def test_get_allowed_origins_normalizes_trailing_slash(mock_get_settings: MagicMock) -> None:
    mock_get_settings.return_value = _make_settings("http://localhost:3000/")
    assert _get_allowed_origins() == ["http://localhost:3000"]


@patch("app.api.routes.auth.get_settings")
def test_get_allowed_origins_fallback_to_frontend_url(mock_get_settings: MagicMock) -> None:
    mock_get_settings.return_value = _make_settings("")  # empty cors
    mock_get_settings.return_value.frontend_url = "http://localhost:3001"
    assert _get_allowed_origins() == ["http://localhost:3001"]


@patch("app.api.routes.auth.get_settings")
def test_validate_origin_from_credential_accepts_allowed_origin(mock_get_settings: MagicMock) -> None:
    mock_get_settings.return_value = _make_settings("http://localhost:3000,http://localhost:3001")
    assert _validate_origin_from_credential("http://localhost:3000") == "http://localhost:3000"
    assert _validate_origin_from_credential("http://localhost:3001/") == "http://localhost:3001"


@patch("app.api.routes.auth.get_settings")
def test_validate_origin_from_credential_rejects_disallowed_origin(mock_get_settings: MagicMock) -> None:
    mock_get_settings.return_value = _make_settings("http://localhost:3000")
    with pytest.raises(HTTPException) as exc_info:
        _validate_origin_from_credential("https://evil.com")
    assert exc_info.value.status_code == 400
    assert "Invalid origin" in str(exc_info.value.detail)


@patch("app.api.routes.auth.get_settings")
def test_validate_origin_from_credential_rejects_empty_origin(mock_get_settings: MagicMock) -> None:
    mock_get_settings.return_value = _make_settings("http://localhost:3000")
    with pytest.raises(HTTPException) as exc_info:
        _validate_origin_from_credential("")
    assert exc_info.value.status_code == 400
    with pytest.raises(HTTPException):
        _validate_origin_from_credential("   ")


@patch("app.api.routes.auth.get_settings")
def test_validate_origin_from_credential_strips_query_and_trailing_slash(mock_get_settings: MagicMock) -> None:
    mock_get_settings.return_value = _make_settings("http://localhost:3000")
    assert _validate_origin_from_credential("http://localhost:3000/?foo=bar") == "http://localhost:3000"


@patch("app.api.routes.auth.get_settings")
def test_origin_from_credential_used_not_request_origin(mock_get_settings: MagicMock) -> None:
    """Regression: verification must use origin from clientDataJSON, not from HTTP request.
    When request has no Origin (same-origin proxy), we must still accept the credential
    if its embedded origin is in the allowlist."""
    mock_get_settings.return_value = _make_settings("http://localhost:3000,http://localhost:3001")
    # Credential says it was created at 3000; that is allowed
    assert _validate_origin_from_credential("http://localhost:3000") == "http://localhost:3000"
    # Even without a request, we validate purely from the credential's origin
    assert _validate_origin_from_credential("http://localhost:3001") == "http://localhost:3001"


@patch("app.api.routes.auth.get_settings")
def test_get_origin_from_request_headers(mock_get_settings: MagicMock) -> None:
    mock_get_settings.return_value = _make_settings()
    request = MagicMock()
    request.headers = {"origin": "http://localhost:3000", "referer": "http://other.com"}
    assert _get_origin(request) == "http://localhost:3000"


@patch("app.api.routes.auth.get_settings")
def test_get_origin_fallback_to_referer(mock_get_settings: MagicMock) -> None:
    mock_get_settings.return_value = _make_settings()
    request = MagicMock()
    request.headers = {"referer": "http://localhost:3000/login"}
    assert _get_origin(request) == "http://localhost:3000/login"


@patch("app.api.routes.auth.get_settings")
def test_validate_origin_request_rejects_disallowed(mock_get_settings: MagicMock) -> None:
    mock_get_settings.return_value = _make_settings("http://localhost:3000")
    request = MagicMock()
    request.headers = {"origin": "https://evil.com"}
    with pytest.raises(HTTPException) as exc_info:
        _validate_origin(request)
    assert exc_info.value.status_code == 400


def test_decode_client_data_json_rejects_none() -> None:
    with pytest.raises(ValueError, match="client_data_json is None"):
        _decode_client_data_json(None)


def test_decode_client_data_json_decodes_base64url_string() -> None:
    payload = {"type": "webauthn.get", "challenge": "YQ", "origin": "http://localhost:3000"}
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    b64 = base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")
    result = _decode_client_data_json(b64)
    assert result["type"] == "webauthn.get"
    assert result["origin"] == "http://localhost:3000"
    assert result["challenge"] == "YQ"


def test_decode_client_data_json_decodes_raw_bytes() -> None:
    payload = {"type": "webauthn.create", "origin": "https://app.example.com"}
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    result = _decode_client_data_json(raw)
    assert result["origin"] == "https://app.example.com"
