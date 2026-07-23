import {
  assessShiftUse,
  classifyBehavioralIssues,
  classifyTextErrors,
  netWpm as calculateNetWpm,
  persistedModifiersSchema,
  rawWpm as calculateRawWpm,
  type BehavioralIssueKind,
  type Finger,
  type Hand,
  type KeyboardPreset,
  type KeyboardRow,
  type ShiftCode,
  type TextErrorKind,
  type TypingSignalEvent
} from "@symtype/shared";

import { median } from "./statistics-analysis.js";

export interface ErrorAnalysisEvidence {
  status: "insufficient" | "limited" | "sufficient";
  sampleCount: number;
  minimumSamples: number;
}

export interface ErrorAnalysisIssue {
  kind: TextErrorKind | BehavioralIssueKind;
  count: number;
  topFeatures: { feature: string; count: number; severity: number }[];
}

export interface ErrorAnalysisSummary {
  version: 1;
  eventCount: number;
  validTimingSamples: number;
  baselineIkiMs: number | null;
  evidence: {
    text: ErrorAnalysisEvidence;
    timing: ErrorAnalysisEvidence;
    combinations: ErrorAnalysisEvidence;
    balance: ErrorAnalysisEvidence;
    shift: ErrorAnalysisEvidence;
    fatigue: ErrorAnalysisEvidence;
  };
  textIssues: ErrorAnalysisIssue[];
  behavioralIssues: ErrorAnalysisIssue[];
}

export interface SessionSummary {
  characters: number;
  correct: number;
  errors: number;
  rawWpm: number;
  netWpm: number;
  keystrokeAccuracy: number;
  finalTextAccuracy: number;
  accuracy: number;
  consistency: number;
  activeMs: number;
  longestAccurateStreak: number;
  feedback: { good: string; bottleneck: string; next: string };
  errorAnalysis: ErrorAnalysisSummary;
}

export interface SessionCorrectionCheckpoint {
  blockId: string;
  position: number;
}

export interface FinalTextSummary {
  characters: number;
  correct: number;
  uncorrectedErrors: number;
}

export interface SummaryEventRow {
  session_id?: string;
  sequence: number;
  is_correct: number;
  iki_ms: number | null;
  was_long_pause: number;
  was_refocus: number;
  was_throttled: number;
  was_repeat: number;
  target_char: string;
  actual_char: string;
  block_id: string | null;
  text_position: number;
  is_correction: number;
  backspace_count: number;
  shift_side: "left" | "right" | "both" | "none";
  modifiers_json: string;
  mapped_hand: string;
  mapped_finger: string;
  keyboard_row: string;
  was_paused: number;
}

export function evidence(sampleCount: number, minimumSamples: number): ErrorAnalysisEvidence {
  return {
    status:
      sampleCount < minimumSamples
        ? "insufficient"
        : sampleCount < minimumSamples * 2
          ? "limited"
          : "sufficient",
    sampleCount,
    minimumSamples
  };
}

export function unavailableErrorAnalysis(eventCount: number): ErrorAnalysisSummary {
  return {
    version: 1,
    eventCount,
    validTimingSamples: 0,
    baselineIkiMs: null,
    evidence: {
      text: evidence(0, 1),
      timing: evidence(0, 5),
      combinations: evidence(0, 8),
      balance: evidence(0, 10),
      shift: evidence(0, 1),
      fatigue: evidence(0, 18)
    },
    textIssues: [],
    behavioralIssues: []
  };
}

export function aggregateIssues(
  issues: readonly {
    kind: TextErrorKind | BehavioralIssueKind;
    feature: string;
    severity: number;
  }[]
): ErrorAnalysisIssue[] {
  const grouped = new Map<
    TextErrorKind | BehavioralIssueKind,
    { count: number; features: Map<string, { count: number; severity: number }> }
  >();
  for (const issue of issues) {
    const group = grouped.get(issue.kind) ?? {
      count: 0,
      features: new Map<string, { count: number; severity: number }>()
    };
    group.count += 1;
    const feature = group.features.get(issue.feature) ?? { count: 0, severity: 0 };
    feature.count += 1;
    feature.severity = Math.max(feature.severity, issue.severity);
    group.features.set(issue.feature, feature);
    grouped.set(issue.kind, group);
  }
  return [...grouped.entries()]
    .map(([kind, value]) => ({
      kind,
      count: value.count,
      topFeatures: [...value.features.entries()]
        .map(([feature, detail]) => ({ feature, ...detail }))
        .sort((left, right) => right.count - left.count || right.severity - left.severity)
        .slice(0, 5)
    }))
    .sort((left, right) => right.count - left.count || left.kind.localeCompare(right.kind));
}

