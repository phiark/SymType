import AppKit
import Foundation
import UniformTypeIdentifiers
import WebKit

enum DesktopBridgeMethod {
  case prepareToHide
  case requestQuit

  var javaScript: String {
    let methodName: String
    switch self {
    case .prepareToHide:
      methodName = "prepareToHide"
    case .requestQuit:
      methodName = "requestQuit"
    }
    return """
      return await (() => {
        const desktop = window.symtypeDesktop;
        if (!desktop || typeof desktop.\(methodName) !== "function") {
          return "failed";
        }
        return Promise.resolve(desktop.\(methodName)()).then(
          value => value === "ready" || value === "cancelled" || value === "failed"
            ? value
            : "failed",
          () => "failed"
        );
      })()
      """
  }
}

private struct DownloadDestination {
  let temporaryURL: URL
  let finalURL: URL
}

@MainActor
private final class CallbackDeadlineState<Value> {
  private var continuation: CheckedContinuation<Value, Never>?
  var timeoutTask: Task<Void, Never>?

  init(continuation: CheckedContinuation<Value, Never>) {
    self.continuation = continuation
  }

  func finish(_ value: Value) {
    guard let continuation else {
      return
    }
    self.continuation = nil
    timeoutTask?.cancel()
    timeoutTask = nil
    continuation.resume(returning: value)
  }
}

@MainActor
enum CallbackDeadline {
  static func resolve<Value>(
    timeout: Duration,
    timeoutValue: Value,
    begin: (@escaping (Value) -> Void) -> Void
  ) async -> Value {
    await withCheckedContinuation { continuation in
      let state = CallbackDeadlineState(continuation: continuation)
      state.timeoutTask = Task { @MainActor in
        try? await Task.sleep(for: timeout)
        guard !Task.isCancelled else {
          return
        }
        state.finish(timeoutValue)
      }
      begin { value in
        Task { @MainActor in
          state.finish(value)
        }
      }
    }
  }
}

enum DownloadFailurePolicy {
  static func shouldReport(_ error: Error) -> Bool {
    let error = error as NSError
    return !(error.domain == NSURLErrorDomain && error.code == NSURLErrorCancelled)
  }
}

@MainActor
public final class DesktopWebViewController: NSViewController {
  public let origin: ServerOrigin
  public let webView: WKWebView

  private var pageIsReady = false
  private var downloads: [ObjectIdentifier: DownloadDestination] = [:]

  public var navigationFailureHandler: ((Error) -> Void)?
  public var downloadFailureHandler: ((Error) -> Void)?

