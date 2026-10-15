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

* After `max(1 s, 4 × smoothed completion latency)` (capped at 10 s) the gate **drains** with
  `gl.finish()` and proceeds. A drain returns at once when only the status was stale and otherwise
  waits for the real outstanding work, so at most one frame is ever in flight. Latency is learned
  only from continuously polled completions and from drains that actually waited. Two intermediate
  designs were rejected on evidence: a fixed 500 ms release, and an adaptive release that submitted
  another frame — both let a software GPU queue work (a camera change then took over 60 s to
  present; `completed` stalled while `submitted` grew). Unit regressions:
  `tests/gpu-frame-gate.test.ts` (never-refreshed fence; slow GPU never two frames in flight; stale
  drain is not a latency sample; idle observation).
* A drain samples only the time `gl.finish()` itself blocked. Hosted run 38662457092 showed the
  first design sampling submit-to-drain-end: that includes the gate's own wait, so on a host that
  never refreshes fence status (and where `finish` costs a few ms of driver overhead) the bound grew
  ×1.6 per frame to the 10 s cap and replay presented one frame per ~10 s. Regression: `does not
  grow its own wait on a host that never refreshes fence status` (fails before, passes after).
* The director follows the player's pit visit, else a rival stationary in service, before battles
  (`pitSubject`, `tests/replay-photo.test.ts`).
* Independent replay-clock regression without rendering: `tests/replay-clock.test.ts` (advance,
  pause, seeks across sealed pages, play to the exact end, restart from the end, rate, step cap,
  rapid repeated controls) over an in-memory `SessionReplay`.
* The service-playback check is a liveness assertion: it fails when playback makes no progress
  for 30 s (the F01 symptom) rather than at a fixed 120 s wall deadline. Hosted runners present
  one 0.5 s replay step every ~5.6–10.5 s on software GL (runs 38662457092, 38671039493: the replay
  advanced steadily and missed the old deadline by one step), so a wall-clock deadline measured
  host speed, not replay correctness.
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
| Full affected journey works | yes on hosted Mesa: run 38637809713 (commit 5c1795d), browser shard 6, `27H.6 populated pit journey` passed in 6.9 min; the replay-clock witness showed pages resident and the position advancing through the service window |
| Unrelated contracts intact | unit suite green; the same run's only browser failures were menu focus-count tests stale after the MACHINE select and EVENTS action (fixed in 3164b6d); re-run pending |
| Corrected artifact published through the release route | pending (WP03) |

F01 is therefore **not closed** until the hosted Build and validation run is green on this source and
publication consumes that artifact.
