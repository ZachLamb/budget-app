import GRDB
import SwiftUI

struct TransactionsView: View {
    let onOpenChat: () -> Void

    @Environment(SyncCoordinator.self) private var sync
    @State private var transactions: [LocalTransaction] = []
    @State private var searchText = ""

    private var filtered: [LocalTransaction] {
        guard !searchText.isEmpty else { return transactions }
        let q = searchText.lowercased()
        return transactions.filter {
            ($0.payeeName?.lowercased().contains(q) ?? false) ||
            ($0.categoryName?.lowercased().contains(q) ?? false)
        }
    }

    var body: some View {
        Group {
            if transactions.isEmpty {
                ContentUnavailableView {
                    Label("No transactions", systemImage: "list.bullet.rectangle")
                } description: {
                    Text("Sync to pull your latest transactions from the server.")
                } actions: {
                    Button("Sync Now") { Task { await sync.syncAll() } }
                        .buttonStyle(.borderedProminent)
                        .disabled(sync.isSyncing)
                }
            } else if filtered.isEmpty {
                ContentUnavailableView.search(text: searchText)
            } else {
                List(filtered) { txn in
                    TransactionRow(txn: txn)
                }
            }
        }
        .searchable(text: $searchText, prompt: "Search transactions")
        .navigationTitle("Transactions")
        .toolbar {
            ToolbarItem {
                Button("Sync", systemImage: "arrow.clockwise") {
                    Task { await sync.syncAll() }
                }
                .disabled(sync.isSyncing)
            }
            ToolbarItem {
                Button("AI Chat", systemImage: "bubble.left.and.bubble.right") {
                    onOpenChat()
                }
            }
        }
        .task { await loadTransactions() }
        .onChange(of: sync.lastSyncedAt) { _, _ in Task { await loadTransactions() } }
    }

    private func loadTransactions() async {
        do {
            transactions = try await AppDatabase.shared.read { db in
                try LocalTransaction
                    .order(Column("date").desc)
                    .limit(500)
                    .fetchAll(db)
            }
        } catch {
            transactions = []
        }
    }
}

struct TransactionRow: View {
    let txn: LocalTransaction

    var body: some View {
        HStack(spacing: Theme.Spacing.md) {
            // Category-colored leading accent for quick visual scanning.
            RoundedRectangle(cornerRadius: Theme.Radius.sm)
                .fill(Theme.Palette.brand.opacity(0.15))
                .frame(width: 32, height: 32)
                .overlay(
                    Image(systemName: txn.amount >= 0 ? "arrow.down.left" : "arrow.up.right")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(txn.amount >= 0 ? Theme.Palette.positive : .secondary)
                )

            VStack(alignment: .leading, spacing: 2) {
                Text(txn.payeeName ?? "Unknown")
                    .fontWeight(.medium)
                if let cat = txn.categoryName {
                    Text(cat)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text(txn.amount, format: .currency(code: "USD"))
                    .font(Theme.Font.numeric)
                    .foregroundStyle(txn.amount >= 0 ? Theme.Palette.positive : .primary)
                Text(txn.date)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, Theme.Spacing.xs)
    }
}
