# Hardware, device and human-play protocols

Masterplan §4.3, §7.6, §21.1–21.2, §23, WP05, WP15, WP21, WP31. These protocols define *how*
evidence is produced; none of the evidence exists yet. CI's Mesa/SwiftShader software GPUs prove
correctness and workload counts, never player frame rates (§23.1).

## 1. Reference machines (to be named)

| Role | Required record | Status |
|---|---|---|
| Reduced-hardware (integrated GPU) | CPU, GPU, RAM, OS, driver, browser/runtime version, display, power mode | not named |
| Core PC (mainstream discrete GPU) — 1920×1080, 60 FPS target | same | not named |
| Higher-end reference — 120 FPS option | same | not named |

Minimum requirements may only be published from these captures.

## 2. Capture procedure (WP05)

1. Build the exact commit; record `BUILD /` identity from the menu footer.
2. Warm run once (shader caches), then capture. Cold-start captures are a separate test.
3. Use the existing *Performance capture* (Pause → Performance capture → Export JSON) and the
   draw-ledger pass report (`renderer.stats()`), plus the browser profiler for CPU/GPU timing.
4. Record frame-interval distribution (p50, p95, p99, max), CPU main-thread time, GPU time, worker
   step time (`H.STEP_MS`), worker backlog (`H.DROPPED`), input age, and GPU gate
   `deferredCallbacks`/`expiredFences`.
5. "1% low" means the mean of the slowest 1% of frame intervals in the capture; it is not the p99.

### Workload matrix (§23.3)

| Scene | Fixed state |
|---|---|
| Menu idle | Aurel, day |
| First load to grid | cold and warm |
| Start grid, packed first corner | 12 cars, chase camera |
| Close mirrors | cockpit, two cars within 10 m |
| Pit service | full crew, trackside camera |
| Wet night traffic | rain preset, night, 12 cars |
| Wide replay | trackside replay director |
| Photo mode | studio and circuit backdrops |
| Long session | 60 min practice: memory/resource trend |
| Rapid restart ×20 | resource counts after each |
| Venue transition Aurel ↔ Vellamar ×10 | no monotonic growth (WP15) |

### Budgets to test (hypotheses, §23.2)

Main thread ≤ 5 ms (p95), GPU ≤ 12 ms (p95) at the core profile, worker below its tick deadline.
CPU, GPU and worker overlap: never add them.

### Headless server workload

`npm run test:server` records CPU per simulated second, realtime factor, worst step and heap growth
for an 8-car race; repeat on the core PC for an operating-cost model (§22.7).

## 3. Device matrix (WP31, §21.1)

| Device | Connection before launch | Hot-plug | Unplug mid-race (safe state) | Reconnect with held buttons | Remap | Calibrate | Result |
|---|---|---|---|---|---|---|---|
| Keyboard | — | — | — | — | | | not run |
| Standard gamepad (name/firmware) | | | | | | | not run |
| Racing wheel (name/firmware) | | | | | | | not run |
| Separate pedals (if claimed) | | | | | | | not run |
| Desktop wrapper input route | | | | | | | not run |

Record OS/browser versions per row. Steering-axis support is not force feedback; FFB needs the
native bridge study (§21.2): capability query, gain/clipping/damping, stop on pause, focus loss,
disconnect and fault, bounded values only.

## 4. Human playtest protocol (§4.3, §7.6, WP21)

Cohorts: circuit-racing players; motorcycle/off-road players (for G4/G5); less experienced gamepad
players. At least five per cohort per gate.

Session script (Formula, both circuits, dry then changeable):

1. Controller-only: launch → menu → race start (no mouse).
2. Practice 10 min, then a 5-lap race from mid-field.
3. Hairpin braking, wet-corner recovery, two-wide contact avoidance, chase-camera crests, pit entry
   and service, race finish, replay, restart.
4. Repeat with assists off for experienced players.

Record device, assists, weather, camera, resolution, duration, lap times, incidents. Ask: what did
you understand, why did you lose control, did you want another attempt, what was unclear in the
rules or HUD? Keep raw notes with session ids; summarise against the dashboard metrics.

Handling sign-off (§7.6) needs a full stint, repeated restarts, a wet transition and adverse-contact
recovery per vehicle. A fast AI lap is not a feel test.

## 5. Audio acceptance (§20.6)

Headphones, speakers, low volume, mono, mute, 44.1/48 kHz, interrupted audio context, replay seek,
rapid camera switches. Keep one reference recording per vehicle family and venue acoustic type.
