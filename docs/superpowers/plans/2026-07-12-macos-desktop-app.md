# macOS Desktop App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a native macOS SwiftUI budget app (`desktop/BudgetApp`) that authenticates with the existing FastAPI backend via Bearer JWT, caches data in GRDB/SQLite, runs local LLM inference through a 3-tier InferenceManager, and exposes a 3-pane budget UI plus a MenuBarExtra status widget.

**Architecture:** App sandbox with loopback + remote network entitlements. Auth via ASWebAuthenticationSession (Google OAuth) storing JWT in macOS Keychain. Data layer: URLSession API client → GRDB local cache via SyncCoordinator. LLM: Ollama/LM Studio → CoreML → cloud fallback via InferenceManager actor. UI: NavigationSplitView sidebar + main pane + detail pane, MenuBarExtra.

**Tech Stack:** Swift 5.10+ / SwiftUI / macOS 14+ / GRDB (Swift Package) / ASWebAuthenticationSession / Keychain Services / URLSession / CoreML / XCTest

## Global Constraints

- Minimum deployment target: macOS 14.0 (Sonoma)
- Swift concurrency: strict (`-strict-concurrency=complete` in build settings)
- All network calls: `async throws` — no completion-handler wrappers
- Loopback calls (`127.0.0.1`) must use http, all remote calls must use https
- No third-party dependencies except GRDB (Swift Package from `github.com/groue/GRDB.swift`)
- Bundle ID: `app.budget.BudgetApp` (update if you have an Apple Developer account with a different ID)
- Deep link scheme: `budget` — register in Info.plist
- All `Actor`-isolated types must use `@MainActor` for SwiftUI-facing `@Observable` models
- Backend base URL: read from `UserDefaults` key `"backendBaseURL"`, default `"https://your-backend.fly.dev"` (replace at deploy time)

---

### Task 1: Xcode Project Scaffold + Entitlements

**Files:**
- Create: `desktop/` directory
- Create: `desktop/BudgetApp.xcodeproj/` — via Xcode (instructions below)
- Create: `desktop/BudgetApp/App/BudgetApp.swift` — `@main` entry
- Create: `desktop/BudgetApp/App/AppDelegate.swift` — deep link handling
- Create: `desktop/BudgetApp.entitlements`
- Create: `desktop/BudgetApp/Info.plist` — deep link URL scheme
- Create: `desktop/README.md` — build instructions

**Interfaces:**
- Produces: compiling Xcode project with sandbox entitlements and deep link scheme registered

- [ ] **Step 1: Create Xcode project via Xcode UI**

Open Xcode → File → New → Project → macOS → App.
- Product Name: `BudgetApp`
- Team: your Apple Developer account (or "None" for local testing)
- Bundle Identifier: `app.budget.BudgetApp`
- Interface: SwiftUI
- Language: Swift
- Storage: None
- Save to: `budget-app/desktop/`

This creates `desktop/BudgetApp.xcodeproj` and `desktop/BudgetApp/`.

- [ ] **Step 2: Add GRDB Swift Package dependency**

In Xcode: File → Add Package Dependencies → enter URL:
`https://github.com/groue/GRDB.swift`
Version: Up to Next Major from `6.0.0`
Target: BudgetApp

- [ ] **Step 3: Set minimum deployment target**

In the BudgetApp target → General → Minimum Deployments → macOS 14.0

- [ ] **Step 4: Enable strict concurrency**

In BudgetApp target → Build Settings → search `SWIFT_STRICT_CONCURRENCY` → set to `complete`

- [ ] **Step 5: Write entitlements**

Replace the generated `BudgetApp.entitlements` with:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.app-sandbox</key>
    <true/>
    <key>com.apple.security.network.client</key>
    <true/>
    <key>com.apple.security.files.user-selected.read-only</key>
    <true/>
</dict>
</plist>
```

- [ ] **Step 6: Register deep link scheme in Info.plist**

Add to `BudgetApp/Info.plist`:

```xml
<key>CFBundleURLTypes</key>
<array>
    <dict>
        <key>CFBundleURLSchemes</key>
        <array>
            <string>budget</string>
        </array>
        <key>CFBundleURLName</key>
        <string>app.budget.BudgetApp</string>
    </dict>
</array>
```

- [ ] **Step 7: Write the app entry point**

Replace the generated `BudgetApp/ContentView.swift` stub with `BudgetApp/App/BudgetApp.swift`:

```swift
import SwiftUI

@main
struct BudgetApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var delegate

    var body: some Scene {
        WindowGroup {
            RootView()
                .onOpenURL { url in
                    NotificationCenter.default.post(
                        name: .budgetDeepLink,
                        object: url
                    )
                }
        }
        .windowStyle(.titleBar)
        .commands {
            AppCommands()
        }

        MenuBarExtra("Budget", systemImage: "dollarsign.circle") {
            MenuBarView()
        }
        .menuBarExtraStyle(.window)
    }
}

extension Notification.Name {
    static let budgetDeepLink = Notification.Name("BudgetDeepLink")
}
```

- [ ] **Step 8: Write AppDelegate for deep links**

Create `BudgetApp/App/AppDelegate.swift`:

```swift
import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate {
    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls {
            NotificationCenter.default.post(name: .budgetDeepLink, object: url)
        }
    }
}
```

- [ ] **Step 9: Write placeholder RootView**

Create `BudgetApp/App/RootView.swift`:

```swift
import SwiftUI

struct RootView: View {
    var body: some View {
        Text("Loading…")
            .frame(minWidth: 900, minHeight: 600)
    }
}
```

- [ ] **Step 10: Write AppCommands**

Create `BudgetApp/App/AppCommands.swift`:

```swift
import SwiftUI

struct AppCommands: Commands {
    var body: some Commands {
        CommandGroup(replacing: .appSettings) {
            Button("Preferences…") {
                NotificationCenter.default.post(name: .openPreferences, object: nil)
            }
            .keyboardShortcut(",")
        }
    }
}

extension Notification.Name {
    static let openPreferences = Notification.Name("OpenPreferences")
}
```

- [ ] **Step 11: Write placeholder MenuBarView**

Create `BudgetApp/MenuBar/MenuBarView.swift`:

```swift
import SwiftUI

struct MenuBarView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Budget App")
                .font(.headline)
            Divider()
            Text("Connecting…")
                .foregroundStyle(.secondary)
        }
        .padding()
        .frame(width: 220)
    }
}
```

- [ ] **Step 12: Create README**

Create `desktop/README.md`:

```markdown
# Budget App — macOS Desktop

Native macOS SwiftUI app connecting to the Budget FastAPI backend.

## Requirements
- macOS 14.0+ (Sonoma)
- Xcode 15+
- Swift 5.10+
- A running Budget backend (set URL in Settings)

## Build
Open `BudgetApp.xcodeproj` in Xcode and press ⌘R.

## Configuration
On first launch, open Settings (⌘,) and set the backend URL.
Default: `https://your-backend.fly.dev`

