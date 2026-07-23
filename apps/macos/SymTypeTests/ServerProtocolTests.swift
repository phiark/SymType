import Darwin
import Foundation
import WebKit
import XCTest

@testable import SymTypeMacCore

private final class TestNavigationDelegate: NSObject, WKNavigationDelegate {
  private let completion: (Error?) -> Void

  init(completion: @escaping (Error?) -> Void) {
    self.completion = completion
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    completion(nil)
  }

  func webView(
    _ webView: WKWebView,
    didFailProvisionalNavigation navigation: WKNavigation!,
    withError error: Error
  ) {
    completion(error)
  }
}

final class ServerProtocolTests: XCTestCase {
  func testOwnedServerValidationRequiresProcessNonceParentAndBuild() throws {
    let dataDirectory = URL(fileURLWithPath: "/private/tmp/SymType")
    let manifest = makeManifest()
    let nonce = String(repeating: "a", count: 43)
    let info = ServerInfo(
      protocolVersion: 1,
      url: "http://127.0.0.1:43121",
      pid: getpid(),
      startedAt: "2026-07-23T08:00:00.000Z",
      databasePath: dataDirectory.appendingPathComponent("symtype.sqlite3").path,
      productVersion: manifest.productVersion,
      buildId: manifest.buildID,
      distribution: "macos-app",
      parentPid: getpid(),
      launchNonce: nonce
    )

    let origin = try ServerValidator.validateInfo(
      info,
      dataDirectory: dataDirectory,
      manifest: manifest,
      expectedProcess: getpid(),
      expectedParent: getpid(),
      expectedNonce: nonce
    )
    XCTAssertEqual(origin.port, 43_121)

    XCTAssertThrowsError(
      try ServerValidator.validateInfo(
        info,
        dataDirectory: dataDirectory,
        manifest: manifest,
        expectedProcess: getpid(),
        expectedParent: getpid(),
        expectedNonce: "wrong"
      )
    ) { error in
      XCTAssertEqual(error as? ServerProtocolError, .nonceMismatch)
    }
  }

  func testUnownedServerStillRequiresExactCompatibleBuild() {
    let dataDirectory = URL(fileURLWithPath: "/private/tmp/SymType")
    let manifest = makeManifest()
    let info = ServerInfo(
      protocolVersion: 1,
      url: "http://127.0.0.1:43121",
      pid: getpid(),
      startedAt: "2026-07-23T08:00:00.000Z",
      databasePath: dataDirectory.appendingPathComponent("symtype.sqlite3").path,
      productVersion: manifest.productVersion,
      buildId: "2.1.0+1.other",
      distribution: "macos-app",
      parentPid: 99,
      launchNonce: "untrusted-but-not-used-for-attachment"
    )

    XCTAssertThrowsError(
      try ServerValidator.validateInfo(
        info,
        dataDirectory: dataDirectory,
        manifest: manifest,
        expectedProcess: nil,
        expectedParent: nil,
        expectedNonce: nil
      )
    ) { error in
      XCTAssertEqual(error as? ServerProtocolError, .buildMismatch)
    }
  }

