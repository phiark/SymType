import CryptoKit
import Darwin
import Foundation
import XCTest

@testable import SymTypeMacCore

final class ProductConfigurationTests: XCTestCase {
  func testBundleLayoutUsesReadOnlyPackagedLocations() {
    let layout = AppBundleLayout(bundleURL: URL(fileURLWithPath: "/Applications/SymType.app"))

    XCTAssertEqual(
      layout.nodeExecutableURL.path,
      "/Applications/SymType.app/Contents/Helpers/node"
    )
    XCTAssertEqual(
      layout.serverEntryURL.path,
      "/Applications/SymType.app/Contents/Resources/app/server/index.js"
    )
    XCTAssertEqual(
      layout.webDistributionURL.path,
      "/Applications/SymType.app/Contents/Resources/app/web"
    )
  }

  func testManifestRejectsTraversalAndDuplicateResources() {
    let traversal = makeManifest(
      resources: [
        .init(path: "../node", bytes: 1, sha256: String(repeating: "a", count: 64))
      ]
    )
    XCTAssertThrowsError(try ReleaseManifestLoader.validate(traversal)) { error in
      XCTAssertEqual(error as? ReleaseManifestError, .invalidResource("../node"))
    }

    let duplicate = makeManifest(
      resources: [
        .init(path: "Helpers/node", bytes: 1, sha256: String(repeating: "a", count: 64)),
        .init(path: "Helpers/node", bytes: 1, sha256: String(repeating: "b", count: 64))
      ]
    )
    XCTAssertThrowsError(try ReleaseManifestLoader.validate(duplicate)) { error in
      XCTAssertEqual(error as? ReleaseManifestError, .duplicateResource("Helpers/node"))
    }

    let abbreviatedCommit = ReleaseManifest(
      schemaVersion: 1,
      productVersion: SymTypeProduct.version,
      buildNumber: 1,
      commitSha: "481a2cbe4182",
      architecture: SymTypeProduct.architecture,
      minimumMacOS: SymTypeProduct.minimumMacOS,
      nodeVersion: SymTypeProduct.nodeVersion,
      nodeAbi: 137,
      resources: []
    )
    XCTAssertThrowsError(try ReleaseManifestLoader.validate(abbreviatedCommit)) { error in
      XCTAssertEqual(error as? ReleaseManifestError, .invalidCommitSHA)
    }
  }

  func testCriticalResourcesMustMatchManifestBytesAndHashes() throws {
    let directory = try makeTemporaryDirectory()
    let contents = directory.appendingPathComponent("Contents", isDirectory: true)
    let node = contents.appendingPathComponent("Helpers/node")
    let server = contents.appendingPathComponent("Resources/app/server/index.js")
    try FileManager.default.createDirectory(
      at: node.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    try FileManager.default.createDirectory(
      at: server.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    let nodeData = Data("#!/bin/sh\n".utf8)
    let serverData = Data("export {};\n".utf8)
    try nodeData.write(to: node)
    try serverData.write(to: server)

    let manifest = makeManifest(
      resources: [
        .init(path: "Helpers/node", bytes: Int64(nodeData.count), sha256: sha256(nodeData)),
        .init(
          path: "Resources/app/server/index.js",
          bytes: Int64(serverData.count),
          sha256: sha256(serverData)
        )
      ]
    )

    XCTAssertNoThrow(
      try ReleaseManifestLoader.validateCriticalResources(
        manifest: manifest,
        contentsURL: contents
      )
    )

    try Data("tampered".utf8).write(to: server)
    XCTAssertThrowsError(
      try ReleaseManifestLoader.validateCriticalResources(
        manifest: manifest,
        contentsURL: contents
      )
    )
  }

  private func makeManifest(
    resources: [ReleaseManifest.Resource]
  ) -> ReleaseManifest {
    ReleaseManifest(
      schemaVersion: 1,
      productVersion: SymTypeProduct.version,
      buildNumber: Int(SymTypeProduct.buildNumber)!,
      commitSha: "481a2cbe41824295ed9baed5f86648e4abd01af4",
      architecture: SymTypeProduct.architecture,
      minimumMacOS: SymTypeProduct.minimumMacOS,
      nodeVersion: SymTypeProduct.nodeVersion,
      nodeAbi: 137,
      resources: resources
    )
  }

  private func sha256(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
  }

  private func makeTemporaryDirectory() throws -> URL {
    let url = FileManager.default.temporaryDirectory
      .appendingPathComponent("symtype-macos-tests-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    addTeardownBlock {
      try? FileManager.default.removeItem(at: url)
    }
    return url
  }
}
