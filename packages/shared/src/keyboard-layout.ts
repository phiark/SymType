/**
 * ANSI US describes characters on keys. A preset describes the finger zone
 * assigned to each physical key. Browser events cannot prove which real finger
 * was used; all hand/finger reporting is therefore inferred from this mapping.
 */

export type Hand = "left" | "right" | "thumb";

export type Finger =
  | "left-pinky"
  | "left-ring"
  | "left-middle"
  | "left-index"
  | "right-index"
  | "right-middle"
  | "right-ring"
  | "right-pinky"
  | "thumb";

export type KeyboardRow = "number" | "top" | "home" | "bottom" | "space";

export type KeyZone = Finger;

export type KeyCategory = "letter" | "number" | "symbol" | "whitespace" | "modifier" | "editing";

export interface PhysicalKeyDefinition {
  readonly code: string;
  readonly unshifted: string | null;
  readonly shifted: string | null;
  readonly hand: Hand;
  readonly finger: Finger;
  readonly row: KeyboardRow;
  readonly zone: KeyZone;
  /** Width in conventional keyboard key units. */
  readonly width: number;
  /** Horizontal center in key units, used only for adjacency and rendering. */
  readonly column: number;
  readonly category: KeyCategory;
}

export type KeyDefinition = PhysicalKeyDefinition;

export interface KeyboardPreset {
  readonly id: string;
  readonly name: string;
  readonly basedOn: "symmetric" | "standard";
  readonly keys: readonly PhysicalKeyDefinition[];
}

