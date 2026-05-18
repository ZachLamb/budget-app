"""SimpleFIN outbound URL host allowlist (SSRF mitigation).

User-supplied claim/access URLs must resolve to hosts on this list before
any httpx request is made. Optional dev override via SIMPLEFIN_ALLOWED_HOSTS_EXTRA.
"""
from __future__ import annotations

import os
from fnmatch import fnmatch
from urllib.parse import urlparse

# Default production allowlist — SimpleFIN bridge and API hosts.
_DEFAULT_ALLOWED_HOST_PATTERNS: tuple[str, ...] = (
    "*.simplefin.org",
    "simplefin.org",
    "beta-bridge.simplefin.org",
)


def _extra_patterns_from_env() -> tuple[str, ...]:
    raw = os.environ.get("SIMPLEFIN_ALLOWED_HOSTS_EXTRA", "").strip()
    if not raw:
        return ()
    return tuple(p.strip().lower() for p in raw.split(",") if p.strip())


def allowed_host_patterns() -> tuple[str, ...]:
    return _DEFAULT_ALLOWED_HOST_PATTERNS + _extra_patterns_from_env()


def _host_matches_pattern(host: str, pattern: str) -> bool:
    host = host.lower()
    pattern = pattern.lower()
    if pattern.startswith("*."):
        suffix = pattern[1:]  # ".simplefin.org"
        return host == pattern[2:] or host.endswith(suffix)
    return host == pattern


def is_allowed_simplefin_host(host: str | None) -> bool:
    if not host:
        return False
    host = host.lower().split(":")[0]
    for pattern in allowed_host_patterns():
        if _host_matches_pattern(host, pattern):
            return True
    return False


def validate_simplefin_url(url: str, *, context: str = "SimpleFIN URL") -> None:
    """Raise ValueError if ``url`` is not an allowed https SimpleFIN endpoint."""
    parsed = urlparse(url.strip())
    if parsed.scheme not in ("https", "http"):
        raise ValueError(f"{context}: only http(s) URLs are allowed")
    # Production paths should use HTTPS; allow http only for explicit dev extras on localhost.
    host = (parsed.hostname or "").lower()
    if parsed.scheme == "http" and host not in ("localhost", "127.0.0.1"):
        raise ValueError(f"{context}: http is only permitted for localhost")
    if not is_allowed_simplefin_host(host):
        raise ValueError(f"{context}: host {host!r} is not on the SimpleFIN allowlist")
