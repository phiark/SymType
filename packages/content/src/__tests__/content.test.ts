import { describe, expect, it } from "vitest";

import {
  CODE_SNIPPETS,
  COMMON_ENGLISH_SENTENCE_TEMPLATES,
  COMMON_ENGLISH_WORD_SET,
  COMMON_ENGLISH_WORDS,
  CONTENT_MODES,
  DATA_ENTRY_CATEGORIES,
  GAME_LEVELS,
  GAME_RESET_POLICY,
  LONG_FORM_SAMPLES,
  PINEAPPLE_ACHIEVEMENTS,
  PUNCTUATION_SNIPPETS,
  SeededRandom,
  builtInLongFormTextId,
  contentSources,
  generateCommonEnglishSentences,
  generateDataEntryItems,
  generateGameLevelPlan,
  generatePracticeCandidates,
  generatePracticeText,
  generatePseudowords,
  getGameLevelText,
  getLongFormSample,
  normalizeSeed,
  selectCommonWords,
  validateContentSafety
} from "../index.js";

describe("seeded randomness", () => {
  it("produces the same stream for an identical string seed", () => {
    const first = new SeededRandom("same-seed");
    const second = new SeededRandom("same-seed");
    const firstStream = Array.from({ length: 20 }, () => first.next());
    const secondStream = Array.from({ length: 20 }, () => second.next());

    expect(firstStream).toEqual(secondStream);
    expect(new SeededRandom("different-seed").next()).not.toBe(firstStream[0]);
  });

  it("normalizes finite numeric and string seeds and rejects non-finite numbers", () => {
    expect(normalizeSeed(42)).toBe(42);
    expect(normalizeSeed("alpha")).toBe(normalizeSeed("alpha"));
    expect(() => normalizeSeed(Number.NaN)).toThrow(/finite/);
  });

  it("keeps integer, pick, and shuffle operations inside their contracts", () => {
    const random = new SeededRandom(8);
    const values = Array.from({ length: 100 }, () => random.integer(3, 7));
    expect(values.every((value) => value >= 3 && value <= 7)).toBe(true);
    expect(random.shuffle(["a", "b", "c"]).sort()).toEqual(["a", "b", "c"]);
    expect(() => random.pick([])).toThrow(/empty/);
  });
});

describe("common English content", () => {
  it("ships a substantial unique, labeled vocabulary without fake frequency ranks", () => {
    expect(COMMON_ENGLISH_WORDS.length).toBeGreaterThan(200);
    expect(new Set(COMMON_ENGLISH_WORDS.map((entry) => entry.text.toLowerCase())).size).toBe(
      COMMON_ENGLISH_WORDS.length
    );
    expect(new Set(COMMON_ENGLISH_WORDS.map((entry) => entry.commonnessBand))).toEqual(
      new Set(["core", "common", "extended"])
    );
    const availableCharacters = new Set(
      COMMON_ENGLISH_WORDS.flatMap((entry) => [...entry.text.toLowerCase()])
    );
    expect(
      [..."abcdefghijklmnopqrstuvwxyz"].every((letter) => availableCharacters.has(letter))
    ).toBe(true);
  });

  it("selects deterministic common words and weights requested focus characters", () => {
    const options = { seed: "word-seed", count: 40, focus: "cz" } as const;
    expect(selectCommonWords(options)).toEqual(selectCommonWords(options));
    expect(selectCommonWords(options)).toHaveLength(40);
    expect(selectCommonWords(options).every((word) => typeof word === "string")).toBe(true);

    const focused = selectCommonWords({ seed: "rare-letter", count: 200, focus: "z" });
    const baseline = selectCommonWords({ seed: "rare-letter", count: 200 });
    const zHits = (words: readonly string[]) =>
      [...words.join("").toLowerCase()].filter((character) => character === "z").length;
    expect(zHits(focused)).toBeGreaterThan(zHits(baseline));
  });

  it("renders every sentence placeholder and returns useful metadata", () => {
    const result = generateCommonEnglishSentences({
      seed: "sentence-seed",
      count: 20,
      focus: "ct"
    });
    expect(result).toEqual(
      generateCommonEnglishSentences({ seed: "sentence-seed", count: 20, focus: "ct" })
    );
    expect(result.every((entry) => !entry.text.includes("{") && entry.wordCount >= 5)).toBe(true);
    expect(COMMON_ENGLISH_SENTENCE_TEMPLATES.every((entry) => entry.sourceId.length > 0)).toBe(
      true
    );
  });
});