  func testCompatibleSourceServerCanBeAttachedWithoutOwnership() throws {
    let dataDirectory = URL(fileURLWithPath: "/private/tmp/SymType")
    let manifest = makeManifest()
    let info = ServerInfo(
      protocolVersion: 1,
      url: "http://127.0.0.1:43121",
      pid: getpid(),
      startedAt: "2026-07-23T08:00:00.000Z",
      databasePath: dataDirectory.appendingPathComponent("symtype.sqlite3").path,
      productVersion: manifest.productVersion,
      buildId: manifest.productVersion,
      distribution: "source",
      parentPid: getppid(),
      launchNonce: nil
    )

    XCTAssertNoThrow(
      try ServerValidator.validateInfo(
        info,
        dataDirectory: dataDirectory,
        manifest: manifest,
        expectedProcess: nil,
        expectedParent: nil,
        expectedNonce: nil
      )
    )

    let mismatched = ServerInfo(
      protocolVersion: 1,
      url: info.url,
      pid: info.pid,
      startedAt: info.startedAt,
      databasePath: info.databasePath,
      productVersion: "2.0.0",
      buildId: "2.0.0",
      distribution: "source",
      parentPid: info.parentPid,
      launchNonce: nil
    )
    XCTAssertThrowsError(
      try ServerValidator.validateInfo(
        mismatched,
        dataDirectory: dataDirectory,
        manifest: manifest,
        expectedProcess: nil,
        expectedParent: nil,
        expectedNonce: nil
      )
    ) { error in
      XCTAssertEqual(error as? ServerProtocolError, .versionMismatch)
    }
  }

  func testFutureServerInfoProtocolIsRejected() {
    let dataDirectory = URL(fileURLWithPath: "/private/tmp/SymType")
    let manifest = makeManifest()
    let info = ServerInfo(
      protocolVersion: 2,
      url: "http://127.0.0.1:43121",
      pid: getpid(),
      startedAt: "2026-07-23T08:00:00.000Z",
      databasePath: dataDirectory.appendingPathComponent("symtype.sqlite3").path,
      productVersion: manifest.productVersion,
      buildId: manifest.buildID,
      distribution: "macos-app",
      parentPid: getpid(),
      launchNonce: String(repeating: "a", count: 43)
    )

    XCTAssertThrowsError(
      try ServerValidator.validateInfo(
        info,
        dataDirectory: dataDirectory,
        manifest: manifest,
        expectedProcess: getpid(),
        expectedParent: getpid(),
        expectedNonce: info.launchNonce
      )
    ) { error in
      XCTAssertEqual(error as? ServerProtocolError, .protocolMismatch(2))
    }
  }

  @MainActor
  func testOwnedStartupCleanupClosesPipeAndTerminatesChild() async throws {
    let pipe = Pipe()
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/bin/cat")
    process.standardInput = pipe
    process.standardOutput = FileHandle.nullDevice
    process.standardError = FileHandle.nullDevice
    try process.run()
    XCTAssertTrue(process.isRunning)

    try await OwnedProcessShutdown.stop(
      process: process,
      parentLifetimePipe: pipe,
      timeout: .seconds(2),
      closeParentPipeBeforeWaiting: true
    )

    XCTAssertFalse(process.isRunning)
  }

  func testExpectedExitMarkerSurvivesUntilTerminationAcknowledgement() {
    let registry = ExpectedProcessExitRegistry()
    registry.markExpected(41_731)

    XCTAssertTrue(registry.consumeExpected(41_731))
    XCTAssertFalse(registry.consumeExpected(41_731))
    XCTAssertFalse(registry.consumeExpected(41_732))
  }

  func testTimedOutStopMakesALateExitUnexpectedAgain() {
    let registry = ExpectedProcessExitRegistry()
    registry.markExpected(41_731)
    registry.cancelExpected(41_731)

    XCTAssertFalse(registry.consumeExpected(41_731))
  }

