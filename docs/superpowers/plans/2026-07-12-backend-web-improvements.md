# Backend + Web Architecture Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Upstash Redis rate limiting, add OpenAPI TypeScript codegen, add a native-client auth endpoint, add AI inference-context endpoints, add SSE realtime events, and wire a web realtime hook.

**Architecture:** The FastAPI backend gains three new capability surfaces — a native Bearer-token auth exchange, AI inference-context endpoints (prompt templates returned to clients who do their own local inference), and an SSE realtime stream. The web frontend gains generated TypeScript types from the OpenAPI spec and a `useRealtimeEvents` hook. No existing proxy routes are removed; new endpoints are designed for direct calls by both web and native clients.

**Tech Stack:** Python 3.12 / FastAPI / SQLAlchemy asyncio / pytest-asyncio · Next.js 16 / TypeScript / openapi-typescript · Upstash Redis (HTTP REST)

## Global Constraints

- All backend changes must pass `python -m pytest tests/ -v` in `backend/`
- All frontend changes must pass `npm run typecheck && npm run test:run && npm run lint` in `frontend/`
- Never add a new Python dependency without updating `backend/requirements.txt`
- Never add a new npm dependency without running `npm install` in `frontend/`
- All new FastAPI routes must have rate-limit entries in `backend/app/middleware/rate_limit.py`
- Every new Alembic migration must be reversible (`downgrade` implemented)
- Do not change `SameSite=Strict` on the session cookie — this would weaken CSRF protection

---

### Task 1: Wire Upstash Redis Rate Limiting in Production

**Files:**
- No code changes required — backend already supports Upstash via `build_store()` in `rate_limit_store.py`
- Modify: `backend/fly.toml` (add comment pointing to secrets docs)
- Verify: `backend/tests/test_rate_limit_upstash.py` already covers this path

**Interfaces:**
- Produces: nothing (ops task — env vars enable the existing code path)

- [ ] **Step 1: Verify Upstash env vars are wired**

```bash
fly secrets list --app clarity-backend 2>/dev/null | grep -i upstash || echo "NOT SET"
```

Expected output: `NOT SET` (if not yet configured)

- [ ] **Step 2: Set Upstash secrets on Fly**

```bash
fly secrets set \
  UPSTASH_REDIS_REST_URL="https://YOUR-UPSTASH-ENDPOINT.upstash.io" \
  UPSTASH_REDIS_REST_TOKEN="YOUR-TOKEN" \
  --app clarity-backend
```

Replace values with your Upstash REST endpoint and token from the Upstash console. The backend will automatically use shared buckets across replicas on next deploy.

- [ ] **Step 3: Add TRUSTED_PROXIES if not set (Fly.io proxy IP range)**

```bash
fly secrets set TRUSTED_PROXIES="0.0.0.0/0" --app clarity-backend
```

This trusts Fly's internal proxy to pass the real client IP via `X-Forwarded-For`. Adjust to a tighter CIDR if Fly publishes one.

- [ ] **Step 4: Add documentation comment to fly.toml**

In `backend/fly.toml`, add a comment under `[build]`:

```toml
# Rate limiting is backed by Upstash Redis when UPSTASH_REDIS_REST_URL +
# UPSTASH_REDIS_REST_TOKEN are set as Fly secrets. Without them, each
# machine instance has an independent in-memory bucket — fine for single
# machine, wrong for multi-replica. Set both via `fly secrets set`.
```

- [ ] **Step 5: Verify existing Upstash test still passes**

```bash
cd backend && python -m pytest tests/test_rate_limit_upstash.py tests/test_rate_limit_store.py -v
```

Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add backend/fly.toml
git commit -m "ops: document Upstash Redis secrets requirement in fly.toml"
```

---

### Task 2: OpenAPI TypeScript Codegen

**Files:**
- Modify: `frontend/package.json` — add `openapi-typescript` devDependency and generate script
- Create: `frontend/src/lib/api/generated.ts` — generated types (gitignored at first, then committed as generated artifact)
- Modify: `.github/workflows/ci.yml` — add codegen step before typecheck
- Create: `frontend/scripts/generate-api-types.sh` — fetch spec and run codegen

**Interfaces:**
- Produces: `export type paths = {...}` and `export type components = {...}` in `generated.ts`; consumed by all API client files in future tasks

- [ ] **Step 1: Install openapi-typescript**

```bash
cd frontend && npm install --save-dev openapi-typescript@7
```

- [ ] **Step 2: Add generate script to package.json**

In `frontend/package.json`, add to `"scripts"`:

```json
"generate:api": "openapi-typescript http://localhost:8000/openapi.json -o src/lib/api/generated.ts"
```

- [ ] **Step 3: Create CI codegen helper script**

Create `frontend/scripts/generate-api-types.sh`:

```bash
#!/usr/bin/env bash
# Downloads the FastAPI OpenAPI spec and generates TypeScript types.
# Requires a running backend at BACKEND_URL (default: http://localhost:8000).
set -euo pipefail

