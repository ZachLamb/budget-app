import AuthenticationServices
import CryptoKit
import Foundation
import Observation
import Security

private let kTokenKey = "budget_access_token"
private let kBackendURLKey = "backendBaseURL"
private let kDefaultBackend = "https://clarity-backend.fly.dev"

@MainActor
@Observable
final class AuthManager: NSObject {
    private(set) var token: String?
    private(set) var isAuthenticated = false
    private(set) var isLoading = false
    private(set) var error: String?

    // Retained for the duration of the OAuth session; released on completion.
    private var webAuthSession: ASWebAuthenticationSession?

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
        // PKCE binds the auth code to this app instance — there's no browser
        // session/cookie for a state param to protect, so the verifier/challenge
        // pair (RFC 7636) is what stops a leaked/intercepted code from being
        // redeemed by anyone other than the client that started this flow.
        let codeVerifier = Self.makeCodeVerifier()
        let codeChallenge = Self.codeChallenge(for: codeVerifier)

        guard var components = URLComponents(
            url: backendURL.appendingPathComponent("api/auth/google/login"),
            resolvingAgainstBaseURL: false
        ) else { return }
        components.queryItems = [
            URLQueryItem(name: "redirect_uri", value: redirectURI),
            URLQueryItem(name: "native", value: "1"),
            URLQueryItem(name: "code_challenge", value: codeChallenge),
        ]
        guard let authURL = components.url else { return }

        do {
            let callbackURL: URL = try await withCheckedThrowingContinuation { cont in
                let session = ASWebAuthenticationSession(
                    url: authURL,
                    callbackURLScheme: "budget"
                ) { [weak self] url, err in
                    self?.webAuthSession = nil
                    if let err { cont.resume(throwing: err) }
                    else if let url { cont.resume(returning: url) }
                    else { cont.resume(throwing: URLError(.cancelled)) }
                }
                session.prefersEphemeralWebBrowserSession = false
                session.presentationContextProvider = self
                self.webAuthSession = session
                session.start()
            }

            guard
                let comps = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false),
                let code = comps.queryItems?.first(where: { $0.name == "code" })?.value
            else {
                self.error = "No auth code in callback URL"
                return
            }

            let jwt = try await exchangeGoogleCode(
                code: code,
                redirectURI: redirectURI,
                codeVerifier: codeVerifier,
                backendURL: backendURL
            )
            try KeychainHelper.save(key: kTokenKey, value: jwt)
            token = jwt
            isAuthenticated = true
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func exchangeGoogleCode(
        code: String,
        redirectURI: String,
        codeVerifier: String,
        backendURL: URL
    ) async throws -> String {
        let url = backendURL.appendingPathComponent("api/auth/native/token")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body = [
            "grant_type": "google_code",
            "code": code,
            "redirect_uri": redirectURI,
            "code_verifier": codeVerifier,
        ]
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw URLError(.badServerResponse)
        }
        struct TokenResponse: Decodable { let access_token: String }
        let decoded = try JSONDecoder().decode(TokenResponse.self, from: data)
        return decoded.access_token
    }

    /// RFC 7636 PKCE: 32 random bytes, base64url-encoded (43 chars, no padding).
    private static func makeCodeVerifier() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        let result = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        precondition(result == errSecSuccess, "SecRandomCopyBytes failed")
        return base64URLEncode(Data(bytes))
    }

    private static func codeChallenge(for verifier: String) -> String {
        let digest = SHA256.hash(data: Data(verifier.utf8))
        return base64URLEncode(Data(digest))
    }

    private static func base64URLEncode(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
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

extension AuthManager: ASWebAuthenticationPresentationContextProviding {
    // Called on the main thread by the framework; MainActor.assumeIsolated is safe here.
    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            NSApplication.shared.windows.first(where: \.isKeyWindow) ?? ASPresentationAnchor()
        }
    }
}
