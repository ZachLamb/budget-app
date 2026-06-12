from __future__ import annotations

"""Hosting health surface for the Settings card.

GET /api/hosting/health — returns a normalized view of the Fly.io
deployment plus a drift report comparing against the free-tier blueprint.
Auth-gated to any signed-in user (single-household app; all users are
trusted operators). Cached 5 min server-side.
"""

from dataclasses import asdict
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from app.api.deps import require_admin
from app.models.user import User
from app.services.hosting import fly as fly_service

router = APIRouter()


class HostingMachine(BaseModel):
    id: str
    state: str
    region: str
    cpu_kind: str
    cpus: int
    memory_mb: int


class HostingVolume(BaseModel):
    id: str
    name: str
    size_gb: int
    region: str
    attached_machine_id: Optional[str] = None


class HostingApp(BaseModel):
    app_name: str
    available: bool
    error: Optional[str] = None
    machines: list[HostingMachine] = []
    volumes: list[HostingVolume] = []


class HostingHealthResponse(BaseModel):
    """Top-level response. ``drift`` is empty when everything matches
    the free-tier blueprint; non-empty list = render an amber warning.

    ``available`` at the top level is true if at least one app's data
    came through; false only when the token is missing or both apps
    errored. The card renders a graceful "unavailable" state in that
    case rather than erroring.
    """

    available: bool
    apps: list[HostingApp]
    drift: list[str]
    last_checked: str
    blueprint: dict[str, int]


@router.get("/health", response_model=HostingHealthResponse)
async def hosting_health(
    refresh: bool = Query(False, description="Bypass the 5-min cache"),
    user: User = Depends(require_admin),
) -> HostingHealthResponse:
    """Infrastructure health (Fly machines/regions) — admin-only: machine
    names and regions are deployment fingerprints regular members don't need."""
    health = await fly_service.fetch_health(force=refresh)
    apps = [
        HostingApp(
            app_name=a.app_name,
            available=a.available,
            error=a.error,
            machines=[HostingMachine(**asdict(m)) for m in a.machines],
            volumes=[HostingVolume(**asdict(v)) for v in a.volumes],
        )
        for a in health.apps
    ]
    return HostingHealthResponse(
        available=any(a.available for a in health.apps),
        apps=apps,
        drift=health.drift,
        last_checked=health.last_checked_iso,
        blueprint=health.blueprint,
    )
