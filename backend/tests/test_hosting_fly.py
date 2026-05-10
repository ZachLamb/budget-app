"""Tests for the Fly.io hosting health service.

Mocks httpx so the tests run without network. Two surfaces matter:
1. Normalization of Fly's machine/volume JSON into our dataclasses.
2. Drift detection vs the free-tier blueprint — the whole point of the card.
"""
from __future__ import annotations

import os
from unittest.mock import patch

import httpx
import pytest

# Token must be set BEFORE the service imports get_settings(), otherwise
# fetch_health bails with "FLY_API_TOKEN is not configured."
os.environ.setdefault("FLY_API_TOKEN", "test-token-for-pytest")

from app.config import get_settings  # noqa: E402
from app.services.hosting import fly as fly_service  # noqa: E402


# ── Sample Fly API payloads (trimmed to fields we read) ───────────────────────


def _machine(*, mid="m_aaaa1111bbbb2222", state="started", region="iad",
             cpus=1, memory=512, cpu_kind="shared"):
    return {
        "id": mid,
        "state": state,
        "region": region,
        "config": {"guest": {"cpus": cpus, "memory_mb": memory, "cpu_kind": cpu_kind}},
    }


def _volume(*, vid="vol_xyz", name="pg_data", size_gb=1, region="iad",
            attached="m_db111"):
    return {
        "id": vid,
        "name": name,
        "size_gb": size_gb,
        "region": region,
        "attached_machine_id": attached,
    }


# ── Test infra ────────────────────────────────────────────────────────────────


class _MockResponse:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload

    def raise_for_status(self):
        if self.status_code >= 400:
            request = httpx.Request("GET", "https://test")
            response = httpx.Response(self.status_code, request=request)
            raise httpx.HTTPStatusError(
                f"HTTP {self.status_code}", request=request, response=response
            )

    def json(self):
        return self._payload


class _MockClient:
    """Stand-in for httpx.AsyncClient — returns one of two fixed payloads
    based on whether the URL contains /machines or /volumes."""

    def __init__(self, *, machines_by_app: dict[str, list[dict]], volumes_by_app: dict[str, list[dict]]):
        self._m = machines_by_app
        self._v = volumes_by_app

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def get(self, url, headers=None):
        # url is like https://api.machines.dev/v1/apps/clarity-backend/machines
        parts = url.rstrip("/").split("/")
        app = parts[-2]
        resource = parts[-1]
        if resource == "machines":
            return _MockResponse(200, self._m.get(app, []))
        if resource == "volumes":
            return _MockResponse(200, self._v.get(app, []))
        return _MockResponse(404, {})


@pytest.fixture(autouse=True)
def _clear_cache():
    fly_service._reset_cache_for_tests()
    get_settings.cache_clear()
    yield
    fly_service._reset_cache_for_tests()


def _install_mock(machines, volumes):
    """Replace httpx.AsyncClient with a stub returning the given payloads."""
    return patch(
        "app.services.hosting.fly.httpx.AsyncClient",
        return_value=_MockClient(machines_by_app=machines, volumes_by_app=volumes),
    )


# ── Normalization ─────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_fetch_health_normalizes_machines_and_volumes():
    machines = {
        "clarity-backend": [_machine(mid="m_app1", state="stopped")],
        "clarity-db": [_machine(mid="m_db1", state="started", memory=256)],
    }
    volumes = {
        "clarity-backend": [],
        "clarity-db": [_volume(vid="v_db1", name="pg_data", size_gb=1)],
    }
    with _install_mock(machines, volumes):
        health = await fly_service.fetch_health(force=True)

    assert len(health.apps) == 2
    app = next(a for a in health.apps if a.app_name == "clarity-backend")
    assert app.available is True
    assert app.machines[0].id == "m_app1"
    assert app.machines[0].state == "stopped"
    assert app.machines[0].memory_mb == 512

    db = next(a for a in health.apps if a.app_name == "clarity-db")
    assert db.volumes[0].size_gb == 1
    assert db.volumes[0].attached_machine_id == "m_db111"


