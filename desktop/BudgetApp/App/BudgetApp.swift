import SwiftUI

@main
struct BudgetApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var delegate
    @State private var auth = AuthManager()
    @State private var sync: SyncCoordinator
    @State private var inference: InferenceManager

    init() {
        let backendURL = URL(
            string: UserDefaults.standard.string(forKey: "backendBaseURL") ?? "https://clarity-backend.fly.dev"
        )!
        let client = APIClient(baseURL: backendURL)
        _sync = State(initialValue: SyncCoordinator(api: client))
        _inference = State(initialValue: InferenceManager(api: client))
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(auth)
                .environment(sync)
                .environment(inference)
                .onOpenURL { url in
                    NotificationCenter.default.post(
                        name: .budgetDeepLink,
                        object: url
                    )
                }
        }
        .windowStyle(.titleBar)
        .commands {
            AppCommands()
        }

        MenuBarExtra("Budget", systemImage: "dollarsign.circle") {
            MenuBarView()
                .environment(sync)
                .environment(inference)
        }
        .menuBarExtraStyle(.window)
    }
}

extension Notification.Name {
    static let budgetDeepLink = Notification.Name("BudgetDeepLink")
}
