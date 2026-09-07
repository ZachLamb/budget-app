import Foundation

// MARK: - Server kind

/// A local OpenAI-compatible model server.
///
/// Both LM Studio and Ollama expose `/v1/models` and `/v1/chat/completions`, so
/// everything here talks the OpenAI dialect rather than either vendor's native
/// API. That keeps the same client working against llama.cpp, vLLM, or the
/// hosted tier without a second code path.
enum LocalServerKind: String, CaseIterable, Identifiable, Sendable {
    case lmStudio
    case ollama

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .lmStudio: return "LM Studio"
        case .ollama: return "Ollama"
        }
    }

    var defaultBaseURL: URL {
        switch self {
        case .lmStudio: return URL(string: "http://127.0.0.1:1234")!
        case .ollama: return URL(string: "http://127.0.0.1:11434")!
        }
    }

    /// Shown when the server can't be reached at all.
    var startupSteps: [String] {
        switch self {
        case .lmStudio:
            return [
                "Open LM Studio.",
                "Go to the Developer tab (the terminal icon in the left sidebar).",
                "Load a model from the dropdown at the top.",
                "Turn the server status toggle to Running — it should say “Running on port 1234”.",
                "Under Server Settings, turn on “Enable CORS” if you also use the web app.",
            ]
        case .ollama:
            return [
                "Open Terminal.",
                "Run `ollama serve` to start the server on port 11434.",
                "Run `ollama pull llama3.2:3b` to download a model if you have none.",
            ]
        }
    }
}

// MARK: - Configuration

struct LocalServerConfig: Sendable, Equatable {
    var kind: LocalServerKind
    var baseURL: URL
    /// Empty means "use whatever the server has loaded".
    var model: String
    /// Empty means the server has authentication turned off.
    var apiToken: String

    init(kind: LocalServerKind, baseURL: URL? = nil, model: String = "", apiToken: String = "") {
        self.kind = kind
        self.baseURL = baseURL ?? kind.defaultBaseURL
        self.model = model
        self.apiToken = apiToken
    }

    /// True when the server address keeps data on this machine or LAN.
    ///
    /// Mirrors the backend's `is_local_backend_url` check. A public host means
    /// financial data would leave the device, so the UI must not call it private.
    var isLoopbackOrPrivate: Bool {
        guard let host = baseURL.host?.lowercased() else { return false }
        if host == "localhost" || host.hasSuffix(".local") { return true }
        if host == "::1" || host == "[::1]" { return true }

        let parts = host.split(separator: ".").compactMap { UInt8($0) }
        guard parts.count == 4 else { return false }
        switch (parts[0], parts[1]) {
        case (127, _): return true            // loopback
        case (10, _): return true             // RFC1918
        case (192, 168): return true          // RFC1918
        case (169, 254): return true          // link-local
        case (172, 16...31): return true      // RFC1918
        default: return false
        }
    }
}

// MARK: - Issues

/// A specific, actionable reason the local model server isn't usable.
///
/// Every case carries its own recovery steps — the point is that the UI never
/// has to show a bare "request failed" when it can say which part failed and
/// what to click.
enum LocalServerIssue: Sendable, Equatable {
    case notRunning(kind: LocalServerKind, port: Int)
    case hostNotFound(host: String)
    case timedOut(seconds: Int)
    case blockedByAppTransportSecurity
    case authRequired(kind: LocalServerKind)
    case authRejected(kind: LocalServerKind)
    case noModelsLoaded(kind: LocalServerKind)
    case configuredModelMissing(requested: String, available: [String])
    case httpError(status: Int, serverMessage: String?)
    case malformedResponse(detail: String)
    case emptyCompletion
    case transport(detail: String)

    var title: String {
        switch self {
        case .notRunning(let kind, _): return "\(kind.displayName) isn't running"
        case .hostNotFound(let host): return "Can't find “\(host)”"
        case .timedOut: return "The server didn't respond in time"
        case .blockedByAppTransportSecurity: return "macOS blocked the connection"
        case .authRequired(let kind): return "\(kind.displayName) needs an API token"
        case .authRejected: return "That API token was rejected"
        case .noModelsLoaded(let kind): return "\(kind.displayName) has no model loaded"
        case .configuredModelMissing(let requested, _): return "Model “\(requested)” isn't loaded"
        case .httpError(let status, _): return "Server returned HTTP \(status)"
        case .malformedResponse: return "Unexpected response from the server"
        case .emptyCompletion: return "The model returned an empty response"
        case .transport: return "Couldn't reach the server"
        }
    }

