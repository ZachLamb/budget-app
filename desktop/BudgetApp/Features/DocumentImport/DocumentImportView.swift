import SwiftUI
import UniformTypeIdentifiers

struct DocumentImportView: View {
    @Environment(InferenceManager.self) private var inference
    @State private var isDragging = false
    @State private var isParsing = false
    @State private var parsedTransactions: [[String: String]] = []
    @State private var issue: LocalServerIssue?
    @State private var error: String?
    @State private var rawText = ""

    var body: some View {
        VStack(spacing: Theme.Spacing.xl) {
            VStack(spacing: Theme.Spacing.xs) {
                Text("Import Bank Statement")
                    .font(.title2.bold())
                Text("Transactions are extracted locally — your statement stays on this Mac.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }

            DropZone(isDragging: $isDragging) { urls in
                Task { await importFiles(urls) }
            }

            if !rawText.isEmpty {
                GroupBox("Extracted Text (preview)") {
                    ScrollView {
                        Text(rawText.prefix(500))
                            .font(.system(.caption, design: .monospaced))
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .frame(height: 100)
                }
            }

            if isParsing {
                ProgressView("Parsing with local AI…")
            }

            if !parsedTransactions.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("\(parsedTransactions.count) transactions found")
                        .foregroundStyle(.green)
                        .fontWeight(.medium)
                    ScrollView {
                        ForEach(Array(parsedTransactions.enumerated()), id: \.offset) { _, txn in
                            HStack {
                                Text(txn["date"] ?? "")
                                    .foregroundStyle(.secondary)
                                    .frame(width: 100, alignment: .leading)
                                Text(txn["payee"] ?? "")
                                Spacer()
                                Text(txn["amount"] ?? "")
                            }
                            .font(.caption)
                        }
                    }
                    .frame(maxHeight: 180)
                    .padding(8)
                    .background(Color(nsColor: .controlBackgroundColor))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                }
            }

            if let issue {
                VStack(alignment: .leading, spacing: Theme.Spacing.md) {
                    InlineBanner(level: issue.level, title: issue.title, message: issue.summary)
                    if !issue.steps.isEmpty {
                        RecoverySteps(steps: issue.steps)
                    }
                }
            } else if let err = error {
                InlineBanner(level: .error, title: "Import failed", message: err)
            }

            Spacer(minLength: 0)
        }
        .padding(Theme.Spacing.xxl)
        .navigationTitle("Import")
    }

    /// JSON Schema for the parsed statement, so the local model constrains its
    /// output at the sampler instead of us hoping it emits valid JSON.
    private static let statementSchema = StructuredOutputSchema(json: """
    {
      "type": "object",
      "properties": {
        "transactions": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "date": {"type": "string"},
              "payee": {"type": "string"},
              "amount": {"type": "string"}
            },
            "required": ["date", "payee", "amount"]
          }
        }
      },
      "required": ["transactions"]
    }
    """)

    private func importFiles(_ urls: [URL]) async {
        error = nil
        issue = nil
        parsedTransactions = []
        isParsing = true
        defer { isParsing = false }

        for url in urls {
            guard url.startAccessingSecurityScopedResource() else {
                self.error = "macOS didn't grant access to that file. Try choosing it again."
                continue
            }
            defer { url.stopAccessingSecurityScopedResource() }

            let text: String
            do {
                text = try String(contentsOf: url, encoding: .utf8)
            } catch {
                self.error = "Could not read “\(url.lastPathComponent)”: \(error.localizedDescription)"
                continue
            }
            rawText = text

            do {
                let system = "You are a bank-statement parser. Extract every transaction. Respond only with JSON matching the schema."
                let prompt = "Parse all transactions from this statement:\n\(text.prefix(8000))"
                let result = try await inference.complete(
                    prompt: prompt,
                    system: system,
                    jsonSchema: Self.statementSchema
                )
                parsedTransactions = decodeTransactions(result)
                if parsedTransactions.isEmpty {
                    self.error = "The AI didn't return any transactions. The statement format may be unusual — check the extracted text preview."
                }
            } catch let inferenceError as InferenceError {
                // A local-server problem carries its own recovery steps; show
                // those rather than a bare message.
                if let serverIssue = inferenceError.localServerIssue {
                    self.issue = serverIssue
                } else {
                    self.error = inferenceError.errorDescription
                }
            } catch {
                self.error = error.localizedDescription
            }
        }
    }

    /// Accepts either the schema's `{"transactions": [...]}` or a bare array,
    /// since not every model honours the wrapper object.
    private func decodeTransactions(_ raw: String) -> [[String: String]] {
        guard let data = raw.data(using: .utf8) else { return [] }
        struct Wrapper: Decodable { let transactions: [[String: String]] }
        if let wrapped = try? JSONDecoder().decode(Wrapper.self, from: data) {
            return wrapped.transactions
        }
        if let bare = try? JSONDecoder().decode([[String: String]].self, from: data) {
            return bare
        }
        return []
    }
}

struct DropZone: View {
    @Binding var isDragging: Bool
    let onDrop: ([URL]) -> Void

    var body: some View {
        RoundedRectangle(cornerRadius: 12)
            .strokeBorder(
                isDragging ? Color.accentColor : Color.secondary.opacity(0.4),
                style: StrokeStyle(lineWidth: 2, dash: [8])
            )
            .frame(height: 120)
            .overlay {
                VStack(spacing: 8) {
                    Image(systemName: "arrow.down.doc")
                        .font(.largeTitle)
                        // `.accentColor` isn't a ShapeStyle member, so the
                        // previous ternary didn't compile. `Color.accentColor`
                        // is the value SwiftUI actually exposes.
                        .foregroundStyle(isDragging ? Color.accentColor : .secondary)
                    Text("Drop a CSV or text bank statement here")
                        .foregroundStyle(.secondary)
                    Text("Parsed on-device by your local AI")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
            }
            .onDrop(of: [.fileURL], isTargeted: $isDragging) { providers in
                Task {
                    var urls: [URL] = []
                    for p in providers {
                        if let url = try? await p.loadItem(forTypeIdentifier: UTType.fileURL.identifier) as? URL {
                            urls.append(url)
                        }
                    }
                    onDrop(urls)
                }
                return true
            }
    }
}