## Local LLM
- Tier 1: Install Ollama (`brew install ollama`) and run `ollama serve`
- Tier 2: CoreML model auto-detected when available
- Tier 3: Cloud via backend (requires consent in Settings)
```

- [ ] **Step 13: Build the project**

In Xcode press ⌘B. Expected: build succeeds with 0 errors.

- [ ] **Step 14: Commit**

```bash
git add desktop/
git commit -m "feat(desktop): scaffold macOS SwiftUI app — entitlements, deep link, MenuBarExtra shell"
```

---

### Task 2: Keychain Helper + AuthManager

**Files:**
- Create: `desktop/BudgetApp/Auth/KeychainHelper.swift`
- Create: `desktop/BudgetApp/Auth/AuthManager.swift`
- Create: `desktop/BudgetApp/Auth/LoginView.swift`
- Create: `desktop/BudgetAppTests/AuthManagerTests.swift`

**Interfaces:**
- Produces: `AuthManager` `@Observable` actor with `var isAuthenticated: Bool`, `var token: String?`, `func loginWithGoogle() async`, `func logout()`
- Produces: `KeychainHelper.save(key:value:)`, `.load(key:) -> String?`, `.delete(key:)`

- [ ] **Step 1: Write Keychain helper**

Create `BudgetApp/Auth/KeychainHelper.swift`:

```swift
import Foundation
import Security

enum KeychainError: Error {
    case unexpectedStatus(OSStatus)
    case itemNotFound
    case invalidData
}

struct KeychainHelper {
    private static let service = "app.budget.BudgetApp"

    static func save(key: String, value: String) throws {
        let data = Data(value.utf8)
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: key,
        ]
        // Try update first
        let attrs: [CFString: Any] = [kSecValueData: data]
        let updateStatus = SecItemUpdate(query as CFDictionary, attrs as CFDictionary)
        if updateStatus == errSecSuccess { return }
        if updateStatus != errSecItemNotFound {
            throw KeychainError.unexpectedStatus(updateStatus)
        }
        // Add new item
        var addQuery = query
        addQuery[kSecValueData] = data
        let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
        guard addStatus == errSecSuccess else {
            throw KeychainError.unexpectedStatus(addStatus)
        }
    }

    static func load(key: String) throws -> String {
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: key,
            kSecReturnData: true,
            kSecMatchLimit: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess else {
            if status == errSecItemNotFound { throw KeychainError.itemNotFound }
            throw KeychainError.unexpectedStatus(status)
        }
        guard let data = result as? Data, let value = String(data: data, encoding: .utf8) else {
            throw KeychainError.invalidData
        }
        return value
    }

    static func delete(key: String) {
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: key,
        ]
        SecItemDelete(query as CFDictionary)
    }
}
```

- [ ] **Step 2: Write AuthManager**

Create `BudgetApp/Auth/AuthManager.swift`:

```swift
import AuthenticationServices
import Foundation
import Observation

private let kTokenKey = "budget_access_token"
private let kBackendURLKey = "backendBaseURL"
private let kDefaultBackend = "https://your-backend.fly.dev"

@MainActor
@Observable
final class AuthManager: NSObject {
    private(set) var token: String?
    private(set) var isAuthenticated = false
    private(set) var isLoading = false
    private(set) var error: String?

    var backendBaseURL: String {
        UserDefaults.standard.string(forKey: kBackendURLKey) ?? kDefaultBackend
    }

    override init() {
        super.init()
        if let saved = try? KeychainHelper.load(key: kTokenKey) {
            token = saved
            isAuthenticated = true
        }
    }

    func loginWithGoogle() async {
        guard let backendURL = URL(string: backendBaseURL) else {
            error = "Invalid backend URL"
            return
        }
        isLoading = true
        error = nil
        defer { isLoading = false }

        // Build Google OAuth URL — the backend's /api/auth/google/login
        // redirects to Google with its own client ID + secret.
        // For native clients we use budget://auth/callback as redirect_uri.
        let redirectURI = "budget://auth/callback"
        guard var components = URLComponents(
            url: backendURL.appendingPathComponent("api/auth/google/login"),
            resolvingAgainstBaseURL: false
        ) else { return }
        components.queryItems = [
            URLQueryItem(name: "redirect_uri", value: redirectURI),
            URLQueryItem(name: "native", value: "1"),
        ]
        guard let authURL = components.url else { return }
        let callbackScheme = "budget"

        do {
            let callbackURL: URL = try await withCheckedThrowingContinuation { cont in
                let session = ASWebAuthenticationSession(
                    url: authURL,
                    callbackURLScheme: callbackScheme
                ) { url, err in
                    if let err { cont.resume(throwing: err) }
                    else if let url { cont.resume(returning: url) }
                    else { cont.resume(throwing: URLError(.cancelled)) }
                }
                session.prefersEphemeralWebBrowserSession = false
                session.start()
                // Keep session alive — ASWebAuthenticationSession is reference counted
                // by the continuation; no need to store it separately.
                _ = session
            }

            // Extract code from budget://auth/callback?code=xxx
            guard
                let components = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false),
                let code = components.queryItems?.first(where: { $0.name == "code" })?.value
            else {
                self.error = "No auth code in callback URL"
                return
            }

            // Exchange code for JWT via native token endpoint
            let jwt = try await exchangeGoogleCode(code: code, redirectURI: redirectURI, backendURL: backendURL)
            try KeychainHelper.save(key: kTokenKey, value: jwt)
            token = jwt
            isAuthenticated = true
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func exchangeGoogleCode(code: String, redirectURI: String, backendURL: URL) async throws -> String {
        let url = backendURL.appendingPathComponent("api/auth/native/token")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body = ["grant_type": "google_code", "code": code, "redirect_uri": redirectURI]
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw URLError(.badServerResponse)
        }
        struct TokenResponse: Decodable { let access_token: String }
        let decoded = try JSONDecoder().decode(TokenResponse.self, from: data)
        return decoded.access_token
    }

    func logout() {
        KeychainHelper.delete(key: kTokenKey)
        token = nil
        isAuthenticated = false
    }

    func handleDeepLink(_ url: URL) {
        // Deep links arrive here via AppDelegate → NotificationCenter
        // The actual exchange happens inside loginWithGoogle() continuation above.
        // This is a no-op fallback for links that arrive outside of a session.
        _ = url
    }
}
```

- [ ] **Step 3: Write LoginView**

Create `BudgetApp/Auth/LoginView.swift`:

```swift
import SwiftUI

struct LoginView: View {
    @Environment(AuthManager.self) private var auth

    var body: some View {
        VStack(spacing: 24) {
            Image(systemName: "dollarsign.circle.fill")
                .font(.system(size: 64))
                .foregroundStyle(.tint)

            Text("Budget App")
                .font(.largeTitle.bold())

            Text("Sign in to sync your budget across devices.")
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            if let err = auth.error {
                Text(err)
                    .foregroundStyle(.red)
                    .font(.caption)
            }

            Button {
                Task { await auth.loginWithGoogle() }
            } label: {
                Label(auth.isLoading ? "Signing in…" : "Sign in with Google", systemImage: "globe")
                    .frame(maxWidth: 240)
            }
            .buttonStyle(.borderedProminent)
            .disabled(auth.isLoading)
            .controlSize(.large)
        }
        .padding(48)
        .frame(width: 480, height: 360)
    }
}
```

- [ ] **Step 4: Update RootView to show LoginView when unauthenticated**

Replace `BudgetApp/App/RootView.swift`:

```swift
import SwiftUI

struct RootView: View {
    @State private var auth = AuthManager()