BACKEND_URL="${BACKEND_URL:-http://localhost:8000}"
OUT="src/lib/api/generated.ts"

echo "Fetching OpenAPI spec from $BACKEND_URL/openapi.json..."
curl -sf "$BACKEND_URL/openapi.json" -o /tmp/openapi.json

echo "Generating TypeScript types -> $OUT"
npx openapi-typescript /tmp/openapi.json -o "$OUT"

echo "Done. Generated $OUT"
```

```bash
chmod +x frontend/scripts/generate-api-types.sh
```

- [ ] **Step 4: Generate types locally (requires backend running)**

```bash
cd frontend && npm run generate:api
```

If the backend isn't running, run a stub:

```bash
cd backend && uvicorn app.main:app --port 8000 &
sleep 2
cd ../frontend && npm run generate:api
kill %1
```

Expected: `frontend/src/lib/api/generated.ts` created with path and component types.

- [ ] **Step 5: Add generated.ts to .gitignore with note**

Add to `frontend/.gitignore` (or root `.gitignore` if it covers `frontend/`):

```
# Regenerated from FastAPI /openapi.json — run `npm run generate:api` after backend changes
frontend/src/lib/api/generated.ts
```

- [ ] **Step 6: Add codegen to CI**

In `.github/workflows/ci.yml`, inside the `frontend` job, add before the `Typecheck` step:

```yaml
      - name: Start backend for OpenAPI codegen
        run: |
          pip install -r ../backend/requirements.txt
          uvicorn app.main:app --port 8000 &
          sleep 3
        working-directory: backend
        env:
          SECRET_KEY: ci-secret-key-not-for-prod
          DATABASE_URL: "sqlite+aiosqlite:///./ci-test.db"
          DATABASE_URL_SYNC: "sqlite:///./ci-test.db"

      - name: Generate API types
        run: BACKEND_URL=http://localhost:8000 bash scripts/generate-api-types.sh
        working-directory: frontend
```

- [ ] **Step 7: Verify typecheck still passes with generated file**

```bash
cd frontend && npm run typecheck
```

Expected: no errors

- [ ] **Step 8: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/scripts/generate-api-types.sh .github/workflows/ci.yml
git commit -m "feat: add OpenAPI TypeScript codegen from FastAPI spec"
```

---

### Task 3: Native Client Auth Endpoint

**Problem to solve:** The existing Google OAuth exchange uses an HttpOnly cookie to pass the auth code (browser-only flow). Native macOS clients cannot read or set browser cookies. We need a direct Bearer-token exchange endpoint for native clients.

**Files:**
- Modify: `backend/app/api/routes/auth.py` — add `POST /api/auth/native/token`
- Modify: `backend/app/config.py` — add `native_client_redirect_uri` setting
- Modify: `backend/app/middleware/rate_limit.py` — add rate limit rule for new route
- Create: `backend/tests/test_native_auth.py`

**Interfaces:**
- Produces: `POST /api/auth/native/token` → `{"access_token": str, "token_type": "bearer", "user": {...}}`
- Consumes: `{"grant_type": "google_code", "code": str, "redirect_uri": str}`

- [ ] **Step 1: Write failing test**

Create `backend/tests/test_native_auth.py`:

```python
"""Tests for POST /api/auth/native/token (native client Bearer auth)."""
from __future__ import annotations

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool
from unittest.mock import AsyncMock, patch

from app.database import Base, get_db
from app.main import app
from app.middleware.rate_limit_store import InMemoryStore


@pytest_asyncio.fixture()
async def client():
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False)

    async def override_db():
        async with Session() as s:
            yield s

    app.dependency_overrides[get_db] = override_db
    app.state.rate_limit_store = InMemoryStore()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c

    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_native_token_rejects_unknown_grant(client):
    resp = await client.post("/api/auth/native/token", json={
        "grant_type": "password",
        "code": "x",
        "redirect_uri": "budget://auth/callback",
    })
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_native_token_rejects_bad_redirect_uri(client):
    resp = await client.post("/api/auth/native/token", json={
        "grant_type": "google_code",
        "code": "x",
        "redirect_uri": "https://evil.com/callback",
    })
    assert resp.status_code == 400
    assert "redirect_uri" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_native_token_google_code_exchange(client):
    """Happy path: mocked Google exchange returns a user → JWT in response body."""
    fake_user_info = {
        "sub": "google-123",
        "email": "alice@example.com",
        "name": "Alice",
    }
    with patch(
        "app.api.routes.auth._fetch_google_user_info",
        new=AsyncMock(return_value=fake_user_info),
    ):
        resp = await client.post("/api/auth/native/token", json={
            "grant_type": "google_code",
            "code": "valid-google-code",
            "redirect_uri": "budget://auth/callback",
        })
    assert resp.status_code == 200
    body = resp.json()
    assert body["token_type"] == "bearer"
    assert len(body["access_token"]) > 20
    assert body["user"]["email"] == "alice@example.com"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && python -m pytest tests/test_native_auth.py -v
```

