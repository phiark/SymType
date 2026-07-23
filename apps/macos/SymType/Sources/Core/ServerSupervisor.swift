import AppKit
import Darwin
import Foundation
import OSLog

struct LauncherLockRecord: Codable {
  let pid: Int32
  let createdAt: String
}

final class LauncherFileLock {
  private let url: URL
  private let ownerPID: Int32
  private var ownsFile = false

  init(url: URL, ownerPID: Int32) {
    self.url = url
    self.ownerPID = ownerPID
  }

  func acquire() throws -> Bool {
    let descriptor = open(
      url.path,
      O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC,
      mode_t(S_IRUSR | S_IWUSR)
    )
    if descriptor < 0 {
      if errno == EEXIST {
        return false
      }
      throw ServerProtocolError.launchFailed("无法建立启动锁。")
    }
    defer {
      close(descriptor)
    }
    let formatter = ISO8601DateFormatter()
    let record = LauncherLockRecord(pid: ownerPID, createdAt: formatter.string(from: Date()))
    let encoded = try JSONEncoder().encode(record)
    let written = encoded.withUnsafeBytes { bytes in
      Darwin.write(descriptor, bytes.baseAddress, bytes.count)
    }
    guard written == encoded.count, fsync(descriptor) == 0 else {
      _ = unlink(url.path)
      throw ServerProtocolError.launchFailed("无法持久化启动锁。")
    }
    ownsFile = true
    return true
  }

  func currentOwner() -> LauncherLockRecord? {
    guard let data = try? Data(contentsOf: url),
          data.count <= 4_096 else {
      return nil
    }
    return try? JSONDecoder().decode(LauncherLockRecord.self, from: data)
  }

  func removeIfStale() -> Bool {
    guard let owner = currentOwner(),
          !ProcessInspection.isAlive(pid: owner.pid) else {
      return false
    }
    return unlink(url.path) == 0 || errno == ENOENT
  }

  func release() {
    guard ownsFile else {
      return
    }
    defer {
      ownsFile = false
    }
    guard currentOwner()?.pid == ownerPID else {
      return
    }
    _ = unlink(url.path)
  }

  deinit {
    release()
  }
}

enum OwnedProcessShutdown {
  @MainActor
  static func stop(
    process: Process,
    parentLifetimePipe: Pipe?,
    timeout: Duration,
    closeParentPipeBeforeWaiting: Bool
  ) async throws {
    if closeParentPipeBeforeWaiting {
      parentLifetimePipe?.fileHandleForWriting.closeFile()
    }
    if process.isRunning {
      process.terminate()
    }
    let clock = ContinuousClock()
    let deadline = clock.now.advanced(by: timeout)
    while process.isRunning, clock.now < deadline {
      try await Task.sleep(for: .milliseconds(100))
    }
    guard !process.isRunning else {
      throw ServerProtocolError.shutdownTimedOut
    }
  }
}

final class ExpectedProcessExitRegistry {
  private var processIdentifiers = Set<Int32>()

  func markExpected(_ processIdentifier: Int32) {
    processIdentifiers.insert(processIdentifier)
  }

  func consumeExpected(_ processIdentifier: Int32) -> Bool {
    processIdentifiers.remove(processIdentifier) != nil
  }

  func cancelExpected(_ processIdentifier: Int32) {
    processIdentifiers.remove(processIdentifier)
  }
}

private final class NoRedirectSessionDelegate: NSObject, URLSessionTaskDelegate {
  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse,
    newRequest request: URLRequest,
    completionHandler: @escaping (URLRequest?) -> Void
  ) {
    completionHandler(nil)
  }
}

@MainActor
public final class ServerSupervisor {
  private static let startupLog = OSLog(
    subsystem: SymTypeProduct.bundleIdentifier,
    category: .pointsOfInterest
  )

  private let layout: AppBundleLayout
  private let dataDirectory: URL
  private let manifest: ReleaseManifest
  private let serverInfoURL: URL
  private let launcherLock: LauncherFileLock
  private let sessionDelegate = NoRedirectSessionDelegate()
  private lazy var healthSession: URLSession = {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
    configuration.timeoutIntervalForRequest = 1.25
    configuration.timeoutIntervalForResource = 2
    configuration.httpCookieStorage = nil
    configuration.urlCache = nil
    return URLSession(
      configuration: configuration,
      delegate: sessionDelegate,
      delegateQueue: nil
    )
  }()

  private var ownedProcess: Process?
  private var parentLifetimePipe: Pipe?
  private var serverLogHandle: FileHandle?
  private var didBecomeReady = false
  private let expectedExitRegistry = ExpectedProcessExitRegistry()

  public var unexpectedTerminationHandler: ((ServerProtocolError) -> Void)?

  public init(
    layout: AppBundleLayout,
    dataDirectory: URL,
    manifest: ReleaseManifest
  ) {
    self.layout = layout
    self.dataDirectory = dataDirectory
    self.manifest = manifest
    serverInfoURL = dataDirectory.appendingPathComponent(
      "server-info.json",
      isDirectory: false
    )
    launcherLock = LauncherFileLock(
      url: dataDirectory.appendingPathComponent("launcher.lock", isDirectory: false),
      ownerPID: getpid()
    )
  }