const symmetricKeys = [
  {
    code: "Backquote",
    unshifted: "`",
    shifted: "~",
    hand: "left",
    finger: "left-pinky",
    row: "number",
    zone: "left-pinky",
    width: 1,
    column: 0,
    category: "symbol"
  },
  {
    code: "Digit1",
    unshifted: "1",
    shifted: "!",
    hand: "left",
    finger: "left-pinky",
    row: "number",
    zone: "left-pinky",
    width: 1,
    column: 1,
    category: "number"
  },
  {
    code: "Digit2",
    unshifted: "2",
    shifted: "@",
    hand: "left",
    finger: "left-ring",
    row: "number",
    zone: "left-ring",
    width: 1,
    column: 2,
    category: "number"
  },
  {
    code: "Digit3",
    unshifted: "3",
    shifted: "#",
    hand: "left",
    finger: "left-middle",
    row: "number",
    zone: "left-middle",
    width: 1,
    column: 3,
    category: "number"
  },
  {
    code: "Digit4",
    unshifted: "4",
    shifted: "$",
    hand: "left",
    finger: "left-index",
    row: "number",
    zone: "left-index",
    width: 1,
    column: 4,
    category: "number"
  },
  {
    code: "Digit5",
    unshifted: "5",
    shifted: "%",
    hand: "left",
    finger: "left-index",
    row: "number",
    zone: "left-index",
    width: 1,
    column: 5,
    category: "number"
  },
  {
    code: "Digit6",
    unshifted: "6",
    shifted: "^",
    hand: "right",
    finger: "right-index",
    row: "number",
    zone: "right-index",
    width: 1,
    column: 6,
    category: "number"
  },
  {
    code: "Digit7",
    unshifted: "7",
    shifted: "&",
    hand: "right",
    finger: "right-index",
    row: "number",
    zone: "right-index",
    width: 1,
    column: 7,
    category: "number"
  },
  {
    code: "Digit8",
    unshifted: "8",
    shifted: "*",
    hand: "right",
    finger: "right-middle",
    row: "number",
    zone: "right-middle",
    width: 1,
    column: 8,
    category: "number"
  },
  {
    code: "Digit9",
    unshifted: "9",
    shifted: "(",
    hand: "right",
    finger: "right-ring",
    row: "number",
    zone: "right-ring",
    width: 1,
    column: 9,
    category: "number"
  },
  {
    code: "Digit0",
    unshifted: "0",
    shifted: ")",
    hand: "right",
    finger: "right-pinky",
    row: "number",
    zone: "right-pinky",
    width: 1,
    column: 10,
    category: "number"
  },
  {
    code: "Minus",
    unshifted: "-",
    shifted: "_",
    hand: "right",
    finger: "right-pinky",
    row: "number",
    zone: "right-pinky",
    width: 1,
    column: 11,
    category: "symbol"
  },
  {
    code: "Equal",
    unshifted: "=",
    shifted: "+",
    hand: "right",
    finger: "right-pinky",
    row: "number",
    zone: "right-pinky",
    width: 1,
    column: 12,
    category: "symbol"
  },
  {
    code: "Backspace",
    unshifted: null,
    shifted: null,
    hand: "right",
    finger: "right-pinky",
    row: "number",
    zone: "right-pinky",
    width: 2,
    column: 13.5,
    category: "editing"
  },

  {
    code: "Tab",
    unshifted: null,
    shifted: null,
    hand: "left",
    finger: "left-pinky",
    row: "top",
    zone: "left-pinky",
    width: 1.5,
    column: 0.25,
    category: "editing"
  },
  {
    code: "KeyQ",
    unshifted: "q",
    shifted: "Q",
    hand: "left",
    finger: "left-pinky",
    row: "top",
    zone: "left-pinky",
    width: 1,
    column: 1.5,
    category: "letter"
  },
  {
    code: "KeyW",
    unshifted: "w",
    shifted: "W",
    hand: "left",
    finger: "left-ring",
    row: "top",
    zone: "left-ring",
    width: 1,
    column: 2.5,
    category: "letter"
  },
  {
    code: "KeyE",
    unshifted: "e",
    shifted: "E",
    hand: "left",
    finger: "left-middle",
    row: "top",
    zone: "left-middle",
    width: 1,
    column: 3.5,
    category: "letter"
  },
  {
    code: "KeyR",
    unshifted: "r",
    shifted: "R",
    hand: "left",
    finger: "left-index",
    row: "top",
    zone: "left-index",
    width: 1,
    column: 4.5,
    category: "letter"
  },
  {
    code: "KeyT",
    unshifted: "t",
    shifted: "T",
    hand: "left",
    finger: "left-index",
    row: "top",
    zone: "left-index",
    width: 1,
    column: 5.5,
    category: "letter"
  },
  {
    code: "KeyY",
    unshifted: "y",
    shifted: "Y",
    hand: "right",
    finger: "right-index",
    row: "top",
    zone: "right-index",
    width: 1,
    column: 6.5,
    category: "letter"
  },
  {
    code: "KeyU",
    unshifted: "u",
    shifted: "U",
    hand: "right",
    finger: "right-index",
    row: "top",
    zone: "right-index",
    width: 1,
    column: 7.5,
    category: "letter"
  },
  {
    code: "KeyI",
    unshifted: "i",
    shifted: "I",
    hand: "right",
    finger: "right-middle",
    row: "top",
    zone: "right-middle",
    width: 1,
    column: 8.5,
    category: "letter"
  },
  {
    code: "KeyO",
    unshifted: "o",
    shifted: "O",
    hand: "right",
    finger: "right-ring",
    row: "top",
    zone: "right-ring",
    width: 1,
    column: 9.5,
    category: "letter"
  },
  {
    code: "KeyP",
    unshifted: "p",
    shifted: "P",
    hand: "right",
    finger: "right-pinky",
    row: "top",
    zone: "right-pinky",
    width: 1,
    column: 10.5,
    category: "letter"
  },
  {
    code: "BracketLeft",
    unshifted: "[",
    shifted: "{",
    hand: "right",
    finger: "right-pinky",
    row: "top",
    zone: "right-pinky",
    width: 1,
    column: 11.5,
    category: "symbol"
  },
  {
    code: "BracketRight",
    unshifted: "]",
    shifted: "}",
    hand: "right",
    finger: "right-pinky",
    row: "top",
    zone: "right-pinky",
    width: 1,
    column: 12.5,
    category: "symbol"
  },
  {
    code: "Backslash",
    unshifted: "\\",
    shifted: "|",
    hand: "right",
    finger: "right-pinky",
    row: "top",
    zone: "right-pinky",
    width: 1.5,
    column: 13.75,
    category: "symbol"
  },

  {
    code: "CapsLock",
    unshifted: null,
    shifted: null,
    hand: "left",
    finger: "left-pinky",
    row: "home",
    zone: "left-pinky",
    width: 1.75,
    column: 0.375,
    category: "modifier"
  },
  {
    code: "KeyA",
    unshifted: "a",
    shifted: "A",
    hand: "left",
    finger: "left-pinky",
    row: "home",
    zone: "left-pinky",
    width: 1,
    column: 1.75,
    category: "letter"
  },
  {
    code: "KeyS",
    unshifted: "s",
    shifted: "S",
    hand: "left",
    finger: "left-ring",
    row: "home",
    zone: "left-ring",
    width: 1,
    column: 2.75,
    category: "letter"
  },
  {
    code: "KeyD",
    unshifted: "d",
    shifted: "D",
    hand: "left",
    finger: "left-middle",
    row: "home",
    zone: "left-middle",
    width: 1,
    column: 3.75,
    category: "letter"
  },
  {
    code: "KeyF",
    unshifted: "f",
    shifted: "F",
    hand: "left",
    finger: "left-index",
    row: "home",
    zone: "left-index",
    width: 1,
    column: 4.75,
    category: "letter"
  },
  {
    code: "KeyG",
    unshifted: "g",
    shifted: "G",
    hand: "left",
    finger: "left-index",
    row: "home",
    zone: "left-index",
    width: 1,
    column: 5.75,
    category: "letter"
  },
  {
    code: "KeyH",
    unshifted: "h",
    shifted: "H",
    hand: "right",
    finger: "right-index",
    row: "home",
    zone: "right-index",
    width: 1,
    column: 6.75,
    category: "letter"
  },
  {
    code: "KeyJ",
    unshifted: "j",
    shifted: "J",
    hand: "right",
    finger: "right-index",
    row: "home",
    zone: "right-index",
    width: 1,
    column: 7.75,
    category: "letter"
  },
  {
    code: "KeyK",
    unshifted: "k",
    shifted: "K",
    hand: "right",
    finger: "right-middle",
    row: "home",
    zone: "right-middle",
    width: 1,
    column: 8.75,
    category: "letter"
  },
  {
    code: "KeyL",
    unshifted: "l",
    shifted: "L",
    hand: "right",
    finger: "right-ring",
    row: "home",
    zone: "right-ring",
    width: 1,
    column: 9.75,
    category: "letter"
  },
  {
    code: "Semicolon",
    unshifted: ";",
    shifted: ":",
    hand: "right",
    finger: "right-pinky",
    row: "home",
    zone: "right-pinky",
    width: 1,
    column: 10.75,
    category: "symbol"
  },
  {
    code: "Quote",
    unshifted: "'",
    shifted: '"',
    hand: "right",
    finger: "right-pinky",
    row: "home",
    zone: "right-pinky",
    width: 1,
    column: 11.75,
    category: "symbol"
  },
  {
    code: "Enter",
    unshifted: null,
    shifted: null,
    hand: "right",
    finger: "right-pinky",
    row: "home",
    zone: "right-pinky",
    width: 2.25,
    column: 13.375,
    category: "editing"
  },

  {
    code: "ShiftLeft",
    unshifted: null,
    shifted: null,
    hand: "left",
    finger: "left-pinky",
    row: "bottom",
    zone: "left-pinky",
    width: 2.25,
    column: 0.625,
    category: "modifier"
  },
  {
    code: "KeyZ",
    unshifted: "z",
    shifted: "Z",
    hand: "left",
    finger: "left-ring",
    row: "bottom",
    zone: "left-ring",
    width: 1,
    column: 2.25,
    category: "letter"
  },
  {
    code: "KeyX",
    unshifted: "x",
    shifted: "X",
    hand: "left",
    finger: "left-middle",
    row: "bottom",
    zone: "left-middle",
    width: 1,
    column: 3.25,
    category: "letter"
  },
  {
    code: "KeyC",
    unshifted: "c",
    shifted: "C",
    hand: "left",
    finger: "left-index",
    row: "bottom",
    zone: "left-index",
    width: 1,
    column: 4.25,
    category: "letter"
  },
  {
    code: "KeyV",
    unshifted: "v",
    shifted: "V",
    hand: "left",
    finger: "left-index",
    row: "bottom",
    zone: "left-index",
    width: 1,
    column: 5.25,
    category: "letter"
  },
  {
    code: "KeyB",
    unshifted: "b",
    shifted: "B",
    hand: "left",
    finger: "left-index",
    row: "bottom",
    zone: "left-index",
    width: 1,
    column: 6.25,
    category: "letter"
  },
  {
    code: "KeyN",
    unshifted: "n",
    shifted: "N",
    hand: "right",
    finger: "right-index",
    row: "bottom",
    zone: "right-index",
    width: 1,
    column: 7.25,
    category: "letter"
  },
  {
    code: "KeyM",
    unshifted: "m",
    shifted: "M",
    hand: "right",
    finger: "right-index",
    row: "bottom",
    zone: "right-index",
    width: 1,
    column: 8.25,
    category: "letter"
  },
  {
    code: "Comma",
    unshifted: ",",
    shifted: "<",
    hand: "right",
    finger: "right-middle",
    row: "bottom",
    zone: "right-middle",
    width: 1,
    column: 9.25,
    category: "symbol"
  },
  {
    code: "Period",
    unshifted: ".",
    shifted: ">",
    hand: "right",
    finger: "right-ring",
    row: "bottom",
    zone: "right-ring",
    width: 1,
    column: 10.25,
    category: "symbol"
  },
  {
    code: "Slash",
    unshifted: "/",
    shifted: "?",
    hand: "right",
    finger: "right-pinky",
    row: "bottom",
    zone: "right-pinky",
    width: 1,
    column: 11.25,
    category: "symbol"
  },
  {
    code: "ShiftRight",
    unshifted: null,
    shifted: null,
    hand: "right",
    finger: "right-pinky",
    row: "bottom",
    zone: "right-pinky",
    width: 2.75,
    column: 13.125,
    category: "modifier"
  },

  {
    code: "Space",
    unshifted: " ",
    shifted: " ",
    hand: "thumb",
    finger: "thumb",
    row: "space",
    zone: "thumb",
    width: 6.25,
    column: 7.5,
    category: "whitespace"
  }
] as const satisfies readonly PhysicalKeyDefinition[];