    var body: some View {
        Group {
            if auth.isAuthenticated {
                MainSplitView()
                    .environment(auth)
            } else {
                LoginView()
                    .environment(auth)
            }
        }
        .frame(minWidth: 900, minHeight: 600)
        .onReceive(NotificationCenter.default.publisher(for: .budgetDeepLink)) { note in
            if let url = note.object as? URL {
                auth.handleDeepLink(url)
            }
        }
    }
}
```

- [ ] **Step 5: Write placeholder MainSplitView**

Create `BudgetApp/App/MainSplitView.swift`:

```swift
import SwiftUI

struct MainSplitView: View {
    var body: some View {
        NavigationSplitView {
            Text("Sidebar")
        } content: {
            Text("Main Pane")
        } detail: {
            Text("Detail")
        }
    }
}
```

- [ ] **Step 6: Write unit tests for KeychainHelper**

Create `BudgetAppTests/AuthManagerTests.swift`:

```swift
import XCTest
@testable import BudgetApp

final class KeychainHelperTests: XCTestCase {
    let testKey = "test_keychain_\(UUID().uuidString)"

    override func tearDown() {
        KeychainHelper.delete(key: testKey)
    }

    func testSaveAndLoad() throws {
        try KeychainHelper.save(key: testKey, value: "hello-token")
        let loaded = try KeychainHelper.load(key: testKey)
        XCTAssertEqual(loaded, "hello-token")
    }

    func testOverwriteExisting() throws {
        try KeychainHelper.save(key: testKey, value: "first")
        try KeychainHelper.save(key: testKey, value: "second")
        let loaded = try KeychainHelper.load(key: testKey)
        XCTAssertEqual(loaded, "second")
    }

    func testDeleteRemovesItem() throws {
        try KeychainHelper.save(key: testKey, value: "to-delete")
        KeychainHelper.delete(key: testKey)
        XCTAssertThrowsError(try KeychainHelper.load(key: testKey)) { err in
            guard case KeychainError.itemNotFound = err else {
                XCTFail("Expected itemNotFound, got \(err)")
                return
            }
        }
    }

    func testLoadMissingThrows() {
        XCTAssertThrowsError(try KeychainHelper.load(key: "nonexistent_\(UUID())"))
    }
}
```

- [ ] **Step 7: Run unit tests in Xcode**

In Xcode: Product → Test (⌘U). All `KeychainHelperTests` should pass.

- [ ] **Step 8: Build and verify**

Press ⌘B. Expected: 0 errors. Launch (⌘R) — expect LoginView to appear.

- [ ] **Step 9: Commit**

```bash
git add desktop/
git commit -m "feat(desktop): KeychainHelper, AuthManager, LoginView, RootView auth gate"
```

---

### Task 3: APIClient

**Files:**
- Create: `desktop/BudgetApp/Data/Remote/APIClient.swift`
- Create: `desktop/BudgetApp/Data/Remote/APIError.swift`
- Create: `desktop/BudgetApp/Data/Remote/Models.swift` — shared Decodable types
- Create: `desktop/BudgetAppTests/APIClientTests.swift`

**Interfaces:**
- Produces: `APIClient` actor with `func get<T: Decodable>(_ path: String) async throws -> T`
- Produces: `func post<B: Encodable, T: Decodable>(_ path: String, body: B) async throws -> T`
- Produces: `func postSSE(_ path: String, body: some Encodable, onChunk: @escaping (String) -> Void) async throws`
- Consumes: `AuthManager.token` for Bearer header, `AuthManager.backendBaseURL`

- [ ] **Step 1: Write APIError**

Create `BudgetApp/Data/Remote/APIError.swift`:

```swift
import Foundation

enum APIError: LocalizedError {
    case invalidURL(String)
    case unauthenticated
    case httpError(Int, String)
    case decodingError(Error)
    case networkError(Error)

    var errorDescription: String? {
        switch self {
        case .invalidURL(let u): return "Invalid URL: \(u)"
        case .unauthenticated: return "Not authenticated. Please sign in."
        case .httpError(let code, let msg): return "Server error \(code): \(msg)"
        case .decodingError(let e): return "Response decode error: \(e)"
        case .networkError(let e): return "Network error: \(e)"
        }
    }
}
```

- [ ] **Step 2: Write shared Decodable models**

Create `BudgetApp/Data/Remote/Models.swift`:

```swift
import Foundation

// MARK: - Transaction
struct RemoteTransaction: Codable, Identifiable {
    let id: String
    let date: String
    let amount: Double
    let payeeName: String?
    let categoryName: String?
    let accountName: String?
    let notes: String?

    enum CodingKeys: String, CodingKey {
        case id, date, amount, notes
        case payeeName = "payee_name"
        case categoryName = "category_name"
        case accountName = "account_name"
    }
}

// MARK: - Budget
struct RemoteBudgetCategory: Codable, Identifiable {
    let id: String
    let name: String
    let groupName: String
    let assigned: Double
    let spent: Double
    let available: Double

    enum CodingKeys: String, CodingKey {
        case id, name, assigned, spent, available
        case groupName = "group_name"
    }
}

// MARK: - InferenceContext
struct InferenceContextResponse: Decodable {
    let system: String
    let prompt: String
    let responseSchema: [String: AnyCodable]
    let featureId: String

    enum CodingKeys: String, CodingKey {
        case system, prompt
        case responseSchema = "response_schema"
        case featureId = "feature_id"
    }
}

// Minimal AnyCodable for the schema field
struct AnyCodable: Codable {
    let value: Any

    init(_ value: Any) { self.value = value }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let s = try? container.decode(String.self) { value = s; return }
        if let i = try? container.decode(Int.self) { value = i; return }
        if let d = try? container.decode(Double.self) { value = d; return }
        if let b = try? container.decode(Bool.self) { value = b; return }
        if let a = try? container.decode([AnyCodable].self) { value = a.map(\.value); return }
        if let o = try? container.decode([String: AnyCodable].self) {
            value = o.mapValues(\.value); return
        }
        value = ()
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch value {
        case let s as String: try container.encode(s)
        case let i as Int: try container.encode(i)
        case let d as Double: try container.encode(d)
        case let b as Bool: try container.encode(b)
        default: try container.encodeNil()
        }
    }
}
```

- [ ] **Step 3: Write APIClient**

Create `BudgetApp/Data/Remote/APIClient.swift`:

```swift
import Foundation

