"""prefer_local_server: settings round-trip + blanket consent for the local tier.

When a household opts to use its own model server (LM Studio / Ollama), the
opt-in itself is consent for that tier — the /api/llm/cloud route must allow
generation with no per-feature consent row.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import httpx
import jwt
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.api.deps import ALGORITHM, get_current_user
from app.config import get_settings
from app.database import Base, get_db
from app.main import app
from app.middleware.rate_limit_store import InMemoryStore
from app.models import Household, User
from app.services.ai import llm_client
from app.api.routes import llm as llm_route


def _token(uid: str) -> str:
    return jwt.encode(
        {"sub": uid, "exp": datetime.now(timezone.utc) + timedelta(minutes=30)},
        get_settings().secret_key,
        algorithm=ALGORITHM,
    )


@pytest_asyncio.fixture()
async def db_session():
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session = async_sessionmaker(engine, expire_on_commit=False)()

    async def _override():
        yield session

    app.dependency_overrides[get_db] = _override
    prior = getattr(app.state, "rate_limit_store", None)
    app.state.rate_limit_store = InMemoryStore()
    try:
        yield session
    finally:
        app.dependency_overrides.pop(get_db, None)
        await session.close()
        await engine.dispose()
        if prior is not None:
            app.state.rate_limit_store = prior


@pytest.fixture(autouse=True)
def _reset_transport():
    yield
    llm_client._TEST_TRANSPORT = None


async def _seed(session, *, prefer_local: bool) -> dict:
    hid, uid = str(uuid.uuid4()), str(uuid.uuid4())
    session.add(Household(id=hid, name="H", prefer_local_server=prefer_local))
    session.add(User(
        id=uid, email=f"{uid}@t.io", name="T", password_hash=None,
        household_id=hid, role="owner", status="approved",
    ))
    await session.commit()
    return {"Authorization": f"Bearer {_token(uid)}"}


def _mock_lmstudio():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            content=b'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n',
        )
    return httpx.MockTransport(handler)


@pytest.mark.asyncio
async def test_settings_put_persists_prefer_local_server(db_session):
    headers = await _seed(db_session, prefer_local=False)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.put(
            "/api/settings/ai", headers=headers,
            json={"ai_enabled": True, "prefer_local_server": True},
        )
    assert resp.status_code == 200
    assert resp.json() == {"ai_enabled": True, "prefer_local_server": True}


@pytest.mark.asyncio
async def test_prefer_local_server_is_blanket_consent(db_session, monkeypatch):
    headers = await _seed(db_session, prefer_local=True)
    monkeypatch.setattr(
        llm_client, "get_settings",
        lambda: SimpleNamespace(ollama_url="http://localhost:1234", ollama_model="gemma", llm_backend_api_key="", demo_mode=False),
    )
    monkeypatch.setattr(llm_route.audit, "write", lambda *a, **k: _async_none())
    llm_client._TEST_TRANSPORT = _mock_lmstudio()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # No consent row exists, but prefer_local_server is on → allowed.
        resp = await client.post(
            "/api/llm/cloud",
            headers=headers,
            json={"feature": "financial_advice", "prompt": "hi", "system": "s", "max_tokens": 32},
        )
    assert resp.status_code == 200
    assert "ok" in resp.text


@pytest.mark.asyncio
async def test_without_prefer_or_consent_is_forbidden(db_session, monkeypatch):
    headers = await _seed(db_session, prefer_local=False)
    monkeypatch.setattr(
        llm_client, "get_settings",
        lambda: SimpleNamespace(ollama_url="http://localhost:1234", ollama_model="gemma", llm_backend_api_key="", demo_mode=False),
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post(
            "/api/llm/cloud",
            headers=headers,
            json={"feature": "financial_advice", "prompt": "hi", "system": "s", "max_tokens": 32},
        )
    assert resp.status_code == 403


async def _async_none():
    return None
