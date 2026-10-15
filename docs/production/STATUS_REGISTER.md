# Implementation and acceptance register

Masterplan WP04 / F14 / §29.2. One row per major feature and per work package. Every row
carries exactly one state; "done" is not a state.

| State | Meaning |
|---|---|
| **absent** | No implementation exists in the repository. |
| **research** | A bounded study, measurement or design exists; no game code depends on it. |
| **prototype** | Tested code exists in isolation; it is not part of a player session. |
| **integrated** | Reachable in a player session and covered by automated tests. |
| **performance accepted** | Integrated, and measured on named reference hardware within budget. |
| **player accepted** | Performance accepted, and target players accepted it in full sessions. |
| **release accepted** | Player accepted, and the exact artifact passed release acceptance. |

Nothing in this repository is above **integrated** today: no named reference-hardware captures and no
target-player sessions have been recorded (§2.1, §23.1). Moving a row up needs the linked evidence.
Roles are accountable roles from §26, not named people.

Last reviewed against source: branch `claude/peaceful-einstein-dedc7t`, commits after
`a8800c73` (see `git log a8800c7..HEAD`).

## 1. Features

| Feature | State | Evidence | Next acceptance step | Owner role |
|---|---|---|---|---|
| Formula vehicle dynamics (APX-01) | integrated | `src/simulation/vehicle.ts`, `tests/physics.test.ts`, `scripts/vehicle-calibration.ts` | Human full-stint feel review (§7.6) | Physics lead |
| Per-entry vehicle definitions | integrated | `src/simulation/vehicles.ts`, `tests/vehicle-definitions.test.ts` | Hardware/AI review of a mixed grid | Technical director |
| TC-1 touring car (front drive) | integrated (procedural art) | `TOURING_TC1`, `docs/vehicle-calibration.json`, `src/rendering/vehicle-bodies/` | Interior, audio identity, handling sign-off (§10.2) | Vehicle gameplay |
| Multi-class catalogue (15 machines) | integrated | `src/simulation/vehicle-catalogue/`, `tests/vehicle-catalogue.test.ts`, `docs/vehicle-calibration.json` | Per-class target review, audio, dirt venue, hardware/AI review of mixed grids | Vehicle gameplay |
| AWD and per-axle differentials | integrated | `src/simulation/differential.ts`, `tests/drivetrain.test.ts` | Human feel review on split-μ and loose surfaces | Physics lead |
| Procedural vehicle bodies (3 LODs + shadow proxy) | integrated | `src/rendering/vehicle-bodies/`, `tests/vehicle-bodies.test.ts` | Art-director review, LOD/material timings on reference hardware (§18.3) | Vehicle art |
| Class-grouped MACHINE menu and class events | integrated | `src/ui/machine-options.ts`, `src/simulation/catalogue-events.ts`, `tests/catalogue-menu-events.test.ts` | Controller/accessibility audit of the grouped list | Gameplay lead |
| Vehicle calibration laboratory | integrated (CI) | `npm run test:vehicles`, two-timestep drift report | Independent target review per class | Physics lead |
| Event / ruleset definitions | integrated | `src/simulation/events.ts`, `tests/events.test.ts` | Designer-authored events for G3 | Gameplay lead |
| Timed endurance classification | integrated (event only) | `timed-endurance` ruleset, timed race test | Fuel/service choices, stint persistence (§11.4) | Gameplay lead |
| Venue-owned pit/grid geometry | integrated | `PitLaneDefinition`, `tests/venue-pit-data.test.ts` | Rendering of a non-standard paddock | Track/tools lead |
| Layer-aware 3-D track progress | integrated | `Track.nearest(.., y)`, `tests/route-overpass.test.ts` | First stacked-road venue in production | Track/tools lead |
| Circuit catalogue: 20 layouts at 12 new venues | integrated | `src/simulation/circuit-catalogue/`, `tests/circuit-catalogue.test.ts`, `docs/circuit-catalogue-races.json`, [CIRCUIT_CATALOGUE.md](../CIRCUIT_CATALOGUE.md) | Human races, crash/recovery and performance capture per venue (§15.3); licence decision for official names | Track/tools lead |
| Procedural venue kit | integrated | `src/rendering/venue-kit/`, `tests/venue-kit.test.ts` | In-browser capture-suite review and art direction sign-off (§17.2); hardware frame timing | Environment art + rendering lead |
| Tunnel rain shelter (roofed zones) | integrated | `Track.sheltered`/`isCovered`, `tests/circuit-catalogue.test.ts` | Spray, sky light and reflections inside tunnels | Weather/rendering |
| Directed route graph, checkpoints, branches | integrated (festival events) | `src/simulation/route-graph.ts`, `tests/route-graph.test.ts`; festival event progress via `RouteProgress` (`src/simulation/open-world/route-path.ts`, `tests/open-world.test.ts`) | Drive a circuit or stage session from a RouteGraph venue | Track/tools lead |
| Festival open world (Solvane Coast: 8.19 km region, 70.9 km road network, free roam, 13 discovered events) | integrated | `src/simulation/open-world/`, `src/rendering/open-world/`, `src/session/free-roam.ts`, `tests/open-world*.test.ts`, `npm run test:open-world` → `docs/open-world.json`, [OPEN_WORLD.md](OPEN_WORLD.md) | Reference-hardware capture of streaming and frame time at each preset; human free-roam and event sessions; traffic; career consumption of `FestivalResult` | Open-world lead + rendering lead |
| Recorded-session identity & record categories | integrated | `src/core/session-identity.ts`, ghost/leaderboard keys; online join agreement and `verifyRecord` reuse them (prototype) | A public board that accepts only verified records (WP52) | Runtime lead |
| Snapshot schema descriptor | integrated | `SNAPSHOT_SCHEMA` v12 (appended `bike` block, both entity families), `snapshotIncompatibility` (version, length, vehicle index) | Recordings migration policy for v11 replays (rejected today) | Runtime lead |
| Content validation | integrated (CI) | `npm run validate:content` in `npm run check` | Validate imported/creator content in-game | Tools lead |
| Replay service (paged recording) | integrated | `src/storage/replay-pages.ts`, `tests/replay-clock.test.ts` | Close F01 on the hosted Mesa job | Runtime lead |
| Replay playback clock | integrated | `src/session/replay-clock.ts` | — | Runtime lead |
| GPU frame gate (bounded wait) | integrated | `src/rendering/gpu-frame-gate.ts`, `tests/gpu-frame-gate.test.ts` | Hardware frame-pacing capture | Rendering lead |
| Replay director (event-aware) | integrated | `pitSubject`, `tests/replay-photo.test.ts` | Overtake/incident priorities (§17.9) | Rendering lead |
| Race radio & captions | integrated | `src/core/radio.ts`, `src/ui/radio-caption.ts` | Voice assets, priority review with players | Audio lead |
| Accessibility: captions, reduced motion | integrated | Settings → Accessibility | Accessibility matrix review (WP32) | Accessibility + QA |
| EVENTS hub / machine choice | integrated | `src/ui/event-cards.ts`, MACHINE select | Controller-only journey review (WP22) | UI/UX lead |
| Save backup and recovery | integrated | `SaveStore.writeWithBackup`, `recoverSave` | Abrupt-termination test on hardware (§12.5) | Persistence owner |
| Transparent race rewards | integrated | `rewardIncome` | Economy review (§12.3) | Design lead |
| Championship and team career | integrated | `src/core/championship.ts`, `src/storage/team-career.ts` | One result identity across both (WP23) | Gameplay lead |
| Motorcycle (road) dynamics | integrated | `bike.ts` core, `bike-vehicle.ts` adapter, `bike-definitions.ts` (GP-R1, SBK-1000), `tests/bike.test.ts`, `tests/bike-session.test.ts`, calibration lab | Human riding-feel review with pad and keyboard; hardware capture (G4) | Motorcycle lead |
| Motorcycle AI and events | integrated | `bike-ai.ts`, `gp-motorcycle` ruleset, Vellamar bike event, seeded AI races (`npm run test:bikes` → `docs/bike-race.json`, `tests/bike-session.test.ts`) | Overtaking/defending tuned for bikes; incident review over long races | Gameplay lead |
| Motorcycle and rider presentation | integrated (procedural art) | `src/rendering/bike.ts`, `src/rendering/rider.ts`, onboard/chase cameras | Art-director review, authored asset with rights, rider animation polish, own engine sound | Vehicle art lead |
| Deformable dirt terrain | prototype | `src/simulation/terrain.ts`, `tests/terrain.test.ts` | Couple to a dirt bike (G5) | Terrain/physics lead |
| Magnetic local-frame vehicles | prototype | `src/simulation/local-frame.ts` | Engineering course (§16.5) | Extreme gameplay |
| Moving surfaces | prototype | `src/simulation/moving-surface.ts` | Couple to vehicle contact | Physics/runtime |
| Freestyle/drift scoring | integrated (festival drift zones) | `src/core/scoring.ts`, `DriftMeter` in `src/simulation/open-world/festival-events.ts`, `tests/open-world-session.test.ts` | Player tuning of thresholds; freestyle (bike/air) scoring | Gameplay lead |
| Rally stage / joker classification | prototype | `src/core/stage-rules.ts` | Point-to-point venue | Rally gameplay |
| Creator content import | prototype | `src/simulation/content-import.ts` | Authoring UI, moderation (G8) | Security/platform |
| Authoritative server workload | research | `scripts/server-prototype.ts`, `docs/server-prototype.json` | Server tick cost of the online slice on named reference hardware | Network lead |
| Authoritative online race (in-memory slice) | prototype | `src/net/`, `tests/net-*.test.ts`, `npm run test:online` → `docs/online-slice.json`, [ONLINE_SLICE.md](ONLINE_SLICE.md) | A real transport and a player session that reaches it | Network lead |
| Online multiplayer service | absent | No deployed service; only the in-memory slice above | Deployable transport, matchmaking, accounts (G7) | Network lead |
| Force feedback | absent | — | Native bridge study (§21.2) | Input/platform lead |
| Desktop/Steam package | absent | — | WP58 | Release/platform |
| VR / split-screen | absent | — | WP62 separate feasibility | Platform R&D |
| ULTRA preset (TAA+CAS, Hi-Z SSR, temporal GTAO, 3 sun cascades, energy bloom, sun shafts, replay lens, AgX/Neutral) | integrated (opt-in) | `src/rendering/ultra/`, `tests/ultra-*.test.ts`, `e2e/58-ultra-pipeline.spec.ts`, `scripts/ultra-capture.ts`, `RENDERING_PIPELINE.md` | Reference-hardware captures of the §3 suite at ULTRA; frame-time budget | Rendering lead |
| Shared PBR material library (GPU-generated detail maps) | prototype | `src/rendering/materials/`, `tests/material-library.test.ts` | First vehicle/venue kit built from it | Rendering lead + art director |
| WebGPU renderer | absent | — | WP61 bounded experiment | Rendering R&D |

