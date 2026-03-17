from contextlib import asynccontextmanager
from datetime import datetime, timezone
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.config import get_settings
from app.database import engine, Base, async_session
from app.api.routes import router as api_router
from app.api.routes.upload import router as upload_router
from app.tasks.scheduler import start_scheduler, stop_scheduler


async def _run_google_oauth_migration(conn):
    """Ensure users table has google_id and nullable password_hash (for Google OAuth)."""
    r = await conn.execute(
        text(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_name = 'users' AND column_name = 'google_id'"
        )
    )
    if r.scalar() is not None:
        return
    await conn.execute(text("ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL"))
    await conn.execute(text("ALTER TABLE users ADD COLUMN google_id VARCHAR(255) UNIQUE"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_users_google_id ON users (google_id)"))


async def _run_debt_fields_migration(conn):
    """Add interest_rate and minimum_payment columns to accounts (for debt tracking)."""
    r = await conn.execute(
        text(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_name = 'accounts' AND column_name = 'interest_rate'"
        )
    )
    if r.scalar() is not None:
        return
    await conn.execute(text("ALTER TABLE accounts ADD COLUMN interest_rate NUMERIC(6,4)"))
    await conn.execute(text("ALTER TABLE accounts ADD COLUMN minimum_payment NUMERIC(14,2)"))


async def _run_simplefin_url_migration(conn):
    """Add simplefin_access_url to households (persists claimed access URL)."""
    r = await conn.execute(
        text(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_name = 'households' AND column_name = 'simplefin_access_url'"
        )
    )
    if r.scalar() is not None:
        return
    await conn.execute(text("ALTER TABLE households ADD COLUMN simplefin_access_url VARCHAR(1024)"))


async def _run_account_sync_fields_migration(conn):
    """Add sync_enabled, last_synced_at, available_balance to accounts; sync_interval_hours to households."""
    # Use IF NOT EXISTS for every column so this migration is fully idempotent
    # regardless of which columns were added in prior partial runs.
    await conn.execute(text("ALTER TABLE accounts ADD COLUMN IF NOT EXISTS sync_enabled BOOLEAN NOT NULL DEFAULT TRUE"))
    await conn.execute(text("ALTER TABLE accounts ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMP WITH TIME ZONE"))
    await conn.execute(text("ALTER TABLE accounts ADD COLUMN IF NOT EXISTS available_balance NUMERIC(14,2)"))
    await conn.execute(text("ALTER TABLE households ADD COLUMN IF NOT EXISTS sync_interval_hours INTEGER NOT NULL DEFAULT 4"))


async def _run_ai_enabled_migration(conn):
    """Add ai_enabled column to households."""
    await conn.execute(text("ALTER TABLE households ADD COLUMN IF NOT EXISTS ai_enabled BOOLEAN NOT NULL DEFAULT TRUE"))


async def _run_plan_preferences_migration(conn):
    """Add debt_strategy and debt_extra_monthly columns to households."""
    await conn.execute(text("ALTER TABLE households ADD COLUMN IF NOT EXISTS debt_strategy VARCHAR(20)"))
    await conn.execute(text("ALTER TABLE households ADD COLUMN IF NOT EXISTS debt_extra_monthly NUMERIC(14,2)"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ensure all models are registered before create_all
    import app.models  # noqa: F401
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    import logging
    _log = logging.getLogger(__name__)

    for label, fn in [
        ("Google OAuth migration", _run_google_oauth_migration),
        ("Debt fields migration", _run_debt_fields_migration),
        ("SimpleFIN access URL migration", _run_simplefin_url_migration),
        ("Account sync fields migration", _run_account_sync_fields_migration),
        ("AI enabled migration", _run_ai_enabled_migration),
        ("Plan preferences migration", _run_plan_preferences_migration),
    ]:
        try:
            async with engine.begin() as conn:
                await fn(conn)
        except Exception as e:
            _log.warning("%s skipped or failed: %s", label, e)

    # Mark any in_progress sync logs as error — they were orphaned by a prior crash/restart
    try:
        from sqlalchemy import select, update
        from app.models import SyncLog
        async with async_session() as db:
            await db.execute(
                update(SyncLog)
                .where(SyncLog.status == "in_progress")
                .values(
                    status="error",
                    error_message="Interrupted by server restart",
                    completed_at=datetime.now(timezone.utc),
                )
            )
            await db.commit()
            _log.info("Cleaned up orphaned in_progress sync logs")
    except Exception as e:
        _log.warning("Failed to clean up orphaned sync logs: %s", e)

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

app.include_router(api_router, prefix="/api")
app.include_router(upload_router, prefix="/api/upload", tags=["upload"])


@app.get("/api/health")
async def health():
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        return {"status": "ok"}
    except Exception:
        return {"status": "degraded", "db": "unreachable"}