describe("readable pseudowords", () => {
  it("generates unique deterministic nonwords within the requested bounds", () => {
    const options = {
      seed: "pseudo-seed",
      count: 80,
      minLength: 4,
      maxLength: 10,
      focus: "cz"
    } as const;
    const first = generatePseudowords(options);
    const second = generatePseudowords(options);

    expect(first).toEqual(second);
    expect(new Set(first.map((entry) => entry.text)).size).toBe(first.length);
    for (const entry of first) {
      expect(entry.text).toMatch(/^[a-z]+$/);
      expect(entry.text.length).toBeGreaterThanOrEqual(4);
      expect(entry.text.length).toBeLessThanOrEqual(10);
      expect(COMMON_ENGLISH_WORD_SET.has(entry.text)).toBe(false);
      expect(entry.isRealWord).toBe(false);
    }
  });

  it("can create capitalization practice without changing its nonword label", () => {
    const words = generatePseudowords({
      seed: 77,
      count: 12,
      capitalization: "title"
    });
    expect(words.every((entry) => /^[A-Z][a-z]+$/.test(entry.text) && !entry.isRealWord)).toBe(
      true
    );
  });
});

describe("fictional data-entry content", () => {
  it("covers every category deterministically", () => {
    const options = {
      seed: "data-seed",
      count: DATA_ENTRY_CATEGORIES.length,
      categories: DATA_ENTRY_CATEGORIES
    } as const;
    const result = generateDataEntryItems(options);
    expect(result).toEqual(generateDataEntryItems(options));
    expect(result.map((entry) => entry.category)).toEqual(DATA_ENTRY_CATEGORIES);
    expect(result.every((entry) => entry.fictional)).toBe(true);
  });

  it("uses a deliberately invalid prefix for phone-style practice", () => {
    const [phone] = generateDataEntryItems({
      seed: 18,
      count: 1,
      categories: ["fictional-phone"]
    });
    expect(phone?.text).toMatch(/^TEL-FIC \+0 \(555\)/);
    expect(phone?.accessibilityLabel).toContain("invalid fictional");
  });
});

describe("licensed snippets and long-form samples", () => {
  it("provides original punctuation and all requested web-code languages", () => {
    expect(PUNCTUATION_SNIPPETS.length).toBeGreaterThanOrEqual(3);
    expect(new Set(CODE_SNIPPETS.map((entry) => entry.language))).toEqual(
      new Set(["javascript", "typescript", "json", "html", "css"])
    );
    for (const snippet of [...PUNCTUATION_SNIPPETS, ...CODE_SNIPPETS]) {
      expect(snippet.licenseId).toBe("symtype-original-content-cc0");
      expect(snippet.safety).toBe("benign-original-training-content");
    }
  });

  it("records exact derived counts and both original and historical provenance", () => {
    expect(LONG_FORM_SAMPLES.length).toBeGreaterThanOrEqual(3);
    expect(new Set(LONG_FORM_SAMPLES.map((entry) => entry.provenance))).toEqual(
      new Set(["original", "public-domain"])
    );
    for (const entry of LONG_FORM_SAMPLES) {
      expect(entry.wordCount).toBe(entry.text.trim().split(/\s+/).length);
      expect(entry.paragraphCount).toBe(entry.text.split(/\n\s*\n/).length);
      expect(contentSources.some((source) => source.id === entry.sourceId)).toBe(true);
    }
  });

  it("gives every bundled passage a stable storage identity", () => {
    for (const sample of LONG_FORM_SAMPLES) {
      expect(builtInLongFormTextId(sample.id)).toBe(`builtin-long-form:${sample.id}`);
      expect(getLongFormSample(sample.id)).toBe(sample);
    }
    expect(() => builtInLongFormTextId("missing-passage")).toThrow(/Unknown bundled/);
  });
});

describe("stable high-level practice API", () => {
  it("implements every advertised mode with bounded deterministic text", () => {
    for (const mode of CONTENT_MODES) {
      const options = { mode: mode.id, seed: "mode-seed", length: 180, focus: "ct" } as const;
      const first = generatePracticeText(options);
      const second = generatePracticeText(options);
      expect(first, mode.id).toBe(second);
      expect([...first].length, mode.id).toBeLessThanOrEqual(180);
      expect([...first].length, mode.id).toBeGreaterThanOrEqual(140);
      expect(first, mode.id).not.toMatch(/\bundefined\b/);
    }
  });

  it("rejects lengths that cannot form a useful exercise", () => {
    expect(() => generatePracticeText({ mode: "common-english", seed: 1, length: 10 })).toThrow(
      /20 to 20000/
    );
  });

  it("preserves typed sequence features in deterministic runtime candidates", () => {
    const options = {
      mode: "smart",
      seed: "sequence-runtime",
      length: 44,
      focusFeatures: ["bigram:ct", "trigram:the"]
    } as const;
    const first = generatePracticeCandidates(options);
    const replay = generatePracticeCandidates(options);

    expect(first).toEqual(replay);
    expect(first[0]?.features).toEqual(["bigram:ct"]);
    expect(first[0]?.text.startsWith("ct")).toBe(true);
    expect(first[1]?.features).toEqual(["trigram:the"]);
    expect(first[1]?.text.startsWith("the")).toBe(true);
    expect(first.flatMap((candidate) => candidate.features)).not.toContain("key:c");
  });

  it("bounds runtime focus to three valid typed features that fit a short micro-block", () => {
    const candidates = generatePracticeCandidates({
      mode: "smart",
      seed: 41,
      length: 20,
      focusFeatures: ["key:a", "bigram:ct", "trigram:the", "bigram:x", "invalid"]
    });
    const focused = candidates.filter((candidate) => candidate.id.includes(":focus:"));

    expect(focused.map((candidate) => candidate.features[0])).toEqual([
      "key:a",
      "bigram:ct",
      "trigram:the"
    ]);
    expect(
      focused.reduce((length, candidate) => length + candidate.text.length, 0) + 2
    ).toBeLessThanOrEqual(20);
  });
});

