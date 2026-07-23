import AppKit
import Foundation
import OSLog

@MainActor
public final class SymTypeWindowController: NSWindowController, NSWindowDelegate {
  private let rootViewController = NSViewController()
  private let statusLabel = NSTextField(labelWithString: "正在安全启动 SymType…")
  private var webController: DesktopWebViewController?
  private var hideRequestInFlight = false

  public init() {
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 1_180, height: 780),
      styleMask: [.titled, .closable, .miniaturizable, .resizable],
      backing: .buffered,
      defer: false
    )
    window.title = SymTypeProduct.name
    window.minSize = NSSize(width: 1_024, height: 680)
    window.center()
    window.isReleasedWhenClosed = false
    super.init(window: window)
    window.delegate = self

    let rootView = NSView()
    rootViewController.view = rootView
    statusLabel.font = .systemFont(ofSize: 16, weight: .medium)
    statusLabel.textColor = .secondaryLabelColor
    statusLabel.translatesAutoresizingMaskIntoConstraints = false
    rootView.addSubview(statusLabel)
    NSLayoutConstraint.activate([
      statusLabel.centerXAnchor.constraint(equalTo: rootView.centerXAnchor),
      statusLabel.centerYAnchor.constraint(equalTo: rootView.centerYAnchor)
    ])
    contentViewController = rootViewController
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  public func load(origin: ServerOrigin) {
    if let existing = webController {
      existing.navigationFailureHandler = nil
      existing.downloadFailureHandler = nil
      existing.webView.stopLoading()
      existing.view.removeFromSuperview()
      existing.removeFromParent()
      webController = nil
    }
    let controller = DesktopWebViewController(origin: origin)
    controller.navigationFailureHandler = { [weak self] error in
      self?.presentError(
        title: "无法加载 SymType",
        detail: error.localizedDescription
      )
    }
    controller.downloadFailureHandler = { [weak self] error in
      self?.presentError(
        title: "导出没有完成",
        detail: error.localizedDescription
      )
    }
    rootViewController.addChild(controller)
    controller.view.translatesAutoresizingMaskIntoConstraints = false
    rootViewController.view.addSubview(controller.view)
    NSLayoutConstraint.activate([
      controller.view.leadingAnchor.constraint(equalTo: rootViewController.view.leadingAnchor),
      controller.view.trailingAnchor.constraint(equalTo: rootViewController.view.trailingAnchor),
      controller.view.topAnchor.constraint(equalTo: rootViewController.view.topAnchor),
      controller.view.bottomAnchor.constraint(equalTo: rootViewController.view.bottomAnchor)
    ])
    statusLabel.removeFromSuperview()
    webController = controller
    controller.loadApplication()
  }

  public func reveal() {
    showWindow(nil)
    window?.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
  }

  public func requestQuit() async -> DesktopBridgeResult {
    guard let webController else {
      return .ready
    }
    return await webController.requestQuit()
  }

  public func windowShouldClose(_ sender: NSWindow) -> Bool {
    guard !hideRequestInFlight else {
      return false
    }
    hideRequestInFlight = true
    Task { @MainActor [weak self, weak sender] in
      guard let self else {
        return
      }
      let result = await self.webController?.prepareToHide() ?? .ready
      self.hideRequestInFlight = false
      switch result {
      case .ready:
        sender?.orderOut(nil)
      case .cancelled:
        sender?.makeKeyAndOrderFront(nil)
      case .failed:
        sender?.makeKeyAndOrderFront(nil)
        self.presentError(
          title: "暂时无法隐藏窗口",
          detail: "待保存的输入尚未确认写入。请重试；窗口和本地服务仍保持运行。"
        )
      }
    }
    return false
  }

  public func presentError(title: String, detail: String) {
    let alert = NSAlert()
    alert.alertStyle = .warning
    alert.messageText = title
    alert.informativeText = detail
    alert.addButton(withTitle: "好")
    if let window {
      alert.beginSheetModal(for: window)
    } else {
      alert.runModal()
    }
  }

  public func chooseShutdownRetry(detail: String) async -> Bool {
    await withCheckedContinuation { continuation in
      let alert = NSAlert()
      alert.alertStyle = .critical
      alert.messageText = "本地服务尚未安全退出"
      alert.informativeText = detail
      alert.addButton(withTitle: "重试退出")
      alert.addButton(withTitle: "取消")
      let finish: (NSApplication.ModalResponse) -> Void = { response in
        continuation.resume(returning: response == .alertFirstButtonReturn)
      }
      if let window {
        alert.beginSheetModal(for: window, completionHandler: finish)
      } else {
        finish(alert.runModal())
      }
    }
  }

  public func chooseServerRestart(detail: String) async -> Bool {
    await withCheckedContinuation { continuation in
      let alert = NSAlert()
      alert.alertStyle = .critical
      alert.messageText = "本地服务意外停止"
      alert.informativeText =
        "\(detail)\n\n可以重新启动本地服务并从 SQLite 中已确认的进度恢复。" +
        "尚未确认写入的最近输入可能需要重打。"
      alert.addButton(withTitle: "重新启动服务")
      alert.addButton(withTitle: "暂不重启")
      let finish: (NSApplication.ModalResponse) -> Void = { response in
        continuation.resume(returning: response == .alertFirstButtonReturn)
      }
      if let window {
        alert.beginSheetModal(for: window, completionHandler: finish)
      } else {
        finish(alert.runModal())
      }
    }
  }

  public func confirmQuitAfterServerFailure() async -> Bool {
    await withCheckedContinuation { continuation in
      let alert = NSAlert()
      alert.alertStyle = .warning
      alert.messageText = "本地服务仍未运行"
      alert.informativeText =
        "无法再刷新尚未确认写入的输入。退出不会删除 SQLite 中已经保存的数据。"
      alert.addButton(withTitle: "仍要退出")
      alert.addButton(withTitle: "返回")
      let finish: (NSApplication.ModalResponse) -> Void = { response in
        continuation.resume(returning: response == .alertFirstButtonReturn)
      }
      if let window {
        alert.beginSheetModal(for: window, completionHandler: finish)
      } else {
        finish(alert.runModal())
      }
    }
  }
}

