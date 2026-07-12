from __future__ import annotations

"""Fly.io hosting health checks.

Reads machine + volume state from Fly's Machines REST API (the well-documented
public API at ``api.machines.dev``), computes whether the config matches the
"free-tier blueprint" Snack's Budget is expected to run on, and returns a normalized
summary the UI can render at a glance.

Why config-drift instead of $ spend: Fly's GraphQL doesn't expose current-month
spend or machine-hours via their public API. What it *does* expose — and what
we can act on — is the configuration that determines the bill. If the config
stays at the free-tier blueprint, the bill stays at $0. This module catches
drift (extra machines, larger sizes, oversized volumes) within minutes of it
happening.

For the actual $ number, the Fly dashboard at fly.io is the source of truth.
The card we render links to it.
"""

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Optional

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)


# ── Free-tier blueprint ───────────────────────────────────────────────────────
# These are the configuration shapes the app is *expected* to run on. Anything
# else triggers a drift warning. They reflect the deploy we did in
# infra/modal-vllm: one app machine (scale-to-zero) + one Postgres machine
# (always on) + one 1GB volume. Adjust if you intentionally scale up later.

APP_NAME = "clarity-backend"
DB_NAME = "clarity-db"
EXPECTED_APP_MACHINES = 1
EXPECTED_DB_MACHINES = 1
EXPECTED_VOLUME_GB = 1
EXPECTED_CPU_KIND = "shared"
EXPECTED_CPUS_MAX = 1  # shared-cpu-1x
EXPECTED_MEMORY_MB_MAX = 1024  # 1 GB ceiling — flag anything 2GB+


# ── HTTP client ───────────────────────────────────────────────────────────────

FLY_API_BASE = "https://api.machines.dev/v1"
_CONNECT_TIMEOUT = 2.0
_READ_TIMEOUT = 8.0


class FlyApiError(Exception):
    """Raised when Fly's API rejects the request or is unreachable.

    The caller (the hosting route) maps this to ``available=False`` in the
    response so the Settings card degrades gracefully instead of erroring.
    """


async def _get(path: str) -> object:
    settings = get_settings()
    token = settings.fly_api_token
    if not token:
        raise FlyApiError("FLY_API_TOKEN is not configured")
    url = f"{FLY_API_BASE}{path}"
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(_READ_TIMEOUT, connect=_CONNECT_TIMEOUT)
        ) as client:
            resp = await client.get(url, headers={"Authorization": f"Bearer {token}"})
            resp.raise_for_status()
            return resp.json()
    except (httpx.ConnectError, httpx.TimeoutException) as e:
        raise FlyApiError(f"Fly API unreachable: {type(e).__name__}") from e
    except httpx.HTTPStatusError as e:
        # Don't echo response body — could contain token or other secrets.
        raise FlyApiError(f"Fly API returned HTTP {e.response.status_code}") from e


# ── Normalized output types ───────────────────────────────────────────────────


@dataclass
class MachineSummary:
    id: str
    state: str  # "started" / "stopped" / "suspended" / "destroying" / ...
    region: str
    cpu_kind: str  # "shared" / "performance"
    cpus: int
    memory_mb: int


@dataclass
class VolumeSummary:
    id: str
    name: str
    size_gb: int
    region: str
    attached_machine_id: Optional[str]


@dataclass
class AppHealth:
    app_name: str
    available: bool
    machines: list[MachineSummary] = field(default_factory=list)
    volumes: list[VolumeSummary] = field(default_factory=list)
    error: Optional[str] = None


@dataclass
class HostingHealth:
    apps: list[AppHealth]
    drift: list[str]  # human-readable drift lines; empty when healthy
    last_checked_iso: str
    blueprint: dict[str, int]  # the expected values, surfaced for the UI


# ── Inspection ────────────────────────────────────────────────────────────────


