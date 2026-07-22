export type DependencyAction = "install" | "rebuild" | "none";

export interface LauncherInstallState {
  lockHash?: unknown;
  nodeAbi?: unknown;
  platform?: unknown;
  architecture?: unknown;
}

export interface DependencyPlanInput {
  lockHash: string;
  state: LauncherInstallState | null;
  nodeModulesPresent: boolean;
  missingDependencies: string[];
  nodeAbi: string;
  runtimePlatform: string;
  runtimeArchitecture: string;
}

export interface DependencyPlan {
  action: DependencyAction;
  reason: string;
}

export function decideDependencyPlan(input: DependencyPlanInput): DependencyPlan;
