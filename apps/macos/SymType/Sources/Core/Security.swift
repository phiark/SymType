import Darwin
import Foundation
import Security

public struct ServerOrigin: Equatable, Sendable {
  public let url: URL
  public let port: Int

  public init(validating candidate: URL) throws {
    guard candidate.scheme?.lowercased() == "http",
          candidate.host?.lowercased() == "127.0.0.1",
          candidate.user == nil,
          candidate.password == nil,
          candidate.query == nil,
          candidate.fragment == nil,
          let candidatePort = candidate.port,
          (1...65_535).contains(candidatePort) else {
      throw DesktopSecurityError.invalidLoopbackURL
    }
    var components = URLComponents()
    components.scheme = "http"
    components.host = "127.0.0.1"
    components.port = candidatePort
    components.path = "/"
    guard let normalized = components.url else {
      throw DesktopSecurityError.invalidLoopbackURL
    }
    url = normalized
    port = candidatePort
  }

  public func contains(_ candidate: URL) -> Bool {
    guard candidate.scheme?.lowercased() == "http",
          candidate.host?.lowercased() == "127.0.0.1" else {
      return false
    }
    return candidate.port == port && candidate.user == nil && candidate.password == nil
  }

  public func permitsDownload(from candidate: URL) -> Bool {
    if contains(candidate) {
      return true
    }
    guard candidate.scheme?.lowercased() == "blob" else {
      return false
    }
    let value = candidate.absoluteString
    guard value.hasPrefix("blob:"),
          let inner = URL(string: String(value.dropFirst("blob:".count))) else {
      return false
    }
    return contains(inner)
  }
}

public enum DesktopSecurityError: LocalizedError, Equatable {
  case invalidLoopbackURL
  case randomNonceFailed
  case unsafeDataDirectory
  case anotherApplicationIsRunning

  public var errorDescription: String? {
    switch self {
    case .invalidLoopbackURL:
      return "本地服务返回了非 127.0.0.1 地址，已拒绝连接。"
    case .randomNonceFailed:
      return "无法生成安全的启动标识。"
    case .unsafeDataDirectory:
      return "SymType 数据目录不安全或无法创建。"
    case .anotherApplicationIsRunning:
      return "另一个 SymType 应用实例已经在运行。"
    }
  }
}

public enum SecureNonce {
  public static func make(byteCount: Int = 32) throws -> String {
    precondition(byteCount >= 24)
    var bytes = [UInt8](repeating: 0, count: byteCount)
    guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
      throw DesktopSecurityError.randomNonceFailed
    }
    return Data(bytes)
      .base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }
}

public enum SecureEnvironmentBuilder {
  public static func make(
    homeDirectory: URL,
    temporaryDirectory: URL,
    dataDirectory: URL,
    webDistribution: URL,
    nonce: String,
    buildID: String
  ) -> [String: String] {
    [
      "HOME": homeDirectory.path,
      "TMPDIR": temporaryDirectory.path,
      "USER": NSUserName(),
      "LOGNAME": NSUserName(),
      "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
      "LANG": "en_US.UTF-8",
      "NODE_ENV": "production",
      "SYMTYPE_DATA_DIR": dataDirectory.path,
      "SYMTYPE_WEB_DIST": webDistribution.path,
      "SYMTYPE_HOST": "127.0.0.1",
      "SYMTYPE_PORT": "0",
      "SYMTYPE_LOG_LEVEL": "info",
      "SYMTYPE_DESKTOP_MODE": "1",
      "SYMTYPE_DESKTOP_LAUNCH_NONCE": nonce,
      "SYMTYPE_BUILD_ID": buildID
    ]
  }
}

public final class ApplicationInstanceLock {
  private var descriptor: Int32 = -1

  public init(lockURL: URL) throws {
    let flags = O_CREAT | O_RDWR | O_CLOEXEC | O_NOFOLLOW
    let opened = open(lockURL.path, flags, mode_t(S_IRUSR | S_IWUSR))
    guard opened >= 0 else {
      throw DesktopSecurityError.unsafeDataDirectory
    }
    guard flock(opened, LOCK_EX | LOCK_NB) == 0 else {
      close(opened)
      throw DesktopSecurityError.anotherApplicationIsRunning
    }
    descriptor = opened
  }

  deinit {
    if descriptor >= 0 {
      _ = flock(descriptor, LOCK_UN)
      close(descriptor)
    }
  }
}

public enum DataDirectory {
  public static func createDefault(fileManager: FileManager = .default) throws -> URL {
    guard let applicationSupport = fileManager.urls(
      for: .applicationSupportDirectory,
      in: .userDomainMask
    ).first else {
      throw DesktopSecurityError.unsafeDataDirectory
    }
    let directory = applicationSupport.appendingPathComponent("SymType", isDirectory: true)
    try fileManager.createDirectory(
      at: directory,
      withIntermediateDirectories: true,
      attributes: [.posixPermissions: 0o700]
    )
    var isDirectory: ObjCBool = false
    guard fileManager.fileExists(atPath: directory.path, isDirectory: &isDirectory),
          isDirectory.boolValue,
          directory.resolvingSymlinksInPath().path != "/",
          directory.resolvingSymlinksInPath().deletingLastPathComponent()
            == applicationSupport.resolvingSymlinksInPath() else {
      throw DesktopSecurityError.unsafeDataDirectory
    }
    try? fileManager.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
    return directory
  }
}

public enum ProcessInspection {
  public static func isAlive(pid: Int32) -> Bool {
    guard pid > 0 else {
      return false
    }
    if kill(pid, 0) == 0 {
      return true
    }
    return errno == EPERM
  }
}
