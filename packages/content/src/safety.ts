export interface ContentSafetyIssue {
  readonly ruleId:
    | "network-location"
    | "email-address"
    | "system-command"
    | "credential-shape"
    | "private-key-material";
  readonly path: string;
  readonly excerpt: string;
}

interface SafetyRule {
  readonly id: ContentSafetyIssue["ruleId"];
  readonly pattern: RegExp;
}

const SAFETY_RULES: readonly SafetyRule[] = [
  {
    id: "network-location",
    pattern:
      /(?:https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|net|org|io|dev|app|co|cn)\b|\b(?:\d{1,3}\.){3}\d{1,3}\b)/i
  },
  {
    id: "email-address",
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
  },
  {
    id: "system-command",
    pattern: /(?:^|\n)\s*(?:\$|>|PS>)\s+[A-Za-z][^\n]{2,}/m
  },
  {
    id: "credential-shape",
    pattern: /\b(?:api.?key|access.?token|secret|credential)\b\s*[:=]\s*["']?[A-Za-z0-9._~-]{16,}/i
  },
  {
    id: "private-key-material",
    pattern: /-{5}BEGIN\s+[A-Z ]{3,32}\s+KEY-{5}/
  }
];

function excerpt(value: string, matchIndex: number): string {
  const start = Math.max(0, matchIndex - 24);
  const end = Math.min(value.length, matchIndex + 48);
  return value.slice(start, end).replaceAll(/\s+/g, " ");
}

function inspectString(value: string, path: string, issues: ContentSafetyIssue[]): void {
  for (const rule of SAFETY_RULES) {
    const match = rule.pattern.exec(value);
    if (match !== null) {
      issues.push({
        ruleId: rule.id,
        path,
        excerpt: excerpt(value, match.index)
      });
    }
  }
}

function visit(
  value: unknown,
  path: string,
  issues: ContentSafetyIssue[],
  seen: Set<object>
): void {
  if (typeof value === "string") {
    inspectString(value, path, issues);
    return;
  }
  if (value === null || typeof value !== "object") {
    return;
  }
  if (seen.has(value)) {
    return;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => visit(entry, `${path}[${index}]`, issues, seen));
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    visit(entry, path.length === 0 ? key : `${path}.${key}`, issues, seen);
  }
}

/**
 * Checks shipped or imported content for network locations, executable system
 * commands, and recognizable secret material. It is deliberately conservative;
 * callers should show issues rather than silently dropping user data.
 */
export function validateContentSafety(value: unknown): readonly ContentSafetyIssue[] {
  const issues: ContentSafetyIssue[] = [];
  visit(value, "content", issues, new Set());
  return issues;
}

export function assertContentSafety(value: unknown): void {
  const issues = validateContentSafety(value);
  if (issues.length > 0) {
    const first = issues[0];
    throw new Error(
      `Unsafe training content matched ${first?.ruleId ?? "an unknown rule"} at ${first?.path ?? "an unknown path"}.`
    );
  }
}
