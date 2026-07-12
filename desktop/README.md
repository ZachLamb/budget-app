# Budget App — macOS Desktop

Native macOS SwiftUI app. Connects to the same FastAPI backend as the web app, with a local GRDB SQLite cache and a 3-tier on-device AI inference pipeline.

## Requirements

| Requirement | Version |
|-------------|---------|
| macOS | 14.0+ (Sonoma) |
| Xcode | 15.4+ |
| Swift | 5.10+ |
| Backend | Running instance (local or Fly.io) |

---

## Getting Started

### 1. Open in Xcode

The Swift source lives in `BudgetApp/`. You need to create an Xcode project that wraps it (Xcode projects are binary and not committed to git).

```
File → New → Project → macOS → App
  Product Name:       BudgetApp
  Bundle Identifier:  app.budget.BudgetApp
  Interface:          SwiftUI
  Language:           Swift
  Storage:            None
  Save location:      budget-app/desktop/
```

### 2. Add GRDB (local database)

```
File → Add Package Dependencies
  URL: https://github.com/groue/GRDB.swift
  Version: Up to Next Major from 6.0.0
```

### 3. Replace generated files

Delete the scaffolded `ContentView.swift` and `<ProjectName>App.swift`. The real source is already in `BudgetApp/`.

### 4. Configure build settings

| Setting | Value |
|---------|-------|
| Deployment Target | macOS 14.0 |
| SWIFT_STRICT_CONCURRENCY | complete |
| Signing & Capabilities | App Sandbox on |

Copy entitlements from `BudgetApp.entitlements`:
- `com.apple.security.app-sandbox` — required for App Store
- `com.apple.security.network.client` — outbound HTTPS to backend
- `com.apple.security.files.user-selected.read-only` — document import (PDF/CSV)

### 5. Set the URL scheme (deep links)

In `Info.plist`, `CFBundleURLTypes` is already wired to the `budget://` scheme. Xcode should pick it up automatically; if not, add it under Info → URL Types.

### 6. Run

Press `⌘R`. On first launch, open Settings (`⌘,`) and enter your backend URL.

---

## Architecture

```
desktop/
├── BudgetApp/
│   ├── App/
│   │   ├── BudgetApp.swift          # @main entry, MenuBarExtra
│   │   ├── AppDelegate.swift        # deep link handler (budget://auth/callback)
│   │   ├── RootView.swift           # wires AuthManager → APIClient → SyncCoordinator
│   │   ├── MainSplitView.swift      # 3-pane NavigationSplitView
│   │   └── AppCommands.swift        # ⌘, shortcut
│   ├── Auth/
│   │   ├── AuthManager.swift        # @Observable, Google OAuth via ASWebAuthenticationSession
│   │   ├── KeychainHelper.swift     # kSecClassGenericPassword read/write/delete
│   │   └── LoginView.swift
│   ├── Data/
│   │   ├── Remote/
│   │   │   ├── APIClient.swift      # actor, Bearer auth, 30s/300s timeouts
│   │   │   ├── Models.swift         # Codable remote types (RemoteTransaction, etc.)
│   │   │   └── APIError.swift       # LocalizedError enum
│   │   ├── Local/
│   │   │   ├── AppDatabase.swift    # DatabaseQueue singleton, v1 migration
│   │   │   ├── LocalTransaction.swift
│   │   │   └── LocalBudgetCategory.swift
│   │   └── Sync/
│   │       └── SyncCoordinator.swift  # @Observable, async let parallelism
│   ├── Inference/
│   │   ├── InferenceManager.swift   # @Observable, 3-tier waterfall
│   │   ├── OllamaProvider.swift     # probes 127.0.0.1:11434 / :1234
│   │   ├── CoreMLProvider.swift     # stub (returns coreMLUnavailable)
│   │   └── CloudProvider.swift      # POST /api/llm/cloud via APIClient
│   ├── Features/
│   │   ├── Transactions/TransactionsView.swift
│   │   ├── Budget/BudgetView.swift
│   │   ├── Chat/ChatView.swift
│   │   ├── DocumentImport/DocumentImportView.swift
│   │   └── Settings/SettingsView.swift
│   └── MenuBar/MenuBarView.swift    # live sync status, AI tier, last-sync time
├── BudgetApp.entitlements
├── BudgetAppTests/
├── Package.swift                    # GRDB dependency declaration
└── README.md
```

