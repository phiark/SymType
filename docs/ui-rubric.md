# SymType UI Quality Rubric

**Gate:** every dimension must score **9/10 or higher** in both Chromium and WebKit before release.
**Initial state (2026-07-20):** not scored; no implementation or render evidence existed then.
**Current checkpoint (2026-07-21):** all 28 defined PNGs have been generated and the first read-only
review inspected every available image. They are evidence inputs, not accepted baselines: the review
found unequal browser histories, implausible automation WPM, a WebKit onboarding-position defect,
native-control inconsistency, browser-specific network copy, and a zero-input false-success state.
The first focused replay also found real WebKit mapping-header contrast below 4.5:1. Remediation is in
the tree; regeneration, normal-mode replay, and a second complete human review remain required, so no
release score is assigned yet.

## Scoring method

Score observed behavior, not intent or DOM presence. A dimension receives the lower of its Chromium and WebKit scores. Any severity-1 defect (blocked primary task, data-loss implication, inaccessible critical control, unresolvable overlap, fabricated data, or dead control) caps the relevant dimension at 5 and blocks release.

- **0–4:** missing, misleading, or blocks core use.
- **5–7:** functional on a happy path but with material gaps, inconsistency, or accessibility defects.
- **8:** solid, with specific visible or state-completeness issues still to fix.
- **9:** release-quality; no material issue, only small polish opportunities.
- **10:** exemplary and unusually robust across all required states; use sparingly and cite evidence.

For each review, record screenshot path, browser/project, viewport, theme, data fixture, route/state, date, console/a11y result, issue IDs, and reviewer. Do not raise a score based only on an automated assertion.

## Required review matrix

Review at minimum:

- **Engines:** Playwright Chromium and WebKit.
- **Widths:** 1440×900 and approximately 1024×768; add 1280×800 for training text. No horizontal page scroll.
- **Themes/motion:** light, dark, system behavior, and reduced motion.
- **Data states:** empty/new, sparse, normal, large (100k-event fixture), loading, saving, server disconnected, recoverable error, and destructive-action confirmation.
- **Surfaces:** welcome, calibration and result, Today, each training-mode entry, active training, completion, Test, Game map/brief/play/failure/success, Analytics, Settings/search/mapping editor, import warning, export, backup/restore summary.
- **Interaction:** keyboard-only journey, pointer, focus recovery, zoom to 200%, sound locked/unlocked/failure, IME composition, blur/pause, Escape confirmation, deep-link refresh.

Three of the eight Keybr reference screenshots requested by the brief are now available and were
reviewed as interaction references, not pixel-match targets. The complete functional inventory and
ANSI 101/Symmetric comparison remain **Blocked** on the other five.

## 1. Visual hierarchy

### 9/10 acceptance

- Every page has one clear primary purpose; the dominant action is obvious without a decorative hero.
- Type scale, spacing, alignment, borders, and shadow consistently distinguish page, section, group, control, and supporting metadata.
- Today prioritizes start/goal/weakness decisions; training prioritizes text/caret/status; completion prioritizes saved outcome and next action.
- Semantic success/warning/error colors appear only where meaningful. One primary accent remains visually dominant.
- Dense analytics and settings use progressive disclosure instead of undifferentiated card grids or an endless form.
- Focus mode removes nonessential navigation without hiding safety, pause, or exit controls.

### Deductions

- −2: competing primary actions or important status visually subordinate.
- −1 each: inconsistent page title rhythm, gratuitous oversized heading, card-within-card clutter, decorative gradient text, excessive glass/rounding, or semantic colors used decoratively.

## 2. Readability

### 9/10 acceptance

- System font stack renders crisply in both engines; no remote/proprietary font files.
- Training measure is comfortable and centered; configurable size/line height/caret remain legible without layout jump.
- Target, correct, current, error, corrected, whitespace, newline, and paused states are distinguishable without relying only on hue.
- Numbers identify units, time range, samples, exclusions, and uncertainty; explanatory text uses observable, plain language.
- Long code/text preserves spaces/newlines while wrapping or scrolling within a deliberate bounded area.
- Empty and sparse states explain what is missing and the next useful action without showing fake points.