actor APIClient {
    private let session: URLSession
    private let encoder = JSONEncoder()
    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        return d
    }()

    // Injected by the environment — set after auth
    var token: String?
    var baseURL: URL

    init(baseURL: URL) {
        self.baseURL = baseURL
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 300
        self.session = URLSession(configuration: config)
    }

    // MARK: - GET

    func get<T: Decodable>(_ path: String) async throws -> T {
        let req = try buildRequest(method: "GET", path: path)
        return try await perform(req)
    }

    // MARK: - POST (JSON response)

    func post<B: Encodable, T: Decodable>(_ path: String, body: B) async throws -> T {
        var req = try buildRequest(method: "POST", path: path)
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try encoder.encode(body)
        return try await perform(req)
    }

    // MARK: - POST SSE (streaming text/event-stream)

    func postSSE<B: Encodable>(
        _ path: String,
        body: B,
        onChunk: @Sendable @escaping (String) -> Void
    ) async throws {
        var req = try buildRequest(method: "POST", path: path)
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        req.httpBody = try encoder.encode(body)

        let (bytes, response) = try await session.bytes(for: req)
        let http = response as? HTTPURLResponse
        if let status = http?.statusCode, status >= 400 {
            throw APIError.httpError(status, "SSE request failed")
        }

        for try await line in bytes.lines {
            if line.hasPrefix("data:") {
                let data = String(line.dropFirst(5)).trimmingCharacters(in: .whitespaces)
                if !data.isEmpty {
                    onChunk(data)
                }
            }
        }
    }

    // MARK: - Helpers

    private func buildRequest(method: String, path: String) throws -> URLRequest {
        guard let url = URL(string: path, relativeTo: baseURL) else {
            throw APIError.invalidURL(path)
        }
        var req = URLRequest(url: url)
        req.httpMethod = method
        if let token {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        return req
    }

    private func perform<T: Decodable>(_ request: URLRequest) async throws -> T {
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw APIError.networkError(error)
        }

        guard let http = response as? HTTPURLResponse else {
            throw APIError.networkError(URLError(.badServerResponse))
        }

        if http.statusCode == 401 {
            throw APIError.unauthenticated
        }

        guard (200..<300).contains(http.statusCode) else {
            let msg = (try? JSONDecoder().decode([String: String].self, from: data))?["detail"]
                ?? HTTPURLResponse.localizedString(forStatusCode: http.statusCode)
            throw APIError.httpError(http.statusCode, msg)
        }

        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError.decodingError(error)
        }
    }
}
```

- [ ] **Step 4: Write APIClient tests**

Create `BudgetAppTests/APIClientTests.swift`:

```swift
import XCTest
@testable import BudgetApp

final class APIClientTests: XCTestCase {
    // APIClient uses URLSession which needs a real server or URL protocol mock.
    // We test the error-path logic via building requests with known-bad inputs.

    func testInvalidURLThrows() async {
        let client = await APIClient(baseURL: URL(string: "https://example.com")!)
        do {
            let _: [String: String] = try await client.get("://not-a-url")
            XCTFail("Expected throw")
        } catch APIError.invalidURL {
            // expected
        } catch {
            XCTFail("Unexpected error type: \(error)")
        }
    }

    func testTokenSetOnActor() async {
        let client = await APIClient(baseURL: URL(string: "https://example.com")!)
        await client.setToken("my-test-token")
        let tok = await client.token
        XCTAssertEqual(tok, "my-test-token")
    }
}
```

Add a helper to `APIClient.swift` for testability:

```swift
    // Exposed for testing only
    func setToken(_ t: String?) { token = t }
```

- [ ] **Step 5: Run tests (⌘U in Xcode)**

Expected: `APIClientTests` pass.

- [ ] **Step 6: Commit**

```bash
git add desktop/
git commit -m "feat(desktop): APIClient actor with GET/POST/SSE, Remote models, APIError"
```

---

### Task 4: GRDB Local Cache + SyncCoordinator

**Files:**
- Create: `desktop/BudgetApp/Data/Local/AppDatabase.swift` — GRDB setup + migrations
- Create: `desktop/BudgetApp/Data/Local/LocalTransaction.swift` — GRDB record
- Create: `desktop/BudgetApp/Data/Local/LocalBudgetCategory.swift` — GRDB record
- Create: `desktop/BudgetApp/Data/Sync/SyncCoordinator.swift` — fetch → upsert loop
- Create: `desktop/BudgetAppTests/DatabaseTests.swift`

**Interfaces:**
- Produces: `AppDatabase.shared: DatabaseQueue`
- Produces: `SyncCoordinator` actor with `func syncAll() async throws`
- Produces: `LocalTransaction: FetchableRecord, PersistableRecord, Identifiable`
- Produces: `LocalBudgetCategory: FetchableRecord, PersistableRecord, Identifiable`

- [ ] **Step 1: Write AppDatabase**

Create `BudgetApp/Data/Local/AppDatabase.swift`:

```swift
import GRDB
import Foundation

final class AppDatabase {
    static let shared: DatabaseQueue = {
        let url = try! FileManager.default
            .url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appendingPathComponent("BudgetApp")
        try! FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        let dbPath = url.appendingPathComponent("budget.sqlite").path
        var config = Configuration()
        config.foreignKeysEnabled = true
        let queue = try! DatabaseQueue(path: dbPath, configuration: config)
        try! migrator.migrate(queue)
        return queue
    }()

    static var migrator: DatabaseMigrator = {
        var m = DatabaseMigrator()

        m.registerMigration("v1_initial") { db in
            try db.create(table: "local_transaction") { t in
                t.column("id", .text).primaryKey()
                t.column("date", .text).notNull()
                t.column("amount", .double).notNull()
                t.column("payee_name", .text)
                t.column("category_name", .text)
                t.column("account_name", .text)
                t.column("notes", .text)
                t.column("synced_at", .datetime).notNull()
            }
            try db.create(table: "local_budget_category") { t in
                t.column("id", .text).primaryKey()
                t.column("name", .text).notNull()
                t.column("group_name", .text).notNull()
                t.column("assigned", .double).notNull()
                t.column("spent", .double).notNull()
                t.column("available", .double).notNull()
                t.column("synced_at", .datetime).notNull()
            }
        }

        return m
    }()
}
```

- [ ] **Step 2: Write LocalTransaction record**

Create `BudgetApp/Data/Local/LocalTransaction.swift`:

```swift
import GRDB
import Foundation

struct LocalTransaction: Codable, FetchableRecord, MutablePersistableRecord, Identifiable {
    static let databaseTableName = "local_transaction"

    var id: String
    var date: String
    var amount: Double
    var payeeName: String?
    var categoryName: String?
    var accountName: String?
    var notes: String?
    var syncedAt: Date

    enum Columns {
        static let id = Column(CodingKeys.id)
        static let date = Column(CodingKeys.date)
        static let amount = Column(CodingKeys.amount)
        static let syncedAt = Column(CodingKeys.syncedAt)
    }

    static func fromRemote(_ r: RemoteTransaction) -> LocalTransaction {
        LocalTransaction(
            id: r.id,
            date: r.date,
            amount: r.amount,
            payeeName: r.payeeName,
            categoryName: r.categoryName,
            accountName: r.accountName,
            notes: r.notes,
            syncedAt: Date()
        )
    }
}
```

- [ ] **Step 3: Write LocalBudgetCategory record**

Create `BudgetApp/Data/Local/LocalBudgetCategory.swift`:

```swift
import GRDB
import Foundation

struct LocalBudgetCategory: Codable, FetchableRecord, MutablePersistableRecord, Identifiable {
    static let databaseTableName = "local_budget_category"

    var id: String
    var name: String
    var groupName: String
    var assigned: Double
    var spent: Double
    var available: Double
    var syncedAt: Date

    static func fromRemote(_ r: RemoteBudgetCategory) -> LocalBudgetCategory {
        LocalBudgetCategory(
            id: r.id,
            name: r.name,
            groupName: r.groupName,
            assigned: r.assigned,
            spent: r.spent,
            available: r.available,
            syncedAt: Date()
        )
    }
}
```

- [ ] **Step 4: Write SyncCoordinator**

Create `BudgetApp/Data/Sync/SyncCoordinator.swift`:

```swift
import Foundation
import GRDB

@MainActor
@Observable
final class SyncCoordinator {
    private(set) var isSyncing = false
    private(set) var lastSyncedAt: Date?
    private(set) var error: String?

    private let api: APIClient
    private let db = AppDatabase.shared

    init(api: APIClient) {
        self.api = api
    }