### Data flow

```
Backend (FastAPI)
    │
    ▼ HTTPS + Bearer JWT
APIClient (actor)
    │
    ├──► SyncCoordinator ──► GRDB (SQLite) ──► SwiftUI views
    │
    └──► InferenceManager
             │
             ├── Tier 1: Ollama / LM Studio (local, probed at startup)
             ├── Tier 2: CoreML (stub — model not shipped)
             └── Tier 3: Cloud via /api/llm/cloud (requires user consent)
```

### Authentication

1. User taps **Sign in with Google** in `LoginView`.
2. `AuthManager.loginWithGoogle()` opens `ASWebAuthenticationSession` with the backend's `/api/auth/google` URL.
3. Google redirects to `budget://auth/callback?code=...`.
4. `AppDelegate` forwards the URL via `NotificationCenter` → `AuthManager`.
5. `AuthManager.exchangeGoogleCode(_:)` POSTs to `/api/auth/native/token` with the code and `redirect_uri: budget://auth/callback`.
6. The backend validates the code via Google, creates/updates the user, and returns a Bearer JWT.
7. `KeychainHelper` stores the JWT; `APIClient` attaches it as `Authorization: Bearer <token>` on every request.

---

## Local AI

The app uses the **inference-context** pattern: the backend returns a `{system, prompt, response_schema, feature_id}` payload; the app runs the LLM locally and POSTs the structured result back to `/api/ai/execute-action`. No raw user data is sent to any cloud LLM without explicit consent.

### Tier 1 — Ollama / LM Studio

```bash
# Install Ollama
brew install ollama

# Pull a small model (runs well on M1/M2/M3)
ollama pull llama3.2:3b

# Start the server (auto-detected on port 11434)
ollama serve
```

Or run [LM Studio](https://lmstudio.ai) in server mode on port 1234 — both are probed at launch.

The model used for inference can be changed in **Settings → Local Model**.

### Tier 2 — CoreML

Stub only in the current build. Returns `InferenceError.coreMLUnavailable`. A future release will bundle a compiled `.mlpackage`.

### Tier 3 — Cloud (opt-in)

Falls back to the backend's `/api/llm/cloud` endpoint. Requires the user to explicitly toggle **Allow cloud AI fallback** in Settings. Consent is stored in `UserDefaults` and checked before every cloud call.

---

## Configuration

All settings are persisted in `UserDefaults` via `@AppStorage`:

| Setting | Default | Description |
|---------|---------|-------------|
| `backendBaseURL` | `https://your-backend.fly.dev` | Backend URL — change to `http://localhost:8000` for local dev |
| `ollamaModel` | `llama3.2:3b` | Ollama model tag passed in inference requests |
| `cloudConsentGranted` | `false` | Must be true before Tier 3 fires |

---

## Running locally (backend + desktop together)

```bash
# Terminal 1 — backend
cd backend
uvicorn app.main:app --reload --port 8000

# Terminal 2 — desktop
# Open Xcode, set backendBaseURL in Settings to http://localhost:8000, press ⌘R
```

---

## Known limitations

- **Xcode project not committed** — binary `.xcodeproj` files conflict badly in git. Follow the setup steps above to regenerate it.
- **CoreML stub** — Tier 2 always falls back to Tier 3; no on-device CoreML model is bundled yet.
- **Multi-user households** — the local GRDB cache is keyed to the authenticated user's household; switching accounts requires signing out and back in.
