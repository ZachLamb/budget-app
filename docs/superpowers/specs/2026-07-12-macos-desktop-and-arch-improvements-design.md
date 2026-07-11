# Design: macOS Desktop App + Cross-Stack Architecture Improvements

**Date:** 2026-07-12  
**Branch:** feat/macos-desktop-app  
**Scope:** Six backend/web improvements + new native macOS SwiftUI client

---

## 1. Goals

1. Ship a native macOS SwiftUI budget app that connects to the existing FastAPI backend
2. Remove architectural friction that affects both web and desktop clients
3. Establish a single source of truth for API contracts, prompt logic, and auth flows

---

## 2. Improvement Areas

### 2A — Remove Next.js Proxy Layer

**Problem:** Every AI call goes Browser → Next.js route → FastAPI (+50–100ms, extra failure surface).  
**Fix:** Web frontend calls FastAPI directly. Update CORS config to allow the Vercel frontend origin. Remove `frontend/src/app/api/ai/` and `frontend/src/app/api/llm/` proxy routes.  
**Constraint:** Auth headers (JWT Bearer) must be forwarded from browser. No cookie-based auth for these routes.

### 2B — Move LLM Prompt Logic Server-Side

**Problem:** Cascade logic, prompt templates, schema validation, and retry logic live in browser TypeScript (`frontend/src/lib/llm/`). The macOS app would have to reimplement all of it in Swift.  
**Fix:** FastAPI gains higher-level intent endpoints:
- `POST /api/ai/categorize` — accepts raw transactions, returns categorization JSON
- `POST /api/ai/chat` — accepts budget context query, streams conversational response
- `POST /api/ai/parse-document` — accepts extracted text from PDF/CSV, returns structured transactions

Each endpoint accepts an optional `x-local-llm-url` header. When present, the backend relays the prompt to the caller's local Ollama/LM Studio instance instead of its own configured backend. This lets the macOS app keep inference local while the backend handles prompt engineering.

Backend retains the cascade: caller-provided local LLM → backend Ollama → cloud (with consent check).

### 2C — OpenAPI Codegen

**Problem:** Both web frontend and macOS app hand-roll fetch calls against FastAPI with no type safety guarantee.  
**Fix:**
- FastAPI already generates `/openapi.json`. Add a CI step that downloads it and runs `openapi-typescript` to generate `frontend/src/lib/api/generated.ts`.
- For Swift: add `swift-openapi-generator` as an Xcode build plugin to generate `desktop/BudgetApp/Generated/` from the same spec.
- All hand-rolled fetch clients refactored to use generated types.

### 2D — Native App Auth (PKCE + Keychain)

**Problem:** Existing auth (JWT + passkeys + magic link + Google OAuth) was designed for browsers. Native macOS app needs PKCE, Keychain storage, and refresh tokens.  
**Fix:**
- Backend: add `POST /api/auth/token/refresh` endpoint accepting a refresh token, returning new access+refresh pair.
- Backend: accept Bearer token in Authorization header on all protected routes (already done via PyJWT — verify this works without cookie session).
- Backend: add `GET /api/auth/oauth/pkce-start` and `GET /api/auth/oauth/pkce-callback` for Google OAuth PKCE flow.
- macOS app: `AuthManager` actor stores access + refresh tokens in Keychain (`kSecClassGenericPassword`). Auto-refreshes on 401.
- macOS app: opens Google OAuth in default browser via `ASWebAuthenticationSession`, receives callback on `budget://auth` deep link.

### 2E — Shared Redis Rate Limiting

**Problem:** In-memory rate limiter is per-process; multiple backend replicas each have independent buckets.  
**Fix:** `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` are already in `config.py` and the rate limit middleware already branches on them. This is purely an ops/env-var task: wire the values in the Fly.io secrets for production.

### 2F — Realtime Sync via SSE

**Problem:** Both web and macOS apps fetch on demand with no push from server.  
**Fix:** FastAPI adds `GET /api/realtime/events` — an SSE stream that emits lightweight change events (`{"type":"transaction.created","id":"..."}`) when the backend writes. Clients receive the event and refetch the affected resource. No full-payload push (avoids large SSE frames).
- Backend: async generator that listens on a per-household asyncio queue. DB write operations post to the queue.
- Web: `useRealtimeEvents()` hook wraps `EventSource`.
- macOS: `RealtimeService` actor wraps `URLSession` bytes stream.

---

## 3. macOS Desktop App

### 3A — Stack

| Layer | Choice | Reason |
|-------|--------|--------|
| Language | Swift 5.10+ | Native performance, strict concurrency |
| UI | SwiftUI | Declarative, dark mode, vibrancy, MenuBarExtra |
| Networking | URLSession (async/await) | No third-party dep for HTTP |
| Local cache | GRDB (SQLite) | Typed Swift ORM, offline support |
| Auth | ASWebAuthenticationSession + Keychain | PKCE, secure token storage |
| LLM Tier 1 | Ollama/LM Studio via 127.0.0.1 | Local heavy inference |
| LLM Tier 2 | CoreML on-device model | Zero-latency fallback |
| LLM Tier 3 | Cloud via backend (with consent gate) | Last resort |

