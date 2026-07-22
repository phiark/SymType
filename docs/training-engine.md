# Training Engine

## Observable scope

The engine estimates performance for keys assigned to hands/fingers by the current mapping. It cannot
observe real finger motion and labels every such aggregate as “mapped key-zone performance.”

## Metrics

- Standard WPM is `(characters / 5) / minutes`; raw WPM includes all accepted presses, net WPM applies
  the documented uncorrected-error penalty.
- Keystroke accuracy is correct accepted presses divided by accepted presses. Final-text accuracy uses
  edit distance between submitted and target text.
- Stable IKI uses eligible correct events only, then median/MAD or a clipped EWMA. Long pauses,
  refocus-first keys, repeats, composition, and browser-throttled events are excluded.
- Correctness uses a Beta posterior with a mild prior; speed keeps short and long robust estimates,
  recent windows, sample count, recency, and uncertainty.

## Priority

Behavioral signals are normalized to `[0,1]`; sample counts and elapsed hours retain their natural
non-negative ranges. With the server's shipped settings, the production formula is:

```text
need = .34 accuracyShortfall + .28 speedShortfall
     + .12 uncertainty + .06 errorRecoveryCost

confidence = .45 + .55 * (1 - exp(-featureSamples / 18))
forgetting = min(1.8, 1 + .18 * ln(1 + hoursSincePractice / 12))
             # 1.25 when the feature has never been practiced
exploration = .20 * sqrt(ln(max(2, totalCandidateSamples + 1))
                         / max(1, featureSamples + 1))

positive = need * confidence
                * (1 + .45 * (forgetting - 1))
                * (1 + .12 * transferValue)
                * (1 + .08 * userFocus)
           + exploration

priority = max(0, positive - .30 * recentOveruse - .35 * fatigue)
```

The confidence floor prevents new evidence from multiplying need to zero; the separate UCB-style
exploration term samples uncertain candidates. Transfer and explicit focus are bounded multipliers,
not additive shortfall terms. The score is non-negative and intentionally has no arbitrary upper clamp;
only relative ordering is consumed by the scheduler. Advanced Settings can override the six displayed
coefficients (accuracy, speed, uncertainty, recovery, transfer, and focus); forgetting, exploration,
overuse, and fatigue retain the versioned engine defaults. These weights, the default 94% difficulty
hold, and 97.5% progression threshold are adjustable engineering hypotheses—not scientifically optimal
constants.

## Lesson policy

An intelligent lesson contains deterministic 20–60 character micro-blocks. A visible block never
changes. At each boundary, fresh events update candidates and the next block is scored for focus
density, readable naturalness, repetition, difficulty, hand alternation, same-finger load, frequency,
and recency. The current seeded allocation is explicit and range-tested; `comfort` is the combined
warm-up and final fluency/control share:

| Evidence band | Duration | Warm-up | Focus | Retest/interleave | Transfer | Fluency | Combined comfort |
| ------------- | -------- | ------- | ----- | ----------------- | -------- | ------- | ---------------- |
| below 94%     | ≤5 min   | 10%     | 45%   | 20%               | 18%      | 7%      | 17%              |
| 94–97.5%      | ≤5 min   | 10%     | 40%   | 20%               | 20%      | 10%     | 20%              |
| ≥97.5%        | ≤5 min   | 10%     | 35%   | 20%               | 25%      | 10%     | 20%              |
| below 94%     | >5 min   | 8%      | 45%   | 20%               | 20%      | 7%      | 15%              |
| 94–97.5%      | >5 min   | 8%      | 40%   | 20%               | 20%      | 12%     | 20%              |
| ≥97.5%        | >5 min   | 8%      | 35%   | 20%               | 25%      | 12%     | 20%              |

Thus focus remains 35–50%, retest 20–30%, transfer 15–25%, and comfortable
control/exploration 10–20%. These are adjustable engineering hypotheses rather than research-proven
optima.

Low accuracy produces shorter blocked practice and easier context. Stable 97–98% performance expands
interleaving and target rhythm. A focused block is followed by a control/transfer block. Five-minute
lessons still perform warm-up, focus, transfer, and a saved review.

## Error classification

