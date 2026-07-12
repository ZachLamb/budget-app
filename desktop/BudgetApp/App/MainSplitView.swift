import SwiftUI

enum SidebarItem: String, CaseIterable, Identifiable {
    case transactions = "Transactions"
    case budget = "Budget"
    case importDoc = "Import"
    case settings = "Settings"

    var id: String { rawValue }

    var icon: String {
        switch self {
        case .transactions: return "list.bullet.rectangle"
        case .budget: return "chart.bar"
        case .importDoc: return "doc.badge.plus"
        case .settings: return "gear"
        }
    }
}

struct MainSplitView: View {
    @State private var selectedItem: SidebarItem? = .transactions
    @State private var chatVisible = false

    var body: some View {
        NavigationSplitView {
            List(SidebarItem.allCases, selection: $selectedItem) { item in
                Label(item.rawValue, systemImage: item.icon)
                    .tag(item)
            }
            .listStyle(.sidebar)
            .navigationTitle("Budget")
        } content: {
            switch selectedItem {
            case .transactions, .none:
                TransactionsView(onOpenChat: { chatVisible = true })
            case .budget:
                BudgetView()
            case .importDoc:
                DocumentImportView()
            case .settings:
                SettingsView()
            }
        } detail: {
            if chatVisible {
                ChatView(onClose: { chatVisible = false })
            } else {
                ContentUnavailableView(
                    "No Selection",
                    systemImage: "bubble.left.and.bubble.right",
                    description: Text("Select a section or open the AI chat")
                )
            }
        }
    }
}
