import CryptoKit
import Foundation

public enum SymTypeProduct {
  public static let name = "SymType"
  public static let bundleIdentifier = "com.zerolab.symtype"
  public static let version = "2.1.0"
  public static let buildNumber = "1"
  public static let minimumMacOS = "15.0"
  public static let architecture = "arm64"
  public static let nodeVersion = "24.18.0"
}

public struct AppBundleLayout: Sendable {
  public let bundleURL: URL
  public let contentsURL: URL
  public let resourcesURL: URL
  public let nodeExecutableURL: URL
  public let applicationPayloadURL: URL
  public let serverEntryURL: URL
  public let webDistributionURL: URL
  public let releaseManifestURL: URL

  public init(bundleURL: URL) {
    self.bundleURL = bundleURL
    contentsURL = bundleURL.appendingPathComponent("Contents", isDirectory: true)
    resourcesURL = contentsURL.appendingPathComponent("Resources", isDirectory: true)
    nodeExecutableURL = contentsURL.appendingPathComponent("Helpers/node", isDirectory: false)
    applicationPayloadURL = resourcesURL.appendingPathComponent("app", isDirectory: true)
    serverEntryURL = applicationPayloadURL.appendingPathComponent(
      "server/index.js",
      isDirectory: false
    )
    webDistributionURL = applicationPayloadURL.appendingPathComponent(
      "web",
      isDirectory: true
    )
    releaseManifestURL = resourcesURL.appendingPathComponent(
      "release-manifest.json",
      isDirectory: false
    )
  }
}

public struct ReleaseManifest: Codable, Equatable, Sendable {
  public struct Resource: Codable, Equatable, Sendable {
    public let path: String
    public let bytes: Int64
    public let sha256: String

    public init(path: String, bytes: Int64, sha256: String) {
      self.path = path
      self.bytes = bytes
      self.sha256 = sha256
    }
  }

  public let schemaVersion: Int
  public let productVersion: String
  public let buildNumber: Int
  public let commitSha: String
  public let architecture: String
  public let minimumMacOS: String
  public let nodeVersion: String
  public let nodeAbi: Int
  public let resources: [Resource]

  public init(
    schemaVersion: Int,
    productVersion: String,
    buildNumber: Int,
    commitSha: String,
    architecture: String,
    minimumMacOS: String,
    nodeVersion: String,
    nodeAbi: Int,
    resources: [Resource]
  ) {
    self.schemaVersion = schemaVersion
    self.productVersion = productVersion
    self.buildNumber = buildNumber
    self.commitSha = commitSha
    self.architecture = architecture
    self.minimumMacOS = minimumMacOS
    self.nodeVersion = nodeVersion
    self.nodeAbi = nodeAbi
    self.resources = resources
  }

  public var buildID: String {
    "\(productVersion)+\(buildNumber).\(commitSha.prefix(12))"
  }
}

public enum ReleaseManifestError: LocalizedError, Equatable {
  case unreadable
  case tooLarge
  case invalidJSON
  case unsupportedSchema(Int)
  case productMismatch(String)
  case buildMismatch(Int)
  case architectureMismatch(String)
  case minimumSystemMismatch(String)
  case nodeVersionMismatch(String)
  case invalidCommitSHA
  case invalidNodeABI
  case invalidResource(String)
  case duplicateResource(String)
  case missingCriticalResource(String)
  case resourceSizeMismatch(String)
  case resourceHashMismatch(String)

  public var errorDescription: String? {
    switch self {
    case .unreadable:
      return "无法读取发布清单。"
    case .tooLarge:
      return "发布清单异常过大。"
    case .invalidJSON:
      return "发布清单不是有效 JSON。"
    case .unsupportedSchema(let value):
      return "不支持的发布清单版本：\(value)。"
    case .productMismatch(let value):
      return "应用版本与发布清单不一致：\(value)。"
    case .buildMismatch(let value):
      return "应用构建号与发布清单不一致：\(value)。"
    case .architectureMismatch(let value):
      return "应用架构不是受支持的 arm64：\(value)。"
    case .minimumSystemMismatch(let value):
      return "最低系统版本与应用不一致：\(value)。"
    case .nodeVersionMismatch(let value):
      return "内置 Node 版本与发布清单不一致：\(value)。"
    case .invalidCommitSHA:
      return "发布清单中的 Git 提交无效。"
    case .invalidNodeABI:
      return "发布清单中的 Node ABI 无效。"
    case .invalidResource(let path):
      return "发布清单包含不安全的资源路径：\(path)。"
    case .duplicateResource(let path):
      return "发布清单重复列出资源：\(path)。"
    case .missingCriticalResource(let path):
      return "关键运行资源缺失：\(path)。"
    case .resourceSizeMismatch(let path):
      return "关键运行资源大小校验失败：\(path)。"
    case .resourceHashMismatch(let path):
      return "关键运行资源完整性校验失败：\(path)。"
    }
  }
}

