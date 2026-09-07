import AppKit
import AuthenticationServices
import Foundation
import Observation

private let kTokenKey = "budget_access_token"
private let kBackendURLKey = "backendBaseURL"
private let kFrontendURLKey = "frontendBaseURL"
private let kDefaultBackend = "https://your-backend.fly.dev"
private let kDefaultFrontend = "http://localhost:3001"
private let kRedirectURI = "budget://auth/callback"

@MainActor
@Observable
final class AuthManager: NSObject {
    private(set) var token: String?
    private(set) var isAuthenticated = false
    private(set) var isLoading = false
    private(set) var error: String?
    /// The signed-in user. Populated by the token exchange and refreshed from
    /// /api/auth/me on launch, so a role or approval change on the server shows
    /// up here instead of going stale until the next sign-in.
    private(set) var user: AuthUser?

    var backendBaseURL: String {
        UserDefaults.standard.string(forKey: kBackendURLKey) ?? kDefaultBackend
    }

    var frontendBaseURL: String {
        UserDefaults.standard.string(forKey: kFrontendURLKey) ?? kDefaultFrontend
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
            let callbackURL = try await presentAuthSheet(url: authURL)
            guard let code = Self.code(from: callbackURL) else {
                self.error = "No auth code in callback URL"
                return
            }

            let result = try await exchangeCode(
                code: code,
                grantType: "google_code",
                backendURL: backendURL
            )
            try KeychainHelper.save(key: kTokenKey, value: result.token)
            token = result.token
            user = result.user
            isAuthenticated = true
        } catch {
            self.error = Self.friendlyMessage(for: error)
        }
    }

    /// Sign in with a passkey by hosting the web login page in an auth sheet.
    ///
    /// Native passkey APIs (`ASAuthorizationController`) require an Associated
    /// Domains entitlement and a real domain — they can't target localhost. The
    /// Safari-backed sheet has no such restriction, so the same passkey the web
    /// app uses works here. The page returns a one-time code on `budget://`,
    /// which we exchange for a JWT.
    func loginWithPasskey() async {
        guard let frontendURL = URL(string: frontendBaseURL),
              let backendURL = URL(string: backendBaseURL)
        else {
            error = "Invalid frontend or backend URL. Check Settings → General."
            return
        }
        isLoading = true
        error = nil
        defer { isLoading = false }

        guard var components = URLComponents(
            url: frontendURL.appendingPathComponent("login"),
            resolvingAgainstBaseURL: false
        ) else { return }
        components.queryItems = [
            URLQueryItem(name: "native", value: "1"),
            URLQueryItem(name: "redirect_uri", value: kRedirectURI),
        ]
        guard let authURL = components.url else { return }

        do {
            let callbackURL = try await presentAuthSheet(url: authURL)
            guard let code = Self.code(from: callbackURL) else {
                self.error = "No auth code in callback URL"
                return
            }
            let result = try await exchangeCode(
                code: code,
                grantType: "native_code",
                backendURL: backendURL
            )
            try KeychainHelper.save(key: kTokenKey, value: result.token)
            token = result.token
            user = result.user
            isAuthenticated = true
        } catch {
            self.error = Self.friendlyMessage(for: error)
        }
    }

    /// Present the system auth sheet and return the `budget://` callback URL.
    private func presentAuthSheet(url: URL) async throws -> URL {
        try await withCheckedThrowingContinuation { cont in
            let session = ASWebAuthenticationSession(
                url: url,
                callbackURLScheme: "budget"
            ) { callbackURL, err in
                if let err { cont.resume(throwing: err) }
                else if let callbackURL { cont.resume(returning: callbackURL) }
                else { cont.resume(throwing: URLError(.cancelled)) }
            }
            session.prefersEphemeralWebBrowserSession = false
            // macOS requires a presentation anchor; without one the session
            // fails immediately with error 2 (presentationContextNotProvided)
            // before the browser ever opens.
            session.presentationContextProvider = self
            session.start()
        }
    }

    private static func code(from url: URL) -> String? {
        URLComponents(url: url, resolvingAgainstBaseURL: false)?
            .queryItems?
            .first(where: { $0.name == "code" })?
            .value
    }

    /// Turn common transport failures into something the user can act on.
    private static func friendlyMessage(for error: Error) -> String {
        if let urlError = error as? URLError {
            switch urlError.code {
            case .cancelled:
                return "Sign-in was cancelled."
            case .cannotConnectToHost, .cannotFindHost:
                return "Couldn't reach the server. Is it running, and are the URLs in Settings → General correct?"
            default:
                break
            }
        }
        if (error as NSError).domain == ASWebAuthenticationSessionErrorDomain,
           (error as NSError).code == ASWebAuthenticationSessionError.canceledLogin.rawValue {
            return "Sign-in was cancelled."
        }
        return error.localizedDescription
    }

    /// Redeem a one-time code at /api/auth/native/token for a Bearer JWT.
    /// `grantType` is `google_code` for the OAuth flow, `native_code` for the
    /// browser-session hand-off used by passkey sign-in.
    private func exchangeCode(
        code: String,
        grantType: String,
        backendURL: URL
    ) async throws -> (token: String, user: AuthUser?) {
        let url = backendURL.appendingPathComponent("api/auth/native/token")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body = ["grant_type": grantType, "code": code, "redirect_uri": kRedirectURI]
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw URLError(.badServerResponse)
        }
        struct TokenResponse: Decodable {
            let access_token: String
            let user: AuthUser?
        }
        let decoded = try JSONDecoder().decode(TokenResponse.self, from: data)
        return (decoded.access_token, decoded.user)
    }

    /// Re-fetch the signed-in user from the backend.
    ///
    /// Called on launch so a stored token doesn't leave stale details on
    /// screen. A 401 means the token expired or was revoked server-side, so we
    /// sign out rather than showing a signed-in shell with no data.
    func refreshUser() async {
        guard let token, let backendURL = URL(string: backendBaseURL) else { return }
        var request = URLRequest(url: backendURL.appendingPathComponent("api/auth/me"))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else { return }
            if http.statusCode == 401 || http.statusCode == 403 {
                logout()
                return
            }
            guard http.statusCode == 200 else { return }
            user = try JSONDecoder().decode(AuthUser.self, from: data)
        } catch {
            // Offline or backend down — keep whatever we already show rather
            // than blanking the account panel.
        }
    }

    func logout() {
        KeychainHelper.delete(key: kTokenKey)
        token = nil
        user = nil
        isAuthenticated = false
    }

    func handleDeepLink(_ url: URL) {
        _ = url
    }
}

extension AuthManager: ASWebAuthenticationPresentationContextProviding {
    nonisolated func presentationAnchor(
        for session: ASWebAuthenticationSession
    ) -> ASPresentationAnchor {
        // Anchor the auth sheet to a real window. Prefer the key/main window;
        // fall back to a fresh anchor so sign-in still works if none is key yet.
        MainActor.assumeIsolated {
            NSApp.keyWindow ?? NSApp.mainWindow ?? ASPresentationAnchor()
        }
    }
}