describe("Pineapple Breach content", () => {
  it("defines six ordered levels with three stages and all three difficulties", () => {
    expect(GAME_LEVELS.map((level) => level.order)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(GAME_LEVELS.map((level) => level.id)).toEqual([
      "signal-sync",
      "firewall-routing",
      "credential-forge",
      "packet-repair",
      "trace-countdown",
      "vault-phrase"
    ]);
    for (const level of GAME_LEVELS) {
      expect(level.stages.map((stage) => stage.stage)).toEqual([1, 2, 3]);
      expect(Object.keys(level.difficulties).sort()).toEqual(["adaptive", "hard", "standard"]);
      expect(
        level.stages
          .flatMap((stage) => stage.targets)
          .every((entry) => entry.safetyLabel === "fictional-local-training-only")
      ).toBe(true);
    }
  });

  it("makes reset behavior explicit and retains no failed level checkpoint", () => {
    expect(GAME_RESET_POLICY).toEqual({
      campaign: "restart-current-level-from-stage-1",
      hardcore: "restart-run-from-level-1",
      retainCompletedEarlierLevelsInCampaign: true,
      retainInLevelCheckpointAfterFailure: false
    });
    expect(PINEAPPLE_ACHIEVEMENTS).toHaveLength(3);
  });

  it("generates deterministic plans for each difficulty", () => {
    for (const difficulty of ["standard", "hard", "adaptive"] as const) {
      const options = {
        levelId: "firewall-routing",
        difficulty,
        seed: "game-seed",
        focus: "ct"
      } as const;
      const plan = generateGameLevelPlan(options);
      expect(plan).toEqual(generateGameLevelPlan(options));
      expect(plan.stages).toHaveLength(3);
      expect(
        plan.stages.every((stage) => stage.targets.length === plan.tuning.targetCountPerStage)
      ).toBe(true);
    }
  });

  it("uses the current weakness signal in Standard, Hard, and Adaptive target selection", () => {
    const zHits = (value: string) =>
      [...value.toLowerCase()].filter((character) => character === "z").length;

    for (const difficulty of ["standard", "hard", "adaptive"] as const) {
      let focusedHits = 0;
      let neutralHits = 0;
      for (let seed = 0; seed < 160; seed += 1) {
        focusedHits += zHits(getGameLevelText("vault-phrase", difficulty, seed, "z"));
        neutralHits += zHits(getGameLevelText("vault-phrase", difficulty, seed));
      }

      expect(focusedHits, difficulty).toBeGreaterThan(neutralHits);
    }
  });

  it("exposes stable text output and keeps the finale obviously non-mnemonic", () => {
    const first = getGameLevelText("vault-phrase", "hard", "vault-seed", "zq");
    const second = getGameLevelText("vault-phrase", "hard", "vault-seed", "zq");
    expect(first).toBe(second);
    expect(first).toMatch(/PROP|WALLET|FICTION|STAGE|FINALE|KEY/);
    for (const line of first.split("\n")) {
      expect(line.split(/\s+/).length).toBeLessThan(12);
      expect(line).toMatch(/[0-9]/);
      expect(line).toMatch(/[:_+\-/#?!,.]/);
    }
  });
});

describe("content safety guard", () => {
  it("finds no banned network, command, or secret shapes in shipped runtime content", () => {
    const shippedContent = {
      contentSources,
      words: COMMON_ENGLISH_WORDS,
      sentences: COMMON_ENGLISH_SENTENCE_TEMPLATES,
      punctuation: PUNCTUATION_SNIPPETS,
      code: CODE_SNIPPETS,
      longForm: LONG_FORM_SAMPLES,
      game: GAME_LEVELS
    };
    expect(validateContentSafety(shippedContent)).toEqual([]);
  });

  it("leaves benign imported text unchanged", () => {
    const input = { note: "A blue paper pineapple rests beside the quiet lamp." };
    expect(validateContentSafety(input)).toEqual([]);
    expect(input.note).toBe("A blue paper pineapple rests beside the quiet lamp.");
  });
});
