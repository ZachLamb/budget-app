import SwiftUI

struct RootView: View {
    @State private var auth: AuthManager
    @State private var api: APIClient
    @State private var sync: SyncCoordinator
    @State private var inference: InferenceManager

    init() {
        let backendURL = URL(
            string: UserDefaults.standard.string(forKey: "backendBaseURL") ?? "https://your-backend.fly.dev"
        )!
        let apiClient = APIClient(baseURL: backendURL)
        let a = AuthManager()
        _auth = State(initialValue: a)
        _api = State(initialValue: apiClient)
        _sync = State(initialValue: SyncCoordinator(api: apiClient))
        _inference = State(initialValue: InferenceManager(api: apiClient))
    }

    var body: some View {
        Group {
            if auth.isAuthenticated {
                MainSplitView()
                    .environment(auth)
                    .environment(sync)
                    .environment(inference)
                    .task {
                        await api.setToken(auth.token)
                        await sync.syncAll()
                        await inference.detectTier()
                    }
            } else {
                LoginView()
                    .environment(auth)
            }
        }
        .frame(minWidth: 900, minHeight: 600)
        .onReceive(NotificationCenter.default.publisher(for: .budgetDeepLink)) { note in
            if let url = note.object as? URL { auth.handleDeepLink(url) }
        }
        .onReceive(NotificationCenter.default.publisher(for: .openPreferences)) { _ in
            NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil)
        }
    }
}
