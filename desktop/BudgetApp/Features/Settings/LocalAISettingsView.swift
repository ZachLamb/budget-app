import SwiftUI

/// Setup and live diagnostics for the local model server.
///
/// The goal is that every failure states which step broke and what to do about
/// it — the previous build collapsed "server closed", "no model loaded",
/// "wrong model name" and "token rejected" into a single "Ollama request failed".
struct LocalAISettingsView: View {
    @Environment(InferenceManager.self) private var inference
    @State private var showToken = false

    var body: some View {
        @Bindable var inference = inference

        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Spacing.lg) {
                statusCard
                connectionCard(inference: inference)
                if let report = inference.report, !report.checks.isEmpty {
                    checklistCard(report: report)
                }
                if let issue = inference.report?.issue {
                    fixItCard(issue: issue)
                }
                cloudFallbackCard(inference: inference)
            }
            .padding(Theme.Spacing.xl)
        }
        .task {
            if inference.report == nil { await inference.refreshStatus() }
        }
    }

    // MARK: Status

    private var statusCard: some View {
        Card {
            HStack(alignment: .top, spacing: Theme.Spacing.md) {
                VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                    HStack(spacing: Theme.Spacing.sm) {
                        Text(inference.serverKind.displayName)
                            .font(Theme.Font.cardTitle)
                        StatusPill(
                            level: inference.report?.level ?? .neutral,
                            text: inference.report?.headline ?? "Not checked yet"
                        )
                    }
                    if let checked = inference.lastCheckedAt {
                        Text("Last checked \(checked, style: .relative) ago")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    if let report = inference.report, report.isReady, !report.isPrivate {
                        Label(
                            "This server is not on your machine — data sent to it leaves your device.",
                            systemImage: "exclamationmark.shield"
                        )
                        .font(.caption)
                        .foregroundStyle(Theme.Palette.warning)
                    } else if let report = inference.report, report.isReady {
                        Label(
                            "Runs on this Mac — your financial data never leaves it.",
                            systemImage: "lock.shield"
                        )
                        .font(.caption)
                        .foregroundStyle(Theme.Palette.positive)
                    }
                }
                Spacer(minLength: 0)
                if inference.isCheckingServer {
                    ProgressView().controlSize(.small)
                }
            }

            HStack(spacing: Theme.Spacing.sm) {
                Button {
                    Task { await inference.runFullDiagnostics() }
                } label: {
                    Label("Test connection", systemImage: "stethoscope")
                }
                .buttonStyle(.borderedProminent)
                .disabled(inference.isCheckingServer || !inference.isURLValid)

                Button {
                    Task { await inference.autoDetectServer() }
                } label: {
                    Label("Find my server", systemImage: "antenna.radiowaves.left.and.right")
                }
                .disabled(inference.isCheckingServer)

                Spacer()
            }
        }
    }

    // MARK: Connection

    private func connectionCard(inference: InferenceManager) -> some View {
        @Bindable var inference = inference

        return Card("Connection", systemImage: "network") {
            VStack(alignment: .leading, spacing: Theme.Spacing.md) {
                LabeledContent("Server") {
                    Picker("", selection: $inference.serverKind) {
                        ForEach(LocalServerKind.allCases) { kind in
                            Text(kind.displayName).tag(kind)
                        }
                    }
                    .labelsHidden()
                    .pickerStyle(.segmented)
                    .frame(maxWidth: 240)
                }

                LabeledContent("Address") {
                    VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                        TextField("http://127.0.0.1:1234", text: $inference.serverURLString)
                            .textFieldStyle(.roundedBorder)
                            .frame(maxWidth: 320)
                            .onSubmit { Task { await inference.refreshStatus() } }
                        if !inference.isURLValid {
                            Text("Enter an address like http://127.0.0.1:1234")
                                .font(.caption)
                                .foregroundStyle(Theme.Palette.negative)
                        }
                    }
                }

                LabeledContent("Model") {
                    modelPicker(inference: inference)
                }

                LabeledContent("API token") {
                    VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                        HStack(spacing: Theme.Spacing.sm) {
                            Group {
                                if showToken {
                                    TextField("Only if authentication is on", text: $inference.apiToken)
                                } else {
                                    SecureField("Only if authentication is on", text: $inference.apiToken)
                                }
                            }
                            .textFieldStyle(.roundedBorder)
                            .frame(maxWidth: 260)

                            Button {
                                showToken.toggle()
                            } label: {
                                Image(systemName: showToken ? "eye.slash" : "eye")
                            }
                            .buttonStyle(.borderless)
                            .help(showToken ? "Hide token" : "Show token")
                        }
                        Text("Stored in your Keychain. Leave empty unless \(inference.serverKind.displayName) has authentication switched on.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func modelPicker(inference: InferenceManager) -> some View {
        @Bindable var inference = inference
        let models = inference.report?.models ?? []

        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            if models.isEmpty {
                // Nothing discovered yet — fall back to free text so the field
                // is still usable before the first successful probe.
                TextField("Automatic", text: $inference.model)
                    .textFieldStyle(.roundedBorder)
                    .frame(maxWidth: 320)
                Text("Run “Test connection” to list the models your server has loaded.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                Picker("", selection: $inference.model) {
                    Text("Automatic — use what's loaded").tag("")
                    Divider()
                    ForEach(models, id: \.self) { name in
                        Text(name).tag(name)
                    }
                }
                .labelsHidden()
                .frame(maxWidth: 320)
                if !inference.model.isEmpty, !models.contains(inference.model) {
                    Text("“\(inference.model)” isn't loaded right now.")
                        .font(.caption)
                        .foregroundStyle(Theme.Palette.warning)
                }
            }
        }
    }

    // MARK: Checklist

    private func checklistCard(report: LocalServerReport) -> some View {
        Card("Diagnostics", systemImage: "checklist") {
            VStack(alignment: .leading, spacing: Theme.Spacing.md) {
                ForEach(report.checks) { check in
                    CheckRow(level: check.level, title: check.title, detail: check.detail)
                }
            }
        }
    }

    // MARK: Fix it

    private func fixItCard(issue: LocalServerIssue) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Theme.Spacing.md) {
                InlineBanner(level: issue.level, title: issue.title, message: issue.summary)
                if !issue.steps.isEmpty {
                    Text("How to fix it")
                        .font(Theme.Font.sectionTitle)
                    RecoverySteps(steps: issue.steps)
                }
            }
        }
    }

    // MARK: Cloud

    private func cloudFallbackCard(inference: InferenceManager) -> some View {
        @Bindable var inference = inference

        return Card(
            "Cloud fallback",
            systemImage: "cloud",
            footnote: "When on, requests that the local server can't handle are sent to your backend's cloud model. Turn this off to guarantee your financial data never leaves this Mac."
        ) {
            Toggle("Allow cloud AI when the local server is unavailable", isOn: $inference.cloudConsentGranted)
                .toggleStyle(.switch)
        }
    }
}