public enum ReleaseManifestLoader {
  private static let maximumManifestBytes = 4 * 1_024 * 1_024
  private static let sha256Pattern = try! NSRegularExpression(
    pattern: "^[a-f0-9]{64}$",
    options: []
  )
  private static let commitPattern = try! NSRegularExpression(
    pattern: "^[a-fA-F0-9]{40}$",
    options: []
  )

  public static func load(from url: URL) throws -> ReleaseManifest {
    guard let attributes = try? FileManager.default.attributesOfItem(atPath: url.path),
          let size = attributes[.size] as? NSNumber else {
      throw ReleaseManifestError.unreadable
    }
    guard size.intValue <= maximumManifestBytes else {
      throw ReleaseManifestError.tooLarge
    }
    guard let data = try? Data(contentsOf: url, options: [.mappedIfSafe]) else {
      throw ReleaseManifestError.unreadable
    }
    guard let manifest = try? JSONDecoder().decode(ReleaseManifest.self, from: data) else {
      throw ReleaseManifestError.invalidJSON
    }
    try validate(manifest)
    return manifest
  }

  public static func validate(_ manifest: ReleaseManifest) throws {
    guard manifest.schemaVersion == 1 else {
      throw ReleaseManifestError.unsupportedSchema(manifest.schemaVersion)
    }
    guard manifest.productVersion == SymTypeProduct.version else {
      throw ReleaseManifestError.productMismatch(manifest.productVersion)
    }
    guard manifest.buildNumber > 0 else {
      throw ReleaseManifestError.buildMismatch(manifest.buildNumber)
    }
    guard manifest.architecture == SymTypeProduct.architecture else {
      throw ReleaseManifestError.architectureMismatch(manifest.architecture)
    }
    guard manifest.minimumMacOS == SymTypeProduct.minimumMacOS else {
      throw ReleaseManifestError.minimumSystemMismatch(manifest.minimumMacOS)
    }
    guard manifest.nodeVersion == SymTypeProduct.nodeVersion else {
      throw ReleaseManifestError.nodeVersionMismatch(manifest.nodeVersion)
    }
    guard matches(commitPattern, value: manifest.commitSha) else {
      throw ReleaseManifestError.invalidCommitSHA
    }
    guard manifest.nodeAbi > 0 else {
      throw ReleaseManifestError.invalidNodeABI
    }

    var paths = Set<String>()
    for resource in manifest.resources {
      guard isSafeRelativePath(resource.path),
            resource.bytes >= 0,
            matches(sha256Pattern, value: resource.sha256) else {
        throw ReleaseManifestError.invalidResource(resource.path)
      }
      guard paths.insert(resource.path).inserted else {
        throw ReleaseManifestError.duplicateResource(resource.path)
      }
    }
  }

  public static func validateCriticalResources(
    manifest: ReleaseManifest,
    contentsURL: URL
  ) throws {
    let criticalPaths = [
      "Helpers/node",
      "Resources/app/server/index.js"
    ]
    let indexed = Dictionary(uniqueKeysWithValues: manifest.resources.map { ($0.path, $0) })
    let canonicalContents = contentsURL.resolvingSymlinksInPath()
    for path in criticalPaths {
      guard let resource = indexed[path] else {
        throw ReleaseManifestError.missingCriticalResource(path)
      }
      let url = contentsURL.appendingPathComponent(path, isDirectory: false)
      let canonicalURL = url.resolvingSymlinksInPath()
      guard let attributes = try? FileManager.default.attributesOfItem(atPath: url.path),
            let size = attributes[.size] as? NSNumber,
            attributes[.type] as? FileAttributeType == .typeRegular,
            canonicalURL.path.hasPrefix(canonicalContents.path + "/") else {
        throw ReleaseManifestError.missingCriticalResource(path)
      }
      guard size.int64Value == resource.bytes else {
        throw ReleaseManifestError.resourceSizeMismatch(path)
      }
      guard try sha256(of: url) == resource.sha256 else {
        throw ReleaseManifestError.resourceHashMismatch(path)
      }
    }
  }

  private static func matches(_ expression: NSRegularExpression, value: String) -> Bool {
    let range = NSRange(value.startIndex..<value.endIndex, in: value)
    return expression.firstMatch(in: value, options: [], range: range) != nil
  }

  private static func isSafeRelativePath(_ path: String) -> Bool {
    guard !path.isEmpty,
          !path.hasPrefix("/"),
          !path.contains("\\"),
          !path.contains("\0") else {
      return false
    }
    let components = path.split(separator: "/", omittingEmptySubsequences: false)
    return !components.contains(where: { $0.isEmpty || $0 == "." || $0 == ".." })
  }

  private static func sha256(of url: URL) throws -> String {
    let handle = try FileHandle(forReadingFrom: url)
    defer {
      try? handle.close()
    }
    var hasher = SHA256()
    while true {
      let data = try handle.read(upToCount: 1_024 * 1_024) ?? Data()
      if data.isEmpty {
        break
      }
      hasher.update(data: data)
    }
    return hasher.finalize().map { String(format: "%02x", $0) }.joined()
  }
}
