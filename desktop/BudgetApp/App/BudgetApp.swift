import SwiftUI

@main
struct BudgetApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var delegate

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
        }
        .menuBarExtraStyle(.window)
    }
}

extension Notification.Name {
    static let budgetDeepLink = Notification.Name("BudgetDeepLink")
}
