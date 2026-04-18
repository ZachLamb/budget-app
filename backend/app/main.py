from contextlib import asynccontextmanager
from datetime import datetime, timezone
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.config import get_settings
from app.database import engine, Base, async_session
from app.api.routes import router as api_router
from app.api.routes.upload import router as upload_router
from app.middleware.rate_limit import RateLimitMiddleware
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


async def _run_fsa_review_items_migration(conn):
    """Create fsa_review_items table for tracking FSA claim status."""
    r = await conn.execute(
        text(
            "SELECT 1 FROM information_schema.tables "
            "WHERE table_name = 'fsa_review_items'"
        )
    )
    if r.scalar() is not None:
        return
    await conn.execute(text("""
        CREATE TABLE fsa_review_items (
            id VARCHAR(36) PRIMARY KEY,
            household_id VARCHAR(36) NOT NULL REFERENCES households(id),
            transaction_id VARCHAR(36) NOT NULL REFERENCES transactions(id),
            status VARCHAR(20) NOT NULL DEFAULT 'pending',
            fsa_category VARCHAR(50),
            confidence VARCHAR(10),
            reason TEXT,
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
            CONSTRAINT uq_fsa_household_txn UNIQUE (household_id, transaction_id)
        )
    """))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_fsa_review_items_household_id ON fsa_review_items (household_id)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_fsa_review_items_transaction_id ON fsa_review_items (transaction_id)"))


async def _run_household_pay_schedule_migration(conn):
    """Paycheck-cycle fields on households (matches migrations/004_household_pay_schedule.sql)."""
    await conn.execute(text("ALTER TABLE households ADD COLUMN IF NOT EXISTS pay_frequency VARCHAR(20)"))
    await conn.execute(text("ALTER TABLE households ADD COLUMN IF NOT EXISTS pay_last_confirmed_date DATE"))
    await conn.execute(
        text("ALTER TABLE households ADD COLUMN IF NOT EXISTS budget_framing VARCHAR(20) NOT NULL DEFAULT 'strict'")
    )


async def _run_recurring_suggestion_dismissals_migration(conn):
    """Recurring suggestion dismissals (matches migrations/005_recurring_suggestion_dismissals.sql)."""
    await conn.execute(text("""
        CREATE TABLE IF NOT EXISTS recurring_suggestion_dismissals (
            id VARCHAR(36) PRIMARY KEY,
            household_id VARCHAR(36) NOT NULL REFERENCES households(id),
            dedupe_key VARCHAR(128) NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT uq_recurring_suggestion_household_key UNIQUE (household_id, dedupe_key)
        )
    """))
    await conn.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_recurring_suggestion_dismissals_household "
            "ON recurring_suggestion_dismissals (household_id)"
        )
    )


async def _run_cycle_commitments_migration(conn):
    """Cycle review columns + cycle_commitments table (matches migrations/006_cycle_commitments_and_review.sql)."""
    await conn.execute(
        text("ALTER TABLE households ADD COLUMN IF NOT EXISTS cycle_review_step SMALLINT NOT NULL DEFAULT 0")
    )
    await conn.execute(text("ALTER TABLE households ADD COLUMN IF NOT EXISTS cycle_review_cycle_start DATE"))
    await conn.execute(text("""
        CREATE TABLE IF NOT EXISTS cycle_commitments (
            id VARCHAR(36) PRIMARY KEY,
            household_id VARCHAR(36) NOT NULL REFERENCES households(id),
            cycle_start_date DATE NOT NULL,
            cycle_end_date DATE NOT NULL,
            title VARCHAR(300) NOT NULL,
            kind VARCHAR(20) NOT NULL,
            payload JSONB,
            status VARCHAR(20) NOT NULL DEFAULT 'active',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """))
    await conn.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_cycle_commitments_household_cycle "
            "ON cycle_commitments (household_id, cycle_start_date)"
        )
    )


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
        ("FSA review items migration", _run_fsa_review_items_migration),
        ("Household pay schedule migration", _run_household_pay_schedule_migration),
        ("Recurring suggestion dismissals migration", _run_recurring_suggestion_dismissals_migration),
        ("Cycle commitments migration", _run_cycle_commitments_migration),
    ]:
        try:
            async with engine.begin() as conn:
                await fn(conn)
        except Exception as e:
            _log.warning("%s skipped or failed: %s", label, e)

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

app.add_middleware(RateLimitMiddleware)

if get_settings().demo_mode:
    from app.middleware.demo_guard import DemoGuardMiddleware
    app.add_middleware(DemoGuardMiddleware)

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
