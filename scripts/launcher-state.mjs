/**
 * Decide how the launcher should reconcile its lockfile-backed dependency tree.
 *
 * A Node ABI change can be repaired by rebuilding the one native dependency we
 * ship. Platform and architecture changes are different: npm may have selected
 * platform-specific optional packages throughout the tree, so they require a
 * fresh locked install.
 */
export function decideDependencyPlan({
  lockHash,
  state,
  nodeModulesPresent,
  missingDependencies,
  nodeAbi,
  runtimePlatform,
  runtimeArchitecture
}) {
  if (!nodeModulesPresent) {
    return { action: "install", reason: "首次运行（node_modules 不存在）" };
  }
  if (!state || typeof state.lockHash !== "string") {
    return { action: "install", reason: "首次由一键启动器验证依赖" };
  }
  if (state.lockHash !== lockHash) {
    return { action: "install", reason: "package-lock.json 已变化" };
  }
  if (missingDependencies.length > 0) {
    return {
      action: "install",
      reason: `依赖目录不完整：${missingDependencies.join("、")}`
    };
  }
  if (state.platform !== runtimePlatform || state.architecture !== runtimeArchitecture) {
    return {
      action: "install",
      reason: "操作系统或处理器架构已变化，需要重新安装锁定的平台依赖"
    };
  }
  if (state.nodeAbi !== nodeAbi) {
    return {
      action: "rebuild",
      reason: "Node ABI 已变化，需要重建本机 SQLite 模块"
    };
  }
  return { action: "none", reason: "lockfile 与已安装依赖一致" };
}
