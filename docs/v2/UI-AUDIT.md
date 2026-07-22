# SymType 2.0 Interface Audit

**State:** Complete; final Chromium/WebKit candidate accepted
**Last update:** 2026-07-22

## Audit surface

The audit covers the existing onboarding, Today, Train, active practice, Test, active test, Game,
active game, Analytics, and Settings flows. It also covers dialogs, empty states, loading, saving,
offline, failure, success, light, dark, reduced-motion, and keyboard-only states.

## Evidence rule

`docs/v2/VISUAL-REVIEW.md` is the release evidence record. V2 changes no UI source, so the accepted
30-image Chromium/WebKit matrix is reused only after the final production replay verifies the same
critical routes, states, reflow, focus, and runtime boundaries.

## Required viewports

- 1440-pixel desktop reference.
- 1280-pixel desktop.
- 1024-pixel desktop.
- A supported narrow layout.
- 200-percent zoom checks for critical flows.

## Audit dimensions

- Hierarchy and reading order.
- Existing action clarity.
- Text measure and typing focus.
- Spacing, borders, shadows, radius, and color consistency.
- Complete hover, focus, active, disabled, loading, error, and saved states.
- Contrast, non-color cues, keyboard access, and focus visibility.
- Clipping, overlap, horizontal scroll, and layout shift.
- Chrome, WebKit, and real Safari behavior.

## Findings

The final candidate passed 1024-pixel layout, 200-percent reflow, light/dark training states,
disconnected behavior, populated Analytics, restore, focus, axe, and every game path in Chromium
and WebKit. The accepted matrix has no open severity-1 or severity-2 visual defect. See
`docs/v2/VISUAL-REVIEW.md` for the bounded evidence and honest limits.

## Evidence limits

A screenshot cannot prove keyboard order, screen-reader output, motion behavior, audio behavior, or
full WCAG conformance. Use interaction and automated tests for those properties.
