import GRDB
import Foundation

final class AppDatabase {
    static let shared: DatabaseQueue = {
        let url = try! FileManager.default
            .url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appendingPathComponent("BudgetApp")
        try! FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        let dbPath = url.appendingPathComponent("budget.sqlite").path
        var config = Configuration()
        config.foreignKeysEnabled = true
        let queue = try! DatabaseQueue(path: dbPath, configuration: config)
        try! migrator.migrate(queue)
        return queue
    }()

    static var migrator: DatabaseMigrator = {
        var m = DatabaseMigrator()

        m.registerMigration("v1_initial") { db in
            try db.create(table: "local_transaction") { t in
                t.column("id", .text).primaryKey()
                t.column("date", .text).notNull()
                t.column("amount", .double).notNull()
                t.column("payee_name", .text)
                t.column("category_name", .text)
                t.column("account_name", .text)
                t.column("notes", .text)
                t.column("synced_at", .datetime).notNull()
            }
            try db.create(table: "local_budget_category") { t in
                t.column("id", .text).primaryKey()
                t.column("name", .text).notNull()
                t.column("group_name", .text).notNull()
                t.column("assigned", .double).notNull()
                t.column("spent", .double).notNull()
                t.column("available", .double).notNull()
                t.column("synced_at", .datetime).notNull()
            }
        }

        return m
    }()
}
