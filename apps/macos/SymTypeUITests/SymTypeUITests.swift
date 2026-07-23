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

  @MainActor
  func testHiddenActiveSessionQuitRevealsConfirmationAndWaitsForUser() throws {
    let application = launchApplication()
    let window = application.windows.firstMatch
    XCTAssertTrue(window.waitForExistence(timeout: 10))
    XCTAssertTrue(application.buttons["测试 JavaScript 对话框"].waitForExistence(timeout: 10))

    application.typeKey("w", modifierFlags: .command)
    let hidden = XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "exists == false"),
      object: window
    )
    XCTAssertEqual(XCTWaiter.wait(for: [hidden], timeout: 5), .completed)

    application.typeKey("q", modifierFlags: .command)
    XCTAssertTrue(
      application.staticTexts["结束这次训练？"].waitForExistence(timeout: 10),
      "A quit from the hidden state must reveal the existing Web confirmation."
    )
    Thread.sleep(forTimeInterval: 6)
    XCTAssertTrue(
      application.wait(for: .runningForeground, timeout: 2),
      "User decision time must not be treated as a five-second renderer failure."
    )
    application.buttons["继续训练"].click()
    XCTAssertTrue(application.windows.firstMatch.waitForExistence(timeout: 5))
    application.terminate()
  }

  @MainActor
  func testJavaScriptDialogAndImportPanelUseNativeSheets() throws {
    let application = launchApplication()
    XCTAssertTrue(application.buttons["测试 JavaScript 对话框"].waitForExistence(timeout: 10))

    application.buttons["测试 JavaScript 对话框"].click()
    XCTAssertTrue(
      application.staticTexts["测试 JavaScript 对话框已打开"].waitForExistence(timeout: 5)
    )
    application.buttons["好"].click()

    application.buttons["测试导入面板"].click()
    XCTAssertTrue(
      application.sheets.firstMatch.waitForExistence(timeout: 5),
      "The WKUIDelegate file chooser must be presented as a native sheet."
    )
    application.sheets.firstMatch.buttons["取消"].click()
    application.terminate()
  }

  private func launchApplication() -> XCUIApplication {
    let application = XCUIApplication()
    application.launchArguments.append("--symtype-ui-testing")
    application.launch()
    return application
  }
}
