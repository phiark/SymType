# SymType Product Specification

**Status:** implementation baseline
**Audience:** product, engineering, design, QA
**Last updated:** 2026-07-20

## 1. Product definition

SymType is a private, local-first English typing tutor for one person using an ANSI US QWERTY keyboard with a configurable **Symmetric finger-zone mapping**. It combines explicit zone courses, per-feature performance estimates, adaptive micro-lessons, transfer practice, tests, analytics, and a six-level fictional typing game.

The keyboard's characters do not change. “Symmetric” describes the suggested finger for each physical key. Because a browser sees a physical key but not the user's finger, every finger metric is labeled **performance inferred from keys assigned by the active mapping**.

### Outcome

A user can install a supported Node.js LTS, launch SymType with one file, practice daily in current Chrome or Safari, and retain the same history after restart, browser change, or browser-storage deletion. The application makes no claim that it diagnoses motor behavior or is proven superior to another tutor.

### Primary user

One local user who wants deliberate practice for Symmetric fingering across letters, numbers, symbols, Shift, natural English, and code. There are no accounts, remote sync, multiplayer, ads, or administrator surfaces.

## 2. Product principles

1. **Local and durable.** SQLite on the computer is authoritative for settings, progress, events, content, tests, and game state. Browser storage is never the source of truth.
2. **Physical-key explicitness.** Every ANSI key is represented by `KeyboardEvent.code`, unshifted/shifted output, hand, finger, row, zone, and width.
3. **Actionable honesty.** Show uncertainty, samples, exclusions, and reasons. A burst is not mastery; a mapped zone is not a detected finger.
4. **Stable while typing.** The visible micro-block never rewrites. Adaptation happens only between blocks.
5. **Accurate before fast.** Difficulty is gated by configurable accuracy thresholds and fatigue signals.
6. **Practice must transfer.** Focused repetition progresses toward interleaved, natural, unfamiliar, and delayed-retention contexts.
7. **Calm craft.** Desktop-first, keyboard-complete, accessible UI with restrained motion and no ornamental dashboard clutter.
8. **Safe fiction.** Pineapple Breach and bundled data cannot function as real security instructions or secrets.

## 3. Explicit non-goals

- Detecting the user's actual hand or finger without a sensor.
- Replacing the ANSI US QWERTY character layout.
- Cloud services, telemetry, accounts, social features, remote databases, or browser-profile persistence.
- Copying Keybr source, assets, icons, prose, layouts, or private/current algorithm behavior.
- Promising a scientifically optimal practice ratio, error rate, session length, or guaranteed advantage over Keybr.
- Providing real intrusion steps, targets, credentials, commands, or wallet recovery material.

## 4. Information architecture

Primary navigation is **Today, Train, Test, Game, Analytics, Settings**. Training collapses nonessential navigation. First-run onboarding precedes the main shell; completion and recovery states remain reachable by direct URL and browser refresh.

### Today

- One dominant “Start today's training” action.
- 5/10/15/20-minute and “Let the system decide” duration choices.
- The dominant start action uses the remaining daily-goal/system recommendation; an explicit quick
  duration overrides it. Accuracy-first, balanced, and speed-challenge intent is shown again on the
  ready screen and never bypasses the configured minimum-accuracy protection.
- Accuracy-first, Balanced, and Speed challenge intent; minimum-accuracy protection always applies.
- Daily goal, practiced minutes, non-coercive streak, recent WPM/accuracy trends, top three weaknesses, and post-session retention.
- Explanations cite observable evidence, for example a slower median bigram IKI, sample size, baseline gap, and days since retest.

### Train

All modes use the same event, persistence, summary, and analytics pipeline:

