import { describe, expect, it } from "vitest";

import {
  SYMMETRIC_PRESET,
  assessShiftUse,
  getKeyByCode,
  parseKeyboardEvent,
  recommendedShiftForCharacter,
  runtimeApiContracts,
  runtimeNonJsonApiContracts,
  type KeyboardEventLike,
  type ShiftCode
} from "./index.js";

function parsedOutput(event: KeyboardEventLike): string {
  const parsed = parseKeyboardEvent(event);
  if (parsed.kind === "printable") {
    return [
      parsed.kind,
      parsed.code,
      parsed.character,
      parsed.inferredHand,
      parsed.inferredFinger,
      parsed.repeated
    ].join("|");
  }
  if (parsed.kind === "control") {
    return [parsed.kind, parsed.code, parsed.key?.finger ?? "null", parsed.repeated].join("|");
  }
  return [parsed.kind, parsed.code, parsed.reason].join("|");
}

describe("V1 golden physical-key and Shift contract", () => {
  it("freezes Caps Lock, digits, symbols, controls, and ignored events", () => {
    const events: readonly KeyboardEventLike[] = [
      { code: "KeyC", key: "z", shiftKey: false },
      { code: "KeyC", shiftKey: true },
      { code: "KeyC", shiftKey: false, capsLock: true },
      { code: "KeyC", shiftKey: true, capsLock: true },
      { code: "Digit4", shiftKey: false },
      { code: "Digit4", shiftKey: true },
      { code: "Digit6", shiftKey: true },
      { code: "Slash", shiftKey: true },
      { code: "Backquote", shiftKey: true },
      { code: "BracketLeft", shiftKey: true },
      { code: "Space", shiftKey: true },
      { code: "Backspace", shiftKey: false, repeat: true },
      { code: "KeyA", key: "Process", shiftKey: false },
      { code: "KeyA", shiftKey: false, metaKey: true },
      { code: "IntlRo", shiftKey: false }
    ];
    expect(events.map(parsedOutput)).toEqual([
      "printable|KeyC|c|left|left-index|false",
      "printable|KeyC|C|left|left-index|false",
      "printable|KeyC|C|left|left-index|false",
      "printable|KeyC|c|left|left-index|false",
      "printable|Digit4|4|left|left-index|false",
      "printable|Digit4|$|left|left-index|false",
      "printable|Digit6|^|right|right-index|false",
      "printable|Slash|?|right|right-pinky|false",
      "printable|Backquote|~|left|left-pinky|false",
      "printable|BracketLeft|{|right|right-pinky|false",
      "printable|Space| |thumb|thumb|false",
      "control|Backspace|right-pinky|true",
      "ignored|KeyA|composition",
      "ignored|KeyA|system-shortcut",
      "ignored|IntlRo|unknown-code"
    ]);
  });

  it("freezes boundary assignments and opposite-hand Shift results", () => {
    const codes = [
      "KeyC",
      "KeyB",
      "KeyN",
      "KeyM",
      "Digit4",
      "Digit6",
      "Slash",
      "BracketLeft",
      "Quote"
    ];
    const mappings = codes.map((code) => {
      const key = getKeyByCode(SYMMETRIC_PRESET, code);
      return key === undefined
        ? "missing"
        : [
            key.code,
            key.unshifted,
            key.shifted,
            key.hand,
            key.finger,
            key.row,
            key.zone,
            key.category
          ].join("|");
    });
    expect(mappings).toEqual([
      "KeyC|c|C|left|left-index|bottom|left-index|letter",
      "KeyB|b|B|left|left-index|bottom|left-index|letter",
      "KeyN|n|N|right|right-index|bottom|right-index|letter",
      "KeyM|m|M|right|right-index|bottom|right-index|letter",
      "Digit4|4|$|left|left-index|number|left-index|number",
      "Digit6|6|^|right|right-index|number|right-index|number",
      "Slash|/|?|right|right-pinky|bottom|right-pinky|symbol",
      "BracketLeft|[|{|right|right-pinky|top|right-pinky|symbol",
      "Quote|'|\"|right|right-pinky|home|right-pinky|symbol"
    ]);
    const cases: readonly [string, readonly ShiftCode[], boolean][] = [
      ["A", [], false],
      ["A", ["ShiftLeft"], false],
      ["A", ["ShiftRight"], false],
      ["A", ["ShiftLeft", "ShiftRight"], false],
      ["A", [], true],
      ["Y", ["ShiftLeft"], false],
      ["?", ["ShiftLeft"], false],
      ["4", [], false],
      ["$", ["ShiftRight"], false],
      ["💡", [], false]
    ];
    expect(
      cases.map(([target, shifts, caps]) =>
        [
          target,
          recommendedShiftForCharacter(SYMMETRIC_PRESET, target),
          assessShiftUse(SYMMETRIC_PRESET, target, shifts, caps)
        ].join("|")
      )
    ).toEqual([
      "A|ShiftRight|missing-shift",
      "A|ShiftRight|same-hand-shift",
      "A|ShiftRight|correct-opposite-hand",
      "A|ShiftRight|both-shifts",
      "A|ShiftRight|caps-lock",
      "Y|ShiftLeft|correct-opposite-hand",
      "?|ShiftLeft|correct-opposite-hand",
      "4||not-required",
      "$|ShiftRight|correct-opposite-hand",
      "💡||not-mappable"
    ]);
  });
});

