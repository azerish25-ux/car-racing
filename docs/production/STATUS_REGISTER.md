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
| TC-1 touring car (front drive) | integrated (provisional art) | `TOURING_TC1`, `docs/vehicle-calibration.json`, `src/rendering/touring-shell.ts` | Final exterior/interior, audio identity, handling sign-off (§10.2) | Vehicle gameplay |
| Vehicle calibration laboratory | integrated (CI) | `npm run test:vehicles`, two-timestep drift report | Independent target review per class | Physics lead |
| Event / ruleset definitions | integrated | `src/simulation/events.ts`, `tests/events.test.ts` | Designer-authored events for G3 | Gameplay lead |
| Timed endurance classification | integrated (event only) | `timed-endurance` ruleset, timed race test | Fuel/service choices, stint persistence (§11.4) | Gameplay lead |
| Venue-owned pit/grid geometry | integrated | `PitLaneDefinition`, `tests/venue-pit-data.test.ts` | Rendering of a non-standard paddock | Track/tools lead |
| Layer-aware 3-D track progress | integrated | `Track.nearest(.., y)`, `tests/route-overpass.test.ts` | First stacked-road venue in production | Track/tools lead |
| Circuit catalogue: 20 layouts at 12 new venues | integrated | `src/simulation/circuit-catalogue/`, `tests/circuit-catalogue.test.ts`, `docs/circuit-catalogue-races.json`, [CIRCUIT_CATALOGUE.md](../CIRCUIT_CATALOGUE.md) | Human races, crash/recovery and performance capture per venue (§15.3); licence decision for official names | Track/tools lead |
| Procedural venue kit | integrated | `src/rendering/venue-kit/`, `tests/venue-kit.test.ts` | In-browser capture-suite review and art direction sign-off (§17.2); hardware frame timing | Environment art + rendering lead |
| Tunnel rain shelter (roofed zones) | integrated | `Track.sheltered`/`isCovered`, `tests/circuit-catalogue.test.ts` | Spray, sky light and reflections inside tunnels | Weather/rendering |
| Directed route graph, checkpoints, branches | prototype | `src/simulation/route-graph.ts`, `tests/route-graph.test.ts` | Drive a session from a RouteGraph venue | Track/tools lead |
| Recorded-session identity & record categories | integrated | `src/core/session-identity.ts`, ghost/leaderboard keys | Public-board verification (WP52) | Runtime lead |
| Snapshot schema descriptor | integrated | `SNAPSHOT_SCHEMA`, `snapshotIncompatibility` | Entity-type blocks for bikes (G4) | Runtime lead |
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
| Motorcycle (road) dynamics | prototype | `src/simulation/bike.ts`, `tests/bike.test.ts` | G4 vertical slice: rig, AI, track, audio | Motorcycle lead |
| Deformable dirt terrain | prototype | `src/simulation/terrain.ts`, `tests/terrain.test.ts` | Couple to a dirt bike (G5) | Terrain/physics lead |
| Magnetic local-frame vehicles | prototype | `src/simulation/local-frame.ts` | Engineering course (§16.5) | Extreme gameplay |
| Moving surfaces | prototype | `src/simulation/moving-surface.ts` | Couple to vehicle contact | Physics/runtime |
| Freestyle/drift scoring | prototype | `src/core/scoring.ts` | A playable challenge | Gameplay lead |
| Rally stage / joker classification | prototype | `src/core/stage-rules.ts` | Point-to-point venue | Rally gameplay |
| Creator content import | prototype | `src/simulation/content-import.ts` | Authoring UI, moderation (G8) | Security/platform |
| Authoritative server workload | research | `scripts/server-prototype.ts`, `docs/server-prototype.json` | Prediction/reconciliation (WP50) | Network lead |
| Online multiplayer service | absent | — | G7 network slice | Network lead |
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
| WP11 | integrated / prototype | Track layer gate integrated; RouteGraph prototype. |
| WP12 | integrated | Identity, record categories, schema descriptor, explicit legacy policy. |
| WP13 | integrated (partial) | Records and replay clock extracted; session/profile/presentation controllers remain in `main.ts`. |
| WP14 | integrated | `npm run validate:content`. |
| WP15 | absent | Load/residency/teardown measurement needs hardware captures. |
| WP16 | research | Proposed decision record in `DECISIONS_AND_RISKS.md`; needs producer sign-off. |
| WP17 | integrated | Calibration lab with design-brief bands and timestep drift. |
| WP18 | integrated (provisional) | TC-1 mechanics, AI, setup, snapshot identity; final art absent. |
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
| WP30 | integrated (partial) | Venue side: 12 new venues / 20 layouts selectable (Original / Real-world / Unconventional), six events use them. Real-world layouts are approximations under neutral names pending a licence. The twelve-car side belongs to the vehicle programme. No layout is performance-, player- or release-accepted. |
| WP31 | research | Device matrix template; no certification. |
| WP32 | integrated (partial) | Captions, reduced motion, engineer mute added; matrix review open. |
| WP33 | prototype | Rider-bike model and control contract. |
| WP34–WP36 | absent | Rider rig, bike AI/event, slice acceptance. |
| WP37–WP38 | prototype | Terrain tiles with checkpoints. |
| WP39–WP41 | absent | Dirt bike, AI lines, motocross slice. |
| WP42 | prototype | Stage/joker classification on RouteGraph. |
| WP43–WP44 | prototype | Magnetic local frames; moving surfaces. |
| WP45–WP47 | absent | Extreme slice acceptance, venue selection, presentation libraries. |
| WP48 | prototype | Explainable scoring. |
| WP49 | research | Server workload measurement. |
| WP50–WP54 | absent | Prediction, lifecycle, records verification, lobbies, resilience. |
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