1. Smart course.
2. Traditional zones and progressive unlocks.
3. Weakness rescue for a key, sequence, mapped finger, or zone.
4. Common English.
5. Clearly labeled pronounceable pseudowords.
6. Fictional numeric/data-entry formats.
7. English punctuation and optional code symbols.
8. Case and opposite-hand Shift practice.
9. Original or license-compatible JavaScript, TypeScript, JSON, HTML, and CSS.
10. Local custom text/import for `.txt`, `.md`, `.json`, `.js`, and `.ts`, with an opt-in for long-term modeling.
11. Original/public-domain long text with provenance and saved position; user imports remain local.
12. Timed tests are reachable here only by link; their records remain distinctly typed as tests.

Filters independently select index zone, non-index fingers, a particular mapped finger, letters, digits, symbols, and case/Shift. Scope constraints are honored by generation while a small amount of mastered control material may be retained.

### Training interaction contract

- Immediate target/correct/error state; configurable stop-on-error versus continue-and-count.
- Configurable Backspace policy, restart, pause, focus mode, and Escape confirmation.
- Current/average/peak WPM, accuracy, time or character progress, optional virtual keyboard, font size, line height, caret, and smooth scrolling.
- Virtual keyboard uses color plus labels/pattern/position, highlights the next physical key, and names the mapped finger.
- IME composition is ignored. Repeat events, long pauses, post-focus first keys, and throttled intervals are excluded from speed or explicitly flagged.
- Page blur auto-pauses timed/game activity and flushes valid queued events. Refresh/unload uses ordinary batch submission plus `sendBeacon` as a best-effort fallback; server idempotency prevents duplicates.
- A completion screen appears only after essential event and summary persistence succeeds.

### Test

15/30/60/120-second and custom-duration tests report raw WPM, net WPM, keystroke accuracy, final-text accuracy, consistency, and error detail. Test rankings compare only the user's prior tests; training and game records cannot enter them. A timed test with no valid training-area character closes audibly and visibly as “no evidence” but does not enter the ranking, period practice totals, goals, streaks, or personal bests.

### Analytics

Time ranges: today, 7 days, 30 days, and all time. Views include:

- practice time, course count, characters, raw/net WPM, both accuracies, consistency, conservative best stable speed;
- WPM and accuracy trends separated by training, test, and game;
- per-character speed/error posterior, uncertainty interval, sample size, and learning slope;
- bigram/trigram hotspots and actual-to-target confusion matrix;
- mapped hand/finger, row, zone, class, and Shift-side aggregation;
- keyboard heatmap and accessible text/table summaries;
- labels for slow-accurate, fast-error-prone, unstable, insufficient-sample, and suspected forgetting;
- recent in-app training-error context, streaks, personal bests, achievements, and three post-lesson feedback items;
- CSV/JSON export, full SQLite/JSON backup, validated restore summary, pre-restore backup, rotation, and integrity check.

No-data, sparse-data, cross-day, and 100k-event states must remain truthful and usable. “No conclusion yet” replaces significance language when evidence is insufficient.

### Settings

Grouped, searchable sections cover profile/goals, mapping, training, target speed, accuracy gates, text presentation, sound, theme, reduced motion, keyboard hints, privacy/data, algorithm experiment, and advanced engine weights. Every advanced group has Restore defaults. Settings persist server-side.

## 5. Onboarding and calibration

The welcome view says only that SymType runs locally, keeps data on this computer, and currently uses Symmetric fingering. It offers sound, theme, reduced motion, and keyboard-hint choices, including sound activation from a user gesture.

An adaptive 3–5 minute baseline samples selected categories: letters, common bigrams, index-boundary keys, digits, punctuation, and case. A user may skip categories they do not intend to train. Results are segmented by category and report speed, accuracy, rhythm dispersion, mapped left/right balance, slowest supported keys/sequences, uncertainty, and a suggested start. The completion summary leads with valid activity time, valid sample count, keystroke accuracy, and rhythm consistency; it does not present whole-session WPM beside IKI-derived category speeds. A single aggregate WPM never hides category differences.

## 6. Keyboard and Shift behavior

### Default Symmetric letter mapping

