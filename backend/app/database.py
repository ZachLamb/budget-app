import asyncio

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, InterfaceError, OperationalError
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from app.config import get_settings


class Base(DeclarativeBase):
    pass


_settings = get_settings()

# Railway (and other PaaS) provide postgresql:// but asyncpg needs postgresql+asyncpg://
_db_url = _settings.database_url
if _db_url.startswith("postgresql://"):
    _db_url = _db_url.replace("postgresql://", "postgresql+asyncpg://", 1)

engine = create_async_engine(
    _db_url,
    echo=False,
    pool_pre_ping=True,
    pool_size=_settings.db_pool_size,
    max_overflow=_settings.db_max_overflow,
)

async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


# Delay before the single connect retry. A dropped connection during
# establishment (e.g. a briefly stalled Postgres — seen in prod when the DB
# machine was memory-starved) is not caught by pool_pre_ping; a short pause
# gives the server a beat to accept connections again.
_CONNECT_RETRY_DELAY_S = 0.25


def _is_retryable_probe_failure(exc: DBAPIError) -> bool:
    # Deliberately broad: the probe (`SELECT 1`) is trivial and idempotent,
    # so retrying it after ANY OperationalError/InterfaceError is harmless —
    # even ones that aren't strictly connection drops (e.g. statement
    # timeouts, which the probe itself won't realistically hit).
    return (
        isinstance(exc, (OperationalError, InterfaceError))
        or exc.connection_invalidated
    )


async def _ensure_live_connection(session: AsyncSession) -> None:
    """Eagerly establish the session's connection, retrying once.

    Runs BEFORE the request handler sees the session, so a retry can never
    re-execute application statements. Persistent connect failure surfaces
    as 503 (retryable) instead of a raw 500.

    Deliberate cost trade-off: this adds one DB round-trip per request and
    begins the session's transaction at request start (including the few
    routes that depend on get_db but never query). Accepted: the round-trip
    is sub-millisecond against a healthy pool, and the alternative (retry at
    first handler statement) risks re-executing application SQL.
    """
    try:
        await session.execute(text("SELECT 1"))
        return
    except DBAPIError as exc:
        if not _is_retryable_probe_failure(exc):
            raise
    await session.rollback()
    await asyncio.sleep(_CONNECT_RETRY_DELAY_S)
    try:
        await session.execute(text("SELECT 1"))
    except DBAPIError as exc:
        if not _is_retryable_probe_failure(exc):
            raise
        raise HTTPException(
            503, "Database temporarily unavailable. Try again in a moment."
        ) from exc


async def get_db() -> AsyncSession:
    async with async_session() as session:
        await _ensure_live_connection(session)
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