@MainActor
public final class SymTypeAppDelegate: NSObject, NSApplicationDelegate {
  private static let startupLog = OSLog(
    subsystem: SymTypeProduct.bundleIdentifier,
    category: .pointsOfInterest
  )

  private let windowController = SymTypeWindowController()
  private var supervisor: ServerSupervisor?
  private var instanceLock: ApplicationInstanceLock?
  private var terminationInFlight = false
  private var serverRecoveryInFlight = false
  private var serverUnavailableAfterCrash = false
  private var lastServerFailureDetail: String?

  public override init() {
    super.init()
  }

  public func applicationDidFinishLaunching(_ notification: Notification) {
    os_signpost(.event, log: Self.startupLog, name: "Native application launched")
    installMainMenu()
#if DEBUG
    if CommandLine.arguments.contains("--symtype-ui-testing") {
      windowController.reveal()
      return
    }
#endif
    do {
      let dataDirectory = try DataDirectory.createDefault()
      do {
        instanceLock = try ApplicationInstanceLock(
          lockURL: dataDirectory.appendingPathComponent(
            "desktop-application.lock",
            isDirectory: false
          )
        )
      } catch DesktopSecurityError.anotherApplicationIsRunning {
        activateExistingApplication()
        NSApp.terminate(nil)
        return
      }

      let layout = AppBundleLayout(bundleURL: Bundle.main.bundleURL)
      let manifest = try ReleaseManifestLoader.load(from: layout.releaseManifestURL)
      guard Bundle.main.object(
        forInfoDictionaryKey: "CFBundleShortVersionString"
      ) as? String == manifest.productVersion else {
        throw ReleaseManifestError.productMismatch(manifest.productVersion)
      }
      guard Bundle.main.object(
        forInfoDictionaryKey: "CFBundleVersion"
      ) as? String == String(manifest.buildNumber) else {
        throw ReleaseManifestError.buildMismatch(manifest.buildNumber)
      }

      let serverSupervisor = ServerSupervisor(
        layout: layout,
        dataDirectory: dataDirectory,
        manifest: manifest
      )
      serverSupervisor.unexpectedTerminationHandler = { [weak self] error in
        Task { @MainActor [weak self] in
          await self?.recoverFromUnexpectedServerExit(detail: error.localizedDescription)
        }
      }
      supervisor = serverSupervisor
      windowController.reveal()
      Task { @MainActor [weak self] in
        guard let self else {
          return
        }
        do {
          let server = try await serverSupervisor.start()
          self.windowController.load(origin: server.origin)
          os_signpost(.event, log: Self.startupLog, name: "Application content requested")
        } catch {
          self.windowController.presentError(
            title: "SymType 无法启动",
            detail: error.localizedDescription
          )
        }
      }
    } catch {
      windowController.reveal()
      windowController.presentError(
        title: "SymType 安装不完整",
        detail: error.localizedDescription
      )
    }
  }

  public func applicationShouldHandleReopen(
    _ sender: NSApplication,
    hasVisibleWindows flag: Bool
  ) -> Bool {
    windowController.reveal()
    return true
  }

