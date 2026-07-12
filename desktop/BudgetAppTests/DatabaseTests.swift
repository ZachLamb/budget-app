import XCTest
import GRDB
@testable import BudgetApp

final class DatabaseTests: XCTestCase {
    var db: DatabaseQueue!

    override func setUp() throws {
        db = try DatabaseQueue()
        try AppDatabase.migrator.migrate(db)
    }

    func testInsertAndFetchTransaction() throws {
        let txn = LocalTransaction(
            id: "t-1",
            date: "2026-07-01",
            amount: -45.00,
            payeeName: "Whole Foods",
            categoryName: "Groceries",
            accountName: nil,
            notes: nil,
            syncedAt: Date()
        )
        try db.write { db in try txn.save(db) }
        let fetched = try db.read { db in
            try LocalTransaction.fetchOne(db, key: "t-1")
        }
        XCTAssertEqual(fetched?.payeeName, "Whole Foods")
        XCTAssertEqual(fetched?.amount, -45.00)
    }

    func testUpsertTransaction() throws {
        var txn = LocalTransaction(
            id: "t-2", date: "2026-07-01", amount: -10.00,
            payeeName: "Coffee", categoryName: nil,
            accountName: nil, notes: nil, syncedAt: Date()
        )
        try db.write { db in try txn.save(db) }
        txn.categoryName = "Food"
        try db.write { db in try txn.save(db) }
        let count = try db.read { db in try LocalTransaction.fetchCount(db) }
        XCTAssertEqual(count, 1)
        let fetched = try db.read { db in try LocalTransaction.fetchOne(db, key: "t-2") }
        XCTAssertEqual(fetched?.categoryName, "Food")
    }

    func testInsertBudgetCategory() throws {
        let cat = LocalBudgetCategory(
            id: "c-1", name: "Groceries", groupName: "Food",
            assigned: 300, spent: 120, available: 180, syncedAt: Date()
        )
        try db.write { db in try cat.save(db) }
        let fetched = try db.read { db in try LocalBudgetCategory.fetchAll(db) }
        XCTAssertEqual(fetched.count, 1)
        XCTAssertEqual(fetched[0].name, "Groceries")
    }
}
