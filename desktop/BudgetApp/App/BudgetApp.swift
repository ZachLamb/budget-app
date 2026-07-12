import SwiftUI

@main
struct BudgetApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var delegate
    @State private var sync = SyncCoordinator(api: APIClient(baseURL: URL(string: "https://your-backend.fly.dev")!))
    @State private var inference = InferenceManager(api: APIClient(baseURL: URL(string: "https://your-backend.fly.dev")!))

    var body: some Scene {
        WindowGroup {
            RootView()
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
