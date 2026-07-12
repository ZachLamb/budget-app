import SwiftUI

struct AppCommands: Commands {
    var body: some Commands {
        CommandGroup(replacing: .appSettings) {
            Button("Preferences…") {
                NotificationCenter.default.post(name: .openPreferences, object: nil)
            }
            .keyboardShortcut(",")
        }
    }
}

extension Notification.Name {
    static let openPreferences = Notification.Name("OpenPreferences")
}