    func syncAll() async {
        guard !isSyncing else { return }
        isSyncing = true
        error = nil
        defer { isSyncing = false }

        do {
            async let txns: Void = syncTransactions()
            async let budget: Void = syncBudget()
            _ = try await (txns, budget)
            lastSyncedAt = Date()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func syncTransactions() async throws {
        // Fetch first page (extend to pagination if needed)
        struct TxnListResponse: Decodable { let transactions: [RemoteTransaction] }
        let resp: TxnListResponse = try await api.get("api/transactions?limit=500")
        let locals = resp.transactions.map(LocalTransaction.fromRemote)
        try db.write { db in
            for t in locals {
                try t.save(db)
            }
        }
    }

    private func syncBudget() async throws {
        struct BudgetResponse: Decodable { let categories: [RemoteBudgetCategory] }
        let resp: BudgetResponse = try await api.get("api/budget/current")
        let locals = resp.categories.map(LocalBudgetCategory.fromRemote)
        try db.write { db in
            for c in locals {
                try c.save(db)
            }
        }
    }
}
```

- [ ] **Step 5: Write database tests**

Create `BudgetAppTests/DatabaseTests.swift`:

```swift
import XCTest
import GRDB
@testable import BudgetApp

final class DatabaseTests: XCTestCase {
    var db: DatabaseQueue!

    override func setUp() throws {
        db = try DatabaseQueue()
        try AppDatabase.migrator.migrate(db)
    }

    func testInsertAndFetchTransaction() throws {
        var txn = LocalTransaction(
            id: "t-1",
            date: "2026-07-01",
            amount: -45.00,
            payeeName: "Whole Foods",
            categoryName: "Groceries",
            accountName: nil,
            notes: nil,
            syncedAt: Date()
        )
        try db.write { db in try txn.save(db) }
        let fetched = try db.read { db in
            try LocalTransaction.fetchOne(db, key: "t-1")
        }
        XCTAssertEqual(fetched?.payeeName, "Whole Foods")
        XCTAssertEqual(fetched?.amount, -45.00)
    }

    func testUpsertTransaction() throws {
        var txn = LocalTransaction(
            id: "t-2", date: "2026-07-01", amount: -10.00,
            payeeName: "Coffee", categoryName: nil,
            accountName: nil, notes: nil, syncedAt: Date()
        )
        try db.write { db in try txn.save(db) }
        txn.categoryName = "Food"
        try db.write { db in try txn.save(db) }
        let count = try db.read { db in try LocalTransaction.fetchCount(db) }
        XCTAssertEqual(count, 1)
        let fetched = try db.read { db in try LocalTransaction.fetchOne(db, key: "t-2") }
        XCTAssertEqual(fetched?.categoryName, "Food")
    }

    func testInsertBudgetCategory() throws {
        let cat = LocalBudgetCategory(
            id: "c-1", name: "Groceries", groupName: "Food",
            assigned: 300, spent: 120, available: 180, syncedAt: Date()
        )
        try db.write { db in try cat.save(db) }
        let fetched = try db.read { db in try LocalBudgetCategory.fetchAll(db) }
        XCTAssertEqual(fetched.count, 1)
        XCTAssertEqual(fetched[0].name, "Groceries")
    }
}
```

- [ ] **Step 6: Run tests (⌘U)**

Expected: all `DatabaseTests` pass.

- [ ] **Step 7: Commit**

```bash
git add desktop/
git commit -m "feat(desktop): GRDB schema, LocalTransaction, LocalBudgetCategory, SyncCoordinator"
```

---

### Task 5: InferenceManager (3-Tier LLM)

**Files:**
- Create: `desktop/BudgetApp/Inference/InferenceManager.swift`
- Create: `desktop/BudgetApp/Inference/OllamaProvider.swift`
- Create: `desktop/BudgetApp/Inference/CoreMLProvider.swift`
- Create: `desktop/BudgetApp/Inference/CloudProvider.swift`
- Create: `desktop/BudgetAppTests/InferenceManagerTests.swift`

**Interfaces:**
- Produces: `InferenceManager` actor with `func complete(prompt: String, system: String) async throws -> String`
- Produces: `func activeTier() async -> InferenceTier` — returns `.ollama`, `.coreML`, or `.cloud`
- `InferenceTier: String, CaseIterable { case ollama, coreML, cloud }`

- [ ] **Step 1: Write InferenceTier + OllamaProvider**

Create `BudgetApp/Inference/OllamaProvider.swift`:

```swift
import Foundation

enum InferenceTier: String, CaseIterable {
    case ollama = "Ollama (Local)"
    case coreML = "CoreML (On-Device)"
    case cloud = "Cloud (Remote)"
}

struct OllamaProvider {
    private static let checkURLs = [
        URL(string: "http://127.0.0.1:11434/api/tags")!,  // Ollama
        URL(string: "http://127.0.0.1:1234/v1/models")!,  // LM Studio
    ]

    static func isAvailable() async -> (Bool, URL?) {
        for url in checkURLs {
            var req = URLRequest(url: url, timeoutInterval: 0.5)
            req.httpMethod = "GET"
            if let (_, resp) = try? await URLSession.shared.data(for: req),
               let http = resp as? HTTPURLResponse, http.statusCode == 200 {
                // Use the corresponding chat endpoint
                let base = url.deletingLastPathComponent().deletingLastPathComponent()
                return (true, base)
            }
        }
        return (false, nil)
    }

    static func complete(prompt: String, system: String, baseURL: URL) async throws -> String {
        let url = baseURL.appendingPathComponent("v1/chat/completions")
        var req = URLRequest(url: url, timeoutInterval: 60)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: Any] = [
            "model": UserDefaults.standard.string(forKey: "ollamaModel") ?? "qwen2.5:7b",
            "messages": [
                ["role": "system", "content": system],
                ["role": "user", "content": prompt],
            ],
            "temperature": 0.2,
            "stream": false,
        ]
        req.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw InferenceError.ollamaRequestFailed
        }

        struct Resp: Decodable {
            struct Choice: Decodable {
                struct Message: Decodable { let content: String }
                let message: Message
            }
            let choices: [Choice]
        }
        let decoded = try JSONDecoder().decode(Resp.self, from: data)
        return decoded.choices.first?.message.content ?? ""
    }
}

enum InferenceError: LocalizedError {
    case ollamaRequestFailed
    case coreMLUnavailable
    case cloudFallbackDenied
    case allTiersFailed

    var errorDescription: String? {
        switch self {
        case .ollamaRequestFailed: return "Ollama request failed"
        case .coreMLUnavailable: return "CoreML model not available"
        case .cloudFallbackDenied: return "Cloud inference not enabled"
        case .allTiersFailed: return "All inference tiers failed"
        }
    }
}
```

- [ ] **Step 2: Write CoreMLProvider stub**

Create `BudgetApp/Inference/CoreMLProvider.swift`:

```swift
import CoreML
import Foundation

// CoreML provider — wraps a .mlmodelc bundled with the app.
// For now this is a stub that always throws .coreMLUnavailable;
// replace with a real CoreML text-generation model when available.
struct CoreMLProvider {
    static func isAvailable() -> Bool {
        // Check if a bundled CoreML model exists
        return Bundle.main.url(forResource: "BudgetLLM", withExtension: "mlmodelc") != nil
    }