  public func applicationDidBecomeActive(_ notification: Notification) {
    if windowController.window?.isVisible == false, !terminationInFlight {
      windowController.reveal()
    }
    if serverUnavailableAfterCrash,
       !serverRecoveryInFlight,
       let lastServerFailureDetail {
      Task { @MainActor [weak self] in
        await self?.recoverFromUnexpectedServerExit(detail: lastServerFailureDetail)
      }
    }
  }

  public func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    guard !terminationInFlight else {
      return .terminateLater
    }
    terminationInFlight = true
    Task { @MainActor [weak self] in
      guard let self else {
        sender.reply(toApplicationShouldTerminate: false)
        return
      }
      if self.serverUnavailableAfterCrash {
        let confirmed = await self.windowController.confirmQuitAfterServerFailure()
        if !confirmed {
          self.terminationInFlight = false
        }
        sender.reply(toApplicationShouldTerminate: confirmed)
        return
      }
      let bridgeResult = await self.windowController.requestQuit()
      guard bridgeResult == .ready else {
        self.terminationInFlight = false
        if bridgeResult == .failed {
          self.windowController.reveal()
          self.windowController.presentError(
            title: "尚未退出",
            detail: "待保存数据没有确认写入。SymType 和本地服务仍保持运行。"
          )
        }
        sender.reply(toApplicationShouldTerminate: false)
        return
      }

      while true {
        do {
          try await self.supervisor?.stopOwnedServer()
          sender.reply(toApplicationShouldTerminate: true)
          return
        } catch {
          self.windowController.reveal()
          let retry = await self.windowController.chooseShutdownRetry(
            detail: error.localizedDescription
          )
          if !retry {
            self.terminationInFlight = false
            sender.reply(toApplicationShouldTerminate: false)
            return
          }
        }
      }
    }
    return .terminateLater
  }

  private func recoverFromUnexpectedServerExit(detail initialDetail: String) async {
    guard !terminationInFlight, !serverRecoveryInFlight, let supervisor else {
      return
    }
    serverRecoveryInFlight = true
    serverUnavailableAfterCrash = true
    lastServerFailureDetail = initialDetail
    defer {
      serverRecoveryInFlight = false
    }

    var detail = initialDetail
    while !terminationInFlight {
      windowController.reveal()
      guard await windowController.chooseServerRestart(detail: detail) else {
        return
      }
      do {
        let server = try await supervisor.start()
        windowController.load(origin: server.origin)
        serverUnavailableAfterCrash = false
        lastServerFailureDetail = nil
        return
      } catch {
        detail = "重新启动没有完成：\(error.localizedDescription)"
        lastServerFailureDetail = detail
      }
    }
  }

  private func activateExistingApplication() {
    guard let bundleIdentifier = Bundle.main.bundleIdentifier else {
      return
    }
    let ownPID = ProcessInfo.processInfo.processIdentifier
    NSRunningApplication
      .runningApplications(withBundleIdentifier: bundleIdentifier)
      .first(where: { $0.processIdentifier != ownPID })?
      .activate(options: [.activateAllWindows])
  }

  private func installMainMenu() {
    let mainMenu = NSMenu()
    let applicationItem = NSMenuItem()
    mainMenu.addItem(applicationItem)
    let applicationMenu = NSMenu()
    applicationMenu.addItem(
      withTitle: "关于 SymType",
      action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)),
      keyEquivalent: ""
    )
    applicationMenu.addItem(.separator())
    applicationMenu.addItem(
      withTitle: "隐藏 SymType",
      action: #selector(NSApplication.hide(_:)),
      keyEquivalent: "h"
    )
    applicationMenu.addItem(.separator())
    applicationMenu.addItem(
      withTitle: "退出 SymType",
      action: #selector(NSApplication.terminate(_:)),
      keyEquivalent: "q"
    )
    applicationItem.submenu = applicationMenu

    let windowItem = NSMenuItem()
    mainMenu.addItem(windowItem)
    let windowMenu = NSMenu(title: "窗口")
    windowMenu.addItem(
      withTitle: "关闭窗口",
      action: #selector(NSWindow.performClose(_:)),
      keyEquivalent: "w"
    )
    windowMenu.addItem(
      withTitle: "最小化",
      action: #selector(NSWindow.performMiniaturize(_:)),
      keyEquivalent: "m"
    )
    windowItem.submenu = windowMenu
    NSApp.windowsMenu = windowMenu
    NSApp.mainMenu = mainMenu
  }
}

public enum SymTypeApplicationMain {
  public static func run() {
    MainActor.assumeIsolated {
      let application = NSApplication.shared
      application.setActivationPolicy(.regular)
      let delegate = SymTypeAppDelegate()
      application.delegate = delegate
      application.run()
      _ = delegate
    }
  }
}
