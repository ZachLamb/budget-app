import Foundation

enum InferenceTier: String, CaseIterable, Sendable {
    case localServer = "Local server"
    case coreML = "On-device"
    case cloud = "Cloud"

    var symbol: String {
        switch self {
        case .localServer: return "desktopcomputer"
        case .coreML: return "cpu"
        case .cloud: return "cloud"
        }
    }

    /// Whether financial data stays on this machine when this tier is used.
    var isPrivate: Bool {
        switch self {
        case .localServer, .coreML: return true
        case .cloud: return false
        }
    }
}

enum InferenceError: LocalizedError {
    /// Wraps the specific local-server diagnosis so callers can show real
    /// recovery steps instead of a generic failure.
    case localServer(LocalServerIssue)
    case coreMLUnavailable
    case cloudFallbackDenied
    case noProviderAvailable

    var errorDescription: String? {
        switch self {
        case .localServer(let issue):
            return issue.errorDescription
        case .coreMLUnavailable:
            return "No on-device model is bundled in this build."
        case .cloudFallbackDenied:
            return "Cloud AI is off, and no local model server is available."
        case .noProviderAvailable:
            return "No inference provider is available."
        }
    }

    var recoverySuggestion: String? {
        switch self {
        case .localServer(let issue):
            return issue.steps.first
        case .cloudFallbackDenied:
            return "Start LM Studio or Ollama, or turn on cloud fallback in Settings."
        default:
            return nil
        }
    }

    /// The underlying local-server issue, when there is one — lets views render
    /// the full numbered recovery checklist.
    var localServerIssue: LocalServerIssue? {
        if case .localServer(let issue) = self { return issue }
        return nil
    }
}
