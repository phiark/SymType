import type {
  RuntimeBootstrapData,
  RuntimeBackupRecord,
  RuntimeCustomTextRecord,
  RuntimeDashboard,
  RuntimeGameProgress,
  RuntimeAchievementRecord,
  RuntimeSessionSummary,
  RuntimeSettings,
  RuntimeTestRecord,
  RuntimeTraditionalProgress,
  RuntimeStoredEvent
} from "@symtype/shared";

export type AppSettings = RuntimeSettings;
export type BootstrapData = RuntimeBootstrapData;
export type GoalRecord = BootstrapData["goal"];
export type KeyboardLayoutRecord = BootstrapData["layouts"][number];
export type KeyboardMappingRecord = Partial<KeyboardLayoutRecord["mappings"][number]> &
  Record<string, unknown> & {
    code?: string;
    row?: string;
    width?: number;
  };
export type GameLevelDefinition = BootstrapData["gameLevels"][number];

export type StoredEvent = RuntimeStoredEvent & { featureChar: string };
export type SessionSummary = RuntimeSessionSummary;
export type DashboardData = RuntimeDashboard;
export type TraditionalProgress = RuntimeTraditionalProgress;
export type TestRecord = RuntimeTestRecord;
export type AchievementRecord = RuntimeAchievementRecord;
export type GameProgressData = RuntimeGameProgress;
export type CustomTextRecord = RuntimeCustomTextRecord;
export type BackupRecord = RuntimeBackupRecord & { filename?: string };
