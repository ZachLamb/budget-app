# Budget App — macOS Desktop

Native macOS SwiftUI app connecting to the Budget FastAPI backend.

## Requirements
- macOS 14.0+ (Sonoma)
- Xcode 15+
- Swift 5.10+
- A running Budget backend (set URL in Settings)

## Setup

### Option A: Open in Xcode (recommended)

1. Open Xcode → File → New → Project → macOS → App
   - Product Name: `BudgetApp`
   - Bundle Identifier: `app.budget.BudgetApp`
   - Interface: SwiftUI / Language: Swift / Storage: None
   - Save to `budget-app/desktop/`
2. Add GRDB: File → Add Package Dependencies → `https://github.com/groue/GRDB.swift` (Up to Next Major from 6.0.0)
3. Replace generated files with the source files in `BudgetApp/`
4. Set deployment target: macOS 14.0
5. Enable strict concurrency: Build Settings → SWIFT_STRICT_CONCURRENCY = complete
6. Set entitlements from `BudgetApp.entitlements`
7. Press ⌘R to run

### Option B: Swift Package Manager

```bash
cd desktop
swift build
```

Note: SPM builds will not have sandboxing or code signing. For production use, always build via Xcode.

## Configuration
On first launch, open Settings (⌘,) and set the backend URL.
Default: `https://your-backend.fly.dev`

## Local LLM
- Tier 1: Install Ollama (`brew install ollama`) and run `ollama serve`
- Tier 2: CoreML model auto-detected when available
- Tier 3: Cloud via backend (requires consent in Settings)
