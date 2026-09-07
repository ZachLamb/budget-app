import SwiftUI

struct SettingsView: View {
    var body: some View {
        TabView {
            GeneralSettingsView()
                .tabItem { Label("General", systemImage: "gearshape") }
            LocalAISettingsView()
                .tabItem { Label("Local AI", systemImage: "cpu") }
            AccountSettingsView()
                .tabItem { Label("Account", systemImage: "person.crop.circle") }
        }
        .frame(width: 620, height: 560)
    }
}

// MARK: - General

struct GeneralSettingsView: View {
    @Environment(AppContainer.self) private var container

    var body: some View {
        @Bindable var container = container

        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Spacing.lg) {
                Card(
                    "Backend",
                    systemImage: "server.rack",
                    footnote: "Use http://localhost:8000 when running the FastAPI backend on this Mac, or your Fly.io URL for the deployed one."
                ) {
                    VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                        TextField("http://localhost:8000", text: $container.backendURLString)
                            .textFieldStyle(.roundedBorder)
                        if !container.isBackendURLValid {
                            Label(
                                "That doesn't look like a valid URL.",
                                systemImage: StatusLevel.error.symbol
                            )
                            .font(.caption)
                            .foregroundStyle(Theme.Palette.negative)
                        }
                    }
                }

                Card(
                    "Web app",
                    systemImage: "globe",
                    footnote: "Used for passkey sign-in, which runs the web login page in a secure sheet. Passkeys are tied to this address, so it must match the site where you created them."
                ) {
                    TextField("http://localhost:3001", text: $container.frontendURLString)
                        .textFieldStyle(.roundedBorder)
                }
            }
            .padding(Theme.Spacing.xl)
        }
    }
}

// MARK: - Account

struct AccountSettingsView: View {
    @Environment(AuthManager.self) private var auth

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Spacing.lg) {
                Card("Account", systemImage: "person.crop.circle") {
                    VStack(alignment: .leading, spacing: Theme.Spacing.md) {
                        if let user = auth.user {
                            LabeledContent("Name", value: user.name)
                            LabeledContent("Email", value: user.email)
                            LabeledContent("Role") {
                                StatusPill(
                                    level: user.isAdmin ? .ok : .neutral,
                                    text: user.isAdmin ? "Admin" : "Member"
                                )
                            }
                            LabeledContent("Approval") {
                                StatusPill(
                                    level: user.status == "approved" ? .ok : .warning,
                                    text: user.status.capitalized
                                )
                            }
                        } else {
                            LabeledContent("Status") {
                                StatusPill(
                                    level: auth.isAuthenticated ? .busy : .neutral,
                                    text: auth.isAuthenticated ? "Loading…" : "Signed out"
                                )
                            }
                        }
                        Divider()
                        Button("Sign Out", role: .destructive) { auth.logout() }
                            .disabled(!auth.isAuthenticated)
                    }
                }
            }
            .padding(Theme.Spacing.xl)
        }
    }
}