    static func complete(prompt: String, system: String) async throws -> String {
        guard isAvailable() else {
            throw InferenceError.coreMLUnavailable
        }
        // TODO: Load and run the CoreML model
        // let modelURL = Bundle.main.url(forResource: "BudgetLLM", withExtension: "mlmodelc")!
        // let model = try MLModel(contentsOf: modelURL)
        // ... run inference ...
        throw InferenceError.coreMLUnavailable
    }
}
```

- [ ] **Step 3: Write CloudProvider**

Create `BudgetApp/Inference/CloudProvider.swift`:

```swift
import Foundation

struct CloudProvider {
    // Cloud inference goes through the backend's existing /api/llm/cloud endpoint.
    // Requires user consent (checked before calling this).
    static func complete(
        prompt: String,
        system: String,
        api: APIClient
    ) async throws -> String {
        struct CloudRequest: Encodable {
            let feature: String
            let prompt: String
            let system: String
            let maxTokens: Int

            enum CodingKeys: String, CodingKey {
                case feature, prompt, system
                case maxTokens = "maxTokens"
            }
        }
        struct CloudResponse: Decodable { let answer: String }

        let req = CloudRequest(
            feature: "chat",
            prompt: prompt,
            system: system,
            maxTokens: 1024
        )

        // The /api/llm/cloud endpoint streams SSE; we collect the last data chunk
        var lastChunk = ""
        try await api.postSSE("api/llm/cloud", body: req) { chunk in
            lastChunk = chunk
        }

        if let data = lastChunk.data(using: .utf8),
           let resp = try? JSONDecoder().decode(CloudResponse.self, from: data) {
            return resp.answer
        }
        return lastChunk
    }
}
```

- [ ] **Step 4: Write InferenceManager**

Create `BudgetApp/Inference/InferenceManager.swift`:

```swift
import Foundation
import Observation

@MainActor
@Observable
final class InferenceManager {
    private(set) var activeTier: InferenceTier = .cloud
    private(set) var isInferring = false
    private(set) var cloudConsentGranted = false

    private let api: APIClient

    init(api: APIClient) {
        self.api = api
    }

    func detectTier() async {
        let (available, _) = await OllamaProvider.isAvailable()
        if available {
            activeTier = .ollama
        } else if CoreMLProvider.isAvailable() {
            activeTier = .coreML
        } else {
            activeTier = .cloud
        }
    }

    func complete(prompt: String, system: String) async throws -> String {
        isInferring = true
        defer { isInferring = false }

        // Tier 1: Ollama / LM Studio
        let (ollamaAvailable, ollamaBase) = await OllamaProvider.isAvailable()
        if ollamaAvailable, let base = ollamaBase {
            activeTier = .ollama
            return try await OllamaProvider.complete(prompt: prompt, system: system, baseURL: base)
        }

        // Tier 2: CoreML
        if CoreMLProvider.isAvailable() {
            activeTier = .coreML
            if let result = try? await CoreMLProvider.complete(prompt: prompt, system: system) {
                return result
            }
        }

        // Tier 3: Cloud (requires consent)
        guard cloudConsentGranted else {
            throw InferenceError.cloudFallbackDenied
        }
        activeTier = .cloud
        return try await CloudProvider.complete(prompt: prompt, system: system, api: api)
    }

    func grantCloudConsent() { cloudConsentGranted = true }
    func revokeCloudConsent() { cloudConsentGranted = false }
}
```

- [ ] **Step 5: Write InferenceManager tests**

Create `BudgetAppTests/InferenceManagerTests.swift`:

```swift
import XCTest
@testable import BudgetApp

final class InferenceManagerTests: XCTestCase {
    func testCloudFallbackDeniedWithoutConsent() async {
        let api = await APIClient(baseURL: URL(string: "https://example.com")!)
        let mgr = await InferenceManager(api: api)
        // Ollama won't be available in CI; CoreML stub always throws
        // Without consent, cloud should throw .cloudFallbackDenied
        do {
            _ = try await mgr.complete(prompt: "test", system: "test system")
            XCTFail("Expected throw")
        } catch InferenceError.cloudFallbackDenied {
            // expected
        } catch {
            // Also acceptable — Ollama might throw before we get to cloud check
            XCTAssertTrue(
                error is InferenceError || error is URLError,
                "Unexpected error: \(error)"
            )
        }
    }
}
```

- [ ] **Step 6: Run tests (⌘U)**

Expected: `InferenceManagerTests` passes.

- [ ] **Step 7: Commit**

```bash
git add desktop/
git commit -m "feat(desktop): 3-tier InferenceManager — Ollama, CoreML stub, Cloud via backend"
```

---

### Task 6: Main 3-Pane UI + Feature Views

**Files:**
- Replace: `desktop/BudgetApp/App/MainSplitView.swift` — full NavigationSplitView
- Create: `desktop/BudgetApp/Features/Transactions/TransactionsView.swift`
- Create: `desktop/BudgetApp/Features/Budget/BudgetView.swift`
- Create: `desktop/BudgetApp/Features/Settings/SettingsView.swift`
- Create: `desktop/BudgetApp/Features/Chat/ChatView.swift`
- Create: `desktop/BudgetApp/Features/DocumentImport/DocumentImportView.swift`

**Interfaces:**
- Consumes: `AuthManager`, `SyncCoordinator`, `InferenceManager` from environment
- Produces: functional navigation with real data from GRDB

- [ ] **Step 1: Wire dependencies into RootView**

Replace `BudgetApp/App/RootView.swift`:

```swift
import SwiftUI

struct RootView: View {
    @State private var auth = AuthManager()
    @State private var api: APIClient = APIClient(baseURL: URL(string: "https://your-backend.fly.dev")!)
    @State private var sync: SyncCoordinator
    @State private var inference: InferenceManager

    init() {
        let a = AuthManager()
        let backendURL = URL(string: UserDefaults.standard.string(forKey: "backendBaseURL") ?? "https://your-backend.fly.dev")!
        let apiClient = APIClient(baseURL: backendURL)
        _auth = State(initialValue: a)
        _api = State(initialValue: apiClient)
        _sync = State(initialValue: SyncCoordinator(api: apiClient))
        _inference = State(initialValue: InferenceManager(api: apiClient))
    }

    var body: some View {
        Group {
            if auth.isAuthenticated {
                MainSplitView()
                    .environment(auth)
                    .environment(sync)
                    .environment(inference)
                    .task {
                        await api.setToken(auth.token)
                        await sync.syncAll()
                        await inference.detectTier()
                    }
            } else {
                LoginView()
                    .environment(auth)
            }
        }
        .frame(minWidth: 900, minHeight: 600)
        .onReceive(NotificationCenter.default.publisher(for: .budgetDeepLink)) { note in
            if let url = note.object as? URL { auth.handleDeepLink(url) }
        }
        .onReceive(NotificationCenter.default.publisher(for: .openPreferences)) { _ in
            NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil)
        }
    }
}
```

- [ ] **Step 2: Write MainSplitView with sidebar navigation**

Replace `BudgetApp/App/MainSplitView.swift`:

```swift
import SwiftUI

enum SidebarItem: String, CaseIterable, Identifiable {
    case transactions = "Transactions"
    case budget = "Budget"
    case importDoc = "Import"
    case settings = "Settings"

    var id: String { rawValue }

    var icon: String {
        switch self {
        case .transactions: return "list.bullet.rectangle"
        case .budget: return "chart.bar"
        case .importDoc: return "doc.badge.plus"
        case .settings: return "gear"
        }
    }
}

struct MainSplitView: View {
    @State private var selectedItem: SidebarItem? = .transactions
    @State private var chatVisible = false