const standardKeys = symmetricKeys.map((key): PhysicalKeyDefinition => {
  if (key.code === "KeyZ") {
    return { ...key, finger: "left-pinky", zone: "left-pinky" };
  }
  if (key.code === "KeyX") {
    return { ...key, finger: "left-ring", zone: "left-ring" };
  }
  if (key.code === "KeyC") {
    return { ...key, finger: "left-middle", zone: "left-middle" };
  }
  return key;
});

export const SYMMETRIC_PRESET: KeyboardPreset = Object.freeze({
  id: "symmetric",
  name: "Symmetric",
  basedOn: "symmetric",
  keys: Object.freeze(symmetricKeys.map((key) => Object.freeze({ ...key })))
});

export const STANDARD_PRESET: KeyboardPreset = Object.freeze({
  id: "standard",
  name: "Standard",
  basedOn: "standard",
  keys: Object.freeze(standardKeys.map((key) => Object.freeze({ ...key })))
});

export const KEYBOARD_PRESETS = Object.freeze({
  symmetric: SYMMETRIC_PRESET,
  standard: STANDARD_PRESET
});

export const SYMMETRIC_LAYOUT: readonly KeyDefinition[] = SYMMETRIC_PRESET.keys;
export const STANDARD_LAYOUT: readonly KeyDefinition[] = STANDARD_PRESET.keys;
export const KEYBOARD_ROWS: readonly KeyboardRow[] = Object.freeze([
  "number",
  "top",
  "home",
  "bottom",
  "space"
]);