    var summary: String {
        switch self {
        case .notRunning(let kind, let port):
            return "Nothing is listening on port \(port). \(kind.displayName) is either closed or its local server is stopped."
        case .hostNotFound(let host):
            return "“\(host)” didn't resolve to an address. Check the server URL for a typo."
        case .timedOut(let seconds):
            return "No reply within \(seconds)s. The model may still be loading into memory, or the server is busy with another request."
        case .blockedByAppTransportSecurity:
            return "App Transport Security refused a plain-HTTP connection. The app needs NSAllowsLocalNetworking in Info.plist to talk to a local server."
        case .authRequired(let kind):
            return "\(kind.displayName) has authentication switched on, but no token is configured here."
        case .authRejected(let kind):
            return "\(kind.displayName) rejected the token. It may have been deleted or regenerated."
        case .noModelsLoaded(let kind):
            return "\(kind.displayName) is running and reachable, but hasn't loaded any model to serve."
        case .configuredModelMissing(let requested, let available):
            if available.isEmpty {
                return "The server has no models loaded, so “\(requested)” can't be used."
            }
            return "The server is running but “\(requested)” isn't among its loaded models: \(available.joined(separator: ", "))."
        case .httpError(let status, let message):
            if let message, !message.isEmpty { return "The server said: \(message)" }
            return "The server rejected the request with status \(status)."
        case .malformedResponse(let detail):
            return "The reply couldn't be read as an OpenAI-compatible response. \(detail)"
        case .emptyCompletion:
            return "The request succeeded but the model produced no text. This usually means the context window is full or the prompt was filtered."
        case .transport(let detail):
            return detail
        }
    }

    var steps: [String] {
        switch self {
        case .notRunning(let kind, _):
            return kind.startupSteps
        case .hostNotFound:
            return [
                "Check the server URL in Settings for a typo.",
                "For a server on this Mac, use http://127.0.0.1:1234 (LM Studio) or http://127.0.0.1:11434 (Ollama).",
            ]
        case .timedOut:
            return [
                "If you just selected a large model, wait — the first request loads it into memory and can take a minute.",
                "Check the LM Studio Developer tab for an in-progress load.",
                "Try a smaller or more quantized model if loads are consistently slow.",
            ]
        case .blockedByAppTransportSecurity:
            return [
                "This is a build configuration problem, not something you can fix in Settings.",
                "Info.plist needs NSAppTransportSecurity → NSAllowsLocalNetworking set to true.",
            ]
        case .authRequired(let kind):
            switch kind {
            case .lmStudio:
                return [
                    "In LM Studio, open Developer → Server Settings.",
                    "Click “Manage Tokens”, then “Create Token”.",
                    "Copy the token and paste it into the API Token field in Settings.",
                    "Or turn the authentication toggle off if you don't want a token.",
                ]
            case .ollama:
                return ["Remove the proxy in front of Ollama, or paste its token into the API Token field."]
            }
        case .authRejected(let kind):
            return [
                "Create a fresh token in \(kind.displayName) and paste it in again.",
                "Check for stray spaces at the start or end of the pasted value.",
            ]
        case .noModelsLoaded(let kind):
            switch kind {
            case .lmStudio:
                return [
                    "In LM Studio, open the Developer tab.",
                    "Pick a model in the dropdown at the top to load it.",
                    "Wait for the status to read “Loaded”, then run this check again.",
                ]
            case .ollama:
                return [
                    "Run `ollama pull llama3.2:3b` to download a model.",
                    "Ollama loads models on demand — pulling one is enough.",
                ]
            }
        case .configuredModelMissing(_, let available):
            var steps = ["Choose one of the loaded models from the Model menu in Settings."]
            if !available.isEmpty {
                steps.append("Currently loaded: \(available.joined(separator: ", ")).")
            }
            steps.append("Or leave the model set to “Automatic” to always use whatever is loaded.")
            return steps
        case .httpError(let status, _):
            if status == 404 {
                return [
                    "The endpoint wasn't found — check the server URL doesn't already include /v1.",
                    "Use just the origin, e.g. http://127.0.0.1:1234.",
                ]
            }
            return ["Check the server's log window for the matching error."]
        case .malformedResponse:
            return [
                "Make sure the URL points at an OpenAI-compatible server, not a web UI.",
                "The URL should be the origin only, e.g. http://127.0.0.1:1234.",
            ]
        case .emptyCompletion:
            return [
                "Try a shorter prompt.",
                "Reload the model in LM Studio to clear its context.",
            ]
        case .transport:
            return ["Check that the server is running and the URL is correct."]
        }
    }

