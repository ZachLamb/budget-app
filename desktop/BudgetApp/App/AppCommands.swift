import SwiftUI

/// Menu-bar commands.
///
/// Deliberately does *not* replace `.appSettings`: the app declares a real
/// `Settings` scene, so macOS provides the "Settings…" item and ⌘, itself.
/// The previous version replaced that group with a button that posted a
/// notification handled by a reflective `showSettingsWindow:` call — which did
/// nothing, because there was no Settings scene to show.
struct AppCommands: Commands {
    var body: some Commands {
        CommandGroup(after: .toolbar) {
            Button("Sync Now") {
                NotificationCenter.default.post(name: .budgetSyncRequested, object: nil)
            }
            .keyboardShortcut("r", modifiers: .command)
        }
    }
}

extension Notification.Name {
    static let budgetSyncRequested = Notification.Name("BudgetSyncRequested")
}