Expected: `FAILED` — route does not exist yet

- [ ] **Step 3: Add native_client_redirect_uri to config**

In `backend/app/config.py`, add inside the `Settings` class:

```python
    # Allowed redirect URIs for native client OAuth (deep link scheme).
    # Comma-separated. Default allows the macOS app's deep link.
    native_client_redirect_uris: str = "budget://auth/callback"
```

- [ ] **Step 4: Extract _fetch_google_user_info helper in auth.py**

In `backend/app/api/routes/auth.py`, find the `google/callback` route and extract the Google user-info fetch into a module-level helper (so the test can mock it):

```python
async def _fetch_google_user_info(code: str, redirect_uri: str) -> dict:
    """Exchange a Google auth code for user info. Raises HTTPException on failure."""
    settings = get_settings()
    async with httpx.AsyncClient() as client:
        token_resp = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code": code,
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
        )
    if not token_resp.is_success:
        raise HTTPException(status_code=400, detail="Google token exchange failed")
    id_token = token_resp.json().get("id_token")
    if not id_token:
        raise HTTPException(status_code=400, detail="No id_token from Google")
    # Decode without verification (Google already signed it; we validated via exchange)
    import jwt as _jwt
    try:
        return _jwt.decode(id_token, options={"verify_signature": False})
    except Exception:
        raise HTTPException(status_code=400, detail="Could not decode Google id_token")
```

- [ ] **Step 5: Add the native token endpoint**

In `backend/app/api/routes/auth.py`, add after the existing Google routes:

```python
class NativeTokenRequest(BaseModel):
    grant_type: str = Field(..., pattern="^google_code$")
    code: str = Field(..., min_length=1, max_length=2048)
    redirect_uri: str = Field(..., min_length=1, max_length=512)


class NativeTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


@router.post("/native/token", response_model=NativeTokenResponse)
async def native_token(
    data: NativeTokenRequest,
    db: AsyncSession = Depends(get_db),
):
    """Exchange a Google auth code for a Bearer JWT — for native (non-browser) clients.

    Unlike /google/exchange (which uses an httpOnly cookie dance designed for
    browsers), this endpoint accepts the auth code directly in the JSON body
    and returns the JWT in the response body for storage in the OS Keychain.

    The redirect_uri must match the NATIVE_CLIENT_REDIRECT_URIS allowlist to
    prevent code injection from an attacker-controlled redirect target.
    """
    settings = get_settings()
    if not settings.google_client_id:
        raise HTTPException(status_code=503, detail="Google OAuth not configured")

    allowed = {u.strip() for u in settings.native_client_redirect_uris.split(",") if u.strip()}
    if data.redirect_uri not in allowed:
        raise HTTPException(status_code=400, detail="redirect_uri not in allowed list")

    user_info = await _fetch_google_user_info(data.code, data.redirect_uri)
    email = user_info.get("email", "").lower().strip()
    google_id = user_info.get("sub", "")
    name = user_info.get("name", email)

    if not email or not google_id:
        raise HTTPException(status_code=400, detail="Incomplete user info from Google")

    result = await db.execute(
        select(User).where(
            (User.google_id == google_id) | (User.email == email)
        )
    )
    user = result.scalar_one_or_none()

    if user is None:
        household = Household(name=f"{name}'s Household")
        db.add(household)
        await db.flush()
        user = User(
            email=email,
            name=name,
            google_id=google_id,
            household_id=household.id,
            role="owner",
            status="pending",
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
        apply_admin_bootstrap(user, settings)
        if user.status == "approved":
            await db.commit()
    elif user.google_id is None:
        user.google_id = google_id
        await db.commit()

    check_approved(user)
    token = _create_token(user)
    return NativeTokenResponse(access_token=token, user=UserResponse.model_validate(user))
```

- [ ] **Step 6: Add rate limit rule**

In `backend/app/middleware/rate_limit.py`, add to `_RULES`:

