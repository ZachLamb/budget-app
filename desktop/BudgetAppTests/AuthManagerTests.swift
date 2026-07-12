import XCTest
@testable import BudgetApp

final class KeychainHelperTests: XCTestCase {
    let testKey = "test_keychain_\(UUID().uuidString)"

    override func tearDown() {
        KeychainHelper.delete(key: testKey)
    }

    func testSaveAndLoad() throws {
        try KeychainHelper.save(key: testKey, value: "hello-token")
        let loaded = try KeychainHelper.load(key: testKey)
        XCTAssertEqual(loaded, "hello-token")
    }

    func testOverwriteExisting() throws {
        try KeychainHelper.save(key: testKey, value: "first")
        try KeychainHelper.save(key: testKey, value: "second")
        let loaded = try KeychainHelper.load(key: testKey)
        XCTAssertEqual(loaded, "second")
    }

    func testDeleteRemovesItem() throws {
        try KeychainHelper.save(key: testKey, value: "to-delete")
        KeychainHelper.delete(key: testKey)
        XCTAssertThrowsError(try KeychainHelper.load(key: testKey)) { err in
            guard case KeychainError.itemNotFound = err else {
                XCTFail("Expected itemNotFound, got \(err)")
                return
            }
        }
    }

    func testLoadMissingThrows() {
        XCTAssertThrowsError(try KeychainHelper.load(key: "nonexistent_\(UUID())"))
    }
}