    var level: StatusLevel {
        switch self {
        case .noModelsLoaded, .configuredModelMissing, .timedOut, .emptyCompletion:
            return .warning
        default:
            return .error
        }
    }
}

extension LocalServerIssue: LocalizedError {
    var errorDescription: String? { "\(title). \(summary)" }
}

// MARK: - Structured output

/// A JSON Schema used to constrain generation.
///
/// Carried as encoded JSON text rather than `[String: Any]`, because a
/// dictionary of `Any` isn't `Sendable` and can't cross an actor boundary
/// without a data-race warning.
struct StructuredOutputSchema: Sendable, Equatable {
    let json: String

    init(json: String) { self.json = json }

    init?(_ dictionary: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: dictionary),
              let text = String(data: data, encoding: .utf8)
        else { return nil }
        self.json = text
    }

    var object: [String: Any]? {
        guard let data = json.data(using: .utf8) else { return nil }
        return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    }
}

// MARK: - Report

struct DiagnosticCheck: Sendable, Identifiable, Equatable {
    let id: String
    let title: String
    let level: StatusLevel
    let detail: String?
}

/// The outcome of inspecting a local server: an ordered checklist plus, when
/// something is wrong, the single most relevant issue to act on.
struct LocalServerReport: Sendable, Equatable {
    var checks: [DiagnosticCheck] = []
    var models: [String] = []
    var resolvedModel: String?
    var issue: LocalServerIssue?
    var latencyMS: Int?
    var isPrivate: Bool = true

    var isReady: Bool { issue == nil && resolvedModel != nil }

    var headline: String {
        if let issue { return issue.title }
        if let model = resolvedModel { return "Connected — \(model)" }
        return "Not checked yet"
    }

    var level: StatusLevel {
        if let issue { return issue.level }
        return isReady ? .ok : .neutral
    }
}

// MARK: - Client

enum LocalModelServer {

    private static let probeTimeout: TimeInterval = 4
    /// Generous on purpose: a cold just-in-time model load in LM Studio can take
    /// well over a minute before the first token appears.
    private static let completionTimeout: TimeInterval = 180

    // MARK: Probe

    /// Fast health check: does the server answer, and what has it loaded?
    static func probe(_ config: LocalServerConfig) async -> LocalServerReport {
        var report = LocalServerReport()
        report.isPrivate = config.isLoopbackOrPrivate

        report.checks.append(
            DiagnosticCheck(
                id: "address",
                title: report.isPrivate ? "Address is on this machine" : "Address is remote",
                level: report.isPrivate ? .ok : .warning,
                detail: report.isPrivate
                    ? config.baseURL.absoluteString
                    : "\(config.baseURL.absoluteString) — data sent here leaves your device."
            )
        )

        let started = Date()
        let modelsResult = await fetchModels(config)
        let elapsed = Int(Date().timeIntervalSince(started) * 1000)
        report.latencyMS = elapsed

        switch modelsResult {
        case .failure(let issue):
            report.issue = issue
            report.checks.append(
                DiagnosticCheck(
                    id: "reachable",
                    title: "Server did not respond",
                    level: issue.level,
                    detail: issue.summary
                )
            )
            return report

        case .success(let models):
            report.models = models
            report.checks.append(
                DiagnosticCheck(
                    id: "reachable",
                    title: "Server responded",
                    level: .ok,
                    detail: "\(config.kind.displayName) answered in \(elapsed)ms."
                )
            )

            guard !models.isEmpty else {
                report.issue = .noModelsLoaded(kind: config.kind)
                report.checks.append(
                    DiagnosticCheck(
                        id: "models",
                        title: "No models loaded",
                        level: .warning,
                        detail: "The server is up but isn't serving a model yet."
                    )
                )
                return report
            }

            report.checks.append(
                DiagnosticCheck(
                    id: "models",
                    title: "\(models.count) model\(models.count == 1 ? "" : "s") loaded",
                    level: .ok,
                    detail: models.joined(separator: ", ")
                )
            )

            // Empty config model means "use whatever is loaded".
            if config.model.isEmpty {
                report.resolvedModel = models[0]
                report.checks.append(
                    DiagnosticCheck(
                        id: "model-choice",
                        title: "Using \(models[0])",
                        level: .ok,
                        detail: "Model is set to Automatic."
                    )
                )
            } else if models.contains(config.model) {
                report.resolvedModel = config.model
                report.checks.append(
                    DiagnosticCheck(
                        id: "model-choice",
                        title: "Using \(config.model)",
                        level: .ok,
                        detail: nil
                    )
                )
            } else {
                report.issue = .configuredModelMissing(requested: config.model, available: models)
                report.checks.append(
                    DiagnosticCheck(
                        id: "model-choice",
                        title: "Selected model isn't loaded",
                        level: .warning,
                        detail: "“\(config.model)” is not among the loaded models."
                    )
                )
            }
            return report
        }
    }

