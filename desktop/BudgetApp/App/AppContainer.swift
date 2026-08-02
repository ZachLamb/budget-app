import Foundation
import Observation

/// Single owner of the app's long-lived objects.
///
/// Previously `BudgetApp` built one `APIClient`/`SyncCoordinator`/`InferenceManager`
/// for the menu bar and `RootView` built a second, separate set for the main
/// window — so "Sync Now" in the menu bar talked to the placeholder backend URL
/// and reported status for a coordinator the window never used. One container,
/// injected into every scene, keeps them in agreement.
@MainActor
@Observable
final class AppContainer {
    static let defaultBackendURL = "http://localhost:8000"
    // 3001, not 3000: docker-compose maps the frontend to 3001, and that's the
    // origin the backend's FRONTEND_URL/CORS defaults expect. The passkey RP ID
    // derives from this host, so it has to match where you created the passkey.
    static let defaultFrontendURL = "http://localhost:3001"

    let api: APIClient
    let auth: AuthManager
    let sync: SyncCoordinator
    let inference: InferenceManager

    var backendURLString: String {
        didSet {
            UserDefaults.standard.set(backendURLString, forKey: "backendBaseURL")
            Task { await applyBackendURL() }
        }
    }

    /// Web app origin, used only to host the passkey login page in the auth
    /// sheet. It must be the frontend host because the WebAuthn relying-party
    /// ID is derived from the page's origin, not the API's.
    var frontendURLString: String {
        didSet {
            UserDefaults.standard.set(frontendURLString, forKey: "frontendBaseURL")
        }
    }

    init() {
        let storedFrontend = UserDefaults.standard.string(forKey: "frontendBaseURL")
            ?? Self.defaultFrontendURL
        UserDefaults.standard.set(storedFrontend, forKey: "frontendBaseURL")
        self.frontendURLString = storedFrontend

        let stored = UserDefaults.standard.string(forKey: "backendBaseURL")
            ?? Self.defaultBackendURL
        // Seed the key so AuthManager, which reads the same UserDefaults key
        // independently, agrees on the backend URL from the first launch rather
        // than falling back to its own separate default.
        UserDefaults.standard.set(stored, forKey: "backendBaseURL")
        self.backendURLString = stored

        let url = URL(string: stored) ?? URL(string: Self.defaultBackendURL)!
        let client = APIClient(baseURL: url)
        self.api = client
        self.auth = AuthManager()
        self.sync = SyncCoordinator(api: client)
        self.inference = InferenceManager(api: client)
    }

    var isBackendURLValid: Bool {
        guard let url = URL(string: backendURLString.trimmingCharacters(in: .whitespaces)),
              let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              url.host != nil
        else { return false }
        return true
    }

    private func applyBackendURL() async {
        guard let url = URL(string: backendURLString.trimmingCharacters(in: .whitespaces)),
              url.host != nil
        else { return }
        await api.setBaseURL(url)
    }

    /// Run once the user is authenticated.
    func bootstrap() async {
        await api.setToken(auth.token)
        await auth.refreshUser()
        await inference.refreshStatus()
        await sync.syncAll()
    }
}
