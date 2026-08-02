import SwiftUI

@main
struct BudgetApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var delegate
    @State private var container = AppContainer()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(container)
                .environment(container.auth)
                .environment(container.sync)
                .environment(container.inference)
                .tint(Theme.Palette.brand)
                .onOpenURL { url in
                    NotificationCenter.default.post(name: .budgetDeepLink, object: url)
                }
        }
        .windowStyle(.titleBar)
        .commands { AppCommands() }

        // A real Settings scene: macOS wires up ⌘, and the app-menu item for
        // free. The previous build posted a notification and called
        // `showSettingsWindow:` reflectively, which silently did nothing
        // because no Settings scene existed.
        Settings {
            SettingsView()
                .environment(container)
                .environment(container.auth)
                .environment(container.inference)
                .tint(Theme.Palette.brand)
        }

        MenuBarExtra("Budget", systemImage: "dollarsign.circle") {
            MenuBarView()
                .environment(container)
                .environment(container.sync)
                .environment(container.inference)
                .tint(Theme.Palette.brand)
        }
        .menuBarExtraStyle(.window)
    }
}

extension Notification.Name {
    static let budgetDeepLink = Notification.Name("BudgetDeepLink")
}