The event analyzer distinguishes adjacent-key confusion, adjacent transposition, repeat, omission,
slow-correct, post-error slowing, combination bottleneck, same-finger cross-row load, mapped hand/finger
imbalance, Shift-side mistakes, number/shift-symbol confusion, burst-error clusters, and possible fatigue.
Adjacent transposition consumes both positions once so it is not double-counted as two substitutions.
“Possible fatigue” is a behavioral window label, not a diagnosis.

## Baseline and experiment

The `keybr-like baseline` is a documented local comparator that weights weak single characters and
gradually unlocks them. It does not claim to reproduce Keybr. A seeded simulation checks starvation,
oscillation, outlier resistance, exposure, 24h/72h retention, unseen-text transfer, and calibration.
Two-week optional experiments assign strategy by date/session, never rapidly within a day, and report
sample sizes/uncertainty or “尚无结论”.

### Deterministic simulation and replay contract

`packages/shared/src/training-simulation.ts` is a pure, seeded harness around the production adaptive
and `keybr-like-baseline` selectors. A scenario explicitly declares each simulated feature's starting
accuracy and IKI, target/minimum IKI, optional learning and forgetting rates, and whether it is a
held-out transfer feature. Defaults are engineering fixtures: they are not estimates of a particular
person and they do not encode a biological learning model. Running the same scenario and seed produces
the same ordered replay events and report.

Every simulated accepted exposure records the scheduler strategy, session/round, feature and kind,
prediction before observation, outcome, IKI, character count, and timestamp. The replay evaluator
reconstructs rolling/long-term feature state from those events and reports:

- effective correct characters per active minute;
- characters, correct characters, and active minutes when all declared mastery features first meet
  the configured posterior-accuracy, conservative stable-WPM, and minimum-sample gates;
- modeled 24-hour, 72-hour, and 7-day retention projections, always labelled `modeled: true`;
- the held-out-minus-trained WPM/accuracy transfer gap, with the held-out sample count;
- pre-observation Brier score and log loss;
- per-feature exposure, posterior change, and first-window versus last-window observed change.

The diagnostic layer measures maximum selection gaps for every strategy-eligible feature, rapid A-B-A
selection returns, and the relative change in a robust IKI estimate after injecting one extreme sample.
Comparator starvation is evaluated only across the single-character features that comparator is
designed to schedule; an intentionally unsupported bigram is not silently counted as a baseline
scheduler failure. Diagnostics with too few windows/speed samples say `insufficient` rather than pass.

The comparison result has no `winner` field. Below the predeclared session, event, retention-feature,
or held-out-feature thresholds it returns the exact state `尚无结论`. Above them it returns
`仅可描述` and still says that a parameterized offline model cannot establish causal benefit,
statistical significance, or faster real-user learning. Real 24h/72h/7d retention and unseen-text
transfer must come from the balanced local experiment, not from the simulator's projections.

### Live SQLite personal report

The production report uses only completed local training sessions and their persisted events,
separated by recorded `adaptive` or `baseline` strategy. A comparison becomes eligible for descriptive
language after at least 14 distinct training dates and five completed sessions in each strategy; it
still has no winner or significance claim. Each group exposes:

- cumulative correct characters and active minutes at the first completed session whose event stream
  has at least 20 valid timing samples, conservative stable WPM at or above the configured target,
  and observed accuracy at or above the configured progression threshold;
- unique focus→retest pairs with identical mode/focus context in 18–36h, 60–84h, and 144–192h
  windows for the displayed 24h, 72h, and 7d checks. A baseline block is used at most once per window;
  at least two pairs are needed before mean accuracy/stable-WPM deltas are descriptive;
- median eligible IKI for keys marked immediately after an error, shown only from three samples;
- online per-character Beta(2,1) predictions scored before each observation with Brier score and log
  loss. Five probability buckets require five samples each for displayed predicted/observed values,
  while overall expected calibration error requires at least 30 observations;
- first-five versus last-five change for characters that were initially below the configured
  accuracy or stable-speed target. Each character needs ten observations and the aggregate remains
  limited until three initially weak characters exist.

Transfer WPM compares designated natural/unfamiliar modes with focus modes; effective correct
characters/minute uses persisted session active time. Subjective difficulty/fatigue and abandonment
rate remain separate contextual measures. Missing timing, scheduled retest, context match, feedback,
or exposure stays a count plus `null`/“尚无结论”; simulated projections are never substituted.
