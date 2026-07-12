// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "BudgetApp",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "BudgetApp", targets: ["BudgetApp"]),
    ],
    dependencies: [
        .package(url: "https://github.com/groue/GRDB.swift", from: "6.0.0"),
    ],
    targets: [
        .executableTarget(
            name: "BudgetApp",
            dependencies: [
                .product(name: "GRDB", package: "GRDB.swift"),
            ],
            path: "BudgetApp",
            swiftSettings: [
                .unsafeFlags(["-strict-concurrency=complete"]),
            ]
        ),
        .testTarget(
            name: "BudgetAppTests",
            dependencies: [
                "BudgetApp",
                .product(name: "GRDB", package: "GRDB.swift"),
            ],
            path: "BudgetAppTests"
        ),
    ]
)
