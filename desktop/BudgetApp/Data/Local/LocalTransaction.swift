import GRDB
import Foundation

struct LocalTransaction: Codable, FetchableRecord, MutablePersistableRecord, Identifiable {
    static let databaseTableName = "local_transaction"

    var id: String
    var date: String
    var amount: Double
    var payeeName: String?
    var categoryName: String?
    var accountName: String?
    var notes: String?
    var syncedAt: Date

    enum Columns {
        static let id = Column(CodingKeys.id)
        static let date = Column(CodingKeys.date)
        static let amount = Column(CodingKeys.amount)
        static let syncedAt = Column(CodingKeys.syncedAt)
    }

    static func fromRemote(_ r: RemoteTransaction) -> LocalTransaction {
        LocalTransaction(
            id: r.id,
            date: r.date,
            amount: r.amount,
            payeeName: r.payeeName,
            categoryName: r.categoryName,
            accountName: r.accountName,
            notes: r.notes,
            syncedAt: Date()
        )
    }
}
