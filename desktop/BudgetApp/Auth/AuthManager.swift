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

        do {
            let callbackURL: URL = try await withCheckedThrowingContinuation { cont in
                let session = ASWebAuthenticationSession(
                    url: authURL,
                    callbackURLScheme: "budget"
                ) { url, err in
                    if let err { cont.resume(throwing: err) }
                    else if let url { cont.resume(returning: url) }
                    else { cont.resume(throwing: URLError(.cancelled)) }
                }
                session.prefersEphemeralWebBrowserSession = false
                session.start()
                _ = session
            }

            guard
                let comps = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false),
                let code = comps.queryItems?.first(where: { $0.name == "code" })?.value
            else {
                self.error = "No auth code in callback URL"
                return
            }

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
        _ = url
    }
}