# ── Drift detection ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_no_drift_for_blueprint_config():
    """The exact deploy we documented should produce zero drift warnings."""
    machines = {
        "clarity-backend": [_machine(mid="m_app1", state="stopped", memory=512)],
        "clarity-db": [_machine(mid="m_db1", state="started", memory=256)],
    }
    volumes = {"clarity-backend": [], "clarity-db": [_volume(size_gb=1)]}
    with _install_mock(machines, volumes):
        health = await fly_service.fetch_health(force=True)
    assert health.drift == []


@pytest.mark.asyncio
async def test_drift_flags_extra_machines():
    machines = {
        "clarity-backend": [
            _machine(mid="m_app1", state="started"),
            _machine(mid="m_app2", state="started"),  # uh oh
        ],
        "clarity-db": [_machine(mid="m_db1")],
    }
    with _install_mock(machines, {"clarity-backend": [], "clarity-db": []}):
        health = await fly_service.fetch_health(force=True)
    assert any("2 machines" in d and "clarity-backend" in d for d in health.drift)


@pytest.mark.asyncio
async def test_drift_flags_oversized_volume():
    machines = {"clarity-backend": [_machine(mid="m_app1")], "clarity-db": [_machine(mid="m_db1")]}
    volumes = {"clarity-backend": [], "clarity-db": [_volume(size_gb=10)]}
    with _install_mock(machines, volumes):
        health = await fly_service.fetch_health(force=True)
    assert any("10 GB" in d for d in health.drift)


@pytest.mark.asyncio
async def test_drift_flags_upgraded_cpu():
    machines = {
        "clarity-backend": [_machine(mid="m_app1", cpu_kind="performance", cpus=2)],
        "clarity-db": [_machine(mid="m_db1")],
    }
    with _install_mock(machines, {"clarity-backend": [], "clarity-db": []}):
        health = await fly_service.fetch_health(force=True)
    assert any("cpu_kind=performance" in d for d in health.drift)
    assert any("2 CPUs" in d for d in health.drift)


@pytest.mark.asyncio
async def test_drift_flags_oversized_memory():
    machines = {
        "clarity-backend": [_machine(mid="m_app1", memory=2048)],  # 2 GB
        "clarity-db": [_machine(mid="m_db1")],
    }
    with _install_mock(machines, {"clarity-backend": [], "clarity-db": []}):
        health = await fly_service.fetch_health(force=True)
    assert any("2048 MB" in d for d in health.drift)


# ── Resilience ────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_app_unavailable_when_machines_api_errors():
    """When the Fly API rejects one app, only that app's availability flips,
    the other app still reports normally, and we don't infer drift from it."""

    class _ErrClient(_MockClient):
        async def get(self, url, headers=None):
            if "clarity-backend" in url:
                return _MockResponse(503, {"error": "service unavailable"})
            return await super().get(url, headers=headers)

    with patch(
        "app.services.hosting.fly.httpx.AsyncClient",
        return_value=_ErrClient(
            machines_by_app={"clarity-db": [_machine(mid="m_db1")]},
            volumes_by_app={"clarity-db": []},
        ),
    ):
        health = await fly_service.fetch_health(force=True)

    app = next(a for a in health.apps if a.app_name == "clarity-backend")
    assert app.available is False
    assert "HTTP 503" in (app.error or "")

    db = next(a for a in health.apps if a.app_name == "clarity-db")
    assert db.available is True
    # No drift inferred from the unavailable app — the only signal is from db,
    # which matches the blueprint.
    assert health.drift == []


@pytest.mark.asyncio
async def test_missing_token_marks_apps_unavailable():
    # Set the env to empty and clear the lru_cache so the service re-reads.
    os.environ["FLY_API_TOKEN"] = ""
    get_settings.cache_clear()
    try:
        with _install_mock({"clarity-backend": [], "clarity-db": []}, {"clarity-backend": [], "clarity-db": []}):
            health = await fly_service.fetch_health(force=True)
    finally:
        os.environ["FLY_API_TOKEN"] = "test-token-for-pytest"
        get_settings.cache_clear()
    assert all(a.available is False for a in health.apps)
    assert all("not configured" in (a.error or "") for a in health.apps)