export function mergeIssueSummaries(
  reports: readonly ErrorAnalysisIssue[][]
): ErrorAnalysisIssue[] {
  const grouped = new Map<
    TextErrorKind | BehavioralIssueKind,
    { count: number; features: Map<string, { count: number; severity: number }> }
  >();
  for (const report of reports) {
    for (const issue of report) {
      const group = grouped.get(issue.kind) ?? {
        count: 0,
        features: new Map<string, { count: number; severity: number }>()
      };
      group.count += issue.count;
      for (const top of issue.topFeatures) {
        const feature = group.features.get(top.feature) ?? { count: 0, severity: 0 };
        feature.count += top.count;
        feature.severity = Math.max(feature.severity, top.severity);
        group.features.set(top.feature, feature);
      }
      grouped.set(issue.kind, group);
    }
  }
  return [...grouped.entries()]
    .map(([kind, group]) => ({
      kind,
      count: group.count,
      topFeatures: [...group.features.entries()]
        .map(([feature, detail]) => ({ feature, ...detail }))
        .sort((left, right) => right.count - left.count || right.severity - left.severity)
        .slice(0, 5)
    }))
    .sort((left, right) => right.count - left.count || left.kind.localeCompare(right.kind));
}

export function mergeErrorAnalysis(reports: readonly ErrorAnalysisSummary[]): ErrorAnalysisSummary {
  if (reports.length === 0) return unavailableErrorAnalysis(0);
  const eventCount = reports.reduce((sum, report) => sum + report.eventCount, 0);
  const validTimingSamples = reports.reduce((sum, report) => sum + report.validTimingSamples, 0);
  const baselineWeight = reports.reduce(
    (sum, report) => sum + (report.baselineIkiMs == null ? 0 : report.validTimingSamples),
    0
  );
  const baselineIkiMs = baselineWeight
    ? reports.reduce(
        (sum, report) => sum + (report.baselineIkiMs ?? 0) * report.validTimingSamples,
        0
      ) / baselineWeight
    : null;
  const sampleTotal = (key: keyof ErrorAnalysisSummary["evidence"]) =>
    reports.reduce((sum, report) => sum + report.evidence[key].sampleCount, 0);
  return {
    version: 1,
    eventCount,
    validTimingSamples,
    baselineIkiMs: baselineIkiMs == null ? null : Number(baselineIkiMs.toFixed(1)),
    evidence: {
      text: evidence(sampleTotal("text"), 1),
      timing: evidence(sampleTotal("timing"), 5),
      combinations: evidence(sampleTotal("combinations"), 8),
      balance: evidence(sampleTotal("balance"), 10),
      shift: evidence(sampleTotal("shift"), 1),
      fatigue: evidence(sampleTotal("fatigue"), 18)
    },
    textIssues: mergeIssueSummaries(reports.map((report) => report.textIssues)),
    behavioralIssues: mergeIssueSummaries(reports.map((report) => report.behavioralIssues))
  };
}

export function isErrorAnalysisSummary(value: unknown): value is ErrorAnalysisSummary {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { version?: unknown }).version === 1 &&
    typeof (value as { eventCount?: unknown }).eventCount === "number" &&
    Array.isArray((value as { textIssues?: unknown }).textIssues) &&
    Array.isArray((value as { behavioralIssues?: unknown }).behavioralIssues)
  );
}