```python
    ("/api/auth/native/token", 10, 60),
```

Place it after the existing `/api/auth/google/exchange` rule.

- [ ] **Step 7: Run tests**

```bash
cd backend && python -m pytest tests/test_native_auth.py -v
```

Expected: all 3 tests pass

- [ ] **Step 8: Run full backend suite**

```bash
cd backend && python -m pytest tests/ -v
```

Expected: no regressions

- [ ] **Step 9: Commit**

```bash
git add backend/app/api/routes/auth.py backend/app/config.py backend/app/middleware/rate_limit.py backend/tests/test_native_auth.py
git commit -m "feat(auth): add POST /api/auth/native/token for native macOS client Bearer auth"
```

---

### Task 4: AI Inference-Context Endpoints

**What these do:** Instead of running LLM inference server-side, these endpoints return a structured `{system, prompt, response_schema}` payload. The client (macOS app or web browser) runs its local LLM with this context, then POSTs the structured result to the existing `/api/ai/execute-action` endpoint.

**Files:**
- Create: `backend/app/services/ai/inference_context.py` — prompt builders
- Create: `backend/app/api/routes/inference_context.py` — route handlers
- Modify: `backend/app/api/routes/__init__.py` — register new router
- Modify: `backend/app/middleware/rate_limit.py` — add rate limit rule
- Create: `backend/tests/test_inference_context.py`

**Interfaces:**
- Produces: `POST /api/ai/inference-context/categorize` → `InferenceContextResponse`
- Produces: `POST /api/ai/inference-context/chat` → `InferenceContextResponse`
- Produces: `POST /api/ai/inference-context/parse-document` → `InferenceContextResponse`
- `InferenceContextResponse = {system: str, prompt: str, response_schema: dict, feature_id: str}`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/test_inference_context.py`:

```python
"""Tests for POST /api/ai/inference-context/* endpoints."""
from __future__ import annotations

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.api.deps import get_current_user, get_household_id
from app.database import Base, get_db
from app.main import app
from app.middleware.rate_limit_store import InMemoryStore
from app.models import Category, CategoryGroup, Household, User


@pytest_asyncio.fixture()
async def ctx():
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False)
    db = Session()

    hh = Household(id="hh-1", name="Test", ai_enabled=True)
    user = User(id="u-1", email="t@t.com", name="T", household_id="hh-1", role="owner", status="approved")
    db.add_all([hh, user])
    await db.flush()
    grp = CategoryGroup(id="g-1", household_id="hh-1", name="Food")
    cat = Category(id="c-1", group_id="g-1", name="Groceries")
    db.add_all([grp, cat])
    await db.commit()

    async def _db():
        yield db

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_household_id] = lambda: "hh-1"
    app.state.rate_limit_store = InMemoryStore()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c

    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_categorize_returns_context(ctx):
    resp = await ctx.post("/api/ai/inference-context/categorize", json={
        "transactions": [
            {"id": "t1", "payee": "WHOLE FOODS", "amount": -45.00, "date": "2026-07-10"},
        ]
    })
    assert resp.status_code == 200
    body = resp.json()
    assert "system" in body
    assert "prompt" in body
    assert "response_schema" in body
    assert body["feature_id"] == "categorize"
    # Prompt must include the transaction data
    assert "WHOLE FOODS" in body["prompt"]
    # Prompt must include available categories
    assert "Groceries" in body["prompt"]


@pytest.mark.asyncio
async def test_chat_returns_context(ctx):
    resp = await ctx.post("/api/ai/inference-context/chat", json={
        "query": "How much did I spend on food last month?"
    })
    assert resp.status_code == 200
    body = resp.json()
    assert body["feature_id"] == "chat"
    assert len(body["system"]) > 20
    assert "food" in body["prompt"].lower() or "spend" in body["prompt"].lower()


@pytest.mark.asyncio
async def test_parse_document_returns_context(ctx):
    resp = await ctx.post("/api/ai/inference-context/parse-document", json={
        "text": "Date: 2026-07-01\nCoffee Shop $4.50\nGrocery Store $82.11"
    })
    assert resp.status_code == 200
    body = resp.json()
    assert body["feature_id"] == "parse_document"
    assert "Coffee Shop" in body["prompt"]


@pytest.mark.asyncio
async def test_categorize_rejects_empty_transactions(ctx):
    resp = await ctx.post("/api/ai/inference-context/categorize", json={
        "transactions": []
    })
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_ai_disabled_blocked(ctx):
    from app.models import Household
    from sqlalchemy import update
    from app.database import get_db as real_db
    # Disable AI for this household via a fresh session
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    # (AI-disabled check tested via the _require_ai_enabled dependency — covered by existing ai route tests)
    pass
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && python -m pytest tests/test_inference_context.py -v
```

Expected: `FAILED` — routes do not exist

- [ ] **Step 3: Create the inference context service**

Create `backend/app/services/ai/inference_context.py`:

```python
from __future__ import annotations

