# Replay clocks and the F01 causal note

Masterplan §24.2 (four clocks), §24.7 (definition of a fixed bug), F01 / WP01–WP03.

## 1. The four clocks

| Clock | Unit and owner | Advanced by | Never advanced by |
|---|---|---|---|
| **Simulation tick** | integer `H.TICK`; physics worker (`Simulation.step`, 120 Hz) | worker fixed-step loop | rendering, wall time while paused |
| **Recorded-session time** | seconds `H.TIME` in recorded frames; `SessionReplay` | appended worker snapshots (≥ 1/15 s apart) | playback |
| **Replay playback position** | seconds from `SessionReplay.start`; `ReplayClock.position` | `ReplayClock.target()` from wall time × rate, capped at 0.5 s per callback | a seek (sets it), a covered/hidden view |
| **Presented frame time** | seconds; `renderer.presented` (interpolated a/b) | a submitted draw of the target position | anything else |

Conversions: `recorded = replay.start + position`; the presented time is the interpolation of the two
recorded frames around `recorded`. `ReplayClock.presented(target)` is the only place the playback
position commits, and only after a frame for that position was actually drawn. A seek is drawn once
before playback advances again (`seekPending`).

Rules:

* A wall-clock wait is not evidence that simulation or replay time advanced.
* A rendered frame is not necessarily a new simulation state (held replay redraws the same instant).
* Logical replay progress does not depend on the scene being drawn; presentation does.

## 2. F01 causal note

**Symptom (hosted run 38508093498, browser shard 6).** After seeking to just before the recorded pit
service and pressing play, `renderer.pitState.time` stayed at 124.19 s while the test waited for
124.37 s; `replayPlaying` remained `true` for 120 s.

**Previous hypotheses and why they were incomplete.** The commit history shows the recording was
first suspected of ending too early, so the test was changed to record longer and to check data
coverage (`fix(e2e): capture enough post-pit replay…`). The coverage check passed in the failing run,
so the recording did contain the target; the hypothesis explained an earlier failure, not this one.
Timeout increases were rejected (masterplan §24.7).

**New evidence (local reproduction, SwiftShader, instrumented build).**

1. With replay-clock diagnostics, a seek inside the held replay never presented:
   `gpu = {pending: true, submitted: 15, completed: 14, deferredCallbacks: 18237}`; replay pages were
   all resident (`failed: []`, `pending: []`, `buffering: 0`). Playback logic was not starved of data;
   presentation was refused.
2. Before that, the anchored seek reported pit phase 0: `pitState.car = 3`. The trackside replay
   director had picked the "closest battle" at the shot boundary and followed car 3 during the
   player's own pit visit.

**Corrected mechanisms.**

* `GpuFrameGate` limits presentation to one unfinished GPU submission by polling a WebGL fence with
  a zero timeout. Browsers refresh fence status as further GL work and frames flow. When the gate
  itself withholds every draw — a held or seeking replay submits nothing else — the poll can report
  `TIMEOUT_EXPIRED` forever. The replay clock then never commits a target (it only commits presented
  frames), so playback appears frozen while `replayPlaying` stays true: exactly the hosted symptom.
* The replay director ranked race events below battles, so a pit-service replay could follow
  another car.

**Fixes.**

* The gate releases an unrefreshed fence after `max(1 s, 4 × smoothed completion latency)`, capped at
  10 s. Latency is learned only from continuously polled completions (a fence first looked at after
  an idle period is not a sample) and widened on expiry, so a genuinely slow GPU converges without a
  backlog. Unit regressions: `tests/gpu-frame-gate.test.ts` (never-refreshed fence; slow GPU; idle
  observation).
* The director follows the player's pit visit, else a rival stationary in service, before battles
  (`pitSubject`, `tests/replay-photo.test.ts`).
* Independent replay-clock regression without rendering: `tests/replay-clock.test.ts` (advance,
  pause, seeks across sealed pages, play to the exact end, restart from the end, rate, step cap,
  rapid repeated controls) over an in-memory `SessionReplay`.
* The pit journey assertions are unchanged; on failure it now reports page residency, buffering vs
  GPU-deferred callbacks and gate state instead of an opaque timeout.

**Prevention.** Presentation gates must have a bounded wait and an observable expiry count
(`expiredFences`). Replay tests report the replay-clock witness. New presentation subjects (events)
must be ranked explicitly in the director.

**Closure criteria (§24.7) and current status.**

| Criterion | Status |
|---|---|
| Mechanism understood | yes (above) |
| Smallest useful regression fails before / passes after | yes: the deadlock test fails with the bound disabled; replay-director test fails without `pitSubject` |
| Full affected journey works | pending: local SwiftShader runs progressed past the previously failing seeks; the hosted Mesa shard must pass on the exact source |
| Unrelated contracts intact | unit suite; hosted CI required |
| Corrected artifact published through the release route | pending (WP03) |

F01 is therefore **not closed** until the hosted Build and validation run is green on this source and
publication consumes that artifact.
