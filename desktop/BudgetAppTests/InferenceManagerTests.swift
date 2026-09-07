import XCTest
@testable import BudgetApp

final class InferenceManagerTests: XCTestCase {

    @MainActor
    func testCompleteThrowsWithoutServerOrConsent() async {
        let api = APIClient(baseURL: URL(string: "https://example.com")!)
        let mgr = InferenceManager(api: api)
        mgr.revokeCloudConsent()
        // Point at a port nothing listens on so the probe fails deterministically.
        mgr.serverURLString = "http://127.0.0.1:9"

        do {
            _ = try await mgr.complete(prompt: "test", system: "test system")
            XCTFail("Expected a throw when no local server and no cloud consent")
        } catch let error as InferenceError {
            switch error {
            case .localServer, .cloudFallbackDenied:
                break  // both are acceptable "nothing available" outcomes
            default:
                XCTFail("Unexpected InferenceError: \(error)")
            }
        } catch {
            XCTFail("Unexpected error type: \(error)")
        }
    }

    @MainActor
    func testURLNormalization() {
        let api = APIClient(baseURL: URL(string: "https://example.com")!)
        let mgr = InferenceManager(api: api)

        // Bare host:port gets an http scheme.
        XCTAssertEqual(
            mgr.normalizedURL(from: "localhost:1234")?.absoluteString,
            "http://localhost:1234"
        )
        // A pasted API path is stripped back to the origin.
        XCTAssertEqual(
            mgr.normalizedURL(from: "http://127.0.0.1:1234/v1/chat/completions")?.absoluteString,
            "http://127.0.0.1:1234"
        )
        // A trailing slash is removed.
        XCTAssertEqual(
            mgr.normalizedURL(from: "http://127.0.0.1:1234/")?.absoluteString,
            "http://127.0.0.1:1234"
        )
        // Garbage is rejected.
        XCTAssertNil(mgr.normalizedURL(from: "not a url"))
        XCTAssertNil(mgr.normalizedURL(from: ""))
    }
}

final class LocalServerConfigTests: XCTestCase {

    func testLoopbackAndPrivateAddressesAreLocal() {
        let cases: [(String, Bool)] = [
            ("http://127.0.0.1:1234", true),
            ("http://localhost:1234", true),
            ("http://192.168.1.50:1234", true),
            ("http://10.0.0.5:11434", true),
            ("http://172.16.4.4:1234", true),
            ("http://172.31.255.1:1234", true),
            ("http://mybox.local:1234", true),
            ("http://172.32.0.1:1234", false),   // just outside RFC1918
            ("http://8.8.8.8:1234", false),
            ("https://api.example.com", false),
        ]
        for (urlString, expected) in cases {
            let config = LocalServerConfig(
                kind: .lmStudio,
                baseURL: URL(string: urlString)!
            )
            XCTAssertEqual(
                config.isLoopbackOrPrivate, expected,
                "\(urlString) should be \(expected ? "local" : "remote")"
            )
        }
    }

    func testStructuredOutputSchemaRoundTrips() {
        let schema = StructuredOutputSchema(["type": "object"])
        XCTAssertNotNil(schema)
        XCTAssertEqual(schema?.object?["type"] as? String, "object")
    }
}

final class LocalServerIssueTests: XCTestCase {

    func testEveryIssueHasRecoverySteps() {
        let issues: [LocalServerIssue] = [
            .notRunning(kind: .lmStudio, port: 1234),
            .hostNotFound(host: "nope"),
            .timedOut(seconds: 4),
            .authRequired(kind: .lmStudio),
            .authRejected(kind: .lmStudio),
            .noModelsLoaded(kind: .lmStudio),
            .configuredModelMissing(requested: "x", available: ["y"]),
            .httpError(status: 500, serverMessage: nil),
            .malformedResponse(detail: "x"),
            .emptyCompletion,
        ]
        for issue in issues {
            XCTAssertFalse(issue.title.isEmpty, "\(issue) needs a title")
            XCTAssertFalse(issue.summary.isEmpty, "\(issue) needs a summary")
            XCTAssertFalse(issue.steps.isEmpty, "\(issue) needs recovery steps")
        }
    }
}
