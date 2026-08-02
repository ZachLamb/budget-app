# Budget App — macOS Desktop

Native macOS SwiftUI app. Connects to the same FastAPI backend as the web app,
with a local GRDB SQLite cache and a tiered AI inference pipeline that keeps your
financial data on your machine by default.

## Requirements

| Requirement | Version | Notes |
|-------------|---------|-------|
| macOS | 14.0+ (Sonoma) | |
| Swift toolchain | 5.10+ | `swift build` works with Command Line Tools |
| Xcode | 15.4+ | Needed to **run** the app and to run the test suite (`XCTest`) |
| Backend | Running instance (local or Fly.io) | |
| LM Studio *or* Ollama | latest | Optional — for private, on-machine AI |

---

## Build

The package builds headlessly with SwiftPM — no `.xcodeproj` required:

```bash
cd desktop
swift build
```

GRDB is resolved automatically from `Package.swift`. This is the fastest way to
verify the code compiles (and is what CI would run).

> **Note:** `swift test` needs the `XCTest` module, which ships only with full
> Xcode. With Command Line Tools alone you'll get `no such module 'XCTest'`.
> Run the tests from Xcode (`⌘U`) or `xcodebuild test`.

---

## Run

Running a SwiftUI app (menu-bar extra, entitlements, URL scheme) needs Xcode.

### Option A — generate an Xcode project from the package

```bash
cd desktop
open Package.swift          # opens the SwiftPM package directly in Xcode
```

Then set the run destination to **My Mac** and press `⌘R`. For a signed,
sandboxed build, add the entitlements from `BudgetApp.entitlements` and the keys
from `Info.plist` under the target's Signing & Capabilities / Info tabs.

### Option B — wrap it in an app target

`File → New → Project → macOS → App` (Product Name `BudgetApp`, Bundle ID
`app.budget.BudgetApp`, SwiftUI, Storage: None), delete the generated
`ContentView.swift`/`…App.swift`, add the `BudgetApp/` sources, and add GRDB via
`File → Add Package Dependencies` (`https://github.com/groue/GRDB.swift`, 6.0.0+).

On first launch, open **Settings** (`⌘,`) → **General** and set the backend URL
(`http://localhost:8000` for local dev).

---

## Run locally (backend + desktop together)

```bash
# Terminal 1 — backend
cd backend
uvicorn app.main:app --reload --port 8000
```

Then run the desktop app (above) and set **Settings → General → Backend** to
`http://localhost:8000`.

---

## Local AI

The app runs AI in tiers, preferring whatever keeps your data on-device:

1. **Local server** — LM Studio or Ollama on your Mac (private).
2. **On-device CoreML** — stub today; falls through until a model is bundled.
3. **Cloud** — the backend's `/api/llm/cloud` proxy, **only** if you turn on
   cloud fallback in Settings.

The active tier and its privacy state are always visible in the sidebar footer
and the menu-bar extra.

### Setting up LM Studio (recommended)

1. Install [LM Studio](https://lmstudio.ai) and open it.
2. Download a model (a 7B+ model is recommended; smaller models struggle with
   structured output).
3. Go to the **Developer** tab → load the model → set the server to **Running**
   (it listens on port **1234**).
4. Optional: under **Server Settings**, enable **CORS** (only needed if you also
   use the web app) and, if you turn authentication on, create a token under
   **Manage Tokens**.
5. In the desktop app: **Settings → Local AI**. It auto-detects the server on
   the standard ports — or click **Find my server**. Then click
   **Test connection** to run full diagnostics (reachability → models loaded →
   a real test completion).

### Setting up Ollama (alternative)

```bash
brew install ollama
ollama serve                 # listens on port 11434
ollama pull llama3.2:3b      # download a model
```

Then point **Settings → Local AI → Server** at Ollama and **Test connection**.

### Diagnostics & troubleshooting

The **Local AI** settings tab is built to tell you exactly what's wrong and how
to fix it. Each check (address is local, server reachable, models loaded, model
selected, test inference) reports its own status, and any failure shows numbered
recovery steps. Common cases it distinguishes:

| Symptom | What the app tells you |
|---------|------------------------|
| Server closed / not started | "LM Studio isn't running" + how to start it |
| Running but no model | "No model loaded" + how to load one |
| Wrong model name selected | Lists the models that *are* loaded |
| Auth on but no token | "Needs an API token" + how to create one |
| Token wrong | "Token was rejected" |
| First request slow | "Still loading into memory" (cold JIT load) |

> The app talks the **OpenAI-compatible** dialect (`/v1/models`,
> `/v1/chat/completions`), so the same code works for LM Studio, Ollama,
> llama.cpp, or vLLM. Structured-output requests use `response_format:
> json_schema` where the model supports it.

---

## Configuration

Backend URL and the local-AI connection are set in **Settings**. Persistence:

| Setting | Storage | Default |
|---------|---------|---------|
| Backend URL | `UserDefaults` (`backendBaseURL`) | `http://localhost:8000` |
| Local server kind / URL / model | `UserDefaults` | LM Studio, `http://127.0.0.1:1234`, Automatic |
| Local server API token | **Keychain** | empty |
| Cloud fallback consent | `UserDefaults` (`cloudConsentGranted`) | off |

The API token lives in the Keychain, not `UserDefaults` — it's a credential.

---

## Architecture

```
desktop/BudgetApp/
├── App/
│   ├── BudgetApp.swift          # @main; WindowGroup + Settings + MenuBarExtra
│   ├── AppContainer.swift       # single owner of APIClient/Auth/Sync/Inference
│   ├── AppDelegate.swift        # deep-link handler (budget://auth/callback)
│   ├── RootView.swift           # auth gate → MainSplitView / LoginView
│   ├── MainSplitView.swift      # 3-pane nav + persistent AI-tier footer
│   └── AppCommands.swift        # ⌘R "Sync Now"
├── DesignSystem/
│   ├── Theme.swift              # spacing/radius/palette/typography tokens
│   └── Components.swift         # Card, StatusPill, CheckRow, RecoverySteps, …
├── Auth/                        # AuthManager, KeychainHelper, LoginView
├── Data/
│   ├── Remote/                  # APIClient (actor), Models, APIError
│   ├── Local/                   # GRDB DatabaseQueue + migrations
│   └── Sync/                    # SyncCoordinator
├── Inference/
│   ├── InferenceManager.swift   # tier orchestration + cached health report
│   ├── LocalModelServer.swift   # OpenAI-compatible client + diagnostics
│   ├── InferenceTypes.swift     # tiers + error taxonomy
│   ├── CloudProvider.swift      # /api/llm/cloud (SSE, accumulated)
│   └── CoreMLProvider.swift     # stub
├── Features/                    # Transactions, Budget, Chat, Import, Settings
└── MenuBar/MenuBarView.swift
```

### Authentication

Sign in with Google via `ASWebAuthenticationSession`; the backend redirects to
`budget://auth/callback?code=…`, which `AppDelegate` forwards to `AuthManager`.
The code is exchanged at `/api/auth/native/token` for a JWT stored in the
Keychain and attached as `Authorization: Bearer …` by `APIClient`.

---

## Known limitations

- **Xcode project not committed** — binary `.xcodeproj` files conflict in git.
  Use `open Package.swift`, or wrap the sources in a new app target.
- **CoreML stub** — Tier 2 always falls through; no on-device model is bundled.
- **`swift test` needs Xcode** — the `XCTest` module isn't in Command Line Tools.
- **Multi-user households** — the local cache is keyed to the signed-in user;
  switching accounts requires signing out and back in.