export interface CharacterBinding {
  readonly key: PhysicalKeyDefinition;
  readonly shifted: boolean;
}

function isKeyboardPreset(value: unknown): value is KeyboardPreset {
  return (
    typeof value === "object" &&
    value !== null &&
    "keys" in value &&
    Array.isArray((value as { readonly keys?: unknown }).keys)
  );
}

export function getKeyByCode(
  code: string,
  layout?: KeyboardPreset | readonly KeyDefinition[]
): KeyDefinition | undefined;
export function getKeyByCode(preset: KeyboardPreset, code: string): KeyDefinition | undefined;
export function getKeyByCode(
  codeOrPreset: string | KeyboardPreset,
  layoutOrCode?: string | KeyboardPreset | readonly KeyDefinition[]
): KeyDefinition | undefined {
  if (typeof codeOrPreset === "string") {
    const keys: readonly KeyDefinition[] = Array.isArray(layoutOrCode)
      ? (layoutOrCode as readonly KeyDefinition[])
      : isKeyboardPreset(layoutOrCode)
        ? layoutOrCode.keys
        : SYMMETRIC_LAYOUT;
    return keys.find((key) => key.code === codeOrPreset);
  }
  if (typeof layoutOrCode !== "string") {
    throw new TypeError("The preset-first getKeyByCode form requires a code");
  }
  return codeOrPreset.keys.find((key) => key.code === layoutOrCode);
}

