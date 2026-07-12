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

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("AI Chat")
                    .font(.headline)
                Spacer()
                Text(inference.activeTier.rawValue)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Button("Close", systemImage: "xmark") { onClose() }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.borderless)
            }
            .padding()
            Divider()

            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        ForEach(messages) { msg in
                            MessageBubble(message: msg)
                                .id(msg.id)
                        }
                        if isThinking {
                            HStack {
                                ProgressView()
                                Text("Thinking…").foregroundStyle(.secondary)
                            }
                            .padding(.horizontal)
                        }
                        if let err = error {
                            Text(err).foregroundStyle(.red).padding(.horizontal)
                        }
                    }
                    .padding()
                }
                .onChange(of: messages.count) { _, _ in
                    proxy.scrollTo(messages.last?.id, anchor: .bottom)
                }
            }

            Divider()
            HStack {
                TextField("Ask about your budget…", text: $inputText)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit { Task { await sendMessage() } }
                Button("Send") { Task { await sendMessage() } }
                    .disabled(inputText.isEmpty || isThinking)
            }
            .padding()
        }
    }

    private func sendMessage() async {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        inputText = ""
        messages.append(ChatMessage(role: .user, text: text))
        isThinking = true
        error = nil

        do {
            let system = "You are a helpful personal finance assistant. Answer concisely based on the user's budget data."
            let result = try await inference.complete(prompt: text, system: system)
            messages.append(ChatMessage(role: .assistant, text: result))
        } catch InferenceError.cloudFallbackDenied {
            error = "Enable cloud AI in Settings to use the chat feature without Ollama."
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
            if message.role == .user { Spacer() }
            Text(message.text)
                .padding(10)
                .background(message.role == .user ? Color.accentColor : Color(nsColor: .controlBackgroundColor))
                .foregroundStyle(message.role == .user ? .white : .primary)
                .clipShape(RoundedRectangle(cornerRadius: 10))
            if message.role == .assistant { Spacer() }
        }
    }
}
