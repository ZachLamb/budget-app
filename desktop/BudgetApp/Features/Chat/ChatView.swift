import SwiftUI

struct ChatMessage: Identifiable {
    let id = UUID()
    let role: Role
    let text: String
    enum Role { case user, assistant }
}

struct ChatView: View {
    let onClose: () -> Void

    @Environment(InferenceManager.self) private var inference
    @State private var messages: [ChatMessage] = []
    @State private var inputText = ""
    @State private var isThinking = false
    @State private var error: String?
    @State private var issue: LocalServerIssue?

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: Theme.Spacing.sm) {
                Text("AI Chat")
                    .font(Theme.Font.cardTitle)
                Spacer()
                StatusPill(
                    level: inference.activeTier.isPrivate ? .ok : .warning,
                    text: inference.activeTier.rawValue
                )
                Button("Close", systemImage: "xmark") { onClose() }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.borderless)
            }
            .padding(Theme.Spacing.lg)
            Divider()

            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: Theme.Spacing.md) {
                        if messages.isEmpty && issue == nil && error == nil {
                            emptyState
                        }
                        ForEach(messages) { msg in
                            MessageBubble(message: msg)
                                .id(msg.id)
                        }
                        if isThinking {
                            HStack(spacing: Theme.Spacing.sm) {
                                ProgressView().controlSize(.small)
                                Text("Thinking…").foregroundStyle(.secondary).font(.callout)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal)
                        }
                        if let issue {
                            VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                                InlineBanner(level: issue.level, title: issue.title, message: issue.summary)
                                if !issue.steps.isEmpty {
                                    RecoverySteps(steps: issue.steps)
                                }
                            }
                            .padding(.horizontal)
                        } else if let err = error {
                            InlineBanner(level: .error, title: "Something went wrong", message: err)
                                .padding(.horizontal)
                        }
                    }
                    .padding()
                }
                .onChange(of: messages.count) { _, _ in
                    proxy.scrollTo(messages.last?.id, anchor: .bottom)
                }
            }

            Divider()
            HStack(spacing: Theme.Spacing.sm) {
                TextField("Ask about your budget…", text: $inputText)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit { Task { await sendMessage() } }
                Button {
                    Task { await sendMessage() }
                } label: {
                    Label("Send", systemImage: "arrow.up.circle.fill")
                        .labelStyle(.iconOnly)
                        .font(.title2)
                }
                .buttonStyle(.borderless)
                .disabled(inputText.trimmingCharacters(in: .whitespaces).isEmpty || isThinking)
            }
            .padding(Theme.Spacing.lg)
        }
    }

    private var emptyState: some View {
        VStack(spacing: Theme.Spacing.sm) {
            Image(systemName: "sparkles")
                .font(.largeTitle)
                .foregroundStyle(Theme.Palette.brand)
            Text("Ask anything about your money")
                .font(.callout.weight(.medium))
            Text("“How much did I spend on groceries?” · “Am I over budget anywhere?”")
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, Theme.Spacing.xxl)
    }

    private func sendMessage() async {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        inputText = ""
        messages.append(ChatMessage(role: .user, text: text))
        isThinking = true
        error = nil
        issue = nil

        do {
            let system = "You are a helpful personal finance assistant. Answer concisely based on the user's budget data."
            let result = try await inference.complete(prompt: text, system: system)
            messages.append(ChatMessage(role: .assistant, text: result))
        } catch let inferenceError as InferenceError {
            // Prefer the specific, actionable local-server diagnosis when there
            // is one; fall back to the plain message otherwise.
            if let serverIssue = inferenceError.localServerIssue {
                self.issue = serverIssue
            } else {
                self.error = inferenceError.errorDescription
            }
        } catch {
            self.error = error.localizedDescription
        }
        isThinking = false
    }
}

struct MessageBubble: View {
    let message: ChatMessage

    var body: some View {
        HStack {
            if message.role == .user { Spacer(minLength: 40) }
            Text(message.text)
                .textSelection(.enabled)
                .padding(.horizontal, Theme.Spacing.md)
                .padding(.vertical, Theme.Spacing.sm)
                .background(
                    message.role == .user
                        ? AnyShapeStyle(Theme.Palette.brand)
                        : AnyShapeStyle(Theme.Palette.surfaceSunken),
                    in: RoundedRectangle(cornerRadius: Theme.Radius.md)
                )
                .foregroundStyle(message.role == .user ? .white : .primary)
            if message.role == .assistant { Spacer(minLength: 40) }
        }
    }
}