  func testHealthRequiresIdentityVersionAndIntegrity() {
    let manifest = makeManifest()
    let valid = HealthResponse(
      ok: true,
      service: "symtype",
      version: manifest.productVersion,
      schemaVersion: SymTypeServerContract.schemaVersion,
      algorithmVersion: SymTypeServerContract.algorithmVersion,
      integrity: .init(ok: true, detail: "ok"),
      time: "2026-07-23T08:00:00.000Z"
    )
    XCTAssertNoThrow(try ServerValidator.validateHealth(valid, manifest: manifest))

    let unhealthy = HealthResponse(
      ok: true,
      service: "symtype",
      version: manifest.productVersion,
      schemaVersion: SymTypeServerContract.schemaVersion,
      algorithmVersion: SymTypeServerContract.algorithmVersion,
      integrity: .init(ok: false, detail: "failed"),
      time: "2026-07-23T08:00:00.000Z"
    )
    XCTAssertThrowsError(try ServerValidator.validateHealth(unhealthy, manifest: manifest)) {
      error in
      XCTAssertEqual(error as? ServerProtocolError, .unhealthy)
    }

    let wrongContract = HealthResponse(
      ok: true,
      service: "symtype",
      version: manifest.productVersion,
      schemaVersion: SymTypeServerContract.schemaVersion + 1,
      algorithmVersion: SymTypeServerContract.algorithmVersion,
      integrity: .init(ok: true, detail: "ok"),
      time: "2026-07-23T08:00:00.000Z"
    )
    XCTAssertThrowsError(try ServerValidator.validateHealth(wrongContract, manifest: manifest)) {
      error in
      XCTAssertEqual(
        error as? ServerProtocolError,
        .schemaMismatch(
          expected: SymTypeServerContract.schemaVersion,
          actual: SymTypeServerContract.schemaVersion + 1
        )
      )
    }
  }

  @MainActor
  func testCallbackDeadlineReturnsFailureWhenJavaScriptNeverReplies() async {
    let started = ContinuousClock.now
    let result: DesktopBridgeResult = await CallbackDeadline.resolve(
      timeout: .milliseconds(20),
      timeoutValue: .failed
    ) { _ in
      // Intentionally never complete, matching an unresponsive renderer.
    }

    XCTAssertEqual(result, .failed)
    XCTAssertLessThan(ContinuousClock.now - started, .seconds(1))
  }

  func testQuitBridgeDoesNotTreatUserDecisionTimeAsARendererDeadline() {
    XCTAssertEqual(DesktopBridgeMethod.prepareToHide.callbackTimeout, .seconds(5))
    XCTAssertNil(DesktopBridgeMethod.requestQuit.callbackTimeout)
    XCTAssertFalse(DesktopBridgeMethod.prepareToHide.requiresRendererLiveness)
    XCTAssertTrue(DesktopBridgeMethod.requestQuit.requiresRendererLiveness)
  }

  @MainActor
  func testQuitBridgeKeepsWaitingWhileTheRendererAnswersHeartbeats() async {
    var heartbeatCount = 0
    let result: DesktopBridgeResult = await CallbackLivenessMonitor.resolve(
      heartbeatInterval: .milliseconds(10),
      heartbeatTimeout: .milliseconds(20),
      failureValue: .failed
    ) { completion in
      Task { @MainActor in
        try? await Task.sleep(for: .milliseconds(80))
        completion(.cancelled)
      }
    } heartbeat: { completion in
      heartbeatCount += 1
      completion(true)
    }

    XCTAssertEqual(result, .cancelled)
    XCTAssertGreaterThanOrEqual(heartbeatCount, 2)
  }

  @MainActor
  func testQuitBridgeFailsWhenTheRendererStopsAnsweringHeartbeats() async {
    let started = ContinuousClock.now
    let result: DesktopBridgeResult = await CallbackLivenessMonitor.resolve(
      heartbeatInterval: .milliseconds(10),
      heartbeatTimeout: .milliseconds(20),
      failureValue: .failed
    ) { _ in
      // The requestQuit promise never settles.
    } heartbeat: { _ in
      // A hung renderer never answers the fixed liveness probe.
    }

    XCTAssertEqual(result, .failed)
    XCTAssertLessThan(ContinuousClock.now - started, .seconds(1))
  }

  func testInstallingAReplacementWebViewInvalidatesTheOldHideCallback() throws {
    var state = HideRequestState()
    let oldRequest = try XCTUnwrap(state.begin())

    state.invalidate()

    XCTAssertFalse(state.complete(generation: oldRequest))
    XCTAssertFalse(state.isInFlight)
    let replacementRequest = try XCTUnwrap(state.begin())
    XCTAssertTrue(state.complete(generation: replacementRequest))
  }

