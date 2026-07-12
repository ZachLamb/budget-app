import XCTest
@testable import BudgetApp

final class APIClientTests: XCTestCase {
    func testInvalidURLThrows() async {
        let client = await APIClient(baseURL: URL(string: "https://example.com")!)
        do {
            let _: [String: String] = try await client.get("://not-a-url")
            XCTFail("Expected throw")
        } catch APIError.invalidURL {
            // expected
        } catch {
            XCTFail("Unexpected error type: \(error)")
        }
    }

    func testTokenSetOnActor() async {
        let client = await APIClient(baseURL: URL(string: "https://example.com")!)
        await client.setToken("my-test-token")
        let tok = await client.token
        XCTAssertEqual(tok, "my-test-token")
    }
}
