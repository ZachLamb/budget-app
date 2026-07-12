import SwiftUI

struct LoginView: View {
    @Environment(AuthManager.self) private var auth

    var body: some View {
        VStack(spacing: 24) {
            Image(systemName: "dollarsign.circle.fill")
                .font(.system(size: 64))
                .foregroundStyle(.tint)

            Text("Budget App")
                .font(.largeTitle.bold())

            Text("Sign in to sync your budget across devices.")
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            if let err = auth.error {
                Text(err)
                    .foregroundStyle(.red)
                    .font(.caption)
            }

            Button {
                Task { await auth.loginWithGoogle() }
            } label: {
                Label(auth.isLoading ? "Signing in…" : "Sign in with Google", systemImage: "globe")
                    .frame(maxWidth: 240)
            }
            .buttonStyle(.borderedProminent)
            .disabled(auth.isLoading)
            .controlSize(.large)
        }
        .padding(48)
        .frame(width: 480, height: 360)
    }
}
