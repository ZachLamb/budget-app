import Foundation

enum InferenceTier: String, CaseIterable {
    case ollama = "Ollama (Local)"
    case coreML = "CoreML (On-Device)"
    case cloud = "Cloud (Remote)"
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
