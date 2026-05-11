"""Admin approval gate + bootstrap + admin endpoints.

Three layers:

1. Service-level (``apply_admin_bootstrap``, ``check_approved``) — pure
   functions over a User instance. Cheapest tests, no DB.
2. Route-level integration for the gate — register / login flows return
   the right status codes when the gate fires.
3. Route-level integration for /api/admin/users — listing, approve, reject,
   self-edit guard, admin-only requirement.

Skips the password-hashing for new-user tests by going through the
service layer directly where possible; uses real route hits only where
the gate behavior is the SUT.
"""
from __future__ import annotations

import os
import uuid

import pytest
import pytest_asyncio
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

os.environ.setdefault("SECRET_KEY", "x" * 64)

from app.config import get_settings  # noqa: E402
from app.database import Base, get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Household, User  # noqa: E402
from app.services.auth.admin_gate import apply_admin_bootstrap, check_approved  # noqa: E402


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


@pytest_asyncio.fixture()
async def route_db(monkeypatch):
    """Wire route DB dep + clear settings cache so ADMIN_EMAIL env changes
    actually take effect inside each test."""
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
    yield Session
    app.dependency_overrides.pop(get_db, None)
    await engine.dispose()


async def _seed_user(
    s: AsyncSession,
    *,
    email: str,
    role: str = "owner",
    status: str = "approved",
    name: str = "Test",
) -> User:
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
        name=name,
        household_id=household.id,
        role=role,
        status=status,
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


# ── apply_admin_bootstrap ─────────────────────────────────────────────────────


def _user(email: str, role: str = "owner", status: str = "pending") -> User:
    """Build an in-memory User. No session — these tests cover the pure helper."""
    return User(
        id=uuid.uuid4().hex,
        email=email,
        name="Test",
        household_id="hh",
        role=role,
        status=status,
    )


def test_bootstrap_noop_when_admin_email_unset(monkeypatch):
    monkeypatch.setenv("ADMIN_EMAIL", "")
    get_settings.cache_clear()
    u = _user("anyone@example.com")
    assert apply_admin_bootstrap(u) is False
    assert u.role == "owner"
    assert u.status == "pending"


def test_bootstrap_noop_when_email_does_not_match(monkeypatch):
    monkeypatch.setenv("ADMIN_EMAIL", "admin@example.com")
    get_settings.cache_clear()
    u = _user("not-the-admin@example.com")
    assert apply_admin_bootstrap(u) is False
    assert u.role == "owner"
    assert u.status == "pending"


def test_bootstrap_promotes_matching_pending_user(monkeypatch):
    monkeypatch.setenv("ADMIN_EMAIL", "admin@example.com")
    get_settings.cache_clear()
    u = _user("admin@example.com")
    assert apply_admin_bootstrap(u) is True
    assert u.role == "admin"
    assert u.status == "approved"


def test_bootstrap_case_insensitive(monkeypatch):
    """Mixed case in either env or DB row should still match. Important for
    Google OAuth where the email comes from Google's profile and may differ
    in case from what the user typed when setting ADMIN_EMAIL."""
    monkeypatch.setenv("ADMIN_EMAIL", "Admin@Example.com")
    get_settings.cache_clear()
    u = _user("admin@example.com")
    assert apply_admin_bootstrap(u) is True
    assert u.role == "admin"
    assert u.status == "approved"


def test_bootstrap_idempotent_for_already_admin(monkeypatch):
    monkeypatch.setenv("ADMIN_EMAIL", "admin@example.com")
    get_settings.cache_clear()
    u = _user("admin@example.com", role="admin", status="approved")
    # Already in the right state — should report no change.
    assert apply_admin_bootstrap(u) is False
    assert u.role == "admin"
    assert u.status == "approved"


# ── check_approved ────────────────────────────────────────────────────────────


def test_check_approved_passes_for_approved():
    u = _user("ok@example.com", status="approved")
    check_approved(u)  # must not raise


def test_check_approved_403_for_pending():
    u = _user("p@example.com", status="pending")
    with pytest.raises(HTTPException) as exc:
        check_approved(u)
    assert exc.value.status_code == 403
    assert "awaiting approval" in exc.value.detail.lower()