### Deductions

- −2: training line spans an exhausting width, text clips, or caret/whitespace is ambiguous.
- −1 each: low-information microcopy, unexplained acronym, overprecision, missing unit/sample label, or dense paragraph where a short table/list is clearer.

## 3. State completeness

### 9/10 acceptance

- Every asynchronous control has idle, hover (nonessential), focus, active, disabled, loading, success, and failure behavior where applicable.
- Save/batch/checkpoint status is understandable; completion is not shown before persistence acknowledgment.
- Server disconnect preserves safe queued work, explains retry, and never pretends data is saved.
- Onboarding skip paths, no planned category, audio denial, unsupported import, restore rejection, migration/health failure, and session recovery have actionable outcomes.
- Timed activity auto-pauses on blur; normal and Hardcore failure resets are visually and behaviorally unambiguous.
- Destructive restore/import steps summarize impact and confirm a pre-restore backup.

### Deductions

- −3: dead control, false success, unrecoverable silent error, or data state that contradicts the server.
- −1 each: missing empty/loading/error state, ambiguous disabled control, stale indicator, or toast-only critical information.

## 4. Consistency

### 9/10 acceptance

- Navigation, page shells, panels, tables, dialogs, buttons, segmented controls, fields, tooltips, chart legends, and status language use shared tokens/components.
- 8pt spacing rhythm and approximately 44×44px important targets hold across routes.
- Practice/test/game share metric definitions but remain clearly labeled and filtered.
- Active keyboard preset, mapped-finger terminology, Shift-side labels, and warnings are identical wherever they appear.
- Restart, pause, exit, save, retry, import, export, and restore semantics do not change unexpectedly across modes.
- Icons supplement visible labels or accessible names and come from the approved local icon set.

### Deductions

- −1 each recurring family: one-off spacing/color/radius, synonymous metric names, conflicting button order, inconsistent keyboard shortcuts, or bespoke component where a shared one exists.

## 5. Accessibility

### 9/10 acceptance

- WCAG 2.2 AA contrast in both themes; status and keyboard zones have text/icon/pattern/position cues in addition to color.
- All functionality is keyboard reachable in a logical order with a clear Safari-compatible focus indicator and no trap.
- Landmarks, headings, labels, descriptions, validation, dialogs, live status, tables, and chart summaries expose meaningful accessible names/roles.
- `prefers-reduced-motion` and the explicit setting suppress nonessential movement; no flashing or motion-dependent instruction.
- Important targets are approximately 44×44px; hover reveals no unique action.
- 200% zoom and 1024px width preserve tasks without hidden controls or horizontal page scroll.
- Sound cues have visual equivalents, and sound-unlock guidance is not blocking.

### Deductions

- −3: keyboard-blocked critical flow, unlabeled critical input, focus loss after dialog/route change, or color-only correctness.
- −1 each: incorrect heading order, missing error association, weak contrast, inaccessible chart, motion leak, undersized repeated target, or live-region chatter during typing.

## 6. Responsiveness

### 9/10 acceptance

- At 1024px, navigation, training metrics, keyboard, dialogs, charts, tables, and mapping editor fit or use intentional component-level scrolling.
- Training input feedback remains immediate; each keystroke updates only the necessary path and does not shift layout.
- Resize, theme change, virtual-keyboard toggle, and long content do not obscure the caret or primary controls.
- Charts reflow with readable axes/legend and retain their accessible summary.
- WebKit and Chromium show no meaningful clipping, focus-ring cropping, sticky overlap, or font-metric breakage.

### Deductions

- −2: page-level horizontal scroll, obscured target/caret, or unusable chart/table at a required viewport.
- −1 each: breakpoint jump, clipped focus ring, wrapping button label, sticky collision, keyboard overflow, or layout shift on metric update.

## 7. Real-data credibility

