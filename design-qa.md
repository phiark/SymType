# Design QA — focused training correction batch

## Sources

- Keybr interaction reference:
  <https://github.com/user-attachments/assets/b0448ad6-81d0-4ddb-8dc6-bed7768db340>
- Keybr keyboard reference:
  <https://github.com/user-attachments/assets/9047e332-d5e7-4d55-bb31-4a39e2ce77ff>
- Keybr keyboard-state reference:
  <https://github.com/user-attachments/assets/09b20a2e-12fb-4ef4-ae52-d5d92965203c>
- Implementation source: `fix/14-typing-session-ui-batch`, local production server on port 4187.

## Capture conditions

- Required browser: Chrome, as selected by the maintainer.
- Required states: active practice, all five glyph states, ANSI keyboard target state, paused
  dialog, and guarded exit confirmation.
- Required viewports: desktop 1224×800 plus 1024px and 200% reflow checks.
- Density: system display density, recorded with the eventual Chrome captures.

## Combined comparison

No final combined source/implementation comparison is recorded yet. Chrome is running, but the
active profile does not have the ChatGPT Chrome Extension installed/enabled, so the implementation
state cannot be captured or inspected through the selected browser. Safari is intentionally not used
as a substitute.

## Iteration history

1. Replaced the completed-looking filled current glyph with an outlined current cue and exposed
   current, untouched, correct, incorrect, and corrected semantic states.
2. Rebuilt the virtual keyboard from the shared ANSI column/width data and strengthened finger-zone,
   boundary, home-key, and target cues without changing any of the 54 mappings.
3. Added a contained Continue/Exit pause dialog that delegates exit to the existing guarded owner.
4. Removed redundant active-session labels while retaining progress, metrics, recovery, pause, and
   exit.
5. Passed component/accessibility assertions and the complete Node 22 non-browser quality gate.

## Final result

blocked