  @MainActor
  func testTerminationWaitsUntilRecoveryReleasesTheSupervisor() async {
    let gate = ServerRecoveryGate()
    XCTAssertTrue(gate.begin())
    var didResume = false
    let waiter = Task { @MainActor in
      await gate.waitUntilIdle()
      didResume = true
    }
    await Task.yield()
    XCTAssertFalse(didResume)

    gate.finish()
    await waiter.value

    XCTAssertTrue(didResume)
    XCTAssertFalse(gate.isInFlight)
  }

  func testConfirmedUnavailableQuitRechecksRecoveryAndUsesOneShutdownDeadline() {
    XCTAssertEqual(ServerTerminationPolicy.shutdownTimeout, .seconds(10))
    XCTAssertEqual(
      ServerTerminationPolicy.bridgeDispositionAfterConfirmedFailure(
        serverIsStillUnavailable: true
      ),
      .skipBridge
    )
    XCTAssertEqual(
      ServerTerminationPolicy.bridgeDispositionAfterConfirmedFailure(
        serverIsStillUnavailable: false
      ),
      .requestBridge
    )
  }

  func testLateServerExitIsDeferredUntilAQuitCancellationFinishes() {
    var availability = ServerAvailabilityState()
    availability.recordFailure("Node stopped after the shutdown timeout")

    XCTAssertNil(
      availability.deferredRecoveryDetail(
        terminationInFlight: true,
        recoveryInFlight: false
      )
    )
    XCTAssertEqual(
      availability.deferredRecoveryDetail(
        terminationInFlight: false,
        recoveryInFlight: false
      ),
      "Node stopped after the shutdown timeout"
    )

    availability.recordRecovery()
    XCTAssertFalse(availability.isUnavailable)
  }

  @MainActor
  func testDesktopBridgeScriptReturnsTheValidatedPromiseResult() async throws {
    let webView = WKWebView(frame: .zero)
    let loaded = expectation(description: "blank page loaded")
    let navigationDelegate = TestNavigationDelegate { error in
      XCTAssertNil(error)
      loaded.fulfill()
    }
    webView.navigationDelegate = navigationDelegate
    webView.loadHTMLString("<!doctype html><title>bridge test</title>", baseURL: nil)
    await fulfillment(of: [loaded], timeout: 5)

    _ = try await webView.callAsyncJavaScript(
      """
      window.symtypeDesktop = {
        prepareToHide: () => Promise.resolve("ready"),
        requestQuit: () => Promise.resolve("cancelled")
      };
      return true;
      """,
      arguments: [:],
      in: nil,
      contentWorld: .page
    )
    let hideResult = try await webView.callAsyncJavaScript(
      DesktopBridgeMethod.prepareToHide.javaScript,
      arguments: [:],
      in: nil,
      contentWorld: .page
    )
    let quitResult = try await webView.callAsyncJavaScript(
      DesktopBridgeMethod.requestQuit.javaScript,
      arguments: [:],
      in: nil,
      contentWorld: .page
    )

    XCTAssertEqual(hideResult as? String, DesktopBridgeResult.ready.rawValue)
    XCTAssertEqual(quitResult as? String, DesktopBridgeResult.cancelled.rawValue)
    _ = navigationDelegate
  }

  private func makeManifest() -> ReleaseManifest {
    ReleaseManifest(
      schemaVersion: 1,
      productVersion: SymTypeProduct.version,
      buildNumber: Int(SymTypeProduct.buildNumber)!,
      commitSha: "481a2cbe41824295ed9baed5f86648e4abd01af4",
      architecture: SymTypeProduct.architecture,
      minimumMacOS: SymTypeProduct.minimumMacOS,
      nodeVersion: SymTypeProduct.nodeVersion,
      nodeAbi: 137,
      resources: []
    )
  }
}