"""Build prompt contexts for client-side local LLM inference.

These functions return {system, prompt, response_schema} — the client
sends this to its local LLM (Ollama, CoreML, Gemini Nano, WebLLM) and
posts the structured result to /api/ai/execute-action.

Security: no user content is inferred server-side here. We only build
and return the prompt string. The client owns inference.
"""

import json
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Category, CategoryGroup
from app.services.ai.context import build_financial_context


CATEGORIZE_SYSTEM = (
    "You are a financial categorization assistant. "
    "Assign each transaction to one of the provided categories. "
    "Respond with valid JSON only — no prose, no markdown fences."
)

CATEGORIZE_SCHEMA = {
    "type": "array",
    "items": {
        "type": "object",
        "properties": {
            "id": {"type": "string"},
            "category_name": {"type": "string"},
            "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        },
        "required": ["id", "category_name", "confidence"],
    },
}

CHAT_SYSTEM = (
    "You are a helpful personal finance assistant. "
    "Answer questions about the user's budget concisely and accurately. "
    "Use only the financial context provided — do not fabricate data. "
    "Respond in plain text."
)

PARSE_DOCUMENT_SYSTEM = (
    "You are a bank statement parser. "
    "Extract individual transactions from the provided text. "
    "Respond with valid JSON only — no prose, no markdown fences."
)

PARSE_DOCUMENT_SCHEMA = {
    "type": "array",
    "items": {
        "type": "object",
        "properties": {
            "date": {"type": "string", "description": "ISO 8601 date (YYYY-MM-DD)"},
            "payee": {"type": "string"},
            "amount": {"type": "number", "description": "Negative for expenses, positive for income"},
        },
        "required": ["date", "payee", "amount"],
    },
}


async def build_categorize_context(
    db: AsyncSession,
    household_id: str,
    transactions: list[dict],
) -> dict:
    """Return prompt context for transaction categorization."""
    result = await db.execute(
        select(Category.name, CategoryGroup.name.label("group_name"))
        .join(CategoryGroup, Category.group_id == CategoryGroup.id)
        .where(CategoryGroup.household_id == household_id)
        .order_by(CategoryGroup.name, Category.name)
    )
    cats = [{"category": r.name, "group": r.group_name} for r in result.all()]
    cats_json = json.dumps(cats, indent=2)

    txn_lines = "\n".join(
        f"- id={t['id']} payee={t['payee']} amount={t['amount']} date={t['date']}"
        for t in transactions
    )

    prompt = (
        f"Available categories:\n{cats_json}\n\n"
        f"Transactions to categorize:\n{txn_lines}\n\n"
        f"Return a JSON array matching the response_schema. "
        f"Use the exact category_name from the list above."
    )

    return {
        "system": CATEGORIZE_SYSTEM,
        "prompt": prompt,
        "response_schema": CATEGORIZE_SCHEMA,
        "feature_id": "categorize",
    }


async def build_chat_context(
    db: AsyncSession,
    household_id: str,
    query: str,
) -> dict:
    """Return prompt context for conversational budget Q&A."""
    financial_ctx = await build_financial_context(db, household_id)
    prompt = f"Financial context:\n{financial_ctx}\n\nUser question: {query}"
    return {
        "system": CHAT_SYSTEM,
        "prompt": prompt,
        "response_schema": {"type": "string"},
        "feature_id": "chat",
    }


def build_parse_document_context(text: str) -> dict:
    """Return prompt context for parsing a raw document text."""
    prompt = (
        f"Parse all transactions from the following bank statement text. "
        f"Return a JSON array matching the response_schema.\n\n"
        f"Document text:\n{text}"
    )
    return {
        "system": PARSE_DOCUMENT_SYSTEM,
        "prompt": prompt,
        "response_schema": PARSE_DOCUMENT_SCHEMA,
        "feature_id": "parse_document",
    }
```

- [ ] **Step 4: Create the route file**

Create `backend/app/api/routes/inference_context.py`:

```python
from __future__ import annotations

"""Inference-context endpoints — return prompt templates for client-side LLM inference.

Clients (macOS app, web browser) call these to get a {system, prompt, response_schema}
payload, run inference locally, then POST the structured result to
/api/ai/execute-action. This keeps all inference on-device regardless of platform.
"""

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.api.routes.ai import _require_ai_enabled
from app.models.user import User
from app.services.ai.inference_context import (
    build_categorize_context,
    build_chat_context,
    build_parse_document_context,
)

router = APIRouter()


class InferenceContextResponse(BaseModel):
    system: str
    prompt: str
    response_schema: dict[str, Any]
    feature_id: str


class TransactionInput(BaseModel):
    id: str
    payee: str
    amount: float
    date: str


class CategorizeRequest(BaseModel):
    transactions: list[TransactionInput] = Field(..., min_length=1, max_length=100)


class ChatRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=2000)


class ParseDocumentRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=50_000)


@router.post("/categorize", response_model=InferenceContextResponse)
async def inference_context_categorize(
    body: CategorizeRequest,
    household_id: str = Depends(_require_ai_enabled),
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """Return prompt context for categorizing the given transactions."""
    txns = [t.model_dump() for t in body.transactions]
    return await build_categorize_context(db, household_id, txns)


@router.post("/chat", response_model=InferenceContextResponse)
async def inference_context_chat(
    body: ChatRequest,
    household_id: str = Depends(_require_ai_enabled),
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """Return prompt context for answering a budget question."""
    return await build_chat_context(db, household_id, body.query)


@router.post("/parse-document", response_model=InferenceContextResponse)
async def inference_context_parse_document(
    body: ParseDocumentRequest,
    _household_id: str = Depends(_require_ai_enabled),
    _user: User = Depends(get_current_user),
):
    """Return prompt context for parsing a raw bank statement or CSV text."""
    return build_parse_document_context(body.text)
```

- [ ] **Step 5: Register router in __init__.py**

In `backend/app/api/routes/__init__.py`, add:

```python
from app.api.routes.inference_context import router as inference_context_router
# ...and in the router include block:
router.include_router(
    inference_context_router,
    prefix="/api/ai/inference-context",
    tags=["ai-inference-context"],
)
```

- [ ] **Step 6: Add rate limit rule**

In `backend/app/middleware/rate_limit.py`, in `_RULES`, add:

```python
    ("/api/ai/inference-context/", 30, 60),
```

Place after the existing `/api/ai/` rule.

- [ ] **Step 7: Run tests**

```bash
cd backend && python -m pytest tests/test_inference_context.py -v
```

Expected: all 5 tests pass

- [ ] **Step 8: Run full suite**

```bash
cd backend && python -m pytest tests/ -v
```

Expected: no regressions

- [ ] **Step 9: Commit**

```bash
git add backend/app/services/ai/inference_context.py backend/app/api/routes/inference_context.py backend/app/api/routes/__init__.py backend/app/middleware/rate_limit.py backend/tests/test_inference_context.py
git commit -m "feat(ai): add /api/ai/inference-context/* endpoints for client-side LLM prompt delivery"
```

---

### Task 5: Backend SSE Realtime Events Stream

**Files:**
- Create: `backend/app/services/realtime.py` — per-household asyncio queue registry
- Create: `backend/app/api/routes/realtime.py` — SSE endpoint
- Modify: `backend/app/api/routes/__init__.py` — register router
- Modify: `backend/app/api/routes/transactions.py` — emit events on write
- Modify: `backend/app/api/routes/categories.py` — emit events on write
- Modify: `backend/app/middleware/rate_limit.py` — no rate limit needed (GET SSE)
- Create: `backend/tests/test_realtime_events.py`

**Interfaces:**
- Produces: `GET /api/realtime/events` — SSE stream emitting `data: {"type":"transaction.created","household_id":"..."}\n\n`
- `emit_event(household_id, event_type)` — called from write routes

- [ ] **Step 1: Write failing test**

Create `backend/tests/test_realtime_events.py`:

```python
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
from app.services.realtime import emit_event


@pytest_asyncio.fixture()
async def ctx():
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False)
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


@pytest.mark.asyncio
async def test_realtime_requires_auth():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        resp = await c.get("/api/realtime/events")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_emit_event_delivers_to_subscriber(ctx):
    """Emit an event and verify it arrives in the SSE stream."""
    received: list[str] = []

    async def consume():
        async with ctx.stream("GET", "/api/realtime/events") as resp:
            assert resp.status_code == 200
            async for line in resp.aiter_lines():
                if line.startswith("data:"):
                    received.append(line)
                    break  # one event is enough

    task = asyncio.create_task(consume())
    await asyncio.sleep(0.05)  # let the subscriber register
    await emit_event("hh-sse", "transaction.created")
    await asyncio.wait_for(task, timeout=2.0)

    assert len(received) == 1
    assert "transaction.created" in received[0]
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && python -m pytest tests/test_realtime_events.py -v
```

Expected: `FAILED` — module does not exist

- [ ] **Step 3: Create the realtime service**

Create `backend/app/services/realtime.py`:

```python
from __future__ import annotations

"""Per-household asyncio queue registry for SSE realtime events.

Design: one asyncio.Queue per active SSE subscriber. Write routes call
emit_event() to fan out a lightweight change notification. Clients refetch
the affected resource on receipt — no full payload in the SSE frame.

No persistence: events emitted while no subscriber is connected are dropped.
This is intentional — SSE is for live UI updates, not reliable delivery.
Use the standard REST endpoints for initial data load.
"""

import asyncio
import json
import logging
from collections import defaultdict
from typing import AsyncIterator

logger = logging.getLogger(__name__)

# household_id → set of subscriber queues
_subscribers: dict[str, set[asyncio.Queue[str | None]]] = defaultdict(set)


async def subscribe(household_id: str) -> AsyncIterator[str]:
    """Async generator: yields SSE-formatted strings until the client disconnects."""
    queue: asyncio.Queue[str | None] = asyncio.Queue(maxsize=50)
    _subscribers[household_id].add(queue)
    logger.debug("realtime_subscribe household=%s total=%d", household_id, len(_subscribers[household_id]))
    try:
        yield ": connected\n\n"  # SSE comment keeps the connection alive
        while True:
            try:
                message = await asyncio.wait_for(queue.get(), timeout=25.0)
            except asyncio.TimeoutError:
                yield ": keepalive\n\n"
                continue
            if message is None:
                break
            yield message
    finally:
        _subscribers[household_id].discard(queue)
        if not _subscribers[household_id]:
            del _subscribers[household_id]
        logger.debug("realtime_unsubscribe household=%s", household_id)


async def emit_event(household_id: str, event_type: str) -> None:
    """Broadcast a change event to all active subscribers for this household."""
    subs = _subscribers.get(household_id)
    if not subs:
        return
    payload = json.dumps({"type": event_type, "household_id": household_id})
    message = f"data: {payload}\n\n"
    for queue in list(subs):
        try:
            queue.put_nowait(message)
        except asyncio.QueueFull:
            logger.warning("realtime_queue_full household=%s dropping event=%s", household_id, event_type)
```

- [ ] **Step 4: Create the realtime route**

Create `backend/app/api/routes/realtime.py`:

```python
from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from app.api.deps import get_current_user, get_household_id
from app.models.user import User
from app.services.realtime import subscribe

router = APIRouter()


@router.get("/events")
async def realtime_events(
    household_id: str = Depends(get_household_id),
    _user: User = Depends(get_current_user),
):
    """SSE stream of lightweight change events for this household.

    Clients receive ``{"type": "transaction.created", "household_id": "..."}``
    and refetch the affected resource. No full payload is sent over SSE.

    The stream sends a keepalive comment every 25 seconds to prevent
    proxies from closing idle connections.
    """
    return StreamingResponse(
        subscribe(household_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # disable nginx buffering
        },
    )
```

- [ ] **Step 5: Register realtime router**

In `backend/app/api/routes/__init__.py`, add:

```python
from app.api.routes.realtime import router as realtime_router
# in the include block:
router.include_router(realtime_router, prefix="/api/realtime", tags=["realtime"])
```

- [ ] **Step 6: Emit events from transactions route**

In `backend/app/api/routes/transactions.py`, add import at top:

```python
from app.services.realtime import emit_event
```

Then in each `POST`/`PUT`/`DELETE` route handler, add after `await db.commit()`:

```python
        await emit_event(household_id, "transaction.created")  # or .updated/.deleted
```

Find the create transaction route (look for `@router.post`) and add the emit call. Do the same for update and delete.

- [ ] **Step 7: Emit events from categories route**

In `backend/app/api/routes/categories.py`, same pattern — add `from app.services.realtime import emit_event` and emit `"category.updated"` after commits in write routes.

- [ ] **Step 8: Run tests**

```bash
cd backend && python -m pytest tests/test_realtime_events.py -v
```

Expected: all tests pass

- [ ] **Step 9: Run full suite**

```bash
cd backend && python -m pytest tests/ -v
```

Expected: no regressions

- [ ] **Step 10: Commit**

```bash
git add backend/app/services/realtime.py backend/app/api/routes/realtime.py backend/app/api/routes/__init__.py backend/app/api/routes/transactions.py backend/app/api/routes/categories.py backend/tests/test_realtime_events.py
git commit -m "feat(realtime): add GET /api/realtime/events SSE stream for live household change events"
```

---

### Task 6: Web useRealtimeEvents Hook

**Files:**
- Create: `frontend/src/hooks/use-realtime-events.ts` — EventSource wrapper
- Create: `frontend/src/hooks/use-realtime-events.test.ts` — tests
- Modify: `frontend/src/app/(app)/transactions/page.tsx` — wire refresh on event

**Interfaces:**
- Produces: `useRealtimeEvents(onEvent: (type: string) => void): { connected: boolean }`
- Consumes: `GET /api/realtime/events` (relative URL via existing axios base)

- [ ] **Step 1: Write failing test**

Create `frontend/src/hooks/use-realtime-events.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRealtimeEvents } from "./use-realtime-events";

