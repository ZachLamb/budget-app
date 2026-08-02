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
        Group {
            if categories.isEmpty {
                ContentUnavailableView {
                    Label("No budget yet", systemImage: "chart.bar")
                } description: {
                    Text("Sync to pull your current budget from the server.")
                } actions: {
                    Button("Sync Now") { Task { await sync.syncAll() } }
                        .buttonStyle(.borderedProminent)
                        .disabled(sync.isSyncing)
                }
            } else {
                List {
                    ForEach(grouped, id: \.0) { group, cats in
                        Section {
                            ForEach(cats) { cat in
                                BudgetCategoryRow(cat: cat)
                            }
                        } header: {
                            Text(group).font(Theme.Font.sectionTitle)
                        }
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
        // `AppDatabase.shared.read` is async; the previous version dropped the
        // `await` and didn't compile.
        do {
            categories = try await AppDatabase.shared.read { db in
                try LocalBudgetCategory
                    .order(Column("group_name"), Column("name"))
                    .fetchAll(db)
            }
        } catch {
            categories = []
        }
    }
}

struct BudgetCategoryRow: View {
    let cat: LocalBudgetCategory

    /// Fraction of the assigned amount already spent, clamped to 0...1.
    private var spentFraction: Double {
        guard cat.assigned > 0 else { return cat.spent > 0 ? 1 : 0 }
        return min(max(cat.spent / cat.assigned, 0), 1)
    }

    private var barColor: Color {
        if cat.available < 0 { return Theme.Palette.negative }
        if spentFraction > 0.9 { return Theme.Palette.warning }
        return Theme.Palette.positive
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            HStack {
                Text(cat.name)
                    .fontWeight(.medium)
                Spacer()
                Text(cat.available, format: .currency(code: "USD"))
                    .font(Theme.Font.numeric)
                    .foregroundStyle(cat.available < 0 ? Theme.Palette.negative : .primary)
            }

            ProgressView(value: spentFraction)
                .tint(barColor)
                .scaleEffect(x: 1, y: 0.7, anchor: .center)

            HStack {
                Text("\(cat.spent, format: .currency(code: "USD")) spent")
                    .font(Theme.Font.numericSmall)
                    .foregroundStyle(.secondary)
                Spacer()
                Text("of \(cat.assigned, format: .currency(code: "USD"))")
                    .font(Theme.Font.numericSmall)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, Theme.Spacing.xs)
    }
}
