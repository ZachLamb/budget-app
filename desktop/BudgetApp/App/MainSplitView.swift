import SwiftUI

enum SidebarItem: String, CaseIterable, Identifiable {
    case transactions = "Transactions"
    case budget = "Budget"
    case importDoc = "Import"

    var id: String { rawValue }

    var icon: String {
        switch self {
        case .transactions: return "list.bullet.rectangle"
        case .budget: return "chart.bar"
        case .importDoc: return "doc.badge.plus"
        }
    }
}

struct MainSplitView: View {
    @Environment(SyncCoordinator.self) private var sync
    @Environment(InferenceManager.self) private var inference

    @State private var selectedItem: SidebarItem? = .transactions
    @State private var chatVisible = false

    var body: some View {
        NavigationSplitView {
            sidebar
        } content: {
            switch selectedItem {
            case .transactions, .none:
                TransactionsView(onOpenChat: { chatVisible = true })
            case .budget:
                BudgetView()
            case .importDoc:
                DocumentImportView()
            }
        } detail: {
            if chatVisible {
                ChatView(onClose: { chatVisible = false })
            } else {
                ContentUnavailableView {
                    Label("Ask about your money", systemImage: "bubble.left.and.bubble.right")
                } description: {
                    Text("Open the AI chat to ask questions about your budget and transactions.")
                } actions: {
                    Button("Open AI Chat") { chatVisible = true }
                        .buttonStyle(.borderedProminent)
                }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .budgetSyncRequested)) { _ in
            Task { await sync.syncAll() }
        }
    }

    private var sidebar: some View {
        VStack(spacing: 0) {
            List(SidebarItem.allCases, selection: $selectedItem) { item in
                Label(item.rawValue, systemImage: item.icon)
                    .tag(item)
            }
            .listStyle(.sidebar)

            Divider()
            aiStatusFooter
        }
        .navigationTitle("Budget")
        .navigationSplitViewColumnWidth(min: 190, ideal: 210, max: 260)
    }

    /// Persistent, glanceable answer to "where is my AI running right now?".
    private var aiStatusFooter: some View {
        HStack(spacing: Theme.Spacing.sm) {
            Image(systemName: inference.activeTier.symbol)
                .foregroundStyle(
                    inference.activeTier.isPrivate
                        ? Theme.Palette.positive
                        : Theme.Palette.warning
                )
            VStack(alignment: .leading, spacing: 1) {
                Text(inference.activeTier.rawValue)
                    .font(.caption.weight(.medium))
                Text(inference.activeTier.isPrivate ? "Private" : "Leaves this Mac")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            if inference.isCheckingServer {
                ProgressView().controlSize(.small)
            } else {
                StatusDot(level: inference.report?.level ?? .neutral)
            }
        }
        .padding(.horizontal, Theme.Spacing.md)
        .padding(.vertical, Theme.Spacing.sm)
        .contentShape(Rectangle())
        .help("AI is running on: \(inference.activeTier.rawValue)")
        .accessibilityElement(children: .combine)
        .accessibilityLabel("AI tier: \(inference.activeTier.rawValue)")
    }
}