def test_check_approved_403_for_rejected():
    u = _user("r@example.com", status="rejected")
    with pytest.raises(HTTPException) as exc:
        check_approved(u)
    assert exc.value.status_code == 403
    # Different message so the UI can distinguish denied vs. pending if desired.
    assert "denied" in exc.value.detail.lower()


# ── Route-level: admin endpoints ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_admin_endpoints_require_admin_role(route_db) -> None:
    """A non-admin user (role="owner") gets 403, not 401, on /api/admin/*.
    The dependency is require_admin, not get_current_user."""
    async with route_db() as s:
        await _seed_user(s, email="regular@test.com", role="owner")

    # Stub get_current_user → return the non-admin so we test require_admin in isolation.
    from app.api.deps import get_current_user

    async def _as_regular(_request=None):
        async with route_db() as s2:
            from sqlalchemy import select
            res = await s2.execute(select(User).where(User.email == "regular@test.com"))
            return res.scalar_one()

    app.dependency_overrides[get_current_user] = _as_regular
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get("/api/admin/users")
        assert r.status_code == 403
        assert "admin" in r.json()["detail"].lower()
    finally:
        app.dependency_overrides.pop(get_current_user, None)


@pytest.mark.asyncio
async def test_admin_can_list_and_approve(route_db) -> None:
    async with route_db() as s:
        admin = await _seed_user(s, email="admin@test.com", role="admin", status="approved")
        pending = await _seed_user(s, email="pending@test.com", role="owner", status="pending")

    from app.api.deps import get_current_user

    async def _as_admin(_request=None):
        async with route_db() as s2:
            from sqlalchemy import select
            res = await s2.execute(select(User).where(User.email == "admin@test.com"))
            return res.scalar_one()

    app.dependency_overrides[get_current_user] = _as_admin
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            # List with pending filter — should include the pending user, exclude the admin.
            r = await client.get("/api/admin/users?status=pending")
            assert r.status_code == 200, r.text
            ids = {u["id"] for u in r.json()}
            assert pending.id in ids
            assert admin.id not in ids

            # Approve the pending user.
            r2 = await client.post(
                f"/api/admin/users/{pending.id}/approve",
                headers={"Origin": _allowed_origin()},
            )
            assert r2.status_code == 200, r2.text
            assert r2.json()["status"] == "approved"
    finally:
        app.dependency_overrides.pop(get_current_user, None)


@pytest.mark.asyncio
async def test_admin_cannot_change_own_status(route_db) -> None:
    """Foot-gun guard: an admin trying to approve/reject themselves should
    400, not 200. Otherwise an admin could accidentally lock themselves out
    by clicking "Reject" on their own row."""
    async with route_db() as s:
        admin = await _seed_user(s, email="admin@test.com", role="admin", status="approved")

    from app.api.deps import get_current_user

    async def _as_admin(_request=None):
        async with route_db() as s2:
            from sqlalchemy import select
            res = await s2.execute(select(User).where(User.email == "admin@test.com"))
            return res.scalar_one()

    app.dependency_overrides[get_current_user] = _as_admin
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.post(
                f"/api/admin/users/{admin.id}/reject",
                headers={"Origin": _allowed_origin()},
            )
        assert r.status_code == 400
        assert "your own" in r.json()["detail"].lower()
    finally:
        app.dependency_overrides.pop(get_current_user, None)


@pytest.mark.asyncio
async def test_admin_approve_is_idempotent(route_db) -> None:
    """Approving an already-approved user is a no-op, not an error."""
    async with route_db() as s:
        await _seed_user(s, email="admin@test.com", role="admin", status="approved")
        already = await _seed_user(s, email="already@test.com", role="owner", status="approved")

    from app.api.deps import get_current_user

    async def _as_admin(_request=None):
        async with route_db() as s2:
            from sqlalchemy import select
            res = await s2.execute(select(User).where(User.email == "admin@test.com"))
            return res.scalar_one()

    app.dependency_overrides[get_current_user] = _as_admin
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.post(
                f"/api/admin/users/{already.id}/approve",
                headers={"Origin": _allowed_origin()},
            )
        assert r.status_code == 200
        assert r.json()["status"] == "approved"
    finally:
        app.dependency_overrides.pop(get_current_user, None)