  public init(origin: ServerOrigin) {
    self.origin = origin
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .default()
    configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
    configuration.defaultWebpagePreferences.allowsContentJavaScript = true
    webView = WKWebView(frame: .zero, configuration: configuration)
    super.init(nibName: nil, bundle: nil)
    webView.navigationDelegate = self
    webView.uiDelegate = self
    webView.allowsLinkPreview = false
    webView.isInspectable = false
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  public override func loadView() {
    webView.translatesAutoresizingMaskIntoConstraints = false
    view = NSView()
    view.addSubview(webView)
    NSLayoutConstraint.activate([
      webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      webView.topAnchor.constraint(equalTo: view.topAnchor),
      webView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
    ])
  }

  public func loadApplication() {
    pageIsReady = false
    var request = URLRequest(url: origin.url)
    request.cachePolicy = .reloadIgnoringLocalCacheData
    request.timeoutInterval = 30
    webView.load(request)
  }

  public func prepareToHide() async -> DesktopBridgeResult {
    await invoke(.prepareToHide)
  }

  public func requestQuit() async -> DesktopBridgeResult {
    await invoke(.requestQuit)
  }

  private func invoke(_ method: DesktopBridgeMethod) async -> DesktopBridgeResult {
    guard pageIsReady else {
      return .ready
    }
    return await CallbackDeadline.resolve(
      timeout: .seconds(5),
      timeoutValue: .failed
    ) { [weak webView] completion in
      guard let webView else {
        completion(.failed)
        return
      }
      webView.callAsyncJavaScript(
        method.javaScript,
        arguments: [:],
        in: nil,
        in: .page
      ) { result in
        switch result {
        case .success(let value):
          guard let rawValue = value as? String,
                let bridgeResult = DesktopBridgeResult(rawValue: rawValue) else {
            completion(.failed)
            return
          }
          completion(bridgeResult)
        case .failure:
          completion(.failed)
        }
      }
    }
  }

  private func isAllowedNavigation(_ url: URL) -> Bool {
    origin.contains(url)
  }

  private func openExternalLinkIfAllowed(
    _ url: URL,
    navigationType: WKNavigationType
  ) -> Bool {
    guard navigationType == .linkActivated,
          url.scheme?.lowercased() == "https",
          url.user == nil,
          url.password == nil else {
      return false
    }
    NSWorkspace.shared.open(url)
    return true
  }

  private func attach(download: WKDownload) {
    download.delegate = self
  }

  private func presentAlert(
    message: String,
    informativeText: String? = nil,
    buttons: [String],
    completion: @escaping (NSApplication.ModalResponse) -> Void
  ) {
    let alert = NSAlert()
    alert.messageText = message
    alert.informativeText = informativeText ?? ""
    for button in buttons {
      alert.addButton(withTitle: button)
    }
    if let window = view.window {
      alert.beginSheetModal(for: window, completionHandler: completion)
    } else {
      completion(alert.runModal())
    }
  }

  private func allowedImportTypes() -> [UTType] {
    var types: [UTType] = [.json]
    for fileExtension in ["sqlite", "sqlite3", "db"] {
      if let type = UTType(filenameExtension: fileExtension) {
        types.append(type)
      }
    }
    return types
  }

  private func safeFilename(_ suggestedFilename: String) -> String {
    let leaf = URL(fileURLWithPath: suggestedFilename).lastPathComponent
    let filtered = leaf.filter { !$0.isNewline && $0 != "\0" }
    return filtered.isEmpty ? "SymType-export" : String(filtered.prefix(180))
  }

  private func finish(download: WKDownload) {
    let identifier = ObjectIdentifier(download)
    guard let destination = downloads.removeValue(forKey: identifier) else {
      return
    }
    do {
      let fileManager = FileManager.default
      if fileManager.fileExists(atPath: destination.finalURL.path) {
        _ = try fileManager.replaceItemAt(
          destination.finalURL,
          withItemAt: destination.temporaryURL,
          backupItemName: nil,
          options: []
        )
      } else {
        try fileManager.moveItem(
          at: destination.temporaryURL,
          to: destination.finalURL
        )
      }
    } catch {
      try? FileManager.default.removeItem(at: destination.temporaryURL)
      downloadFailureHandler?(error)
    }
  }
}

extension DesktopWebViewController: WKNavigationDelegate {
  public func webView(
    _ webView: WKWebView,
    decidePolicyFor navigationAction: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    guard let url = navigationAction.request.url else {
      decisionHandler(.cancel)
      return
    }
    if navigationAction.shouldPerformDownload, origin.permitsDownload(from: url) {
      decisionHandler(.download)
      return
    }
    if isAllowedNavigation(url) {
      decisionHandler(.allow)
      return
    }
    _ = openExternalLinkIfAllowed(url, navigationType: navigationAction.navigationType)
    decisionHandler(.cancel)
  }

  public func webView(
    _ webView: WKWebView,
    decidePolicyFor navigationResponse: WKNavigationResponse,
    decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
  ) {
    guard let url = navigationResponse.response.url,
          origin.contains(url) else {
      decisionHandler(.cancel)
      return
    }
    let disposition = (navigationResponse.response as? HTTPURLResponse)?
      .value(forHTTPHeaderField: "Content-Disposition")?
      .lowercased()
    if disposition?.contains("attachment") == true || !navigationResponse.canShowMIMEType {
      decisionHandler(.download)
    } else {
      decisionHandler(.allow)
    }
  }

  public func webView(
    _ webView: WKWebView,
    navigationAction: WKNavigationAction,
    didBecome download: WKDownload
  ) {
    attach(download: download)
  }

  public func webView(
    _ webView: WKWebView,
    navigationResponse: WKNavigationResponse,
    didBecome download: WKDownload
  ) {
    attach(download: download)
  }

  public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    pageIsReady = true
  }

  public func webView(
    _ webView: WKWebView,
    didFail navigation: WKNavigation!,
    withError error: Error
  ) {
    pageIsReady = false
    navigationFailureHandler?(error)
  }

  public func webView(
    _ webView: WKWebView,
    didFailProvisionalNavigation navigation: WKNavigation!,
    withError error: Error
  ) {
    pageIsReady = false
    navigationFailureHandler?(error)
  }

  public func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    pageIsReady = false
    webView.reload()
  }
}

