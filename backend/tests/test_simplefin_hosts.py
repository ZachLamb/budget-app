"""Tests for SimpleFIN outbound host allowlist."""
from __future__ import annotations

import pytest

from app.services.sync.simplefin_hosts import (
    is_allowed_simplefin_host,
    validate_simplefin_url,
)


def test_default_allowlist_accepts_simplefin_subdomain() -> None:
    assert is_allowed_simplefin_host("api.simplefin.org")
    assert is_allowed_simplefin_host("beta-bridge.simplefin.org")


def test_default_allowlist_rejects_arbitrary_host() -> None:
    assert not is_allowed_simplefin_host("evil.example.com")
    assert not is_allowed_simplefin_host("localhost")


def test_validate_simplefin_url_rejects_ssrf_target() -> None:
    with pytest.raises(ValueError, match="allowlist"):
        validate_simplefin_url("https://169.254.169.254/latest/meta-data/")


def test_validate_simplefin_url_accepts_bridge() -> None:
    validate_simplefin_url("https://beta-bridge.simplefin.org/setup/abc")


def test_extra_hosts_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SIMPLEFIN_ALLOWED_HOSTS_EXTRA", "localhost")
    assert is_allowed_simplefin_host("localhost")
    validate_simplefin_url("http://localhost:9999/claim")
