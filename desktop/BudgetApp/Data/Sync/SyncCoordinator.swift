import Foundation
import GRDB
import Observation

@MainActor
@Observable
final class SyncCoordinator {
    private(set) var isSyncing = false
    private(set) var lastSyncedAt: Date?
    private(set) var error: String?

    private let api: APIClient
    private let db = AppDatabase.shared

    init(api: APIClient) {
        self.api = api
    }

    func updateToken(_ token: String?) async {
        await api.setToken(token)
    }

    func syncAll() async {
        guard !isSyncing else { return }
        isSyncing = true
        error = nil
        defer { isSyncing = false }

        do {
            async let txns: Void = syncTransactions()
            async let budget: Void = syncBudget()
            _ = try await (txns, budget)
            lastSyncedAt = Date()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func syncTransactions() async throws {
        struct TxnListResponse: Decodable { let transactions: [RemoteTransaction] }
        let resp: TxnListResponse = try await api.get("api/transactions?limit=500")
        let locals = resp.transactions.map(LocalTransaction.fromRemote)
        try await db.write { db in
            for var t in locals {
                try t.save(db)
            }
        }
    }

    private func syncBudget() async throws {
        struct BudgetResponse: Decodable { let categories: [RemoteBudgetCategory] }
        let resp: BudgetResponse = try await api.get("api/budget/current")
        let locals = resp.categories.map(LocalBudgetCategory.fromRemote)
        try await db.write { db in
            for var c in locals {
                try c.save(db)
            }
        }
    }
}
