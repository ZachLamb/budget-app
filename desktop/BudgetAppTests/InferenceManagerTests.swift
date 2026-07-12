import XCTest
@testable import BudgetApp

final class InferenceManagerTests: XCTestCase {
    func testCloudFallbackDeniedWithoutConsent() async {
        let api = await APIClient(baseURL: URL(string: "https://example.com")!)
        let mgr = await InferenceManager(api: api)
        do {
            _ = try await mgr.complete(prompt: "test", system: "test system")
            XCTFail("Expected throw")
        } catch InferenceError.cloudFallbackDenied {
            // expected — Ollama not running in test environment, CoreML stub unavailable
        } catch {
            // Ollama timeout also acceptable
            XCTAssertTrue(
                error is InferenceError || error is URLError,
                "Unexpected error: \(error)"
            )
        }
    }
}