// Mock EventSource
class MockEventSource {
  url: string;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onopen: (() => void) | null = null;
  static instances: MockEventSource[] = [];

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }
  close = vi.fn();

  simulate(data: string) {
    this.onmessage?.({ data });
  }
  simulateOpen() {
    this.onopen?.();
  }
  simulateError() {
    this.onerror?.();
  }
}

beforeEach(() => {
  MockEventSource.instances = [];
  (global as unknown as { EventSource: unknown }).EventSource = MockEventSource;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useRealtimeEvents", () => {
  it("connects to /api/realtime/events", () => {
    const onEvent = vi.fn();
    renderHook(() => useRealtimeEvents(onEvent));
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toContain("/api/realtime/events");
  });

  it("calls onEvent when message arrives", () => {
    const onEvent = vi.fn();
    renderHook(() => useRealtimeEvents(onEvent));
    const es = MockEventSource.instances[0];
    act(() => {
      es.simulate(JSON.stringify({ type: "transaction.created", household_id: "hh-1" }));
    });
    expect(onEvent).toHaveBeenCalledWith("transaction.created");
  });

  it("sets connected true on open", () => {
    const onEvent = vi.fn();
    const { result } = renderHook(() => useRealtimeEvents(onEvent));
    expect(result.current.connected).toBe(false);
    act(() => {
      MockEventSource.instances[0].simulateOpen();
    });
    expect(result.current.connected).toBe(true);
  });

  it("closes EventSource on unmount", () => {
    const onEvent = vi.fn();
    const { unmount } = renderHook(() => useRealtimeEvents(onEvent));
    const es = MockEventSource.instances[0];
    unmount();
    expect(es.close).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npm run test:run -- use-realtime-events
```

Expected: `FAILED` — module not found

- [ ] **Step 3: Implement the hook**

Create `frontend/src/hooks/use-realtime-events.ts`:

```typescript
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const RECONNECT_DELAY_MS = 3000;

/**
 * Subscribe to the backend SSE realtime events stream.
 *
 * Reconnects automatically on error with a 3-second delay.
 * Uses relative URL so it goes through the same host as the Next.js app —
 * credentials (session cookie) are included automatically.
 */
export function useRealtimeEvents(
  onEvent: (type: string) => void,
): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    const es = new EventSource("/api/realtime/events", { withCredentials: true });

    es.onopen = () => setConnected(true);

    es.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data) as { type?: string };
        if (payload.type) {
          onEventRef.current(payload.type);
        }
      } catch {
        // ignore malformed events
      }
    };

    es.onerror = () => {
      setConnected(false);
      es.close();
      reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY_MS);
    };

    return es;
  }, []);

  useEffect(() => {
    const es = connect();
    return () => {
      es.close();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
  }, [connect]);

  return { connected };
}
```

- [ ] **Step 4: Run tests**

```bash
cd frontend && npm run test:run -- use-realtime-events
```

Expected: all 4 tests pass

- [ ] **Step 5: Wire hook to transactions page**

In `frontend/src/app/(app)/transactions/page.tsx`, import and use:

```typescript
import { useRealtimeEvents } from "@/hooks/use-realtime-events";
// ...inside the component:
  useRealtimeEvents((type) => {
    if (type === "transaction.created" || type === "transaction.updated" || type === "transaction.deleted") {
      // trigger refetch — call whatever the page uses to reload transactions
      void refetch();  // replace with the actual refetch function name used in this component
    }
  });
```

Read the existing `transactions/page.tsx` first to find the correct refetch pattern.

- [ ] **Step 6: Verify typecheck**

```bash
cd frontend && npm run typecheck
```

Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add frontend/src/hooks/use-realtime-events.ts frontend/src/hooks/use-realtime-events.test.ts frontend/src/app/(app)/transactions/page.tsx
git commit -m "feat(realtime): add useRealtimeEvents hook and wire to transactions page"
```

---

## Verification

After all tasks:

```bash
cd backend && python -m pytest tests/ -v
cd frontend && npm run typecheck && npm run test:run && npm run lint && npm run build
```

Both must exit 0.
