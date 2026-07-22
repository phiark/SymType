import {
  STANDARD_LAYOUT,
  SYMMETRIC_LAYOUT,
  type Finger,
  type Hand,
  type KeyboardRow,
  type KeyDefinition
} from "@symtype/shared";

import type { BootstrapData, KeyboardMappingRecord } from "./types";

const hands = new Set<Hand>(["left", "right", "thumb"]);
const fingers = new Set<Finger>([
  "left-pinky",
  "left-ring",
  "left-middle",
  "left-index",
  "right-index",
  "right-middle",
  "right-ring",
  "right-pinky",
  "thumb"
]);
const rows = new Set<KeyboardRow>(["number", "top", "home", "bottom", "space"]);

function mappedCode(mapping: KeyboardMappingRecord): string | undefined {
  if (mapping.physical_code) return mapping.physical_code;
  return typeof mapping.code === "string" ? mapping.code : undefined;
}

/** Builds the browser guidance/event layout from the server-authoritative active layout. */
export function activeKeyboardLayout(bootstrap: BootstrapData): readonly KeyDefinition[] {
  const active =
    bootstrap.layouts.find((layout) => layout.id === bootstrap.settings.activeLayoutId) ??
    bootstrap.layouts.find((layout) => Boolean(layout.is_active));
  const base = active?.preset === "standard" ? STANDARD_LAYOUT : SYMMETRIC_LAYOUT;
  if (!active?.mappings.length) return base;
  const byCode = new Map(
    active.mappings.flatMap((mapping) => {
      const code = mappedCode(mapping);
      return code ? [[code, mapping] as const] : [];
    })
  );
  return base.map((key) => {
    const mapping = byCode.get(key.code);
    if (!mapping) return key;
    const hand = hands.has(mapping.hand as Hand) ? (mapping.hand as Hand) : key.hand;
    const finger = fingers.has(mapping.finger as Finger) ? (mapping.finger as Finger) : key.finger;
    const rowValue = mapping.keyboard_row ?? mapping.row;
    const row = rows.has(rowValue as KeyboardRow) ? (rowValue as KeyboardRow) : key.row;
    const zone = fingers.has(mapping.zone as Finger) ? (mapping.zone as Finger) : finger;
    const widthValue = mapping.key_width ?? mapping.width;
    return {
      ...key,
      unshifted: mapping.unshifted === undefined ? key.unshifted : mapping.unshifted,
      shifted: mapping.shifted === undefined ? key.shifted : mapping.shifted,
      hand,
      finger,
      row,
      zone,
      width: typeof widthValue === "number" && widthValue > 0 ? widthValue : key.width
    };
  });
}

const fingerScopes: Record<string, Finger> = {
  左小指: "left-pinky",
  左无名指: "left-ring",
  左中指: "left-middle",
  左食指: "left-index",
  右食指: "right-index",
  右中指: "right-middle",
  右无名指: "right-ring",
  右小指: "right-pinky"
};

function charactersForKey(key: KeyDefinition, shifted = true): string[] {
  return [key.unshifted, shifted ? key.shifted : null].filter((value): value is string =>
    Boolean(value && value.trim())
  );
}

type ScopeDimension = "finger" | "hand" | "character";

function scopeDimension(scope: string): ScopeDimension | null {
  if (scope === "左手" || scope === "右手") return "hand";
  if (scope === "食指区" || scope === "其他区" || fingerScopes[scope]) return "finger";
  if (["字母", "数字", "符号", "大小写"].includes(scope)) return "character";
  return null;
}

function charactersMatchingScope(scope: string, key: KeyDefinition): string[] {
  if (scope === "食指区") return key.finger.endsWith("index") ? charactersForKey(key) : [];
  if (scope === "其他区")
    return key.finger !== "thumb" && !key.finger.endsWith("index") ? charactersForKey(key) : [];
  if (scope === "左手" || scope === "右手")
    return key.hand === (scope === "左手" ? "left" : "right") ? charactersForKey(key) : [];
  if (scope === "字母") return key.category === "letter" ? charactersForKey(key, false) : [];
  if (scope === "数字") return key.category === "number" ? charactersForKey(key, false) : [];
  if (scope === "符号") {
    if (key.category === "number") return key.shifted ? [key.shifted] : [];
    return key.category === "symbol" ? charactersForKey(key) : [];
  }
  if (scope === "大小写") return key.category === "letter" ? charactersForKey(key) : [];
  const finger = fingerScopes[scope];
  return finger && key.finger === finger ? charactersForKey(key) : [];
}

/** Converts human-readable filters to explicit characters without inferring physical keys on the server. */
export function focusCharactersForScopes(
  scopes: readonly string[],
  layout: readonly KeyDefinition[]
): string[] {
  const byDimension = new Map<ScopeDimension, Set<string>>();
  for (const scope of scopes) {
    const dimension = scopeDimension(scope);
    if (!dimension) continue;
    const selected = byDimension.get(dimension) ?? new Set<string>();
    for (const key of layout) {
      for (const value of charactersMatchingScope(scope, key)) selected.add(value);
    }
    byDimension.set(dimension, selected);
  }
  const dimensions = [...byDimension.values()];
  if (!dimensions.length) return [];
  return [...(dimensions[0] ?? [])].filter((character) =>
    dimensions.slice(1).every((selected) => selected.has(character))
  );
}