extension DesktopWebViewController: WKUIDelegate {
  public func webView(
    _ webView: WKWebView,
    createWebViewWith configuration: WKWebViewConfiguration,
    for navigationAction: WKNavigationAction,
    windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    guard let url = navigationAction.request.url else {
      return nil
    }
    if origin.contains(url) {
      webView.load(navigationAction.request)
    } else {
      _ = openExternalLinkIfAllowed(url, navigationType: navigationAction.navigationType)
    }
    return nil
  }

  public func webView(
    _ webView: WKWebView,
    runJavaScriptAlertPanelWithMessage message: String,
    initiatedByFrame frame: WKFrameInfo,
    completionHandler: @escaping () -> Void
  ) {
    presentAlert(message: message, buttons: ["好"]) { _ in
      completionHandler()
    }
  }

  public func webView(
    _ webView: WKWebView,
    runJavaScriptConfirmPanelWithMessage message: String,
    initiatedByFrame frame: WKFrameInfo,
    completionHandler: @escaping (Bool) -> Void
  ) {
    presentAlert(message: message, buttons: ["确认", "取消"]) { response in
      completionHandler(response == .alertFirstButtonReturn)
    }
  }

  public func webView(
    _ webView: WKWebView,
    runJavaScriptTextInputPanelWithPrompt prompt: String,
    defaultText: String?,
    initiatedByFrame frame: WKFrameInfo,
    completionHandler: @escaping (String?) -> Void
  ) {
    let textField = NSTextField(string: defaultText ?? "")
    textField.frame = NSRect(x: 0, y: 0, width: 320, height: 24)
    let alert = NSAlert()
    alert.messageText = prompt
    alert.accessoryView = textField
    alert.addButton(withTitle: "确认")
    alert.addButton(withTitle: "取消")
    let finish: (NSApplication.ModalResponse) -> Void = { response in
      completionHandler(response == .alertFirstButtonReturn ? textField.stringValue : nil)
    }
    if let window = view.window {
      alert.beginSheetModal(for: window, completionHandler: finish)
    } else {
      finish(alert.runModal())
    }
  }

  public func webView(
    _ webView: WKWebView,
    runOpenPanelWith parameters: WKOpenPanelParameters,
    initiatedByFrame frame: WKFrameInfo,
    completionHandler: @escaping ([URL]?) -> Void
  ) {
    let panel = NSOpenPanel()
    panel.canChooseDirectories = false
    panel.canChooseFiles = true
    panel.allowsMultipleSelection = parameters.allowsMultipleSelection
    panel.allowedContentTypes = allowedImportTypes()
    let finish: (NSApplication.ModalResponse) -> Void = { response in
      completionHandler(response == .OK ? panel.urls : nil)
    }
    if let window = view.window {
      panel.beginSheetModal(for: window, completionHandler: finish)
    } else {
      finish(panel.runModal())
    }
  }
}

extension DesktopWebViewController: WKDownloadDelegate {
  public func download(
    _ download: WKDownload,
    decideDestinationUsing response: URLResponse,
    suggestedFilename: String,
    completionHandler: @escaping (URL?) -> Void
  ) {
    let panel = NSSavePanel()
    panel.nameFieldStringValue = safeFilename(suggestedFilename)
    panel.canCreateDirectories = true
    let finish: (NSApplication.ModalResponse) -> Void = { [weak self] result in
      guard let self else {
        completionHandler(nil)
        return
      }
      guard result == .OK, let finalURL = panel.url else {
        completionHandler(nil)
        return
      }
      let temporaryName = ".symtype-\(UUID().uuidString)-\(finalURL.lastPathComponent)"
      let temporaryURL = finalURL
        .deletingLastPathComponent()
        .appendingPathComponent(temporaryName, isDirectory: false)
      self.downloads[ObjectIdentifier(download)] = DownloadDestination(
        temporaryURL: temporaryURL,
        finalURL: finalURL
      )
      completionHandler(temporaryURL)
    }
    if let window = view.window {
      panel.beginSheetModal(for: window, completionHandler: finish)
    } else {
      finish(panel.runModal())
    }
  }

  public func downloadDidFinish(_ download: WKDownload) {
    finish(download: download)
  }

  public func download(
    _ download: WKDownload,
    didFailWithError error: Error,
    resumeData: Data?
  ) {
    let identifier = ObjectIdentifier(download)
    if let destination = downloads.removeValue(forKey: identifier) {
      try? FileManager.default.removeItem(at: destination.temporaryURL)
    }
    if DownloadFailurePolicy.shouldReport(error) {
      downloadFailureHandler?(error)
    }
  }
}
