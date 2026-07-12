import CoreML
import Foundation

// Stub — replace with a real CoreML text-generation model when available.
struct CoreMLProvider {
    static func isAvailable() -> Bool {
        return Bundle.main.url(forResource: "BudgetLLM", withExtension: "mlmodelc") != nil
    }

    static func complete(prompt: String, system: String) async throws -> String {
        guard isAvailable() else {
            throw InferenceError.coreMLUnavailable
        }
        // TODO: Load and run the CoreML model once a suitable model is bundled
        throw InferenceError.coreMLUnavailable
    }
}