  deinit {
    parentLifetimePipe?.fileHandleForWriting.closeFile()
    serverLogHandle?.closeFile()
  }

  public func start() async throws -> ValidatedServer {
    os_signpost(.begin, log: Self.startupLog, name: "Desktop server startup")
    defer {
      os_signpost(.end, log: Self.startupLog, name: "Desktop server startup")
    }

    try validateRuntimeLayout()
    if let existing = try await discoverExistingServer() {
      didBecomeReady = true
      return existing
    }

    if let concurrentServer = try await acquireLauncherLock() {
      didBecomeReady = true
      return concurrentServer
    }
    defer {
      launcherLock.release()
    }

    if let existing = try await discoverExistingServer() {
      didBecomeReady = true
      return existing
    }

    let nonce = try SecureNonce.make()
    let process = try launchServer(nonce: nonce)
    ownedProcess = process
    do {
      let validated = try await waitUntilReady(process: process, nonce: nonce)
      didBecomeReady = true
      return validated
    } catch {
      let startupError = error
      do {
        expectedExitRegistry.markExpected(process.processIdentifier)
        try await OwnedProcessShutdown.stop(
          process: process,
          parentLifetimePipe: parentLifetimePipe,
          timeout: .seconds(10),
          closeParentPipeBeforeWaiting: true
        )
        closeOwnedHandles()
        ownedProcess = nil
      } catch {
        throw ServerProtocolError.launchCleanupFailed(
          startup: startupError.localizedDescription,
          cleanup: error.localizedDescription
        )
      }
      throw startupError
    }
  }

  public func stopOwnedServer(timeout: Duration = .seconds(10)) async throws {
    guard let process = ownedProcess else {
      return
    }
    guard process.isRunning else {
      closeOwnedHandles()
      ownedProcess = nil
      return
    }

    expectedExitRegistry.markExpected(process.processIdentifier)
    do {
      try await OwnedProcessShutdown.stop(
        process: process,
        parentLifetimePipe: parentLifetimePipe,
        timeout: timeout,
        closeParentPipeBeforeWaiting: false
      )
    } catch {
      expectedExitRegistry.cancelExpected(process.processIdentifier)
      throw error
    }
    closeOwnedHandles()
    ownedProcess = nil
  }

  public var ownsRunningServer: Bool {
    ownedProcess?.isRunning == true
  }

  private func validateRuntimeLayout() throws {
    guard FileManager.default.isExecutableFile(atPath: layout.nodeExecutableURL.path) else {
      throw ServerProtocolError.launchFailed("内置 Node 不存在或不可执行。")
    }
    var isDirectory: ObjCBool = false
    guard FileManager.default.fileExists(
      atPath: layout.webDistributionURL.path,
      isDirectory: &isDirectory
    ), isDirectory.boolValue else {
      throw ServerProtocolError.launchFailed("Web 生产资源不存在。")
    }
    guard FileManager.default.fileExists(atPath: layout.serverEntryURL.path) else {
      throw ServerProtocolError.launchFailed("服务端生产入口不存在。")
    }
    try ReleaseManifestLoader.validateCriticalResources(
      manifest: manifest,
      contentsURL: layout.contentsURL
    )
  }

  private func acquireLauncherLock() async throws -> ValidatedServer? {
    let clock = ContinuousClock()
    let deadline = clock.now.advanced(by: .seconds(30))
    while clock.now < deadline {
      if try launcherLock.acquire() {
        return nil
      }
      if let existing = try await discoverExistingServer() {
        return existing
      }
      if launcherLock.removeIfStale() {
        continue
      }
      try await Task.sleep(for: .milliseconds(250))
    }
    throw ServerProtocolError.launchTimedOut
  }

  private func discoverExistingServer() async throws -> ValidatedServer? {
    guard FileManager.default.fileExists(atPath: serverInfoURL.path) else {
      return nil
    }
    let info: ServerInfo
    do {
      info = try ServerInfoReader.read(from: serverInfoURL)
    } catch {
      throw ServerProtocolError.incompatibleRunningServer
    }
    guard ProcessInspection.isAlive(pid: info.pid) else {
      return nil
    }
    do {
      let origin = try ServerValidator.validateInfo(
        info,
        dataDirectory: dataDirectory,
        manifest: manifest,
        expectedProcess: nil,
        expectedParent: nil,
        expectedNonce: nil
      )
      let health = try await fetchHealth(origin: origin)
      try ServerValidator.validateHealth(health, manifest: manifest)
      return ValidatedServer(origin: origin, info: info, health: health, isOwned: false)
    } catch {
      throw ServerProtocolError.incompatibleRunningServer
    }
  }