### 9/10 acceptance

- Every value traces to SQLite-backed API data or is clearly labeled preview/demo fixture in test-only environments.
- Date range, mode, mapping version, algorithm version, sample size, uncertainty, excluded intervals, and metric definitions are available where they affect interpretation.
- Training, test, and game data are visually distinct; test rankings contain tests only.
- Sparse evidence says “insufficient sample” or “no conclusion”; peaks are not labeled mastery/stable speed.
- Recommendations expose measurable reasons and avoid causation, actual-finger detection, neurological language, or false statistical significance.
- Export, backup, restore summary, and on-screen totals reconcile for the same fixture.

### Deductions

- −4: hard-coded fake statistic presented as user history, fabricated chart, or mismatch implying saved data that is absent.
- −2: missing sample/uncertainty where a strength claim is made, or mixed mode data presented as comparable without disclosure.
- −1 each: unexplained rounding, stale range label, inconsistent total, opaque recommendation, or ambiguous “best/mastered” wording.

## Review ledger

Do not enter a score until evidence exists.

| Review ID     | Build/commit                                           | Browser + viewport                                                                      | Fixture/state                                                                                                                              | Evidence                                                                                                                                                                           | Scores H/R/S/C/A/Resp/D                      | Issues                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Result                                                                                                    |
| ------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| UI-REVIEW-001 | Current tree                                           | Chromium 1280px, full page                                                              | Analytics, empty 7d                                                                                                                        | `tests/e2e/analytics-settings.spec.ts-snapshots/analytics-chromium-chromium-darwin.png`; inspected 2026-07-21                                                                      | Not scored                                   | Clear hierarchy and truthful empty states; only one engine/state, no required 1024 evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | In progress                                                                                               |
| UI-REVIEW-002 | Pre-remediation render                                 | Chromium + WebKit; 1024/512/full page                                                   | 28-image first-generation set                                                                                                              | `tests/e2e/*-snapshots/*.png`; every available image inspected 2026-07-21                                                                                                          | Not scored                                   | Unequal histories, implausible WPM, WebKit progress/range differences, native network strings, zero-input success; regenerate after fixes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Failed input                                                                                              |
| UI-REVIEW-003 | Node 24 post-remediation RC, 2026-07-21                | Chromium + WebKit; 1024×768/900, 512×768 reflow, 1280px full page                       | 30-image clean-install, sparse/normal, disconnected, active/dialog, zero/nonzero completion matrix                                         | `tests/e2e/*-snapshots/*.png`; all 30 images inspected at original resolution 2026-07-21 after the 20/20 regeneration run                                                          | Chromium 9/9/9/9/9/9/9; WebKit 9/9/9/9/9/9/9 | No open severity-1/2 issue in the captured matrix: empty Today/Analytics/game states agree; disconnected copy is Chinese; zero-input test is neutral and excluded while nonzero outcomes are credible; calibration labels effective activity/sample count; WebKit selects/ranges are 44px and visually consistent; focus, heatmap readability, 200% reflow, and clipping checks pass. Screenshots do not replace real-Safari audio listening or uncaptured release-matrix states.                                                                                                                                                                                                                                                                                                                                                                                                       | Superseded by the later zero-evidence completion and empty-Analytics source change; historical score only |
| UI-REVIEW-004 | Current zero-evidence/empty-Analytics tree, 2026-07-21 | Chromium + WebKit; 1024×768/900, 512×768 reflow, 1280px full page                       | 30-image clean-install, empty Analytics, disconnected, active/dialog, neutral zero-input test, and nonzero training/test completion matrix | `tests/e2e/*-snapshots/*.png`; all 30 current images inspected side by side at original resolution 2026-07-21; full `00-visual-matrix.spec.ts` assertions passed in the latest run | Chromium 9/9/9/9/9/9/9; WebKit 9/9/9/9/9/9/9 | No open severity-1/2 visual issue in the captured matrix. The zero-input test now omits fabricated zero metrics and positive feedback, states that it was safely closed and excluded, and offers clear restart/Today actions; normal completion remains data-bearing and visually distinct. Empty Analytics uses truthful actionable states throughout. Browser pairs retain Chinese disconnect copy, 44px controls, visible unclipped focus, readable heatmap/labels, and overflow-free 1024/200% reflow. The combined visual/onboarding replay passed 14 cases and had two completion numeric-pixel mismatches; the self-contained completion replay then passed 2/2 after setting its own dark theme and applying the documented 0.1% structural ceiling. Overall full E2E, real-Safari audible listening, and uncaptured release-matrix states remain outside this visual sign-off. | Pass for the current 30-image visual matrix; no overall release sign-off while full E2E remains pending   |
| UI-REVIEW-005 | `fix/14-typing-session-ui-batch`, 2026-07-24           | Maintainer-selected Chrome; desktop, 1024px, and 200% pending                           | Active practice, five glyph states, ANSI keyboard target, paused dialog, guarded exit, representative alerts                               | `design-qa.md`; source references recorded, implementation screenshots and combined comparison unavailable                                                                         | Not scored                                   | Current Chrome profile lacks the ChatGPT Chrome Extension. Tracked pre-batch PNGs are intentionally unchanged and cannot be treated as current evidence.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Blocked; do not update baselines or claim visual completion until Chrome evidence exists                  |
| UI-REVIEW-006 | Issue #18, source `e818c6d`, 2026-09-07                | Chromium + WebKit; 1024px, 512px reflow proxy, 1280px full page; in-app manual 1280×720 | All 30 tracked PNGs, six-route before/after, five input states, pause/exit, settings, lazy route/error recovery                            | `docs/v2/ISSUE-18-PRODUCT-REVIEW.md`; `docs/v2/evidence/issue-18/ACCEPTANCE.md`; all tracked PNGs inspected at original resolution on this date                                    | Chromium 9/9/9/9/9/9/9; WebKit 9/9/9/9/9/9/9 | No severity-1/2 visual or accessibility defect found in the captured matrix. Primary actions, selected scope, current input, target key, and Save are clear. Empty/sparse states remain truthful; browser timing values are live and may differ between engines. Physical Safari audio, historic browser majors, and missing external references remain outside this evidence.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Pass for this captured product matrix; independent repository approval remains required                   |