| Mapped finger | Keys                             |
| ------------- | -------------------------------- |
| Left little   | `Q A`                            |
| Left ring     | `W S Z`                          |
| Left middle   | `E D X`                          |
| Left index    | `R F C V T G B`                  |
| Right index   | `Y H N U J M`                    |
| Right middle  | `I K ,`                          |
| Right ring    | `O L .`                          |
| Right little  | `P ; /` and right brackets/quote |
| Thumb         | Space                            |

Number row: left little `` ` 1 ``; left ring `2`; left middle `3`; left index `4 5`; right index `6 7`; right middle `8`; right ring `9`; right little `0 - =`. Shifted symbols inherit the physical key's mapped finger.

The product ships with **Symmetric** and **Standard** presets. Presets are immutable; users duplicate one to edit mappings per key. Shift defaults to the hand opposite the target key. SymType separately counts left Shift, right Shift, same-hand Shift, missed Shift, and Caps Lock. Caps Lock is observed, not silently treated as correct Shift technique.

The mapping must be checked against the referenced Keybr ANSI 101/Symmetric screenshots before release. Those screenshots are not present in the initial workspace, so that comparison is externally blocked and cannot be claimed complete.

## 7. Sound

Web Audio provides correct key, space, error, rhythm milestone, course-complete, game-alert, and game-success cues in at least Soft, Mechanical, and Terminal palettes. Controls include volume, mute, errors only, key sounds only, and all sounds.

One reusable `AudioContext`, pooled nodes/buffers, and short envelopes keep audio off the input critical path. Safari initialization occurs after a user gesture. Failure produces a nonblocking, actionable prompt and never prevents typing or saving.

## 8. Adaptive learning behavior

The deterministic, seeded engine is UI-independent. It maintains short- and long-window evidence for characters, shifted characters, supported bigrams/trigrams, mapped fingers/hands, rows, zones, classes, and content modes. Evidence includes a gently prior-weighted Beta accuracy posterior, robust correct-key IKI location/dispersion, sample count, recency, correct streak, goal gap, and uncertainty.

Weakness priority combines normalized accuracy and speed shortfalls with confidence/exploration, forgetting, transfer value, user focus, recent overuse, and fatigue. It must not collapse to zero merely because one dimension is healthy. Weights, bounds, algorithm version, and explanations are observable and tested.

Smart lessons use 20–60 character micro-blocks. A typical session dynamically balances focus (about 35–50%), spaced retest (20–30%), transfer (15–25%), and comfortable/exploratory work (10–20%). These are adjustable engineering starting ranges, not fixed quotas or research-derived optima. Below roughly 94% accuracy the engine does not raise difficulty; sustained roughly 97–98% can permit progression. Thresholds are configurable.

The engine recognizes adjacent-key confusion, transposition, repeat/omission, slow-correct behavior, post-error slowing, sequence-specific cost, same-finger cross-row cost, mapped hand/finger imbalance, Shift-side errors, digit/shift-symbol confusion, burst-error clusters, and multi-signal suspected fatigue. Adjacent transposition is attributed once rather than as two substitutions.

A deterministic “keybr-like baseline” means only single-character weakness weighting. It is a local comparator, not a reconstruction of Keybr. Simulations and optional date/session-balanced experiments compare correct characters/minutes to threshold, 24h/72h and 7-day retention, stable WPM/accuracy, unseen-text transfer gap, effective correct characters per minute, subjective difficulty/fatigue/exit, recovery time, prediction calibration, and exposure-response. Insufficient samples yield no conclusion.

## 9. Pineapple Breach

An original, fictional campaign uses the user's current weakness model without teaching real intrusion. All targets and secret-like text are unmistakably fictional and never use real domains/IPs, executable malicious commands, credential formats, or valid BIP-39 words as a recovery phrase. Every custom-text entry warns against entering passwords, API keys, private keys, wallet mnemonics, or recovery phrases.

Six sequential levels train: (1) short-string accuracy, (2) alternation and index boundaries, (3) case/digits/symbols, (4) confusing-sequence repair, (5) timed natural text/pseudocode, and (6) an obviously fictional vault phrase/key. Standard, Hard, and Adaptive difficulty are available.

Alert increases through documented errors, long pauses, and timeout; bounded accurate streaks can reduce it. Pausing is allowed, blur auto-pauses, and failure reasons are explicit. Normal campaign failure resets the current level to stage 1, zero score, and zero alert while preserving completed levels. Hardcore failure resets the entire run to level 1 after an explicit pre-run warning. Personal bests and local achievements persist, but game data remains separate from test rankings.

## 10. Metrics and data semantics

- **Raw WPM:** accepted character-producing presses divided by 5, divided by active minutes.
- **Net WPM:** raw character count minus the documented uncorrected-error penalty, floored at zero, then divided by 5 and active minutes. The shared metric function owns the exact convention so training, tests, charts, and exports cannot drift.
- **Keystroke accuracy:** correct valid target-directed keystrokes / all valid target-directed keystrokes, including erroneous attempts and corrections.
- **Final-text accuracy:** `max(0, 1 − editDistance(submitted, expected) / max(expected.length, 1))` for the target segment due at completion.
- **Consistency:** a documented, bounded transformation of valid IKI dispersion; higher is steadier.
- **Stable speed:** a conservative estimate from enough valid samples and uncertainty, never a single peak.
- **Active time:** excludes pauses, blurred periods, throttling, and configured long-pause intervals.

Client monotonic timestamps support interval calculation; receipt/server timestamps support durable ordering and audits. Only keys within the active SymType input surface are captured. Custom text and event data never leave the machine.

## 11. Reliability, security, and compatibility

- Production/local server binds to `127.0.0.1`, validates Host and Origin, rejects cross-origin mutation, protects state-changing routes from CSRF/DNS rebinding, serves a strict CSP, and renders custom content as plain text.
- SQLite uses migrations, foreign keys, WAL, busy timeout, bounded transactional event batches, idempotent batch/session sequences, checkpoints, integrity checks, and graceful close. Migration failure never triggers silent destructive rebuild.
- Application data uses the OS data directory and supports `SYMTYPE_DATA_DIR`; only ignored development/test databases live in the repo.
- After first install, ordinary launch and runtime are offline. No CDN fonts, scripts, sound, or images.
- Launchers for macOS, Windows, and Linux anchor to their own directory, validate the supported Node LTS, install only when required, build/migrate when required, reuse or start an instance, wait for health, open the final URL, log to the data directory, and keep readable failures visible.
- Current two major Chrome and Safari versions are supported; release evidence includes Playwright Chromium and WebKit flows and screenshots at desktop and approximately 1024px width.

## 12. Accessibility and visual acceptance

System fonts, an 8pt spacing rhythm, warm neutral surfaces, one primary accent, semantic status colors, clear hierarchy, and restrained 120–240ms motion define the visual language. Themes are light/dark/system. Important targets are approximately 44×44px, focus is always visible, color is never the sole cue, and contrast meets WCAG 2.2 AA. `prefers-reduced-motion` is honored. No critical behavior is hover-only.

The seven-axis release rubric in [ui-rubric.md](./ui-rubric.md) must score at least 9/10 with real Chromium and WebKit evidence. The full traceability gate lives in [requirements-matrix.md](./requirements-matrix.md).

## 13. Definition of done

SymType is complete only when all user-visible controls operate on real data; SQLite history survives browser reset/change; every listed mode and six game levels works; mapping and adaptive-engine invariants are tested; backup/restore is safe; Chromium and WebKit critical paths and screenshots pass; all quality commands pass; documentation supports a clean install and recovery; and the final independent audit finds no unexplained pending item, critical TODO, fake statistic, dead control, console error, or silent data-loss path.