  private func launchServer(nonce: String) throws -> Process {
    let logsDirectory = dataDirectory.appendingPathComponent("logs", isDirectory: true)
    try FileManager.default.createDirectory(
      at: logsDirectory,
      withIntermediateDirectories: true,
      attributes: [.posixPermissions: 0o700]
    )
    let logURL = logsDirectory.appendingPathComponent("desktop-server.log", isDirectory: false)
    let logDescriptor = open(
      logURL.path,
      O_WRONLY | O_CREAT | O_APPEND | O_CLOEXEC | O_NOFOLLOW,
      mode_t(S_IRUSR | S_IWUSR)
    )
    guard logDescriptor >= 0 else {
      throw ServerProtocolError.launchFailed("无法安全打开服务日志。")
    }
    var logStatus = stat()
    guard fstat(logDescriptor, &logStatus) == 0,
          (logStatus.st_mode & S_IFMT) == S_IFREG,
          fchmod(logDescriptor, mode_t(S_IRUSR | S_IWUSR)) == 0 else {
      close(logDescriptor)
      throw ServerProtocolError.launchFailed("服务日志不是安全的常规文件。")
    }
    let logHandle = FileHandle(fileDescriptor: logDescriptor, closeOnDealloc: true)

    let lifetimePipe = Pipe()
    let process = Process()
    process.executableURL = layout.nodeExecutableURL
    process.arguments = [layout.serverEntryURL.path]
    process.currentDirectoryURL = layout.applicationPayloadURL
    process.environment = SecureEnvironmentBuilder.make(
      homeDirectory: FileManager.default.homeDirectoryForCurrentUser,
      temporaryDirectory: FileManager.default.temporaryDirectory,
      dataDirectory: dataDirectory,
      webDistribution: layout.webDistributionURL,
      nonce: nonce,
      buildID: manifest.buildID
    )
    process.standardInput = lifetimePipe
    process.standardOutput = logHandle
    process.standardError = logHandle
    process.terminationHandler = { [weak self] finished in
      Task { @MainActor [weak self] in
        guard let self else {
          return
        }
        let wasExpected = self.expectedExitRegistry.consumeExpected(
          finished.processIdentifier
        )
        let wasReady = self.didBecomeReady
        if self.ownedProcess?.processIdentifier == finished.processIdentifier {
          self.closeOwnedHandles()
          self.ownedProcess = nil
          self.didBecomeReady = false
        }
        if wasReady, !wasExpected {
          self.unexpectedTerminationHandler?(
            .serverExited(finished.terminationStatus)
          )
        }
      }
    }

    do {
      try process.run()
    } catch {
      logHandle.closeFile()
      lifetimePipe.fileHandleForWriting.closeFile()
      lifetimePipe.fileHandleForReading.closeFile()
      throw ServerProtocolError.launchFailed(error.localizedDescription)
    }
    parentLifetimePipe = lifetimePipe
    serverLogHandle = logHandle
    return process
  }

  private func waitUntilReady(process: Process, nonce: String) async throws -> ValidatedServer {
    let clock = ContinuousClock()
    let deadline = clock.now.advanced(by: .seconds(30))
    var lastValidationError: Error?
    while clock.now < deadline {
      if !process.isRunning {
        throw ServerProtocolError.serverExited(process.terminationStatus)
      }
      if FileManager.default.fileExists(atPath: serverInfoURL.path) {
        do {
          let info = try ServerInfoReader.read(from: serverInfoURL)
          let origin = try ServerValidator.validateInfo(
            info,
            dataDirectory: dataDirectory,
            manifest: manifest,
            expectedProcess: process.processIdentifier,
            expectedParent: getpid(),
            expectedNonce: nonce
          )
          let health = try await fetchHealth(origin: origin)
          try ServerValidator.validateHealth(health, manifest: manifest)
          os_signpost(.event, log: Self.startupLog, name: "Desktop server healthy")
          return ValidatedServer(origin: origin, info: info, health: health, isOwned: true)
        } catch {
          lastValidationError = error
        }
      }
      try await Task.sleep(for: .milliseconds(150))
    }
    if let error = lastValidationError as? ServerProtocolError {
      throw error
    }
    throw ServerProtocolError.launchTimedOut
  }

  private func fetchHealth(origin: ServerOrigin) async throws -> HealthResponse {
    guard let url = URL(string: "api/v1/health", relativeTo: origin.url) else {
      throw DesktopSecurityError.invalidLoopbackURL
    }
    var request = URLRequest(url: url)
    request.httpMethod = "GET"
    request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
    request.timeoutInterval = 1.25
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    let (data, response) = try await healthSession.data(for: request)
    guard data.count <= 64 * 1_024,
          let http = response as? HTTPURLResponse,
          http.statusCode == 200,
          http.url == url,
          let health = try? JSONDecoder().decode(HealthResponse.self, from: data) else {
      throw ServerProtocolError.unhealthy
    }
    return health
  }

  private func closeOwnedHandles() {
    parentLifetimePipe?.fileHandleForWriting.closeFile()
    parentLifetimePipe?.fileHandleForReading.closeFile()
    parentLifetimePipe = nil
    serverLogHandle?.closeFile()
    serverLogHandle = nil
  }
}
