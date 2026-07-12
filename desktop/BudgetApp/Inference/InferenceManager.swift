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
