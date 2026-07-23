import Foundation

public enum SymTypeServerContract {
  // These values deliberately track apps/server/src/db/migrations.ts and ALGORITHM_VERSION.
  // A server contract change requires an explicit desktop release update.
  public static let schemaVersion = 10
  public static let algorithmVersion = "adaptive-v1"
}

public struct ServerInfo: Codable, Equatable, Sendable {
  public let protocolVersion: Int
  public let url: String
  public let pid: Int32
  public let startedAt: String
  public let databasePath: String
  public let productVersion: String?
  public let buildId: String?
  public let distribution: String?
  public let parentPid: Int32?
  public let launchNonce: String?

  public init(
    protocolVersion: Int,
    url: String,
    pid: Int32,
    startedAt: String,
    databasePath: String,
    productVersion: String?,
    buildId: String?,
    distribution: String?,
    parentPid: Int32?,
    launchNonce: String?
  ) {
    self.protocolVersion = protocolVersion
    self.url = url
    self.pid = pid
    self.startedAt = startedAt
    self.databasePath = databasePath
    self.productVersion = productVersion
    self.buildId = buildId
    self.distribution = distribution
    self.parentPid = parentPid
    self.launchNonce = launchNonce
  }
}

public struct HealthResponse: Codable, Equatable, Sendable {
  public struct Integrity: Codable, Equatable, Sendable {
    public let ok: Bool
    public let detail: String

    public init(ok: Bool, detail: String) {
      self.ok = ok
      self.detail = detail
    }
  }

  public let ok: Bool
  public let service: String
  public let version: String
  public let schemaVersion: Int
  public let algorithmVersion: String
  public let integrity: Integrity
  public let time: String

  public init(
    ok: Bool,
    service: String,
    version: String,
    schemaVersion: Int,
    algorithmVersion: String,
    integrity: Integrity,
    time: String
  ) {
    self.ok = ok
    self.service = service
    self.version = version
    self.schemaVersion = schemaVersion
    self.algorithmVersion = algorithmVersion
    self.integrity = integrity
    self.time = time
  }
}

public struct ValidatedServer: Sendable {
  public let origin: ServerOrigin
  public let info: ServerInfo
  public let health: HealthResponse
  public let isOwned: Bool

  public init(
    origin: ServerOrigin,
    info: ServerInfo,
    health: HealthResponse,
    isOwned: Bool
  ) {
    self.origin = origin
    self.info = info
    self.health = health
    self.isOwned = isOwned
  }
}

public enum ServerProtocolError: LocalizedError, Equatable {
  case malformedServerInfo
  case serverInfoTooLarge
  case protocolMismatch(Int)
  case databasePathMismatch
  case processMismatch
  case nonceMismatch
  case parentMismatch
  case versionMismatch
  case buildMismatch
  case distributionMismatch
  case unhealthy
  case schemaMismatch(expected: Int, actual: Int)
  case algorithmMismatch(expected: String, actual: String)
  case incompatibleRunningServer
  case launchFailed(String)
  case launchTimedOut
  case launchCleanupFailed(startup: String, cleanup: String)
  case shutdownTimedOut
  case serverExited(Int32)

  public var errorDescription: String? {
    switch self {
    case .malformedServerInfo:
      return "本地服务启动信息无效。"
    case .serverInfoTooLarge:
      return "本地服务启动信息异常过大。"
    case .protocolMismatch(let value):
      return "不支持的本地服务启动协议：\(value)。"
    case .databasePathMismatch:
      return "本地服务指向了意外的数据文件。"
    case .processMismatch:
      return "本地服务进程身份校验失败。"
    case .nonceMismatch:
      return "本地服务启动标识校验失败。"
    case .parentMismatch:
      return "本地服务父进程校验失败。"
    case .versionMismatch:
      return "已有 SymType 服务版本不兼容。请先退出它，再打开此版本。"
    case .buildMismatch:
      return "已有 SymType 服务构建不兼容。请先退出它，再打开此版本。"
    case .distributionMismatch:
      return "本地服务不是受支持的桌面分发实例。"
    case .unhealthy:
      return "本地服务未通过数据库完整性检查。"
    case .schemaMismatch(let expected, let actual):
      return "本地服务数据库结构不兼容（需要 \(expected)，实际 \(actual)）。"
    case .algorithmMismatch(let expected, let actual):
      return "本地服务训练算法不兼容（需要 \(expected)，实际 \(actual)）。"
    case .incompatibleRunningServer:
      return "检测到不兼容的 SymType 服务；没有终止该进程。请先正常退出它。"
    case .launchFailed(let detail):
      return "无法启动本地服务：\(detail)"
    case .launchTimedOut:
      return "本地服务在 30 秒内没有完成安全启动。"
    case .launchCleanupFailed(let startup, let cleanup):
      return "本地服务启动失败（\(startup)），且自有进程未能安全清理（\(cleanup)）。"
    case .shutdownTimedOut:
      return "本地服务在 10 秒内没有安全退出。数据未被强制中断。"
    case .serverExited(let status):
      return "本地服务意外退出（状态 \(status)）。"
    }
  }
}

