import { SYMMETRIC_PRESET } from "./keyboard-layout.js";

/**
 * Custom text is trained against the immutable ANSI US character map. Enter
 * and Tab are also supported by the event pipeline even though they are not
 * printable values in the keyboard preset.
 */
const supportedCustomTextCharacters = new Set<string>([
  "\n",
  "\t",
  ...SYMMETRIC_PRESET.keys.flatMap((key) =>
    [key.unshifted, key.shifted].filter((character): character is string => character !== null)
  )
]);

export interface UnsupportedCustomTextCharacter {
  readonly character: string;
  /** UTF-16 offset, matching persisted custom-text positions. */
  readonly offset: number;
  readonly codePoint: number;
}

export function normalizeCustomTextContent(content: string): string {
  return content.replace(/\r\n?/gu, "\n");
}

export function findUnsupportedCustomTextCharacter(
  content: string
): UnsupportedCustomTextCharacter | undefined {
  let offset = 0;
  for (const character of content) {
    if (!supportedCustomTextCharacters.has(character)) {
      return {
        character,
        offset,
        codePoint: character.codePointAt(0) ?? 0
      };
    }
    offset += character.length;
  }
  return undefined;
}

export function describeUnsupportedCustomTextCharacter(
  unsupported: UnsupportedCustomTextCharacter
): string {
  const codePoint = `U+${unsupported.codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
  return `内容第 ${unsupported.offset + 1} 个字符（${codePoint}）不在 ANSI US 键盘范围内。请改用可输入的英文、数字、标点、换行或 Tab。`;
}
