import SwiftUI

struct SettingsView: View {
    @Environment(AuthManager.self) private var auth
    @Environment(InferenceManager.self) private var inference
    @AppStorage("backendBaseURL") private var backendURL = "https://your-backend.fly.dev"
    @AppStorage("ollamaModel") private var ollamaModel = "qwen2.5:7b"

    var body: some View {
        Form {
            Section("Backend") {
                LabeledContent("Server URL") {
                    TextField("https://…", text: $backendURL)
                        .textFieldStyle(.roundedBorder)
                        .frame(maxWidth: 360)
                }
            }

            Section("Local AI") {
                LabeledContent("Ollama Model") {
                    TextField("qwen2.5:7b", text: $ollamaModel)
                        .textFieldStyle(.roundedBorder)
                        .frame(maxWidth: 200)
                }
                LabeledContent("Active Tier") {
                    Text(inference.activeTier.rawValue)
                        .foregroundStyle(.secondary)
                }
                Toggle("Allow Cloud Fallback", isOn: Binding(
                    get: { inference.cloudConsentGranted },
                    set: { granted in
                        if granted { inference.grantCloudConsent() }
                        else { inference.revokeCloudConsent() }
                    }
                ))
            }

            Section("Account") {
                Button("Sign Out", role: .destructive) {
                    auth.logout()
                }
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Settings")
        .padding()
    }
}
