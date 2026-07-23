// swift-tools-version: 6.0

import PackageDescription

let package = Package(
  name: "SymTypeMac",
  platforms: [
    .macOS(.v15)
  ],
  products: [
    .executable(name: "SymType", targets: ["SymType"])
  ],
  targets: [
    .target(
      name: "SymTypeMacCore",
      path: "SymType/Sources/Core"
    ),
    .executableTarget(
      name: "SymType",
      dependencies: ["SymTypeMacCore"],
      path: "SymType/Sources/App"
    ),
    .testTarget(
      name: "SymTypeMacCoreTests",
      dependencies: ["SymTypeMacCore"],
      path: "SymTypeTests"
    )
  ],
  swiftLanguageModes: [.v5]
)
