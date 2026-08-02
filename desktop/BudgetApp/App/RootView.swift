import SwiftUI

struct RootView: View {
    @Environment(AppContainer.self) private var container
    @Environment(AuthManager.self) private var auth

    var body: some View {
        Group {
            if auth.isAuthenticated {
                MainSplitView()
                    .task { await container.bootstrap() }
            } else {
                LoginView()
            }
        }
        .frame(minWidth: 940, minHeight: 620)
        .onReceive(NotificationCenter.default.publisher(for: .budgetDeepLink)) { note in
            if let url = note.object as? URL { auth.handleDeepLink(url) }
        }
    }
}
