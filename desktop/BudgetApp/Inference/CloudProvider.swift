import Foundation

/// Tier 3 — the backend's opt-in cloud proxy (`POST /api/llm/cloud`).
struct CloudProvider {

    /// Accumulates the streamed completion.
    ///
    /// `postSSE` delivers one `data:` payload at a time. The backend's frames
    /// are `{"content": "…"}` deltas terminated by `{"done": true}`, with
    /// `{"error": "…"}` on failure — so the text has to be joined across frames.
    /// An earlier version assigned each chunk to a single variable and returned
    /// the last one, which meant replies were only ever the final token.
    private final class StreamAccumulator: @unchecked Sendable {
        private let lock = NSLock()
        private var text = ""
        private var failure: String?

        func ingest(_ payload: String) {
            guard let data = payload.data(using: .utf8),
                  let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            else { return }

            lock.lock()
            defer { lock.unlock() }

            if let message = object["error"] as? String {
                failure = message
            } else if let content = object["content"] as? String {
                text += content
            }
        }

        func result() throws -> String {
            lock.lock()
            defer { lock.unlock() }
            if let failure { throw APIError.httpError(502, failure) }
            return text
        }
    }

    static func complete(
        prompt: String,
        system: String,
        api: APIClient,
        feature: String = "chat",
        maxTokens: Int = 1024
    ) async throws -> String {
        struct CloudRequest: Encodable {
            let feature: String
            let prompt: String
            let system: String
            let maxTokens: Int
        }

        let req = CloudRequest(
            feature: feature,
            prompt: prompt,
            system: system,
            maxTokens: maxTokens
        )

        let accumulator = StreamAccumulator()
        try await api.postSSE("api/llm/cloud", body: req) { chunk in
            accumulator.ingest(chunk)
        }
        return try accumulator.result()
    }
}
