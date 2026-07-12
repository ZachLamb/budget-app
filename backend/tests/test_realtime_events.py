"""Tests for GET /api/realtime/events SSE stream."""
from __future__ import annotations

import asyncio
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.api.deps import get_current_user, get_household_id
from app.database import Base, get_db
from app.main import app
from app.middleware.rate_limit_store import InMemoryStore
from app.models import Household, User
from app.services import realtime as realtime_module
from app.services.realtime import emit_event, subscribe, _subscribers


@pytest_asyncio.fixture()
async def db_engine():
    """Shared in-memory SQLite engine for this module."""
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    await engine.dispose()


@pytest_asyncio.fixture()
async def ctx(db_engine):
    """Authenticated client fixture: DB wired, user + household overridden."""
    Session = async_sessionmaker(db_engine, expire_on_commit=False)
    db = Session()

    hh = Household(id="hh-sse", name="SSE Test")
    user = User(id="u-sse", email="sse@t.com", name="SSE", household_id="hh-sse", role="owner", status="approved")
    db.add_all([hh, user])
    await db.commit()

    async def _db():
        yield db

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_household_id] = lambda: "hh-sse"
    app.state.rate_limit_store = InMemoryStore()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c

    app.dependency_overrides.clear()


@pytest_asyncio.fixture()
async def unauthed_client(db_engine):
    """Client with DB wired but no auth override — auth dep raises 401."""
    Session = async_sessionmaker(db_engine, expire_on_commit=False)
    db = Session()

    async def _db():
        yield db

    app.dependency_overrides[get_db] = _db
    app.state.rate_limit_store = InMemoryStore()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c

    app.dependency_overrides.clear()


@pytest_asyncio.fixture(autouse=True)
async def clean_subscribers():
    """Ensure _subscribers dict is empty before/after each test."""
    realtime_module._subscribers.clear()
    yield
    realtime_module._subscribers.clear()


@pytest.mark.asyncio
async def test_realtime_requires_auth(unauthed_client):
    """No auth token → 401."""
    resp = await unauthed_client.get("/api/realtime/events")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_emit_event_delivers_to_subscriber():
    """Unit test: emit_event fans out to active subscriber queues."""
    received: list[str] = []

    async def consume():
        gen = subscribe("hh-unit")
        async for chunk in gen:
            if chunk.startswith("data:"):
                received.append(chunk)
                break  # got one event — close the generator
            # ignore SSE comment lines (: connected, : keepalive)

    task = asyncio.create_task(consume())
    await asyncio.sleep(0.01)  # let subscriber register
    await emit_event("hh-unit", "transaction.created")
    await asyncio.wait_for(task, timeout=2.0)

    assert len(received) == 1
    assert "transaction.created" in received[0]
    assert "hh-unit" in received[0]


@pytest.mark.asyncio
async def test_subscribe_first_chunk_is_connected():
    """subscribe() yields ': connected\\n\\n' as its first chunk."""
    received: list[str] = []

    async def consume_one():
        gen = subscribe("hh-keepalive")
        async for chunk in gen:
            received.append(chunk)
            break

    task = asyncio.create_task(consume_one())
    await asyncio.wait_for(task, timeout=1.0)

    # The first item is always ": connected\n\n"
    assert received[0] == ": connected\n\n"


@pytest.mark.asyncio
async def test_subscribe_sends_connected_comment():
    """subscribe() yields ': connected\\n\\n' as its first chunk."""
    gen = subscribe("hh-connect-check")
    first = await gen.__anext__()
    assert first == ": connected\n\n"
    # Clean up — push None sentinel so the generator exits cleanly
    import asyncio as _asyncio
    for q in list(_subscribers.get("hh-connect-check", set())):
        try:
            q.put_nowait(None)
        except _asyncio.QueueFull:
            pass