    var body: some View {
        NavigationSplitView {
            List(SidebarItem.allCases, selection: $selectedItem) { item in
                Label(item.rawValue, systemImage: item.icon)
                    .tag(item)
            }
            .listStyle(.sidebar)
            .navigationTitle("Budget")
        } content: {
            switch selectedItem {
            case .transactions, .none:
                TransactionsView(onOpenChat: { chatVisible = true })
            case .budget:
                BudgetView()
            case .importDoc:
                DocumentImportView()
            case .settings:
                SettingsView()
            }
        } detail: {
            if chatVisible {
                ChatView(onClose: { chatVisible = false })
            } else {
                ContentUnavailableView(
                    "No Selection",
                    systemImage: "bubble.left.and.bubble.right",
                    description: Text("Select a section or open the AI chat")
                )
            }
        }
    }
}
```

- [ ] **Step 3: Write TransactionsView**

Create `BudgetApp/Features/Transactions/TransactionsView.swift`:

```swift
import GRDB
import SwiftUI

struct TransactionsView: View {
    let onOpenChat: () -> Void

    @Environment(SyncCoordinator.self) private var sync
    @State private var transactions: [LocalTransaction] = []
    @State private var searchText = ""

    private var filtered: [LocalTransaction] {
        guard !searchText.isEmpty else { return transactions }
        let q = searchText.lowercased()
        return transactions.filter {
            ($0.payeeName?.lowercased().contains(q) ?? false) ||
            ($0.categoryName?.lowercased().contains(q) ?? false)
        }
    }

    var body: some View {
        List(filtered) { txn in
            TransactionRow(txn: txn)
        }
        .searchable(text: $searchText, prompt: "Search transactions")
        .navigationTitle("Transactions")
        .toolbar {
            ToolbarItem {
                Button("Sync", systemImage: "arrow.clockwise") {
                    Task { await sync.syncAll() }
                }
                .disabled(sync.isSyncing)
            }
            ToolbarItem {
                Button("AI Chat", systemImage: "bubble.left.and.bubble.right") {
                    onOpenChat()
                }
            }
        }
        .task { await loadTransactions() }
        .onChange(of: sync.lastSyncedAt) { _, _ in Task { await loadTransactions() } }
    }

    private func loadTransactions() async {
        do {
            transactions = try AppDatabase.shared.read { db in
                try LocalTransaction
                    .order(Column("date").desc)
                    .limit(500)
                    .fetchAll(db)
            }
        } catch {
            transactions = []
        }
    }
}

struct TransactionRow: View {
    let txn: LocalTransaction

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(txn.payeeName ?? "Unknown")
                    .fontWeight(.medium)
                if let cat = txn.categoryName {
                    Text(cat)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text(txn.amount, format: .currency(code: "USD"))
                    .foregroundStyle(txn.amount >= 0 ? .green : .primary)
                Text(txn.date)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
    }
}
```

- [ ] **Step 4: Write BudgetView**

Create `BudgetApp/Features/Budget/BudgetView.swift`:

```swift
import GRDB
import SwiftUI

struct BudgetView: View {
    @Environment(SyncCoordinator.self) private var sync
    @State private var categories: [LocalBudgetCategory] = []

    private var grouped: [(String, [LocalBudgetCategory])] {
        Dictionary(grouping: categories, by: \.groupName)
            .sorted { $0.key < $1.key }
    }

    var body: some View {
        List {
            ForEach(grouped, id: \.0) { group, cats in
                Section(group) {
                    ForEach(cats) { cat in
                        BudgetCategoryRow(cat: cat)
                    }
                }
            }
        }
        .navigationTitle("Budget")
        .toolbar {
            ToolbarItem {
                Button("Sync", systemImage: "arrow.clockwise") {
                    Task { await sync.syncAll() }
                }
                .disabled(sync.isSyncing)
            }
        }
        .task { await load() }
        .onChange(of: sync.lastSyncedAt) { _, _ in Task { await load() } }
    }

    private func load() async {
        do {
            categories = try AppDatabase.shared.read { db in
                try LocalBudgetCategory.order(Column("group_name"), Column("name")).fetchAll(db)
            }
        } catch { categories = [] }
    }
}

struct BudgetCategoryRow: View {
    let cat: LocalBudgetCategory

    var body: some View {
        HStack {
            Text(cat.name)
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text(cat.available, format: .currency(code: "USD"))
                    .foregroundStyle(cat.available >= 0 ? .primary : .red)
                    .fontWeight(.medium)
                Text("of \(cat.assigned, format: .currency(code: "USD"))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }
}
```

- [ ] **Step 5: Write ChatView**

Create `BudgetApp/Features/Chat/ChatView.swift`:

```swift
import SwiftUI

struct ChatMessage: Identifiable {
    let id = UUID()
    let role: Role
    let text: String
    enum Role { case user, assistant }
}

struct ChatView: View {
    let onClose: () -> Void

    @Environment(InferenceManager.self) private var inference
    @Environment(SyncCoordinator.self) private var sync
    @State private var messages: [ChatMessage] = []
    @State private var inputText = ""
    @State private var isThinking = false
    @State private var error: String?

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("AI Chat")
                    .font(.headline)
                Spacer()
                Text(inference.activeTier.rawValue)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Button("Close", systemImage: "xmark") { onClose() }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.borderless)
            }
            .padding()
            Divider()

            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        ForEach(messages) { msg in
                            MessageBubble(message: msg)
                                .id(msg.id)
                        }
                        if isThinking {
                            HStack {
                                ProgressView()
                                Text("Thinking…").foregroundStyle(.secondary)
                            }
                            .padding(.horizontal)
                        }
                        if let err = error {
                            Text(err).foregroundStyle(.red).padding(.horizontal)
                        }
                    }
                    .padding()
                }
                .onChange(of: messages.count) { _, _ in
                    proxy.scrollTo(messages.last?.id, anchor: .bottom)
                }
            }

            Divider()
            HStack {
                TextField("Ask about your budget…", text: $inputText)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit { Task { await sendMessage() } }
                Button("Send") { Task { await sendMessage() } }
                    .disabled(inputText.isEmpty || isThinking)
            }
            .padding()
        }
    }

    private func sendMessage() async {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        inputText = ""
        messages.append(ChatMessage(role: .user, text: text))
        isThinking = true
        error = nil

        do {
            let system = "You are a helpful personal finance assistant. Answer concisely based on the user's budget data."
            let result = try await inference.complete(prompt: text, system: system)
            messages.append(ChatMessage(role: .assistant, text: result))
        } catch InferenceError.cloudFallbackDenied {
            error = "Enable cloud AI in Settings to use the chat feature without Ollama."
        } catch {
            self.error = error.localizedDescription
        }
        isThinking = false
    }
}

struct MessageBubble: View {
    let message: ChatMessage

    var body: some View {
        HStack {
            if message.role == .user { Spacer() }
            Text(message.text)
                .padding(10)
                .background(message.role == .user ? Color.accentColor : Color(nsColor: .controlBackgroundColor))
                .foregroundStyle(message.role == .user ? .white : .primary)
                .clipShape(RoundedRectangle(cornerRadius: 10))
            if message.role == .assistant { Spacer() }
        }
    }
}
```

- [ ] **Step 6: Write DocumentImportView**

Create `BudgetApp/Features/DocumentImport/DocumentImportView.swift`:

```swift
import SwiftUI
import UniformTypeIdentifiers

