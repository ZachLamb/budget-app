import GRDB
import SwiftUI

struct BudgetView: View {
    @Environment(SyncCoordinator.self) private var sync
    @State private var categories: [LocalBudgetCategory] = []

    private var grouped: [(String, [LocalBudgetCategory])] {
        Dictionary(grouping: categories, by: \.groupName)
            .sorted { $0.key < $1.key }
    }

    var body: some View {
        List {
            ForEach(grouped, id: \.0) { group, cats in
                Section(group) {
                    ForEach(cats) { cat in
                        BudgetCategoryRow(cat: cat)
                    }
                }
            }
        }
        .navigationTitle("Budget")
        .toolbar {
            ToolbarItem {
                Button("Sync", systemImage: "arrow.clockwise") {
                    Task { await sync.syncAll() }
                }
                .disabled(sync.isSyncing)
            }
        }
        .task { await load() }
        .onChange(of: sync.lastSyncedAt) { _, _ in Task { await load() } }
    }

    private func load() async {
        do {
            categories = try AppDatabase.shared.read { db in
                try LocalBudgetCategory.order(Column("group_name"), Column("name")).fetchAll(db)
            }
        } catch { categories = [] }
    }
}

struct BudgetCategoryRow: View {
    let cat: LocalBudgetCategory

    var body: some View {
        HStack {
            Text(cat.name)
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text(cat.available, format: .currency(code: "USD"))
                    .foregroundStyle(cat.available >= 0 ? .primary : .red)
                    .fontWeight(.medium)
                Text("of \(cat.assigned, format: .currency(code: "USD"))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }
}
