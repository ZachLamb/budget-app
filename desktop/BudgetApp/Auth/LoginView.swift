import SwiftUI

struct LoginView: View {
    @Environment(AuthManager.self) private var auth

    var body: some View {
        VStack(spacing: Theme.Spacing.xl) {
            Image(systemName: "dollarsign.circle.fill")
                .font(.system(size: 72))
                .foregroundStyle(Theme.Palette.brand)
                .shadow(color: Theme.Palette.brand.opacity(0.3), radius: 12, y: 4)

            VStack(spacing: Theme.Spacing.sm) {
                Text("Snack's Budget")
                    .font(.largeTitle.bold())
                Text("Sign in to sync your budget across devices.")
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }

            if let err = auth.error {
                InlineBanner(level: .error, title: "Sign-in failed", message: err)
                    .frame(maxWidth: 320)
            }

            // Passkey is the primary path, matching the web app.
            Button {
                Task { await auth.loginWithPasskey() }
            } label: {
                HStack(spacing: Theme.Spacing.sm) {
                    if auth.isLoading {
                        ProgressView().controlSize(.small)
                    } else {
                        Image(systemName: "person.badge.key")
                    }
                    Text(auth.isLoading ? "Signing in…" : "Sign in with passkey")
                }
                .frame(maxWidth: 240)
            }
            .buttonStyle(.borderedProminent)
            .disabled(auth.isLoading)
            .controlSize(.large)

            Button {
                Task { await auth.loginWithGoogle() }
            } label: {
                HStack(spacing: Theme.Spacing.sm) {
                    Image(systemName: "globe")
                    Text("Sign in with Google")
                }
                .frame(maxWidth: 240)
            }
            .buttonStyle(.bordered)
            .disabled(auth.isLoading)
            .controlSize(.large)
        }
        .padding(Theme.Spacing.xxl)
        .frame(width: 480, height: 440)
    }
}
