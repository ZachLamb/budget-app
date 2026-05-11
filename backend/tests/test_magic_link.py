"""Magic-link sign-in flow.

Covers: issuance creates a row with hashed token + future expiry,
redemption is single-use, expired tokens fail, revoking outstanding
tokens on re-issue, and the anti-enumeration property at the route
level (unknown email returns 200 with same shape as known email).

Mocks Resend so tests don't hit the network. Verifies that the email
service is called for known emails and NOT called for unknown emails —
but the HTTP response is identical either way.
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

# Configure email envs BEFORE app loads so settings.resend_api_key is non-empty.
os.environ.setdefault("RESEND_API_KEY", "test-resend-key")
os.environ.setdefault("EMAIL_FROM_ADDRESS", "noreply@clarity.test")
os.environ.setdefault("FRONTEND_URL", "http://localhost:3001")

from app.config import get_settings  # noqa: E402
from app.database import Base, get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Household, MagicLink, User  # noqa: E402
from app.services.auth import magic_link as ml_service  # noqa: E402


# ── Fixtures ──────────────────────────────────────────────────────────────────


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


async def _seed_user(s: AsyncSession, email: str) -> User:
    from sqlalchemy import select as _select

    existing = await s.execute(_select(Household).limit(1))
    household = existing.scalar_one_or_none()
    if household is None:
        household = Household(id=uuid.uuid4().hex, name="Test")
        s.add(household)
        await s.flush()
    user = User(
        id=uuid.uuid4().hex,
        email=email,
        name="Test",
        household_id=household.id,
        status="approved",  # pre-gate normal user; admin-gate tests use a separate factory
    )
    s.add(user)
    await s.commit()
    return user


def _allowed_origin() -> str:
    raw = os.environ.get(
        "CORS_ORIGINS",
        "http://localhost:3000,http://localhost:3001,http://localhost:80",
    )
    return raw.split(",")[0].strip()


# ── Service-layer tests ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_issue_stores_hash_not_plaintext(db_session: AsyncSession):
    user = await _seed_user(db_session, "issue@test.com")
    token = await ml_service.issue(db_session, user.id)
    # Plaintext token returned to caller.
    assert isinstance(token, str) and len(token) >= 40
    # DB stores only the hash.
    row = (await db_session.execute(select(MagicLink))).scalar_one()
    assert row.token_hash != token
    assert len(row.token_hash) == 64  # sha256 hex
    assert row.user_id == user.id
    assert row.used_at is None
    assert row.revoked_at is None
    # SQLite drops tzinfo on read; coerce before comparing.
    expires = row.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    assert expires > datetime.now(timezone.utc)


@pytest.mark.asyncio
async def test_redeem_consumes_token_and_returns_user_id(db_session: AsyncSession):
    user = await _seed_user(db_session, "redeem@test.com")
    token = await ml_service.issue(db_session, user.id)
    uid = await ml_service.redeem(db_session, token)
    assert uid == user.id


@pytest.mark.asyncio
async def test_redeem_is_single_use(db_session: AsyncSession):
    user = await _seed_user(db_session, "single@test.com")
    token = await ml_service.issue(db_session, user.id)
    first = await ml_service.redeem(db_session, token)
    second = await ml_service.redeem(db_session, token)
    assert first == user.id
    assert second is None


@pytest.mark.asyncio
async def test_redeem_rejects_expired_token(db_session: AsyncSession):
    user = await _seed_user(db_session, "expired@test.com")
    # Issue with a negative TTL so it's already expired.
    token = await ml_service.issue(db_session, user.id, ttl=timedelta(seconds=-1))
    uid = await ml_service.redeem(db_session, token)
    assert uid is None


@pytest.mark.asyncio
async def test_redeem_rejects_unknown_token(db_session: AsyncSession):
    uid = await ml_service.redeem(db_session, "not-a-real-token")
    assert uid is None


@pytest.mark.asyncio
async def test_redeem_rejects_empty_or_oversized(db_session: AsyncSession):
    assert await ml_service.redeem(db_session, "") is None
    assert await ml_service.redeem(db_session, "x" * 500) is None


@pytest.mark.asyncio
async def test_new_issue_revokes_outstanding_tokens(db_session: AsyncSession):
    user = await _seed_user(db_session, "revoke@test.com")
    token_a = await ml_service.issue(db_session, user.id)
    token_b = await ml_service.issue(db_session, user.id)
    # New token works.
    assert await ml_service.redeem(db_session, token_b) == user.id
    # Old token doesn't (revoked at issuance of B).
    db_session.expire_all()
    assert await ml_service.redeem(db_session, token_a) is None


@pytest.mark.asyncio
async def test_prune_expired_deletes_old_rows(db_session: AsyncSession):
    user = await _seed_user(db_session, "prune@test.com")
    # One old row, one new row.
    old = MagicLink(
        user_id=user.id,
        token_hash="a" * 64,
        expires_at=datetime.now(timezone.utc) - timedelta(days=30),
        created_at=datetime.now(timezone.utc) - timedelta(days=30),
    )
    db_session.add(old)
    await ml_service.issue(db_session, user.id)
    deleted = await ml_service.prune_expired(db_session, older_than=timedelta(days=7))
    assert deleted == 1
    rows = (await db_session.execute(select(MagicLink))).scalars().all()
    assert len(rows) == 1  # only the fresh issue survived


# ── Route-level tests ─────────────────────────────────────────────────────────


@pytest_asyncio.fixture()
async def route_db():
    """Wire the route's DB dependency to an in-memory SQLite."""
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False)

    async def _get_db():
        async with Session() as s:
            try:
                yield s
                await s.commit()
            except Exception:
                await s.rollback()
                raise

    app.dependency_overrides[get_db] = _get_db
    # Also expose the session factory so tests can pre-seed users.
    yield Session
    app.dependency_overrides.pop(get_db, None)
    await engine.dispose()


