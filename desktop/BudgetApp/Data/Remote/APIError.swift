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