export function summarizeFinalText(
  rows: readonly SummaryEventRow[],
  correctionCheckpoint?: SessionCorrectionCheckpoint
): FinalTextSummary {
  const finalByScope = new Map<string, Map<number, { target_char: string; actual_char: string }>>();
  for (const row of rows) {
    const scope = row.block_id ?? "session";
    const positions =
      finalByScope.get(scope) ?? new Map<number, { target_char: string; actual_char: string }>();
    if (row.is_correction || row.backspace_count > 0) {
      for (const position of positions.keys()) {
        if (position >= row.text_position) positions.delete(position);
      }
    }
    positions.set(row.text_position, row);
    finalByScope.set(scope, positions);
  }
  if (correctionCheckpoint) {
    const positions = finalByScope.get(correctionCheckpoint.blockId);
    if (positions) {
      for (const position of positions.keys()) {
        if (position >= correctionCheckpoint.position) positions.delete(position);
      }
    }
  }
  const finalPositions = [...finalByScope.values()].flatMap((positions) => [...positions.values()]);
  const correct = finalPositions.filter((row) => row.actual_char === row.target_char).length;
  return {
    characters: finalPositions.length,
    correct,
    uncorrectedErrors: finalPositions.length - correct
  };
}

export function classifyAlignedText(
  target: string,
  actual: string,
  preset: KeyboardPreset
): ReturnType<typeof classifyTextErrors> {
  if (target === actual) return [];
  const longest = Math.max(target.length, actual.length);
  if (longest <= 320) return classifyTextErrors(target, actual, preset);
  const issues: ReturnType<typeof classifyTextErrors> = [];
  for (let start = 0; start < longest; start += 240) {
    issues.push(
      ...classifyTextErrors(
        target.slice(start, start + 240),
        actual.slice(start, start + 240),
        preset
      )
    );
  }
  return issues;
}

function isMappedHand(value: string): value is Hand {
  return value === "left" || value === "right" || value === "thumb";
}

function isMappedFinger(value: string): value is Finger {
  return [
    "left-pinky",
    "left-ring",
    "left-middle",
    "left-index",
    "right-index",
    "right-middle",
    "right-ring",
    "right-pinky",
    "thumb"
  ].includes(value);
}

function isKeyboardRow(value: string): value is KeyboardRow {
  return ["number", "top", "home", "bottom", "space"].includes(value);
}

function activeShiftCodes(side: SummaryEventRow["shift_side"]): ShiftCode[] {
  if (side === "left") return ["ShiftLeft"];
  if (side === "right") return ["ShiftRight"];
  if (side === "both") return ["ShiftLeft", "ShiftRight"];
  return [];
}

function parseModifiers(value: string): Record<string, boolean> {
  let candidate: unknown;
  try {
    candidate = JSON.parse(value) as unknown;
  } catch {
    throw new Error(
      "Authoritative keystroke modifiers JSON is corrupted; restore a verified backup before continuing"
    );
  }
  const parsed = persistedModifiersSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new Error(
      "Authoritative keystroke modifiers JSON does not match its schema; restore a verified backup before continuing"
    );
  }
  return parsed.data;
}