async def _fetch_app(app: str) -> AppHealth:
    """Pull machines + volumes for a single app. Fail-soft."""
    out = AppHealth(app_name=app, available=True)
    # Machines
    try:
        raw = await _get(f"/apps/{app}/machines")
        if not isinstance(raw, list):
            raise FlyApiError("unexpected machines payload shape")
        for m in raw:
            cfg = m.get("config") or {}
            guest = cfg.get("guest") or {}
            out.machines.append(
                MachineSummary(
                    id=str(m.get("id") or ""),
                    state=str(m.get("state") or "unknown"),
                    region=str(m.get("region") or "unknown"),
                    cpu_kind=str(guest.get("cpu_kind") or "unknown"),
                    cpus=int(guest.get("cpus") or 0),
                    memory_mb=int(guest.get("memory_mb") or 0),
                )
            )
    except FlyApiError as e:
        out.available = False
        out.error = str(e)
        return out
    # Volumes
    try:
        raw = await _get(f"/apps/{app}/volumes")
        if isinstance(raw, list):
            for v in raw:
                out.volumes.append(
                    VolumeSummary(
                        id=str(v.get("id") or ""),
                        name=str(v.get("name") or ""),
                        size_gb=int(v.get("size_gb") or 0),
                        region=str(v.get("region") or "unknown"),
                        attached_machine_id=v.get("attached_machine_id"),
                    )
                )
    except FlyApiError:
        # Volume API errors are non-fatal — the app's machines info is the
        # more important signal. Leave volumes empty and continue.
        pass
    return out


def _detect_drift(apps: list[AppHealth]) -> list[str]:
    """Compare observed state to the free-tier blueprint. Each returned
    string is one human-readable warning the UI can render verbatim."""
    drift: list[str] = []
    for app in apps:
        if not app.available:
            # Don't infer drift when we can't see the state.
            continue
        # Expected counts.
        if app.app_name == APP_NAME and len(app.machines) > EXPECTED_APP_MACHINES:
            drift.append(
                f"{app.app_name}: {len(app.machines)} machines (expected {EXPECTED_APP_MACHINES})"
            )
        if app.app_name == DB_NAME and len(app.machines) > EXPECTED_DB_MACHINES:
            drift.append(
                f"{app.app_name}: {len(app.machines)} machines (expected {EXPECTED_DB_MACHINES})"
            )
        # Per-machine size checks.
        for m in app.machines:
            if m.cpu_kind != EXPECTED_CPU_KIND:
                drift.append(
                    f"{app.app_name} machine {m.id[:8]}: cpu_kind={m.cpu_kind} (expected {EXPECTED_CPU_KIND})"
                )
            if m.cpus > EXPECTED_CPUS_MAX:
                drift.append(
                    f"{app.app_name} machine {m.id[:8]}: {m.cpus} CPUs (expected ≤{EXPECTED_CPUS_MAX})"
                )
            if m.memory_mb > EXPECTED_MEMORY_MB_MAX:
                drift.append(
                    f"{app.app_name} machine {m.id[:8]}: {m.memory_mb} MB (expected ≤{EXPECTED_MEMORY_MB_MAX})"
                )
        # Volume size checks.
        for v in app.volumes:
            if v.size_gb > EXPECTED_VOLUME_GB:
                drift.append(
                    f"{app.app_name} volume {v.name or v.id[:8]}: {v.size_gb} GB (expected ≤{EXPECTED_VOLUME_GB})"
                )
    return drift


# ── Cache ─────────────────────────────────────────────────────────────────────
# Process-local cache, 5-min TTL. The Fly API rate-limits and there's no value
# in hitting it more often than that — a config change is announcement-level,
# not millisecond. On scale-to-zero serverless we'd lose the cache between
# requests, but our Fly machine is the one machine, so warm.

_CACHE_TTL_SEC = 300
_cache: dict[str, tuple[HostingHealth, float]] = {}
_cache_lock = asyncio.Lock()


async def fetch_health(*, force: bool = False) -> HostingHealth:
    """Fetch hosting health, cached for ``_CACHE_TTL_SEC``.

    Pass ``force=True`` to bypass the cache (used by the "Refresh" button).
    Always returns a HostingHealth (never raises) — apps individually carry
    ``available=False`` + an error string if their fetch failed.
    """
    now = time.monotonic()
    if not force:
        async with _cache_lock:
            entry = _cache.get("health")
            if entry and entry[1] > now:
                return entry[0]

    # Fetch both apps in parallel.
    apps = await asyncio.gather(
        _fetch_app(APP_NAME),
        _fetch_app(DB_NAME),
        return_exceptions=False,
    )
    drift = _detect_drift(apps)
    from datetime import datetime, timezone

    health = HostingHealth(
        apps=apps,
        drift=drift,
        last_checked_iso=datetime.now(timezone.utc).isoformat(),
        blueprint={
            "app_machines": EXPECTED_APP_MACHINES,
            "db_machines": EXPECTED_DB_MACHINES,
            "volume_gb": EXPECTED_VOLUME_GB,
            "memory_mb_max": EXPECTED_MEMORY_MB_MAX,
        },
    )
    async with _cache_lock:
        _cache["health"] = (health, now + _CACHE_TTL_SEC)
    return health


def _reset_cache_for_tests() -> None:
    _cache.clear()
