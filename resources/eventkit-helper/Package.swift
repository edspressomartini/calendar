// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "UpNextEventKit",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(name: "UpNextEventKit"),
        .testTarget(name: "UpNextEventKitTests", dependencies: ["UpNextEventKit"]),
    ]
)
