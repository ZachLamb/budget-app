import SwiftUI

struct RootView: View {
    @State private var auth = AuthManager()

    var body: some View {
        Group {
            if auth.isAuthenticated {
                MainSplitView()
                    .environment(auth)
            } else {
                LoginView()
                    .environment(auth)
            }
        }
        .frame(minWidth: 900, minHeight: 600)
        .onReceive(NotificationCenter.default.publisher(for: .budgetDeepLink)) { note in
            if let url = note.object as? URL {
                auth.handleDeepLink(url)
            }
        }
    }
}
