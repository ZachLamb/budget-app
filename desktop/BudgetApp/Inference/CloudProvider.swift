import Foundation

struct CloudProvider {
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