    /// Everything `probe` does, plus a real end-to-end completion so the user
    /// knows inference actually works — not just that a port is open.
    static func runFullDiagnostics(_ config: LocalServerConfig) async -> LocalServerReport {
        var report = await probe(config)
        guard report.isReady, let model = report.resolvedModel else { return report }

        var testConfig = config
        testConfig.model = model

        do {
            let started = Date()
            let reply = try await complete(
                prompt: "Reply with the single word: ready",
                system: "You are a connectivity test. Reply with one word.",
                config: testConfig,
                maxTokens: 16
            )
            let ms = Int(Date().timeIntervalSince(started) * 1000)
            report.checks.append(
                DiagnosticCheck(
                    id: "roundtrip",
                    title: "Test inference succeeded",
                    level: .ok,
                    detail: "Round trip took \(ms)ms. Model said: “\(reply.prefix(60))”"
                )
            )
        } catch let issue as LocalServerIssue {
            report.issue = issue
            report.checks.append(
                DiagnosticCheck(
                    id: "roundtrip",
                    title: "Test inference failed",
                    level: issue.level,
                    detail: issue.summary
                )
            )
        } catch {
            let issue = LocalServerIssue.transport(detail: error.localizedDescription)
            report.issue = issue
            report.checks.append(
                DiagnosticCheck(
                    id: "roundtrip",
                    title: "Test inference failed",
                    level: .error,
                    detail: error.localizedDescription
                )
            )
        }
        return report
    }

    /// Try the well-known ports so a first-run user doesn't have to know any.
    static func autoDetect(apiToken: String = "") async -> LocalServerConfig? {
        for kind in LocalServerKind.allCases {
            let config = LocalServerConfig(kind: kind, apiToken: apiToken)
            let report = await probe(config)
            // A server that answers but has no model loaded still counts as
            // found — that's a fixable state, not a missing server.
            if report.issue == nil || report.issue == .noModelsLoaded(kind: kind) {
                return config
            }
        }
        return nil
    }

    // MARK: Models

    private static func fetchModels(
        _ config: LocalServerConfig
    ) async -> Result<[String], LocalServerIssue> {
        let url = config.baseURL.appendingPathComponent("v1/models")
        var req = URLRequest(url: url, timeoutInterval: probeTimeout)
        req.httpMethod = "GET"
        applyAuth(&req, config: config)

        do {
            let (data, response) = try await URLSession.shared.data(for: req)
            guard let http = response as? HTTPURLResponse else {
                return .failure(.malformedResponse(detail: "No HTTP status in the reply."))
            }
            if let issue = authIssue(status: http.statusCode, config: config) {
                return .failure(issue)
            }
            guard (200..<300).contains(http.statusCode) else {
                return .failure(.httpError(
                    status: http.statusCode,
                    serverMessage: extractServerMessage(data)
                ))
            }

            struct ModelList: Decodable {
                struct Entry: Decodable { let id: String }
                let data: [Entry]
            }
            do {
                let decoded = try JSONDecoder().decode(ModelList.self, from: data)
                return .success(decoded.data.map(\.id))
            } catch {
                return .failure(.malformedResponse(
                    detail: "Expected an OpenAI model list at /v1/models."
                ))
            }
        } catch {
            return .failure(mapTransportError(error, config: config))
        }
    }

    // MARK: Completion