## 2. Work packages (§26)

| WP | State | What exists / what remains |
|---|---|---|
| WP01 | integrated | Mechanism reproduced: the GPU frame gate waited forever for a fence the browser does not refresh while no frames are submitted; the replay director also followed another car during the pit visit. Fixes and regressions: `gpu-frame-gate.test.ts`, `replay-photo.test.ts`, `replay-clock.test.ts`. Causal note: `REPLAY_CLOCKS_AND_F01.md`. |
| WP02 | integrated | Full journey assertions unchanged; diagnostics added. Passed on the hosted Mesa shard (run 38637809713, shard 6, 6.9 min). Whole-workflow green is still required for WP03. |
| WP03 | absent | Publication of the corrected artifact is a release-owner action after green CI. |
| WP04 | integrated | This register. |
| WP05 | research | Protocol in `HARDWARE_DEVICE_PLAYTEST_PROTOCOLS.md`; no hardware captured. |
| WP06 | integrated | Shadow-pass LOD substitution for crowd/seats; needs hardware timing and moving-image review. |
| WP07 | absent | Requires approved retopology of the supplied player asset and rights review. |
| WP08 | integrated | Per-entry definitions; TC-1 proves coexistence. |
| WP09 | integrated | Rulesets/events; five legacy modes resolve unchanged. |
| WP10 | integrated | Left-pit venue completes a full AI stop. |
| WP11 | integrated | Track layer gate integrated; RouteGraph/RouteProgress drive festival event progress (gates at the very end of an edge were missed when the next sample was already on the successor: fixed, regression in `route-graph.test.ts`). No circuit venue is built from a RouteGraph yet. |
| WP12 | integrated | Identity, record categories, schema descriptor, explicit legacy policy. |
| WP13 | integrated (partial) | Records and replay clock extracted; session/profile/presentation controllers remain in `main.ts`. |
| WP14 | integrated | `npm run validate:content`. |
| WP15 | absent | Load/residency/teardown measurement needs hardware captures. |
| WP16 | research | Proposed decision record in `DECISIONS_AND_RISKS.md`; needs producer sign-off. |
| WP17 | integrated | Calibration lab with design-brief bands and timestep drift; AWD with centre split, open/LSD/locked axle differentials, tyre families. Every catalogue machine in band at both timesteps (APX-01 top speed 319.8 vs 320 km/h floor is a pre-existing exception). Human feel review open. |
| WP18 | integrated (provisional) | TC-1 plus fifteen catalogue machines: mechanics, AI envelopes, setup limits, snapshot identity, procedural exteriors. Interiors, audio families, damage variants and sign-off absent. |
| WP19 | integrated | Per-definition AI envelopes, zero-downforce braking fix. |
| WP20 | integrated | Explicit pass commitment in `TrafficPlanner`: one target per attempt, abort on gap opening, lost closing speed (>1 s), defender covering before overlap, no safe lane or 12 s timeout; skill-dependent retry hysteresis; passes/aborts counted with reason (`tests/traffic.test.ts`). Unit suite and `test:physics` green. QA-suite measurements (§13.7) open. |
| WP21 | absent | Needs human sessions on named devices. |
| WP22 | integrated (partial) | EVENTS hub, machine choice with explained rejections; full controller audit open. |
| WP23 | integrated (partial) | Idempotent, explained rewards; one result identity across championship/team open. |
| WP24 | integrated (partial) | Backup-on-write and recovery; corruption/quota/termination suite on hardware open. |
| WP25 | absent | Academy per vehicle family. |
| WP26 | integrated | Powertrain sound families (`src/audio/sound-profiles.ts`): firing order, harmonic emphasis, rev range, induction, transmission and electric-motor briefs for 13 families; engine voices and the player power-unit layer follow the recorded vehicle (`tests/sound-profiles.test.ts`). APX-01 output is unchanged; TC-1 has its own four-cylinder turbo voice. Listening review open. |
| WP27 | research | Capture-suite definition in `CONTENT_PIPELINE.md`; art director approval open. |
| WP28 | absent | Temporal clarity work needs the capture suite. |
| WP29 | integrated (partial) | Twenty catalogue layouts reached greybox, AI race (seeded 6-car races, all pass) and an operational pass with a procedural venue kit; layer-aware overpasses (Kansai, Iron Quay) and tunnels in production venues. Open: crash/recovery demonstration, human races, art pass and performance capture (§14.3 stages 4–6), person-time records (§14.7). |
| WP30 | integrated (partial) | Venue side: 12 new venues / 20 layouts selectable (Original / Real-world / Unconventional), six events use them. Real-world layouts are approximations under neutral names pending a licence. The twelve-car side belongs to the vehicle programme. No layout is performance-, player- or release-accepted. Car side: 17 machines across 11 families with procedural bodies, class-grouped menu, multi-class endurance ruleset and GT/hypercar/touring/kart/rallycross events. Six-venue scope, dirt venue, audio and art acceptance open. |
| WP31 | research | Device matrix template; no certification. |
| WP32 | integrated (partial) | Captions, reduced motion, engineer mute added; matrix review open. |
| WP33 | integrated | Rider-bike model and control contract in sessions: lean intent with counter-steer controller, separate front/rear brake (rear on the clutch binding), TC/wheelie/stoppie/cornering ABS on the Sport assist; GP-R1 and SBK-1000 definitions with calibration bands. Human feel review open. |
| WP34 | integrated (procedural art) | BikeVehicle adapter (slim OBB, contact feedback, crash → separation → remount reported to race control), snapshot v12 bike block, procedural bike and rider rig with LODs, onboard/chase cameras. Authored art, damage variants and own audio absent. |
| WP35 | integrated | Bike AI on the shared race craft with lean-limited envelopes and a lean-aware path tracker; seeded AI race completes with bounded incidents (test). Bike-specific overtaking not tuned. |
| WP36 | integrated (partial) | MACHINE choices, all-bike grid, `gp-motorcycle` ruleset, Vellamar bike event card, mixed car/bike grids rejected. Slice acceptance (players, hardware) open; nothing accepted. |
| WP37–WP38 | prototype | Terrain tiles with checkpoints. |
| WP39–WP41 | absent | Dirt bike, AI lines, motocross slice. |
| WP42 | prototype | Stage/joker classification on RouteGraph. |
| WP43–WP44 | prototype | Magnetic local frames; moving surfaces. |
| WP45–WP47 | absent | Extreme slice acceptance, venue selection, presentation libraries. |
| WP48 | integrated (partial) | Explainable scoring drives festival drift zones; freestyle disciplines open. |
| WP49 | research | Server workload measurement. |
| WP50 | prototype | Sequenced input commands (60 Hz sampling, 30 Hz send, every unacknowledged command repeated), 20 Hz compact per-recipient snapshots, authoritative 120 Hz server, local-car prediction with a learned input response and smoothed reconciliation, jitter-buffered Hermite interpolation of remote cars, explicit server collision authority. Corrections measured at 100 ms RTT / 2% loss (`tests/net-prediction.test.ts`, `docs/online-slice.json`: p95 0.15 m); the input lead starts from the keep-alive round trip and grows from late-command feedback (200/300 ms RTT tested). Full-world client re-simulation not done (no Simulation state restore); bot drivers, not human inputs; no player session. |
| WP51 | prototype | lobby → grid → race → results → teardown over the `Transport` interface; joins present a `RecordedSessionIdentity` computed from local content and are rejected with the first version/hash mismatch (`tests/net-lifecycle.test.ts`). Crash/restart procedure documented; journal-replay restore tested; persistence, supervisor and address migration absent; host migration out of scope. |
| WP52 | prototype | Records = seed + options + input journal + content hashes (+ exact 10 s state checkpoints, per-lap AI-assisted flags); headless re-simulation accepts only bit-identical classification, lap times, flags and checkpoints; forged lap time, invented checkpoints, tampered journal and mismatched content/physics version rejected; AI-driven laps never count as `categoryBest`; journal bound derived from the session (`tests/net-records.test.ts`). Not wired to time-trial boards; records unsigned; same-build determinism only. |
| WP53 | prototype | Lobby directory create/list/join/leave, capacity, ready check, class/ruleset compatibility via `sessionIncompatibilities`, host kick/ban with moderation hooks, per-player and per-connection rate limits (`tests/net-lobby.test.ts`, `tests/net-resilience.test.ts`). No UI, no authenticated accounts. |
| WP54 | prototype | Disconnect → AI takeover (or ghost classification), 250 ms input-starvation hold, token rejoin within 30 s (CSPRNG tokens bound to the account, never replacing a live connection, rate-limited; during the countdown too), loss/duplication/reordering tolerated, input sanity limits, message size limits, strikes and kick, server tick-budget monitor (`tests/net-resilience.test.ts`, slice run). No load shedding; ghosts are not contact-immune. |
| WP55 | absent | Productized authoring tools. |
| WP56 | prototype | Sandboxed creator import. |
| WP57–WP60 | absent | Publishing, PC package, product acceptance, release packet. |
| WP61–WP62 | absent | WebGPU and new-platform evaluations. |
| WP63 | integrated | `DECISIONS_AND_RISKS.md` is the living scope/risk record. |
| WP64 | research | Dashboard definition in `RELEASE_DASHBOARD.md`; replay corpus not yet assembled. |

## 3. Gates (§25.1)

| Gate | Status | Blocking evidence |
|---|---|---|
| G0 Stable baseline | open | Hosted CI green on the corrected source; publication and rollback evidence. |
| G1 Golden race | open | Human full races, hardware profiles. |
| G2 Generalized car/track platform | open, technically substantially met | Mechanically distinct second car, left-pit venue, overpass tests and record policy exist; G1 first. |
| G3–G9 | not started | Depend on G1/G2 acceptance. |
