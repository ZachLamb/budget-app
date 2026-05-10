"""Tests for the cloud LLM cost circuit breaker.

Critical invariant: cache-hit audit rows must NOT count toward the breaker.
The breaker exists to cap GPU cost, and cache hits don't touch the GPU.
"""
from __future__ import annotations

from datetime import datetime, timezone

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models.llm import LlmAudit
from app.services.ai import circuit


@pytest_asyncio.fixture()
async def db_session() -> AsyncSession:
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False)
    async with Session() as s:
        yield s
    await engine.dispose()


def _audit_row(*, cache_hit: bool, prompt_tokens: int, completion_tokens: int) -> LlmAudit:
    return LlmAudit(
        user_id="u1",
        feature="explain_charge",
        tier=4,
        status=200,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        latency_ms=100,
        model="qwen2.5:7b",
        cache_hit=cache_hit,
        created_at=datetime.now(timezone.utc),
    )


@pytest.mark.asyncio
async def test_breaker_closed_when_no_audit(db_session: AsyncSession):
    circuit._reset_cache_for_tests()
    assert await circuit.is_open(db_session) is False


@pytest.mark.asyncio
async def test_breaker_opens_on_high_token_rate(db_session: AsyncSession):
    circuit._reset_cache_for_tests()
    db_session.add(_audit_row(cache_hit=False, prompt_tokens=600_000, completion_tokens=500_000))
    await db_session.commit()
    assert await circuit.is_open(db_session, tokens_per_hour=1_000_000) is True


@pytest.mark.asyncio
async def test_cache_hits_do_not_trip_breaker(db_session: AsyncSession):
    """If this fails, hot prompts will trip the breaker even though they cost nothing."""
    circuit._reset_cache_for_tests()
    # All cache hits — no GPU work was done.
    for _ in range(10):
        db_session.add(_audit_row(cache_hit=True, prompt_tokens=200_000, completion_tokens=200_000))
    await db_session.commit()
    # Breaker should stay closed — we set thresholds low, but cache hits filter out.
    assert await circuit.is_open(db_session, tokens_per_hour=100_000, requests_per_hour=5) is False


@pytest.mark.asyncio
async def test_breaker_opens_on_request_rate_excluding_cache_hits(db_session: AsyncSession):
    circuit._reset_cache_for_tests()
    # 2 live calls + 100 cache hits → only 2 count toward request rate.
    for _ in range(2):
        db_session.add(_audit_row(cache_hit=False, prompt_tokens=100, completion_tokens=100))
    for _ in range(100):
        db_session.add(_audit_row(cache_hit=True, prompt_tokens=100, completion_tokens=100))
    await db_session.commit()
    # requests_per_hour=10 — breaker stays closed because only 2 non-cache rows.
    assert await circuit.is_open(db_session, tokens_per_hour=999_999_999, requests_per_hour=10) is False
    # requests_per_hour=2 — now it trips on the 2 live calls.
    circuit._reset_cache_for_tests()  # bypass the 30s decision cache
    assert await circuit.is_open(db_session, tokens_per_hour=999_999_999, requests_per_hour=2) is True