    /// Non-streaming chat completion.
    ///
    /// `jsonSchema` uses the server's structured-output support to constrain
    /// generation at the sampler, which is far more reliable than asking the
    /// model to "reply with JSON" and hoping. Models below ~7B params often
    /// can't honour a schema, so callers should still validate the result.
    static func complete(
        prompt: String,
        system: String,
        config: LocalServerConfig,
        maxTokens: Int = 1024,
        jsonSchema: StructuredOutputSchema? = nil
    ) async throws -> String {
        let url = config.baseURL.appendingPathComponent("v1/chat/completions")
        var req = URLRequest(url: url, timeoutInterval: completionTimeout)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        applyAuth(&req, config: config)

        var body: [String: Any] = [
            "messages": [
                ["role": "system", "content": system],
                ["role": "user", "content": prompt],
            ],
            "temperature": 0.2,
            "max_tokens": maxTokens,
            "stream": false,
        ]
        if !config.model.isEmpty {
            body["model"] = config.model
        }
        if let schemaObject = jsonSchema?.object {
            body["response_format"] = [
                "type": "json_schema",
                "json_schema": [
                    "name": "response",
                    "strict": true,
                    "schema": schemaObject,
                ],
            ]
        }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: req)
        } catch {
            throw mapTransportError(error, config: config)
        }

        guard let http = response as? HTTPURLResponse else {
            throw LocalServerIssue.malformedResponse(detail: "No HTTP status in the reply.")
        }
        if let issue = authIssue(status: http.statusCode, config: config) {
            throw issue
        }
        guard (200..<300).contains(http.statusCode) else {
            let message = extractServerMessage(data)
            // LM Studio answers 404 when the requested model id isn't loaded —
            // far more useful surfaced as a model problem than as a raw 404.
            if http.statusCode == 404, !config.model.isEmpty {
                throw LocalServerIssue.configuredModelMissing(
                    requested: config.model,
                    available: (try? await fetchModels(config).get()) ?? []
                )
            }
            throw LocalServerIssue.httpError(status: http.statusCode, serverMessage: message)
        }

        struct ChatResponse: Decodable {
            struct Choice: Decodable {
                struct Message: Decodable { let content: String? }
                let message: Message
            }
            let choices: [Choice]
        }
        let decoded: ChatResponse
        do {
            decoded = try JSONDecoder().decode(ChatResponse.self, from: data)
        } catch {
            throw LocalServerIssue.malformedResponse(
                detail: "Could not read choices[0].message.content."
            )
        }
        let text = decoded.choices.first?.message.content ?? ""
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw LocalServerIssue.emptyCompletion
        }
        return text
    }

    // MARK: Helpers

    private static func applyAuth(_ req: inout URLRequest, config: LocalServerConfig) {
        let token = config.apiToken.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !token.isEmpty else { return }
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    }

    private static func authIssue(status: Int, config: LocalServerConfig) -> LocalServerIssue? {
        guard status == 401 || status == 403 else { return nil }
        let hasToken = !config.apiToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        return hasToken ? .authRejected(kind: config.kind) : .authRequired(kind: config.kind)
    }

    /// Pull the human-readable message out of an OpenAI-style error body.
    /// Handles both `{"error": "msg"}` and `{"error": {"message": "msg"}}`.
    private static func extractServerMessage(_ data: Data) -> String? {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            let raw = String(data: data, encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines)
            guard let raw, !raw.isEmpty else { return nil }
            return String(raw.prefix(300))
        }
        if let message = object["error"] as? String { return message }
        if let error = object["error"] as? [String: Any],
           let message = error["message"] as? String {
            return message
        }
        if let message = object["message"] as? String { return message }
        return nil
    }

    private static func mapTransportError(
        _ error: Error,
        config: LocalServerConfig
    ) -> LocalServerIssue {
        guard let urlError = error as? URLError else {
            return .transport(detail: error.localizedDescription)
        }
        let port = config.baseURL.port ?? (config.baseURL.scheme == "https" ? 443 : 80)
        switch urlError.code {
        case .cannotConnectToHost, .networkConnectionLost, .cannotLoadFromNetwork:
            return .notRunning(kind: config.kind, port: port)
        case .cannotFindHost, .dnsLookupFailed:
            return .hostNotFound(host: config.baseURL.host ?? config.baseURL.absoluteString)
        case .timedOut:
            return .timedOut(seconds: Int(probeTimeout))
        case .appTransportSecurityRequiresSecureConnection:
            return .blockedByAppTransportSecurity
        default:
            return .transport(detail: urlError.localizedDescription)
        }
    }
}
