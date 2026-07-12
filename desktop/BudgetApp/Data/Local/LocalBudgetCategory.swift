import GRDB
import Foundation

struct LocalBudgetCategory: Codable, FetchableRecord, MutablePersistableRecord, Identifiable {
    static let databaseTableName = "local_budget_category"

    var id: String
    var name: String
    var groupName: String
    var assigned: Double
    var spent: Double
    var available: Double
    var syncedAt: Date

    static func fromRemote(_ r: RemoteBudgetCategory) -> LocalBudgetCategory {
        LocalBudgetCategory(
            id: r.id,
            name: r.name,
            groupName: r.groupName,
            assigned: r.assigned,
            spent: r.spent,
            available: r.available,
            syncedAt: Date()
        )
    }
}