### 3B — Directory Layout

```
desktop/
├── BudgetApp.xcodeproj/
├── BudgetApp/
│   ├── App/              # @main, AppDelegate, deep link router
│   ├── Auth/             # AuthManager actor, Keychain helper, PKCE flow
│   ├── Inference/        # InferenceManager (3-tier orchestration)
│   ├── Data/
│   │   ├── Remote/       # Generated API client (from OpenAPI spec)
│   │   ├── Local/        # GRDB schema, migrations, repositories
│   │   └── Sync/         # SyncCoordinator — reconcile remote → local cache
│   ├── Features/
│   │   ├── Transactions/ # List, filter, search (cached)
│   │   ├── Budget/       # Budget overview pane
│   │   ├── DocumentImport/ # PDF/CSV drag-drop → /api/ai/parse-document
│   │   ├── Chat/         # Conversational AI → /api/ai/chat
│   │   └── Settings/     # Backend URL, model preferences, API keys
│   ├── UI/               # Shared SwiftUI components
│   └── MenuBar/          # MenuBarExtra: model health, sync status
├── BudgetAppTests/
└── BudgetApp.entitlements
```

### 3C — Entitlements

```xml
<key>com.apple.security.app-sandbox</key><true/>
<key>com.apple.security.network.client</key><true/>
<key>com.apple.security.files.user-selected.read-only</key><true/>
```

Outbound connections limited to: `127.0.0.1` (local LLM), your FastAPI backend URL, Google OAuth endpoints.

### 3D — Three-Pane UI Layout

```
┌─────────────┬──────────────────────┬─────────────────────┐
│  Sidebar    │   Main Pane          │   Detail / Chat     │
│             │                      │                     │
│ Transactions│ Transaction list     │ AI chat interface   │
│ Budget      │ (GRDB cached,        │ Document import     │
│ Import      │  offline-capable)    │ drop zone           │
│ Settings    │                      │                     │
└─────────────┴──────────────────────┴─────────────────────┘
```

MenuBarExtra in system menu bar shows: model tier active, sync status, last-synced time.

### 3E — InferenceManager (3-Tier)

```swift
actor InferenceManager {
    func complete(prompt: String, system: String?) async throws -> AsyncStream<String> {
        if let stream = try? await tier1_ollama(prompt, system) { return stream }
        if let stream = try? await tier2_coreml(prompt, system) { return stream }
        return try await tier3_cloud_with_consent(prompt, system)
    }
}
```

Tier 1 pings `http://127.0.0.1:11434/api/tags` (Ollama) or `http://127.0.0.1:1234/v1/models` (LM Studio) with a 500ms timeout before attempting inference.

---

## 4. Data Flow

```
macOS App                        FastAPI Backend              PostgreSQL
─────────────────────────────────────────────────────────────────────────
AuthManager ──── Bearer JWT ────► /api/auth/* 
SyncCoordinator ─────────────────► /api/transactions (paginated fetch)
                 ◄──── SSE ───── /api/realtime/events
InferenceManager (Tier 1) ───────────────────────────────── (local only)
InferenceManager (Tier 3) ──── x-local-llm-url ──►  /api/ai/categorize
GRDB local cache ◄── SyncCoordinator writes
SwiftUI views ◄──── @Observable repos reading GRDB
```

---

## 5. Implementation Phases

| Phase | Scope | Complexity |
|-------|-------|------------|
| 1 | Redis rate limit wiring (env vars only) | XS |
| 2 | OpenAPI codegen CI step + TypeScript types | S |
| 3 | Backend: PKCE auth endpoints + refresh token | M |
| 4 | Backend: server-side AI intent endpoints (2B) | L |
| 5 | Web: remove Next.js proxy, call FastAPI direct | M |
| 6 | Backend: SSE realtime events stream | M |
| 7 | Web: useRealtimeEvents hook | S |
| 8 | macOS: Xcode project scaffold + entitlements | M |
| 9 | macOS: AuthManager + Keychain + PKCE | M |
| 10 | macOS: GRDB schema + SyncCoordinator | L |
| 11 | macOS: InferenceManager (3-tier) | M |
| 12 | macOS: SwiftUI 3-pane UI + features | XL |
| 13 | macOS: MenuBarExtra | S |
| 14 | macOS: Document import + chat features | L |

---

## 6. Out of Scope

- APNs push notifications (can be added post-launch)
- iOS/iPadOS app (separate project)
- Changing the database (PostgreSQL stays)
- Removing WebLLM/Nano from web app (they still serve web users)