export function getBindingForCharacter(
  preset: KeyboardPreset,
  character: string
): CharacterBinding | undefined {
  for (const key of preset.keys) {
    if (key.unshifted === character) {
      return { key, shifted: false };
    }
    if (key.shifted === character && key.unshifted !== character) {
      return { key, shifted: true };
    }
  }
  return undefined;
}

export function getKeyByCharacter(
  character: string,
  layout: KeyboardPreset | readonly KeyDefinition[] = SYMMETRIC_LAYOUT
): KeyDefinition | undefined {
  const preset: KeyboardPreset = Array.isArray(layout)
    ? {
        id: "lookup",
        name: "Lookup",
        basedOn: "symmetric",
        keys: layout
      }
    : (layout as KeyboardPreset);
  return getBindingForCharacter(preset, character)?.key;
}

export function characterForPhysicalKey(
  key: PhysicalKeyDefinition,
  shiftKey: boolean,
  capsLock: boolean
): string | null {
  if (key.unshifted === null) {
    return null;
  }
  if (key.category === "letter") {
    return shiftKey !== capsLock ? key.shifted : key.unshifted;
  }
  return shiftKey ? key.shifted : key.unshifted;
}

export interface KeyboardEventLike {
  readonly code: string;
  readonly key?: string;
  readonly shiftKey: boolean;
  readonly ctrlKey?: boolean;
  readonly altKey?: boolean;
  readonly metaKey?: boolean;
  readonly repeat?: boolean;
  readonly isComposing?: boolean;
  readonly capsLock?: boolean;
}

export type ParsedKeystroke =
  | {
      readonly kind: "printable";
      readonly code: string;
      readonly character: string;
      readonly key: PhysicalKeyDefinition;
      readonly inferredFinger: Finger;
      readonly inferredHand: Hand;
      readonly repeated: boolean;
    }
  | {
      readonly kind: "control";
      readonly code: string;
      readonly key: PhysicalKeyDefinition | undefined;
      readonly repeated: boolean;
    }
  | {
      readonly kind: "ignored";
      readonly reason: "composition" | "system-shortcut" | "unknown-code";
      readonly code: string;
    };

export function parseKeyboardEvent(
  event: KeyboardEventLike,
  preset: KeyboardPreset = SYMMETRIC_PRESET
): ParsedKeystroke {
  if (event.isComposing === true || event.key === "Process") {
    return { kind: "ignored", reason: "composition", code: event.code };
  }
  if (event.ctrlKey === true || event.altKey === true || event.metaKey === true) {
    return { kind: "ignored", reason: "system-shortcut", code: event.code };
  }
  const key = getKeyByCode(preset, event.code);
  if (key === undefined) {
    return { kind: "ignored", reason: "unknown-code", code: event.code };
  }
  const character = characterForPhysicalKey(key, event.shiftKey, event.capsLock ?? false);
  if (character === null) {
    return {
      kind: "control",
      code: event.code,
      key,
      repeated: event.repeat ?? false
    };
  }
  return {
    kind: "printable",
    code: event.code,
    character,
    key,
    inferredFinger: key.finger,
    inferredHand: key.hand,
    repeated: event.repeat ?? false
  };
}

