import SwiftUI
import UniformTypeIdentifiers

struct DocumentImportView: View {
    @Environment(InferenceManager.self) private var inference
    @State private var isDragging = false
    @State private var isParsing = false
    @State private var parsedTransactions: [[String: String]] = []
    @State private var error: String?
    @State private var rawText = ""

    var body: some View {
        VStack(spacing: 24) {
            Text("Import Bank Statement")
                .font(.title2.bold())

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

            if let err = error {
                Text(err).foregroundStyle(.red)
            }
        }
        .padding(32)
        .navigationTitle("Import")
    }

    private func importFiles(_ urls: [URL]) async {
        error = nil
        isParsing = true
        defer { isParsing = false }

        for url in urls {
            guard url.startAccessingSecurityScopedResource() else { continue }
            defer { url.stopAccessingSecurityScopedResource() }

            let text: String
            do {
                text = try String(contentsOf: url, encoding: .utf8)
            } catch {
                self.error = "Could not read file: \(error.localizedDescription)"
                continue
            }
            rawText = text

            do {
                let system = "You are a bank statement parser. Extract all transactions as JSON."
                let prompt = "Parse all transactions from this statement:\n\(text.prefix(8000))"
                let result = try await inference.complete(prompt: prompt, system: system)
                if let data = result.data(using: .utf8),
                   let arr = try? JSONDecoder().decode([[String: String]].self, from: data) {
                    parsedTransactions = arr
                } else {
                    self.error = "Could not parse AI response as transaction list"
                }
            } catch {
                self.error = error.localizedDescription
            }
        }
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
                        .font(.title)
                        .foregroundStyle(isDragging ? .accentColor : .secondary)
                    Text("Drop CSV or text file here")
                        .foregroundStyle(.secondary)
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