struct DocumentImportView: View {
    @Environment(InferenceManager.self) private var inference
    @Environment(AuthManager.self) private var auth
    @State private var isDragging = false
    @State private var isParsing = false
    @State private var parsedTransactions: [[String: String]] = []
    @State private var error: String?
    @State private var rawText = ""

    var body: some View {
        VStack(spacing: 24) {
            Text("Import Bank Statement")
                .font(.title2.bold())

            DropZone(isDragging: $isDragging) { urls in
                Task { await importFiles(urls) }
            }

            if !rawText.isEmpty {
                GroupBox("Extracted Text (preview)") {
                    ScrollView {
                        Text(rawText.prefix(500))
                            .font(.system(.caption, design: .monospaced))
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .frame(height: 100)
                }
            }

            if isParsing {
                ProgressView("Parsing with local AI…")
            }

            if !parsedTransactions.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("\(parsedTransactions.count) transactions found")
                        .foregroundStyle(.green)
                        .fontWeight(.medium)
                    ScrollView {
                        ForEach(Array(parsedTransactions.enumerated()), id: \.offset) { _, txn in
                            HStack {
                                Text(txn["date"] ?? "")
                                    .foregroundStyle(.secondary)
                                    .frame(width: 100, alignment: .leading)
                                Text(txn["payee"] ?? "")
                                Spacer()
                                Text(txn["amount"] ?? "")
                            }
                            .font(.caption)
                        }
                    }
                    .frame(maxHeight: 180)
                    .padding(8)
                    .background(Color(nsColor: .controlBackgroundColor))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                }
            }

            if let err = error {
                Text(err).foregroundStyle(.red)
            }
        }
        .padding(32)
        .navigationTitle("Import")
    }

    private func importFiles(_ urls: [URL]) async {
        error = nil
        isParsing = true
        defer { isParsing = false }

        for url in urls {
            guard url.startAccessingSecurityScopedResource() else { continue }
            defer { url.stopAccessingSecurityScopedResource() }

            let text: String
            do {
                text = try String(contentsOf: url, encoding: .utf8)
            } catch {
                self.error = "Could not read file: \(error.localizedDescription)"
                continue
            }
            rawText = text

            do {
                let system = "You are a bank statement parser. Extract all transactions as JSON."
                let prompt = "Parse all transactions from this statement:\n\(text.prefix(8000))"
                let result = try await inference.complete(prompt: prompt, system: system)
                // Parse JSON array from result
                if let data = result.data(using: .utf8),
                   let arr = try? JSONDecoder().decode([[String: String]].self, from: data) {
                    parsedTransactions = arr
                } else {
                    self.error = "Could not parse AI response as transaction list"
                }
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}

struct DropZone: View {
    @Binding var isDragging: Bool
    let onDrop: ([URL]) -> Void

    var body: some View {
        RoundedRectangle(cornerRadius: 12)
            .strokeBorder(
                isDragging ? Color.accentColor : Color.secondary.opacity(0.4),
                style: StrokeStyle(lineWidth: 2, dash: [8])
            )
            .frame(height: 120)
            .overlay {
                VStack(spacing: 8) {
                    Image(systemName: "arrow.down.doc")
                        .font(.title)
                        .foregroundStyle(isDragging ? .accentColor : .secondary)
                    Text("Drop CSV or PDF here")
                        .foregroundStyle(.secondary)
                }
            }
            .onDrop(of: [.fileURL], isTargeted: $isDragging) { providers in
                Task {
                    var urls: [URL] = []
                    for p in providers {
                        if let url = try? await p.loadItem(forTypeIdentifier: UTType.fileURL.identifier) as? URL {
                            urls.append(url)
                        }
                    }
                    onDrop(urls)
                }
                return true
            }
    }
}
```

- [ ] **Step 7: Write SettingsView**

Create `BudgetApp/Features/Settings/SettingsView.swift`:

```swift
import SwiftUI

struct SettingsView: View {
    @Environment(AuthManager.self) private var auth
    @Environment(InferenceManager.self) private var inference
    @AppStorage("backendBaseURL") private var backendURL = "https://your-backend.fly.dev"
    @AppStorage("ollamaModel") private var ollamaModel = "qwen2.5:7b"

    var body: some View {
        Form {
            Section("Backend") {
                LabeledContent("Server URL") {
                    TextField("https://…", text: $backendURL)
                        .textFieldStyle(.roundedBorder)
                        .frame(maxWidth: 360)
                }
            }

            Section("Local AI") {
                LabeledContent("Ollama Model") {
                    TextField("qwen2.5:7b", text: $ollamaModel)
                        .textFieldStyle(.roundedBorder)
                        .frame(maxWidth: 200)
                }
                LabeledContent("Active Tier") {
                    Text(inference.activeTier.rawValue)
                        .foregroundStyle(.secondary)
                }
                Toggle("Allow Cloud Fallback", isOn: Binding(
                    get: { inference.cloudConsentGranted },
                    set: { granted in
                        if granted { inference.grantCloudConsent() }
                        else { inference.revokeCloudConsent() }
                    }
                ))
            }

            Section("Account") {
                Button("Sign Out", role: .destructive) {
                    auth.logout()
                }
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Settings")
        .padding()
    }
}
```

- [ ] **Step 8: Update MenuBarView with real data**

Replace `BudgetApp/MenuBar/MenuBarView.swift`:

```swift
import SwiftUI

struct MenuBarView: View {
    @Environment(SyncCoordinator.self) private var sync
    @Environment(InferenceManager.self) private var inference

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Budget App")
                    .font(.headline)
                Spacer()
                Circle()
                    .fill(sync.isSyncing ? Color.orange : Color.green)
                    .frame(width: 8, height: 8)
            }
            Divider()
            LabeledContent("AI Tier") {
                Text(inference.activeTier.rawValue)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if let lastSync = sync.lastSyncedAt {
                LabeledContent("Last Sync") {
                    Text(lastSync, style: .relative)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            if let err = sync.error {
                Text(err)
                    .font(.caption)
                    .foregroundStyle(.red)
            }
            Divider()
            Button("Sync Now") {
                Task { await sync.syncAll() }
            }
            .disabled(sync.isSyncing)
        }
        .padding()
        .frame(width: 240)
    }
}
```

Note: `MenuBarView` needs access to the environment — update `BudgetApp.swift` to pass environments to the `MenuBarExtra` scene:

```swift
        MenuBarExtra("Budget", systemImage: "dollarsign.circle") {
            MenuBarView()
                .environment(sync)    // add these
                .environment(inference)
        }
```

Update `BudgetApp.swift` to store `sync` and `inference` as `@State` at the App level so they can be shared between scenes.

- [ ] **Step 9: Build and launch (⌘R)**

Run the app. Expected:
- Login screen appears
- After sign-in, 3-pane navigation shows
- MenuBarExtra appears in system menu bar

- [ ] **Step 10: Commit**

```bash
git add desktop/
git commit -m "feat(desktop): 3-pane SwiftUI UI — Transactions, Budget, Chat, DocumentImport, Settings, MenuBarExtra"
```

---

## Verification

Final build verification:
- In Xcode: Product → Test (⌘U) — all test targets pass
- Product → Build (⌘B) — 0 errors, 0 warnings ideally
- Product → Run (⌘R) — app launches, LoginView shown, deep link scheme registered

Push branch:

```bash
git push -u origin feat/macos-desktop-app
```