export type ShiftCode = "ShiftLeft" | "ShiftRight";
export type ShiftAssessment =
  | "not-required"
  | "correct-opposite-hand"
  | "missing-shift"
  | "same-hand-shift"
  | "caps-lock"
  | "both-shifts"
  | "not-mappable";

export function recommendedShiftForCharacter(
  preset: KeyboardPreset,
  target: string
): ShiftCode | null {
  const binding = getBindingForCharacter(preset, target);
  if (binding === undefined || !binding.shifted || binding.key.hand === "thumb") {
    return null;
  }
  return binding.key.hand === "left" ? "ShiftRight" : "ShiftLeft";
}

export function assessShiftUse(
  preset: KeyboardPreset,
  target: string,
  activeShifts: readonly ShiftCode[],
  capsLock: boolean
): ShiftAssessment {
  const binding = getBindingForCharacter(preset, target);
  if (binding === undefined) {
    return "not-mappable";
  }
  if (!binding.shifted || binding.key.hand === "thumb") {
    return "not-required";
  }
  if (capsLock && binding.key.category === "letter") {
    return "caps-lock";
  }
  if (activeShifts.length === 0) {
    return "missing-shift";
  }
  if (new Set(activeShifts).size > 1) {
    return "both-shifts";
  }
  const recommended = recommendedShiftForCharacter(preset, target);
  return activeShifts[0] === recommended ? "correct-opposite-hand" : "same-hand-shift";
}

export function clonePreset(source: KeyboardPreset, id: string, name: string): KeyboardPreset {
  if (id.trim().length === 0 || name.trim().length === 0) {
    throw new Error("A custom keyboard preset requires a non-empty id and name");
  }
  return {
    id,
    name,
    basedOn: source.basedOn,
    keys: source.keys.map((key) => ({ ...key }))
  };
}

export function replaceKeyMapping(
  preset: KeyboardPreset,
  code: string,
  mapping: Pick<PhysicalKeyDefinition, "hand" | "finger" | "zone">
): KeyboardPreset {
  if (mapping.finger !== "thumb") {
    const fingerHand = mapping.finger.startsWith("left-") ? "left" : "right";
    if (mapping.hand !== fingerHand || mapping.zone !== mapping.finger) {
      throw new Error("Hand, finger, and zone must describe the same physical assignment");
    }
  } else if (mapping.hand !== "thumb" || mapping.zone !== "thumb") {
    throw new Error("Thumb mappings must use the thumb hand and zone");
  }
  let replaced = false;
  const keys = preset.keys.map((key) => {
    if (key.code !== code) {
      return key;
    }
    replaced = true;
    return { ...key, ...mapping };
  });
  if (!replaced) {
    throw new Error(`Unknown ANSI key code: ${code}`);
  }
  return { ...preset, keys };
}

export function areKeysAdjacent(
  preset: KeyboardPreset,
  firstCode: string,
  secondCode: string
): boolean {
  const first = getKeyByCode(preset, firstCode);
  const second = getKeyByCode(preset, secondCode);
  if (first === undefined || second === undefined || first.code === second.code) {
    return false;
  }
  const rowOrder: Record<KeyboardRow, number> = {
    number: 0,
    top: 1,
    home: 2,
    bottom: 3,
    space: 4
  };
  return (
    Math.abs(rowOrder[first.row] - rowOrder[second.row]) <= 1 &&
    Math.abs(first.column - second.column) <= 1.35
  );
}

export function inferredTrainingRegions(key: PhysicalKeyDefinition): readonly string[] {
  const regions: string[] = [key.category];
  if (key.finger.endsWith("index")) {
    regions.push("index");
  } else if (key.finger !== "thumb") {
    regions.push("other");
  }
  if (key.shifted !== null && key.shifted !== key.unshifted) {
    regions.push("case-or-shift");
  }
  return regions;
}