@pytest.mark.asyncio
async def test_route_known_email_sends_real_email(route_db) -> None:
    async with route_db() as s:
        await _seed_user(s, "known@test.com")

    mock_send = AsyncMock(return_value=type("R", (), {"ok": True, "provider_id": "msg_1", "error": None})())
    with patch("app.api.routes.magic_link.email_service.send_email", mock_send):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.post(
                "/api/auth/magic-link/request",
                json={"email": "known@test.com"},
                headers={"Origin": _allowed_origin()},
            )
    assert r.status_code == 200
    assert r.json() == {"ok": True}
    mock_send.assert_awaited_once()
    # The argument should include the user's email in `to=`.
    kwargs = mock_send.await_args.kwargs
    assert kwargs["to"] == "known@test.com"
    assert "token=" in kwargs["text"]
    assert "token=" in kwargs["html"]


@pytest.mark.asyncio
async def test_route_unknown_email_returns_same_shape_no_send(route_db) -> None:
    mock_send = AsyncMock()
    with patch("app.api.routes.magic_link.email_service.send_email", mock_send):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.post(
                "/api/auth/magic-link/request",
                json={"email": "nobody@test.com"},
                headers={"Origin": _allowed_origin()},
            )
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True}
    # CRITICAL: no email was sent. An attacker cannot tell whether the
    # email exists from response content, latency, or absence of an email
    # (they don't have access to the inbox).
    mock_send.assert_not_called()


@pytest.mark.asyncio
async def test_route_verify_redeems_and_sets_cookie(route_db) -> None:
    async with route_db() as s:
        user = await _seed_user(s, "verify@test.com")
        token = await ml_service.issue(s, user.id)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get(f"/api/auth/magic-link/verify?token={token}")
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True}
    set_cookie = r.headers.get("set-cookie", "")
    assert "session=" in set_cookie
    assert "HttpOnly" in set_cookie


@pytest.mark.asyncio
async def test_route_verify_rejects_used_token(route_db) -> None:
    async with route_db() as s:
        user = await _seed_user(s, "used@test.com")
        token = await ml_service.issue(s, user.id)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        first = await client.get(f"/api/auth/magic-link/verify?token={token}")
        second = await client.get(f"/api/auth/magic-link/verify?token={token}")
    assert first.status_code == 200
    assert second.status_code == 400
    # Generic error — never reveal whether the token never existed vs was already used.
    assert "Invalid or expired" in second.json().get("detail", "")


@pytest.mark.asyncio
async def test_route_verify_rejects_garbage_token(route_db) -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/api/auth/magic-link/verify?token=garbage-not-a-token-12345")
    assert r.status_code == 400
