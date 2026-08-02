import Foundation
import Observation

@MainActor
@Observable
final class InferenceManager {

    // MARK: Persisted keys

    private enum Keys {
        static let kind = "localServerKind"
        static let url = "localServerURL"
        static let model = "localServerModel"
        static let cloudConsent = "cloudConsentGranted"
        /// Keychain, not UserDefaults — it's a credential.
        static let tokenKeychain = "localServerAPIToken"
    }

    // MARK: State

    private(set) var activeTier: InferenceTier = .cloud
    private(set) var isInferring = false
    /// Latest health report for the local server. `nil` until the first check.
    private(set) var report: LocalServerReport?
    private(set) var isCheckingServer = false
    private(set) var lastCheckedAt: Date?

    var cloudConsentGranted: Bool {
        didSet { UserDefaults.standard.set(cloudConsentGranted, forKey: Keys.cloudConsent) }
    }

    var serverKind: LocalServerKind {
        didSet {
            // Switching vendor implies the default port for that vendor, unless
            // the user has deliberately typed a custom URL for it.
            if oldValue != serverKind {
                serverURLString = serverKind.defaultBaseURL.absoluteString
                model = ""
            }
            persistConfig()
        }
    }

    var serverURLString: String {
        didSet { persistConfig() }
    }

    /// Empty means "use whatever the server has loaded".
    var model: String {
        didSet { persistConfig() }
    }

    var apiToken: String {
        didSet {
            if apiToken.isEmpty {
                KeychainHelper.delete(key: Keys.tokenKeychain)
            } else {
                try? KeychainHelper.save(key: Keys.tokenKeychain, value: apiToken)
            }
        }
    }

    private let api: APIClient

    // MARK: Init

    init(api: APIClient) {
        self.api = api
        let defaults = UserDefaults.standard

        let storedKind = defaults.string(forKey: Keys.kind).flatMap(LocalServerKind.init(rawValue:))
        self.serverKind = storedKind ?? .lmStudio
        self.serverURLString = defaults.string(forKey: Keys.url)
            ?? (storedKind ?? .lmStudio).defaultBaseURL.absoluteString
        self.model = defaults.string(forKey: Keys.model) ?? ""
        self.cloudConsentGranted = defaults.bool(forKey: Keys.cloudConsent)
        self.apiToken = (try? KeychainHelper.load(key: Keys.tokenKeychain)) ?? ""
    }

    // MARK: Config

    /// Current config, or `nil` when the URL field isn't a usable URL.
    var config: LocalServerConfig? {
        guard let url = normalizedURL(from: serverURLString) else { return nil }
        return LocalServerConfig(
            kind: serverKind,
            baseURL: url,
            model: model,
            apiToken: apiToken
        )
    }

    /// Accepts what people actually type — "localhost:1234", a trailing slash,
    /// or a pasted "http://127.0.0.1:1234/v1" — and normalises to an origin.
    func normalizedURL(from raw: String) -> URL? {
        var text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        if !text.contains("://") { text = "http://" + text }
        guard var components = URLComponents(string: text),
              let scheme = components.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              components.host != nil
        else { return nil }

        // Strip an accidentally-pasted API path; callers append /v1/... themselves.
        var path = components.path
        for suffix in ["/v1/chat/completions", "/v1/models", "/v1", "/"] {
            if path.hasSuffix(suffix) {
                path = String(path.dropLast(suffix.count))
                break
            }
        }
        components.path = path
        components.query = nil
        components.fragment = nil
        return components.url
    }

    var isURLValid: Bool { normalizedURL(from: serverURLString) != nil }

    private func persistConfig() {
        let defaults = UserDefaults.standard
        defaults.set(serverKind.rawValue, forKey: Keys.kind)
        defaults.set(serverURLString, forKey: Keys.url)
        defaults.set(model, forKey: Keys.model)
    }

    // MARK: Health checks

    /// Quick check — used on launch and after settings changes.
    func refreshStatus() async {
        guard let config else {
            report = LocalServerReport(
                checks: [
                    DiagnosticCheck(
                        id: "address",
                        title: "Server URL isn't valid",
                        level: .error,
                        detail: "Enter an address like http://127.0.0.1:1234"
                    )
                ],
                issue: .hostNotFound(host: serverURLString)
            )
            activeTier = fallbackTier()
            return
        }

        isCheckingServer = true
        defer { isCheckingServer = false }

        let result = await LocalModelServer.probe(config)
        report = result
        lastCheckedAt = Date()
        activeTier = result.isReady ? .localServer : fallbackTier()
    }

    /// Deep check — adds a real test completion. Driven by the Settings button.
    func runFullDiagnostics() async {
        guard let config else {
            await refreshStatus()
            return
        }
        isCheckingServer = true
        defer { isCheckingServer = false }

        let result = await LocalModelServer.runFullDiagnostics(config)
        report = result
        lastCheckedAt = Date()
        activeTier = result.isReady ? .localServer : fallbackTier()
    }

    /// Scan the well-known ports and adopt whatever answers.
    /// Returns true when a server was found.
    @discardableResult
    func autoDetectServer() async -> Bool {
        isCheckingServer = true
        defer { isCheckingServer = false }

        guard let found = await LocalModelServer.autoDetect(apiToken: apiToken) else {
            await refreshStatus()
            return false
        }
        serverKind = found.kind
        serverURLString = found.baseURL.absoluteString
        await refreshStatus()
        return true
    }

    private func fallbackTier() -> InferenceTier {
        if CoreMLProvider.isAvailable() { return .coreML }
        return .cloud
    }

    // MARK: Inference

    /// Run a completion through the best available tier.
    ///
    /// Uses the cached health report rather than re-probing: probing on every
    /// message added up to a second of latency per request and made the failure
    /// mode ("is it the server or the model?") impossible to see.
    func complete(
        prompt: String,
        system: String,
        jsonSchema: StructuredOutputSchema? = nil
    ) async throws -> String {
        isInferring = true
        defer { isInferring = false }

        // Tier 1 — local server. Refresh if we've never checked.
        if report == nil { await refreshStatus() }

        if let config, let report, report.isReady {
            var resolved = config
            resolved.model = report.resolvedModel ?? config.model
            do {
                activeTier = .localServer
                return try await LocalModelServer.complete(
                    prompt: prompt,
                    system: system,
                    config: resolved,
                    jsonSchema: jsonSchema
                )
            } catch let issue as LocalServerIssue {
                // Record it so Settings and the menu bar reflect reality, then
                // decide whether anything else can serve the request.
                self.report?.issue = issue
                if !cloudConsentGranted, !CoreMLProvider.isAvailable() {
                    throw InferenceError.localServer(issue)
                }
            }
        }

        // Tier 2 — on-device CoreML.
        if CoreMLProvider.isAvailable() {
            activeTier = .coreML
            if let result = try? await CoreMLProvider.complete(prompt: prompt, system: system) {
                return result
            }
        }

        // Tier 3 — cloud, only with explicit consent.
        guard cloudConsentGranted else {
            if let issue = report?.issue {
                throw InferenceError.localServer(issue)
            }
            throw InferenceError.cloudFallbackDenied
        }
        activeTier = .cloud
        return try await CloudProvider.complete(prompt: prompt, system: system, api: api)
    }

    func grantCloudConsent() { cloudConsentGranted = true }
    func revokeCloudConsent() { cloudConsentGranted = false }
}