Score key: H hierarchy, R readability, S state completeness, C consistency, A accessibility, Resp responsiveness, D real-data credibility.

## Issue 18 score rationale and boundaries

The seven 9/10 scores apply to the inspected matrix, not a blanket quality or accessibility
certification. Hierarchy follows the primary practice loop; readability keeps system type and a clear
input measure; state completeness includes neutral empty results, active/corrected input, saving,
exit and failure recovery. Consistency retains shared controls, six routes and metric definitions.
Accessibility combines non-color keyboard cues, current focus/axe assertions and manual keyboard
pause/exit. Responsiveness combines the paired 1024px/reflow screenshots with production input
measurements. Credibility uses real SQLite counts, explicit sample absence and full-report equality.

The remaining point in each dimension is reserved for evidence beyond this bounded review: new-user
comprehension, sustained use, unrecorded state combinations, native assistive-technology/listening
sessions, historical browser versions and longitudinal training outcomes. This review does not
invent those observations. Dense specialist analysis/settings content is still available below the
primary task; optional refinement does not block this product convergence. The current suite compares
the reviewed baselines without an update flag. UI-REVIEW-005 remains a historical environment block.

## Release sign-off

Release sign-off requires:

1. a completed ledger with dated Chromium and WebKit evidence for every required surface/state;
2. all seven dimension minima at 9/10 after fixes;
3. no open severity-1/2 visual or accessibility defect;
4. Playwright visual baselines reviewed, not blindly updated;
5. zero unexpected browser-console errors on critical flows;
6. the Keybr screenshot feature/mapping inventory completed when the missing inputs are supplied, or explicitly retained as an external Blocked item in the release report.
