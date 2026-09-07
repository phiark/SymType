# Design QA — Issue 18 product journey

Date: 2026-09-07. Source: `origin/main` at `481a2cb`. Candidate: `refactor/18-product-experience`.

[The product review](docs/v2/ISSUE-18-PRODUCT-REVIEW.md) records the prioritized findings, source
references, before/after captures, interaction health, measurement, checks and rollback. All captures
use synthetic local data. Original screenshots are under `docs/v2/evidence/issue-18`.

## Capture and review conditions

- Manual: Codex in-app browser, 1280×720, system display density, isolated local database.
- Automated: Chromium and WebKit, desktop/1024px, light/dark/system theme and reduced motion.
- Dynamic coverage: five glyph states, actual ANSI keyboard cues, pause, Tab/Enter exit,
  guarded save/exit, configuration focus return, sticky settings save, recovery and completion.
- Existing Playwright screenshot baselines are reviewed and updated for the deliberate changes.
  Axe, overflow, reflow and keyboard behavior remain independent functional assertions.
- A physical Safari manual run is not claimed. The July Chrome-extension limitation is retained
  below as historical context; current evidence names the browsers actually used.

## Iteration decisions

1. Put the existing primary task before optional scope filters, catalogues and experiment controls.
2. Preserve selected context in disclosure summaries and return keyboard focus after panel closure.
3. Retain the Issue 14 glyph, keyboard and guarded-pause corrections, then validate actual input.
4. Keep saved-state feedback and Save visible through the settings journey.
5. Recover a failed lazy page with a plain reload action and home link, with saved-state guidance.
6. Verify every original mode and the data/backup lifecycle; measure performance separately from
   visual appearance.

## Historical Issue 14 references

The earlier branch was `fix/14-typing-session-ui-batch`; it passed component checks but recorded an
unavailable Chrome extension. It had no completed visual acceptance and is not evidence of a manual
Chrome pass. Its source is incorporated with `git cherry-pick -x` and revalidated here.

- [Typing reference](https://github.com/user-attachments/assets/b0448ad6-81d0-4ddb-8dc6-bed7768db340)
- [Keyboard reference](https://github.com/user-attachments/assets/9047e332-d5e7-4d55-bb31-4a39e2ce77ff)
- [Keyboard-state reference](https://github.com/user-attachments/assets/09b20a2e-12fb-4ef4-ae52-d5d92965203c)

## Delivery state

The Issue 18 review and its [acceptance log](docs/v2/evidence/issue-18/ACCEPTANCE.md) are the current
record. All 30 tracked PNGs were inspected at original resolution; UI-REVIEW-006 records the current
visual result. The final non-update browser suite passed 85 cases with one intentional skip. Repository delivery still requires its linked
PR to pass CI and receive an independent approving review before merge.