describe("V1 golden public runtime API", () => {
  it("freezes the literal 46-entry API manifest", () => {
    const actual = [...runtimeApiContracts, ...runtimeNonJsonApiContracts].map(
      ({ id, method, path }) => `${method} ${id} ${path.source}`
    );
    expect(actual).toEqual([
      "GET health ^\\/api\\/v1\\/health$",
      "GET bootstrap ^\\/api\\/v1\\/bootstrap$",
      "GET profile ^\\/api\\/v1\\/profile$",
      "GET settings.read ^\\/api\\/v1\\/settings$",
      "PATCH settings.patch ^\\/api\\/v1\\/settings$",
      "PUT preferences.put ^\\/api\\/v1\\/preferences$",
      "GET layouts.read ^\\/api\\/v1\\/layouts$",
      "POST layouts.create ^\\/api\\/v1\\/layouts$",
      "PUT layouts.mappings.replace ^\\/api\\/v1\\/layouts\\/(?<id>[^/]+)\\/mappings$",
      "POST sessions.create ^\\/api\\/v1\\/sessions$",
      "GET sessions.read ^\\/api\\/v1\\/sessions\\/(?<id>[^/]+)$",
      "POST sessions.events ^\\/api\\/v1\\/sessions\\/(?<id>[^/]+)\\/events$",
      "POST sessions.events-beacon ^\\/api\\/v1\\/sessions\\/(?<id>[^/]+)\\/events\\/beacon$",
      "POST sessions.pause ^\\/api\\/v1\\/sessions\\/(?<id>[^/]+)\\/pause$",
      "POST sessions.complete ^\\/api\\/v1\\/sessions\\/(?<id>[^/]+)\\/complete$",
      "POST sessions.feedback ^\\/api\\/v1\\/sessions\\/(?<id>[^/]+)\\/feedback$",
      "POST sessions.recover ^\\/api\\/v1\\/sessions\\/(?<id>[^/]+)\\/recover$",
      "POST sessions.abandon ^\\/api\\/v1\\/sessions\\/(?<id>[^/]+)\\/abandon$",
      "POST lessons.next-block ^\\/api\\/v1\\/lessons\\/(?<lessonId>[^/]+)\\/blocks\\/next$",
      "GET dashboard ^\\/api\\/v1\\/dashboard$",
      "GET statistics ^\\/api\\/v1\\/statistics$",
      "GET goals.read ^\\/api\\/v1\\/goals$",
      "PUT goals.update ^\\/api\\/v1\\/goals$",
      "GET traditional-progress ^\\/api\\/v1\\/traditional-progress$",
      "GET tests.read ^\\/api\\/v1\\/tests$",
      "POST tests.create ^\\/api\\/v1\\/tests$",
      "POST game.create ^\\/api\\/v1\\/game\\/runs$",
      "GET game.read ^\\/api\\/v1\\/game\\/runs\\/(?<id>[^/]+)$",
      "POST game.level-result ^\\/api\\/v1\\/game\\/runs\\/(?<id>[^/]+)\\/level-result$",
      "GET game.achievements ^\\/api\\/v1\\/game\\/achievements$",
      "GET game.progress ^\\/api\\/v1\\/game\\/progress$",
      "GET custom-text.read-all ^\\/api\\/v1\\/custom-texts$",
      "GET custom-text.read ^\\/api\\/v1\\/custom-texts\\/(?<id>[^/]+)$",
      "POST custom-text.create ^\\/api\\/v1\\/custom-texts$",
      "PATCH custom-text.progress ^\\/api\\/v1\\/custom-texts\\/(?<id>[^/]+)\\/progress$",
      "GET export.json ^\\/api\\/v1\\/export\\/json$",
      "GET backups.read ^\\/api\\/v1\\/backups$",
      "POST backups.create ^\\/api\\/v1\\/backups$",
      "POST import.json.preview ^\\/api\\/v1\\/import\\/preview$",
      "POST import.json.commit ^\\/api\\/v1\\/import\\/commit$",
      "POST import.sqlite.preview ^\\/api\\/v1\\/import\\/sqlite\\/preview$",
      "POST import.sqlite.commit ^\\/api\\/v1\\/import\\/sqlite\\/commit$",
      "GET diagnostics.read ^\\/api\\/v1\\/diagnostics$",
      "POST diagnostics.snapshot.create ^\\/api\\/v1\\/diagnostics\\/snapshot$",
      "GET export.csv ^\\/api\\/v1\\/export\\/csv$",
      "GET export.sqlite ^\\/api\\/v1\\/export\\/sqlite$"
    ]);
  });
});
