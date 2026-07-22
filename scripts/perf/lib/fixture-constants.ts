import { createHash } from "node:crypto";

export const FIXTURE_SEED = 20_250_722;
export const FIXED_UTC = "2025-01-15T12:00:00.000Z";
export const FIXED_PROFILE_ID = "local-profile";
export const FIXED_TIME_ZONE = "UTC";
export const EVENTS_PER_SESSION = 1_000;

export function deterministicUuid(scope: string, index: number): string {
  const bytes = createHash("sha256")
    .update(`${FIXTURE_SEED}:${scope}:${index}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function fixtureTimestamp(sessionIndex: number): string {
  const base = Date.parse(FIXED_UTC);
  return new Date(base + sessionIndex * 3_600_000).toISOString();
}