export function analyzeSessionErrors(input: {
  rows: readonly SummaryEventRow[];
  blockTargets: ReadonlyMap<string, string>;
  preset: KeyboardPreset;
  targetWpm: number;
}): ErrorAnalysisSummary {
  const { rows, blockTargets, preset, targetWpm } = input;
  const groupedRows = new Map<string, SummaryEventRow[]>();
  for (const row of rows) {
    const key = row.block_id ?? "session";
    const group = groupedRows.get(key) ?? [];
    group.push(row);
    groupedRows.set(key, group);
  }

  const textEvidence: { kind: TextErrorKind; feature: string; severity: number }[] = [];
  for (const [groupId, group] of groupedRows) {
    const targetByPosition = new Map<number, string>();
    const actualByPosition = new Map<number, SummaryEventRow>();
    const supersededErrors: SummaryEventRow[] = [];
    for (const row of group) {
      targetByPosition.set(row.text_position, row.target_char);
      if (row.is_correction || row.backspace_count > 0) {
        for (const [position, previous] of actualByPosition) {
          if (position >= row.text_position) {
            if (previous.is_correct === 0) supersededErrors.push(previous);
            actualByPosition.delete(position);
          }
        }
      }
      const previous = actualByPosition.get(row.text_position);
      if (previous?.is_correct === 0) supersededErrors.push(previous);
      actualByPosition.set(row.text_position, row);
    }
    let highestPosition = -1;
    for (const position of targetByPosition.keys())
      highestPosition = Math.max(highestPosition, position);
    for (const position of actualByPosition.keys())
      highestPosition = Math.max(highestPosition, position);
    if (highestPosition < 0) continue;
    const storedTarget = blockTargets.get(groupId);
    const target = storedTarget
      ? storedTarget.slice(0, highestPosition + 1)
      : Array.from(
          { length: highestPosition + 1 },
          (_, index) => targetByPosition.get(index) ?? ""
        ).join("");
    const actual = Array.from(
      { length: highestPosition + 1 },
      (_, index) => actualByPosition.get(index)?.actual_char ?? ""
    ).join("");
    for (const issue of classifyAlignedText(target, actual, preset)) {
      textEvidence.push({
        kind: issue.kind,
        feature: `${issue.actual || "∅"}→${issue.target || "∅"}`,
        severity: 1
      });
    }
    for (const row of supersededErrors) {
      for (const issue of classifyAlignedText(row.target_char, row.actual_char, preset)) {
        textEvidence.push({
          kind: issue.kind,
          feature: `${issue.actual || "∅"}→${issue.target || "∅"}`,
          severity: 1
        });
      }
    }
  }

  const validTimingRows = rows.filter(
    (row) =>
      row.is_correct === 1 &&
      row.iki_ms != null &&
      row.iki_ms >= 25 &&
      row.iki_ms <= 3000 &&
      row.was_long_pause === 0 &&
      row.was_refocus === 0 &&
      row.was_paused === 0 &&
      row.was_throttled === 0 &&
      row.was_repeat === 0
  );
  const validIkis = validTimingRows.map((row) => row.iki_ms as number);
  const measuredBaseline = median(validIkis);
  const baselineIkiMs = measuredBaseline ?? 60_000 / (Math.max(5, targetWpm) * 5);
  const signalEvents: TypingSignalEvent[] = rows.map((row) => {
    const modifiers = parseModifiers(row.modifiers_json);
    return {
      target: row.target_char,
      actual: row.actual_char,
      correct: row.is_correct === 1,
      ikiMs: row.iki_ms,
      ...(isMappedHand(row.mapped_hand) ? { mappedHand: row.mapped_hand } : {}),
      ...(isMappedFinger(row.mapped_finger) ? { mappedFinger: row.mapped_finger } : {}),
      ...(isKeyboardRow(row.keyboard_row) ? { keyboardRow: row.keyboard_row } : {}),
      shiftAssessment: assessShiftUse(
        preset,
        row.target_char,
        activeShiftCodes(row.shift_side),
        modifiers.capsLock === true
      ),
      excludedFromSpeed:
        row.was_long_pause === 1 ||
        row.was_refocus === 1 ||
        row.was_paused === 1 ||
        row.was_throttled === 1 ||
        row.was_repeat === 1
    };
  });
  const rawBehavioralIssues = classifyBehavioralIssues(signalEvents, {
    baselineIkiMs,
    minimumGroupSamples: 5,
    fatigueWindow: 18,
    preset
  });
  const mappedTimingSamples = validTimingRows.filter(
    (row) => isMappedHand(row.mapped_hand) && isMappedFinger(row.mapped_finger)
  ).length;
  const behavioralEvidence = rawBehavioralIssues
    .filter((issue) => {
      if (issue.kind === "shift-use-error" || issue.kind === "error-burst") return true;
      if (
        issue.kind === "slow-bigram" ||
        issue.kind === "slow-trigram" ||
        issue.kind === "same-finger-cross-row"
      ) {
        return validTimingRows.length >= 8;
      }
      if (issue.kind === "hand-imbalance" || issue.kind === "finger-imbalance") {
        return mappedTimingSamples >= 10;
      }
      return validTimingRows.length >= 5;
    })
    .map((issue) => ({
      kind: issue.kind,
      feature: issue.feature,
      severity: issue.severity
    }));
  const shiftedTargets = signalEvents.filter(
    (event) => event.shiftAssessment !== "not-required" && event.shiftAssessment !== "not-mappable"
  ).length;
  return {
    version: 1,
    eventCount: rows.length,
    validTimingSamples: validTimingRows.length,
    baselineIkiMs:
      measuredBaseline == null || validTimingRows.length < 5
        ? null
        : Number(measuredBaseline.toFixed(1)),
    evidence: {
      text: evidence(rows.length, 1),
      timing: evidence(validTimingRows.length, 5),
      combinations: evidence(validTimingRows.length, 8),
      balance: evidence(mappedTimingSamples, 10),
      shift: evidence(shiftedTargets, 1),
      fatigue: evidence(rows.length, 18)
    },
    textIssues: aggregateIssues(textEvidence),
    behavioralIssues: aggregateIssues(behavioralEvidence)
  };
}