public enum ServerInfoReader {
  public static let maximumBytes = 64 * 1_024

  public static func read(from url: URL) throws -> ServerInfo {
    guard let attributes = try? FileManager.default.attributesOfItem(atPath: url.path),
          let size = attributes[.size] as? NSNumber else {
      throw ServerProtocolError.malformedServerInfo
    }
    guard size.intValue <= maximumBytes else {
      throw ServerProtocolError.serverInfoTooLarge
    }
    guard let data = try? Data(contentsOf: url, options: [.mappedIfSafe]),
          let info = try? JSONDecoder().decode(ServerInfo.self, from: data) else {
      throw ServerProtocolError.malformedServerInfo
    }
    return info
  }
}

public enum ServerValidator {
  public static func validateInfo(
    _ info: ServerInfo,
    dataDirectory: URL,
    manifest: ReleaseManifest,
    expectedProcess: Int32?,
    expectedParent: Int32?,
    expectedNonce: String?
  ) throws -> ServerOrigin {
    guard info.protocolVersion == 1 else {
      throw ServerProtocolError.protocolMismatch(info.protocolVersion)
    }
    let expectedDatabase = dataDirectory
      .appendingPathComponent("symtype.sqlite3", isDirectory: false)
      .resolvingSymlinksInPath()
    let reportedDatabase = URL(fileURLWithPath: info.databasePath).resolvingSymlinksInPath()
    guard expectedDatabase.path == reportedDatabase.path else {
      throw ServerProtocolError.databasePathMismatch
    }
    guard ProcessInspection.isAlive(pid: info.pid) else {
      throw ServerProtocolError.processMismatch
    }
    if let expectedProcess, info.pid != expectedProcess {
      throw ServerProtocolError.processMismatch
    }
    guard info.productVersion == manifest.productVersion else {
      throw ServerProtocolError.versionMismatch
    }
    if expectedProcess != nil || expectedParent != nil || expectedNonce != nil {
      guard info.distribution == "macos-app" else {
        throw ServerProtocolError.distributionMismatch
      }
      guard info.buildId == manifest.buildID else {
        throw ServerProtocolError.buildMismatch
      }
    } else {
      switch info.distribution {
      case "macos-app":
        guard info.buildId == manifest.buildID else {
          throw ServerProtocolError.buildMismatch
        }
      case "source":
        guard info.buildId == manifest.productVersion else {
          throw ServerProtocolError.buildMismatch
        }
      default:
        throw ServerProtocolError.distributionMismatch
      }
    }
    if let expectedParent, info.parentPid != expectedParent {
      throw ServerProtocolError.parentMismatch
    }
    if let expectedNonce, info.launchNonce != expectedNonce {
      throw ServerProtocolError.nonceMismatch
    }
    guard let url = URL(string: info.url) else {
      throw DesktopSecurityError.invalidLoopbackURL
    }
    return try ServerOrigin(validating: url)
  }

  public static func validateHealth(
    _ health: HealthResponse,
    manifest: ReleaseManifest
  ) throws {
    guard health.ok,
          health.service == "symtype",
          health.integrity.ok else {
      throw ServerProtocolError.unhealthy
    }
    guard health.version == manifest.productVersion else {
      throw ServerProtocolError.versionMismatch
    }
    guard health.schemaVersion == SymTypeServerContract.schemaVersion else {
      throw ServerProtocolError.schemaMismatch(
        expected: SymTypeServerContract.schemaVersion,
        actual: health.schemaVersion
      )
    }
    guard health.algorithmVersion == SymTypeServerContract.algorithmVersion else {
      throw ServerProtocolError.algorithmMismatch(
        expected: SymTypeServerContract.algorithmVersion,
        actual: health.algorithmVersion
      )
    }
  }
}

public enum DesktopBridgeResult: String, Equatable, Sendable {
  case ready
  case cancelled
  case failed
}
