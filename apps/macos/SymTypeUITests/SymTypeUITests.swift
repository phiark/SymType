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

    application.activate()
    XCTAssertTrue(
      application.windows.firstMatch.waitForExistence(timeout: 5),
      "Activating the running application should reveal the same retained window."
    )
    XCTAssertEqual(application.windows.count, 1)
    application.terminate()
  }
}