export function calculateSessionSummary(
  rows: readonly SummaryEventRow[],
  givenActiveMs?: number,
  errorAnalysis: ErrorAnalysisSummary = unavailableErrorAnalysis(rows.length),
  correctionCheckpoint?: SessionCorrectionCheckpoint
): SessionSummary {
  const characters = rows.length;
  const correct = rows.filter((row) => row.is_correct === 1).length;
  const errors = characters - correct;
  const eligible = rows
    .filter(
      (row) =>
        row.is_correct === 1 &&
        row.iki_ms != null &&
        row.iki_ms > 25 &&
        row.iki_ms <= 3000 &&
        !row.was_long_pause &&
        !row.was_refocus &&
        !row.was_throttled &&
        !row.was_repeat
    )
    .map((row) => row.iki_ms as number);
  const measuredMs = eligible.reduce((sum, value) => sum + value, 0);
  const activeMs = Math.max(1000, Math.round(givenActiveMs ?? measuredMs));
  const accuracy = characters === 0 ? 0 : correct / characters;
  const finalText = summarizeFinalText(rows, correctionCheckpoint);
  const rawWpm = calculateRawWpm(characters, activeMs);
  const netWpm = calculateNetWpm(characters, finalText.uncorrectedErrors, activeMs);
  const finalTextAccuracy =
    finalText.characters === 0 ? 0 : finalText.correct / finalText.characters;
  const mean = eligible.length
    ? eligible.reduce((sum, value) => sum + value, 0) / eligible.length
    : 0;
  const deviation = eligible.length
    ? Math.sqrt(eligible.reduce((sum, value) => sum + (value - mean) ** 2, 0) / eligible.length)
    : 0;
  const consistency = mean ? Math.max(0, 1 - deviation / mean) : 0;
  let streak = 0;
  let longestAccurateStreak = 0;
  for (const row of rows) {
    streak = row.is_correct ? streak + 1 : 0;
    longestAccurateStreak = Math.max(longestAccurateStreak, streak);
  }
  const accuracyPercent = Math.round(accuracy * 100);
  return {
    characters,
    correct,
    errors,
    rawWpm: Number(rawWpm.toFixed(1)),
    netWpm: Number(netWpm.toFixed(1)),
    keystrokeAccuracy: Number(accuracy.toFixed(4)),
    finalTextAccuracy: Number(finalTextAccuracy.toFixed(4)),
    accuracy: Number(accuracy.toFixed(4)),
    consistency: Number(consistency.toFixed(4)),
    activeMs,
    longestAccurateStreak,
    errorAnalysis,
    feedback: {
      good:
        accuracy >= 0.975
          ? `准确率 ${accuracyPercent}%，动作控制稳定。`
          : `完成了 ${characters} 个有证据的练习字符。`,
      bottleneck:
        errors > 0
          ? `${errors} 次错误拖低了净速度；下一轮先守住准确率。`
          : eligible.length < 12
            ? "有效节奏样本仍少，稳定速度暂不下结论。"
            : "主要机会是保持节奏时逐步提速。",
      next:
        accuracy < 0.94
          ? "安排更短的 blocked micro-block，并降低目标速度。"
          : "隔开一个流畅组后，在自然文本中复测本轮映射区域。"
    }
  };
}
