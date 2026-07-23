import Darwin
import Foundation
import XCTest

@testable import SymTypeMacCore

final class SecurityTests: XCTestCase {
  func testOriginAllowsOnlyExactIPv4LoopbackOrigin() throws {
    let origin = try ServerOrigin(validating: URL(string: "http://127.0.0.1:4173/")!)

    XCTAssertTrue(origin.contains(URL(string: "http://127.0.0.1:4173/train?mode=smart")!))
    XCTAssertTrue(
      origin.permitsDownload(
        from: URL(string: "blob:http://127.0.0.1:4173/77a93100-3708-4d64-a584")!
      )
    )
    XCTAssertFalse(origin.contains(URL(string: "http://localhost:4173/")!))
    XCTAssertFalse(origin.contains(URL(string: "http://127.0.0.1:4174/")!))
    XCTAssertFalse(origin.contains(URL(string: "https://127.0.0.1:4173/")!))
    XCTAssertFalse(origin.contains(URL(string: "http://127.0.0.2:4173/")!))
    XCTAssertFalse(
      origin.permitsDownload(from: URL(string: "blob:https://example.invalid/value")!)
    )
  }

  func testOriginRejectsCredentialsQueriesAndFragments() {
    for value in [
      "https://127.0.0.1:4173/",
      "http://localhost:4173/",
      "http://user@127.0.0.1:4173/",
      "http://127.0.0.1:4173/?port=other",
      "http://127.0.0.1:4173/#fragment",
      "http://127.0.0.1/"
    ] {
      XCTAssertThrowsError(try ServerOrigin(validating: URL(string: value)!))
    }
  }

  func testSecureEnvironmentIsAnAllowlist() {
    let environment = SecureEnvironmentBuilder.make(
      homeDirectory: URL(fileURLWithPath: "/Users/tester"),
      temporaryDirectory: URL(fileURLWithPath: "/private/tmp/tester"),
      dataDirectory: URL(fileURLWithPath: "/Users/tester/Library/Application Support/SymType"),
      webDistribution: URL(fileURLWithPath: "/Applications/SymType.app/web"),
      nonce: String(repeating: "n", count: 43),
      buildID: "2.1.0+1.481a2cbe4182"
    )

    XCTAssertEqual(environment["SYMTYPE_HOST"], "127.0.0.1")
    XCTAssertEqual(environment["SYMTYPE_PORT"], "0")
    XCTAssertEqual(environment["SYMTYPE_DESKTOP_MODE"], "1")
    XCTAssertNil(environment["NODE_OPTIONS"])
    XCTAssertNil(environment["NODE_PATH"])
    XCTAssertNil(environment["DYLD_INSERT_LIBRARIES"])
    XCTAssertNil(environment["DYLD_LIBRARY_PATH"])
    XCTAssertEqual(
      Set(environment.keys),
      Set([
        "HOME", "TMPDIR", "USER", "LOGNAME", "PATH", "LANG", "NODE_ENV",
        "SYMTYPE_DATA_DIR", "SYMTYPE_WEB_DIST", "SYMTYPE_HOST", "SYMTYPE_PORT",
        "SYMTYPE_LOG_LEVEL", "SYMTYPE_DESKTOP_MODE",
        "SYMTYPE_DESKTOP_LAUNCH_NONCE", "SYMTYPE_BUILD_ID"
      ])
    )
  }

  func testNonceIsBase64URLAndLongEnough() throws {
    let nonce = try SecureNonce.make()
    XCTAssertGreaterThanOrEqual(nonce.count, 32)
    XCTAssertLessThanOrEqual(nonce.count, 128)
    XCTAssertNotNil(nonce.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression))
  }

  func testApplicationInstanceLockRejectsSecondHolder() throws {
    let directory = FileManager.default.temporaryDirectory
      .appendingPathComponent("symtype-lock-tests-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer {
      try? FileManager.default.removeItem(at: directory)
    }
    let lockURL = directory.appendingPathComponent("application.lock")
    let first = try ApplicationInstanceLock(lockURL: lockURL)
    withExtendedLifetime(first) {
      XCTAssertThrowsError(try ApplicationInstanceLock(lockURL: lockURL)) { error in
        XCTAssertEqual(error as? DesktopSecurityError, .anotherApplicationIsRunning)
      }
    }
  }

  func testOldLauncherLockIsNotRemovedWhileOwnerIsAlive() throws {
    let directory = FileManager.default.temporaryDirectory
      .appendingPathComponent("symtype-launch-lock-tests-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer {
      try? FileManager.default.removeItem(at: directory)
    }
    let lockURL = directory.appendingPathComponent("launcher.lock")
    let record = """
      {"pid":\(getpid()),"createdAt":"2000-01-01T00:00:00Z"}
      """
    try Data(record.utf8).write(to: lockURL)
    let lock = LauncherFileLock(url: lockURL, ownerPID: getpid())

    XCTAssertFalse(lock.removeIfStale())
    XCTAssertTrue(FileManager.default.fileExists(atPath: lockURL.path))
  }

  func testCancelledDownloadDoesNotShowFailureUI() {
    let cancellation = NSError(domain: NSURLErrorDomain, code: NSURLErrorCancelled)
    let diskFailure = NSError(domain: NSCocoaErrorDomain, code: NSFileWriteOutOfSpaceError)

    XCTAssertFalse(DownloadFailurePolicy.shouldReport(cancellation))
    XCTAssertTrue(DownloadFailurePolicy.shouldReport(diskFailure))
  }
}
