export type FocusInput = string | readonly string[];

export function normalizeFocusCharacters(focus: FocusInput | undefined): readonly string[] {
  if (focus === undefined) {
    return [];
  }
  const joined = typeof focus === "string" ? focus : focus.join("");
  return [...new Set([...joined.toLocaleLowerCase("en-US")])].filter(
    (character) => character.trim().length > 0
  );
}

export function countFocusHits(text: string, focus: FocusInput | undefined): number {
  const characters = normalizeFocusCharacters(focus);
  if (characters.length === 0) {
    return 0;
  }
  const normalized = text.toLocaleLowerCase("en-US");
  return characters.reduce((sum, character) => {
    let hits = 0;
    for (const candidate of normalized) {
      if (candidate === character) {
        hits += 1;
      }
    }
    return sum + hits;
  }, 0);
}
