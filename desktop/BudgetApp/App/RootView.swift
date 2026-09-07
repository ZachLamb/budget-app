import SwiftUI

struct RootView: View {
    @Environment(AuthManager.self) private var auth
    @Environment(SyncCoordinator.self) private var sync
    @Environment(InferenceManager.self) private var inference

    var body: some View {
        Group {
            if auth.isAuthenticated {
                MainSplitView()
                    .environment(auth)
                    .environment(sync)
                    .environment(inference)
                    .task {
                        await sync.updateToken(auth.token)
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
