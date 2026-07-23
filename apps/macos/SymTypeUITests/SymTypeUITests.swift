import XCTest

final class SymTypeUITests: XCTestCase {
  override func setUpWithError() throws {
    continueAfterFailure = false
  }

  @MainActor
  func testApplicationLaunchesOneNativeWindow() throws {
    let application = XCUIApplication()
    application.launchArguments.append("--symtype-ui-testing")
    application.launch()

    XCTAssertTrue(
      application.windows.firstMatch.waitForExistence(timeout: 10),
      "SymType should expose its single native window while the local service starts."
    )
    XCTAssertEqual(application.windows.count, 1)

    application.typeKey("w", modifierFlags: .command)
    let windowBecameHidden = XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "exists == false"),
      object: application.windows.firstMatch
    )
    XCTAssertEqual(
      XCTWaiter.wait(for: [windowBecameHidden], timeout: 5),
      .completed,
      "Cmd-W should hide, rather than destroy, the native window."
    )

    // `XCUIApplication.activate()` is a no-op while the application is already
    // foreground, whereas a real Dock reopen follows an activation transition.
    // Move focus to Finder first so the test exercises that transition without
    // relying on a second shortcut being delivered after the window is hidden.
    let finder = XCUIApplication(bundleIdentifier: "com.apple.finder")
    finder.activate()
    XCTAssertTrue(
      finder.wait(for: .runningForeground, timeout: 10),
      "Finder should take focus before SymType is reactivated."
    )
    XCTAssertTrue(
      application.wait(for: .runningBackground, timeout: 10),
      "The retained application should remain alive while hidden."
    )
    application.activate()
    XCTAssertTrue(
      application.windows.firstMatch.waitForExistence(timeout: 10),
      "Activating the running application should reveal the same retained window."
    )
    XCTAssertEqual(application.windows.count, 1)
    application.terminate()
  }
}
