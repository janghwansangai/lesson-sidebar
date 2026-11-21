// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "winctl",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "winctl",
            path: "Sources/winctl",
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("ApplicationServices"),
            ]
        )
    ]
)
