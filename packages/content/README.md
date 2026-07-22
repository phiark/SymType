# `@symtype/content`

Deterministic, offline-only English training content for SymType. The package has no runtime dependencies and does not read from the network, browser storage, or the file system.

Primary app-facing exports:

- `CONTENT_MODES`
- `generatePracticeText({ mode, seed, length, focus? })`
- `GAME_LEVELS`
- `getGameLevelText(levelId, difficulty, seed, focus?)`
- `contentSources`

Lower-level exports expose curated words, sentence templates, pseudoword generation, fictional data-entry values, original code and punctuation snippets, long-form samples, seeded randomness, game plans, and content safety validation.

Every generator is deterministic for identical inputs. Pseudowords are labeled as nonwords. Telephone-style values carry an intentionally invalid prefix. Pineapple Breach strings are fictional props and avoid real network locations, commands, credentials, and wallet recovery formats.
