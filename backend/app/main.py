from contextlib import asynccontextmanager
from datetime import datetime, timezone
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.config import get_settings
from app.database import engine, async_session
from app.api.routes import router as api_router
from app.api.routes.upload import router as upload_router
from app.middleware.rate_limit import RateLimitMiddleware
from app.middleware.rate_limit_store import build_store
from app.services.auth import lockout as _auth_lockout
from app.tasks.scheduler import start_scheduler, stop_scheduler


# Schema is managed by Alembic (see ``backend/alembic/``). The container
# entrypoint runs ``alembic upgrade head`` before uvicorn starts; deploys
# that previously relied on the inline ``_run_*_migration`` helpers should
# run ``alembic stamp head`` once to mark their existing schema as
# baselined. See AGENTS.md.


@asynccontextmanager
async def lifespan(app: FastAPI):
    import logging
    _log = logging.getLogger(__name__)

    # Mark stale in_progress sync logs as error — they were orphaned by a
    # prior crash/restart. Only touch rows older than 15 minutes so a live
    # sync running in a sibling worker (staggered restart, multi-replica)
    # isn't clobbered into a false failure.
    try:
        from datetime import timedelta
        from sqlalchemy import update
        from app.models import SyncLog
        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(minutes=15)
        async with async_session() as db:
            await db.execute(
                update(SyncLog)
                .where(SyncLog.status == "in_progress")
                .where(SyncLog.started_at < cutoff)
                .values(
                    status="error",
                    error_message="Interrupted by server restart",
                    completed_at=now,
                )
            )
            await db.commit()
            _log.info("Checked for orphaned in_progress sync logs (cutoff=%s)", cutoff.isoformat())
    except Exception as e:
        _log.warning("Failed to clean up orphaned sync logs: %s", e)

    # Seed demo data if DEMO_MODE is enabled
    if get_settings().demo_mode:
        from app.demo_seed import seed_demo_data
        try:
            await seed_demo_data(async_session)
        except Exception as e:
            _log.warning("Demo seed failed: %s", e)

    start_scheduler()
    yield
    stop_scheduler()
    await engine.dispose()


# redirect_slashes=False: routes registered without trailing slash (e.g. /api/accounts,
# not /api/accounts/).  This prevents FastAPI from issuing 307 redirects that would loop
# with Next.js's trailing-slash normalisation.
app = FastAPI(
    title="Budget App API",
    version="0.1.0",
    lifespan=lifespan,
    redirect_slashes=False,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in get_settings().cors_origins.split(",")],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

# Build one rate-limit store at import and share it across the middleware
# and the lockout service so we only hold one Upstash HTTP client per worker.
# Exposing it on app.state lets /api/health probe it without re-reading env.
_rate_limit_store = build_store(
    rest_url=get_settings().upstash_redis_rest_url,
    rest_token=get_settings().upstash_redis_rest_token,
)
app.state.rate_limit_store = _rate_limit_store
_auth_lockout.set_store(_rate_limit_store)
import logging as _logging  # noqa: E402 — deliberately late to group with the banner below
_logging.getLogger(__name__).info(
    "rate-limit store: %s", _rate_limit_store.backend_name
)

app.add_middleware(RateLimitMiddleware, store=_rate_limit_store)

if get_settings().demo_mode:
    from app.middleware.demo_guard import DemoGuardMiddleware
    app.add_middleware(DemoGuardMiddleware)

app.include_router(api_router, prefix="/api")
app.include_router(upload_router, prefix="/api/upload", tags=["upload"])


@app.get("/api/config")
async def public_config():
    """Public runtime config the browser needs before login.

    Returns server-authoritative values (demo_mode, which auth methods are
    configured) so the frontend doesn't have to rely on build-time
    NEXT_PUBLIC_* vars — which can silently drift from the real backend
    state (e.g. build with DEMO_MODE=false, redeploy backend with demo on).

    Pre-auth by design: everything here is already inferrable from the
    login page's visible affordances, so there's nothing to protect.
    """
    s = get_settings()
    return {
        "demo_mode": bool(s.demo_mode),
        "auth_methods": {
            # Password/passkey are always compiled in. Google requires
            # credentials AND is disabled in demo (no real sign-up path).
            "password": True,
            "passkey": True,
            "google": bool(s.google_client_id) and not s.demo_mode,
        },
    }


@app.get("/api/health")
async def health():
    components: dict = {"db": "ok", "rate_limit_store": _rate_limit_store.backend_name}
    status = "ok"

    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception:
        components["db"] = "unreachable"
        status = "degraded"

    # In-memory always pings True; this only adds real network cost when
    # Upstash is configured.
    try:
        ok = await _rate_limit_store.ping()
    except Exception:
        ok = False
    if not ok:
        # A missing Redis isn't fatal (the middleware fails open) but it
        # means limits are not shared across workers — worth surfacing.
        components["rate_limit_store_status"] = "unavailable"
        status = "degraded" if status == "ok" else status
    else:
        components["rate_limit_store_status"] = "ok"

    return {"status": status, **components}
