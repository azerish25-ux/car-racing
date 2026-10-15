## Production master plan response

Per-entry vehicle definitions (APX-01 Formula and an original front-drive
TC-1 touring car), composable rulesets and events (including timed
endurance), venue-owned pit/grid geometry, layer-aware 3-D track progress and
a directed route graph, recorded-session identity and versioned record
categories, content validation, the F01 replay/GPU-gate fix, race radio with
captions, accessibility switches, rumble, an EVENTS hub, and isolated
prototypes for motorcycles, deformable dirt, magnetic loops, moving surfaces,
scoring, joker stages, creator import and an authoritative-server workload.
Status (nothing is claimed beyond "integrated" without hardware or player
evidence), decisions, risks and protocols: [docs/production](docs/production/README.md).

## Circuit catalogue (WP29–WP30)

Twenty new layouts at twelve venues, selectable from CIRCUIT (grouped Original /
Real-world / Unconventional): six approximations of famous circuits from public
geometry under neutral names, plus a night street circuit with dry tunnels, an
alpine pass, a 31° tri-oval and infield road course, a desert canyon, a cliff
road and a dockyard flyover. A procedural venue kit dresses every layout from
its data. [Roster, rights, validation and limits](docs/CIRCUIT_CATALOGUE.md).

## A12 secondary grandstands

Aurel's six retained secondary stands now use an original modular Blender/GLB
library with formed seats, mounting shoes, roof ribs, protected aisles and
terrain-seated supports. The two hero stands, spectator occupancy, circuit
physics and supplied player assets are unchanged. [Scope and independent
acceptance](docs/A12_SECONDARY_GRANDSTANDS.md).

## A01–A07 track infrastructure

Aurel uses original authored concrete, guardrails, catch-fence supports, impact
barriers, closed recovery/access gates, marshal shelters and a start gantry.
Three detail levels, packed PBR maps and retained Blender sources preserve the
existing physical route, live race signals and supplied player assets.
[Scope, provenance and independent acceptance](docs/TRACK_INFRASTRUCTURE_ASSET_PACK.md).

## Aurel start/finish environment

The start/finish stands now share original authored architecture, shaped seats,
recorded race-information display and audience task motion. Existing protected
marshal posts use the refined crew kit. [Scope and verification](docs/START_FINISH_ENVIRONMENT.md).

## Coordinated pit-team performance

All six existing pit roles now use distinct authored actions with planted-foot
and equipment-contact retargeting. Jacks lower during the existing clearance
window before departure; tyre exchange and the 5.2-second minimum are retained.
[Scope, physical correction and verification](docs/PIT_TEAM_PERFORMANCE.md).

## A41/A42 crew and authored actions

Grid and pit mechanics share a refined garment, helmet and glove kit. Nine
editable Blender actions feed the retained contact-aware renderer; the wheel-gun
performance follows the actual pit-service clock. Supplied player assets and
physics are unchanged. [Scope and verification](docs/A41_A42_CREW.md).

## A61 rival exterior refinement

Opponents use three separately verified Blender exports of the retained APX
mechanical assembly. The source player car, cockpit and driver are unchanged.
See [A61 implementation and evidence boundaries](docs/A61_RIVAL.md).

## Race-Day Presentation V2

Normal Grand Prix/Endurance entry now includes a real-grid briefing, an optional
automatic crew-preparation sequence and a saved Quick Start preference. Racing
uses a lower-corner driving cluster with on-demand vehicle pages. Crew follow
staged clearance routes and remain parked rather than vanishing on a timer.
See [implementation, controls and explicit limits](docs/grid-preparation/IMPLEMENTATION.md).
Full CI, published-build identity, target-hardware performance and final art are
separate evidence gates; feature presence is not their certification.

## Broadcast presentation pass

Multisampled scene rendering with depth-only ambient obscurance, broadcast colour
grading, bloom on Medium and above, a deeper sky and asphalt, and a new race HUD /
paddock identity built on a bundled Saira typeface (position badge, flag strip,
rev lights, timing tower). See [audit findings, changes and validation](docs/BROADCAST_PRESENTATION.md).

## Player car: supplied RB19 + R06 driver/cockpit

The main player now uses the combined user-supplied RB19 car and R06 seated
cockpit/driver. This includes steering-linked hands, live wheel instruments,
source-aligned cockpit/T-cam views, animated wheels and replay-derived poses.
The engine stays Three.js and AI opponents retain their original models.
See [asset provenance, controls, validation and remaining limits](docs/SUPPLIED_PLAYER.md).
The first load includes the 36 MB required player model plus a 4.6 MB integrity-checked
index-only detail package. High-quality close-ups and Photo Studio retain the
original model; lower presets and distant views use reduced index sets on the
same rig and materials. See [runtime tiers and validation boundaries](docs/SUPPLIED_PLAYER_RUNTIME.md).

## Driver and service-character construction

Continuous glove backs, authored suit folds, inset wheel controls and fitted crew
visors extend the existing Three.js race. See [scope, measured component costs and
independent acceptance gates](docs/CHARACTER_QUALITY.md).

## Aurel race-readability candidate

Compact-screen telemetry, full-service camera sightline probes and bounded
wet-floodlight highlights extend the existing game. See
[implementation and remaining gates](docs/RACE_READABILITY.md) and
[executed validation](docs/RACE_READABILITY_VALIDATION.json).
This is not final-art, target-hardware, hosted-CI or public-deployment approval.

## Graphics-continuity correction candidate

The current continuation retains indexed static geometry, preserves live liveries
at every car LOD, refines the authored seated driver and pit garments, improves
cockpit control legends, and filters wet highlights and circuit ground variation.
See [implemented scope and measured costs](docs/GRAPHICS_CONTINUATION.md) and
[exact validation boundaries](docs/GRAPHICS_CONTINUATION_VALIDATION.json).
This is **not** final-art, physical-hardware, full-race human or Steam acceptance;
source publication and public deployment must be verified independently.

## Phase 27H.6 development candidate

**Latest implementation checkpoint — 27H.6:** unobstructed wide-view telemetry,
scroll-safe populated standings, solid-structure broadcast occlusion, and
sequence-qualified grid/close-racing/wet-following/pit captures, conforming damp
asphalt, complete pit-crew framing and bounded pose reuse. See also
[reconciliation and current validation](docs/PHASE_27H6_RECONCILIATION.md). See
[implemented scope and independent open gates](docs/PHASE_27H6_IMPLEMENTATION.md)
and [validation](docs/PHASE_27H6_VALIDATION.json). This is a tested source
candidate, not final-art, target-hardware, hosted-CI or Steam acceptance.

**Retained environment checkpoint — 27H.4:** constructed Aurel districts, terrain-graded plazas, slotted drainage, retained event-hall integration and late-bound regional weather. See [implementation and open gates](docs/PHASE_27H4_IMPLEMENTATION.md) and [local validation](docs/PHASE_27H4_VALIDATION.json). This is not full-lap art or Steam-release acceptance.

The closure continuation adds measured adaptive exposure, local weather haze, complete-group broadcast framing, revised sleeve/safety-cell geometry, same-task PNG ownership and explicit full-tab recording to disk. See [closure implementation and remaining independent acceptance](docs/PHASE_27G_CLOSURE_EVIDENCE.md).

The current continuation implements shared second-generation car geometry/materials,
grip-anchored hands, authored Aurel districts, updated pit/crowd/staff models,
sunset lighting, snapshot-qualified reference event capture, direct text-decal
positioning and an original captioned Team HQ scene. See
[implementation, resource ownership and open acceptance](docs/PHASE_27G_IMPLEMENTATION_AND_ACCEPTANCE.md).
This is **not final-art acceptance, all-100 parity, complete Section 146 or Steam
readiness**. The original master specification remains authoritative.

<div align="center">

# 🏎️ APEX / Formula

### A browser racing simulator built around the engineering underneath the lap.

**Original cars. Original circuit. Coupled physics, race systems, telemetry, and procedural presentation.**

[![Build and validation](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/workflows/ci.yml/badge.svg)](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/workflows/ci.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9.3-3178C6?logo=typescript&logoColor=white)
![Three.js](https://img.shields.io/badge/Three.js-0.180.0-111111?logo=threedotjs&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-7.1.7-646CFF?logo=vite&logoColor=white)
![Physics](https://img.shields.io/badge/Physics-120_Hz_%2F_240_Hz_substeps-orange)
![Status](https://img.shields.io/badge/Status-Engineering_prototype-yellow)

[🚀 Get started](#-get-started) · [🛠️ Tech stack](#-tech-stack) · [⚙️ Engineering](#-engineering-under-the-bodywork) · [🧪 Validation](#-testing-and-validation) · [📚 Documentation](#-documentation)

</div>

---

## Phase 27H — authored bodywork and evidence-bound closure

The actual renderer now loads the retained Blender-exported nose, engine-cover
and sidepod skins with byte-integrity checks, owned geometry and live livery UVs.
IK-driven elbow cloth and revised glove cross sections preserve the existing
simulation/steering anchors. See [implementation and explicit open gates](docs/PHASE_27H_IMPLEMENTATION.md)
and [the exact 148-section / 100-reference acceptance matrix](docs/PHASE_27H_MATRIX.md).
This is an implementation increment, **not final-art acceptance, all-image parity,
physical Windows/wheel validation, completed Section 146 or Steam readiness**.

## Phase 27D — spectator and night-presentation continuation

The [continuation report](docs/PHASE_27D_PRESENTATION_CONTINUATION.md) records a fourth, two-triangle distant-crowd representation, snapshot-driven spectator reactions, a shared circuit-night profile and stronger real-renderer regression coverage. It builds on `537491b4`, preserving the already-published CI repairs, lit spray and continuous four-source floodlights. The locked-toolchain check passes 728 unit cases, lint, type checking and production build. The occupied-grandstand component comparison removes 16.42% of submitted triangles with three extra handoff draws; this is not a hardware FPS claim. Final graphics, full application/hardware validation and Steam acceptance remain open. Older report counts below describe their original checkpoints.

## Phase 27C — cohesion increment (acceptance open)

The [Phase 27C implementation and evidence report](docs/PHASE_27C_FULL_LAP_COHESION.md) records original car/driver detail, seated crowd LODs, six grounded service areas, terrain material continuity, and full-lap camera/lighting review. It includes correction of camera self-obstruction and unnecessary lens transmission. Seven focused native groups, eight existing native physics/race scripts and 81 isolated circuit GPU captures passed their stated checks. The full installed-toolchain build/CI, hardware performance and final visual acceptance remain **unverified/open**; this is not a completed Phase 27C or Steam-ready release. Historical test counts below are historical, not certification of this source increment.

## Phase 27A — wet-race broadcast fidelity and trackside density

The current milestone advances the retained 148-section master directive's graphics-quality pass after the full-race recording-continuity hardening. It targets the most repeated gap in the supplied wet/broadcast reference frames: real-state water-film response, more legible rain/spray structure, and motorsport infrastructure that belongs to the same world as the replay cameras.

The 2.973 km Aurel circuit now carries **56 drainage grates, 12 marshal shelters, 13 utility cabinets and 20 physical replay-camera sites**. The drain cadence/side-selection is shared with the real 512×7 surface-water drainage field, so low/outside cells around those grates physically evacuate water faster; the camera sites reuse the exact positions of the replay director, and marshal LED boards consume the real live/replayed flag channel rather than a decorative timer. The new infrastructure is 5,268 triangles and is spatial/material batched from 323 source mesh instances to 157 draw-owning meshes. Wet asphalt gains an actual spatial-water-driven physical clearcoat lobe; local reflection probes update faster only when real rain/wheel water warrants it; storm precipitation cools/darkens distance haze; and the fixed 1,800-particle pool now forms load-scaled, orientation-aware rearward spray plus separate rain, smoke/dust and spark silhouettes without changing physical weather/tire state.

See [the milestone rationale, measurements, validation and explicit remaining limits](docs/WET_BROADCAST_FIDELITY_MILESTONE.md) and the preserved [dynamic wet-race presentation contract](docs/PHASE_27A_DYNAMIC_RACE_PRESENTATION.md). This is a deliberate Phase-27 step, **not** a claim of SSR/ray tracing, volumetric-fluid spray, scanned venue fidelity or commercial-game visual parity. The preceding [full-race recording-continuity milestone](docs/FULL_RACE_CONTINUITY_MILESTONE.md) remains part of the current foundation.

---

## Reference continuation: visible systems, not just an audit

This continuation starts from `c79992a56a08cdfee84732bbc32cac8e0d073085`.
The [individual implementation report](docs/REFERENCE_100_IMPLEMENTATION_PASS.md) records all **100 visually reviewed images**, their exact hashes, the existing game counterpart, this continuation's changes, and unresolved gaps. **82 racing-related frames + 2 hardware photographs + 16 unrelated exclusions** is not 100 independent completed features. All 84 applicable entries have a native inspection action; inspection routing is not a visual-parity certificate.

Open **Reference Review**, expand a numbered entry and use its **OPEN / INSPECT** button. New work includes:

| Reference cues                             | Native addition                                                                        | How to inspect                                                                                       |
| ------------------------------------------ | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 005 / 026 / 031                            | Real dark livery showroom with floor, podium, softboxes and reversible scene state     | Photo / Livery → Setting → Dark showroom                                                             |
| 034 / 037 / 070 / 072 / 074 / 089 / 097    | Conservative road-centre chevrons with cyclic braking advice and wet/yellow reductions | Driving Academy → Guidance → Corners / Full                                                          |
| 037 and objective-driven racing references | Five-attempt consistency programme with a real banker lap and measured grades          | Driving Academy → Start new session → explicit replacement confirmation                              |
| 047                                        | Suspension-hub tyre blankets, straps and withdrawing preparation staff                 | Reference 047 from the menu preview, or the first moments of a Grand Prix                            |
| 025 / 039 / 079 / 080 / 087                | Original floodlit night presentation and patterned LED sphere                          | Driving Academy → Night; the landmark is near 13% of the Aurel lap                                   |
| 028 / 032 / 085 and close-duel views       | Left/right near-car and overlap arrows                                                 | Drive alongside another car; arrows use relative physical positions and reject different road levels |

Guidance never writes steering, brake or throttle commands. The five-attempt programme uses **completed-lap validity, penalties and AI participation from the physics worker**, not UI guesses or render counts. Replays/photographs cannot award attempts. Switching night or showroom is presentation only, without secretly changing weather, grip or simulation time. A new programme uses dry, solo, medium-tyre practice and requires confirmation before replacing a session/replay. The programme and guide/night selections are session-local; saved team/livery data is unchanged.

The snapshot protocol is now **10**, using previously reserved fields 94–95 for completed-lap validity and AI-assistance evidence. Frame size remains 249 floats per car, and both replay paths preserve those discrete fields. The established 228-column telemetry CSV remains unchanged.

**Validation boundary:** new unit tests cover geometry, bounds, read-only state, real lap crossings, worker metadata, replay preservation and scene restoration. `e2e/08-reference-implementation.spec.ts` exercises real game integration on a WebGL-enabled browser. The authoring environment reports WebGL2 unavailable and local navigation blocked by administrator policy; DOM-only screenshots are not production-render evidence. Full visual acceptance remains required. No supplied screenshots, publisher logos, real-person portraits or editorial overlays are shipped as game textures.

Remaining gaps include the reference title's narrative cinematics, online/friends leaderboards, audio driving accessibility, advanced multi-slot decal editing, exact licensed venues/vehicles, and commercial-quality photoreal rendering. Do not mark those complete merely because a neighbouring cue or inspection button exists.

## Reference-led player tools

The uploaded 100-image pack has now been **reviewed image by image**, with exact filename,
dimensions, SHA-256, observed content, code ownership, viewing steps and remaining gaps in
[the complete audit](docs/REFERENCE_100_AUDIT.md). The same numbered index is searchable from
**Reference Review** in the main menu. This is traceability, not a claim of F1 25/PS5 parity.

| Player-facing addition                                                                                                           | Where to use it                                  | Reference cues                                   |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------ |
| Editable on-car livery: two paints, three patterns, original wordmark and number; saved across reload and quality changes        | **Photo / Livery** → edit → **Save Livery**      | 005, 031, 032, 033 and identity compositions     |
| Frozen-scene photo studio: any car, orbit/elevation/distance, 18–150 mm lens, exposure, roll and actual canvas-only PNG export   | Menu, pause or replay → **Photo Studio**         | 006, 042, 045, 075–077, 083 and broadcast views  |
| Saved Team HQ: department staffing/capacity, facility upgrades, four fictional driver contracts, calendar and transaction ledger | **Team HQ** → Headquarters / Personnel / Finance | 011–019, 035, 081                                |
| Three timed research studies unlock explicit physics setup presets for the next session                                          | **Team HQ** → Engineering                        | 012, 014                                         |
| Local rivalry, reputation and contextual written briefings from classified manual races                                          | Finish a Grand Prix with opponents → **Team HQ** | 018, limited written counterparts to 020/038/086 |

Photo mode returns to the prior menu, paused session or **paused** replay; it does not secretly
resume driving. Unsaved paint previews are discarded on return. Team transactions update the
visible state only after the local save commits. AI demonstration, practice, DNF and solo runs
are not awarded team-rivalry results. Driver identity affects name/number/payroll, not driving AI.

**Reference integrity:** 050–065 are unrelated article/product images, 048–049 are supplementary
wheel/pedal product photos, and 15 entries repeat or vary earlier compositions. They are
explicitly accounted for, not fabricated into 100 unique game features. Reference artwork is
not redistributed in the application. Important outstanding gaps include real night-city scenes,
reverse/global time trials, tire-blanket grid preparation, dedicated audio driving assistance and
animated story/interview scenes. The audit preserves those gaps rather than marking them done.

## 🏁 What is APEX / Formula?

APEX / Formula is an original, single-player Formula-style racing simulation written in **TypeScript and Three.js**. Drive the fictional **2.973 km Aurel circuit**, race AI opponents, change vehicle setup, manage tires and hybrid energy, react to evolving weather, perform pit stops, and inspect the lap through replay and telemetry.

Its central design rule is that a system should change the car, not merely decorate the screen: tire temperature affects grip, fuel changes mass, damage changes aerodynamic loads, water changes contact behavior, and battery deployment consumes stored energy. The dashboard, graphics, and sound consume that simulated state.

> **Project status:** v0.1.0 engineering prototype. This is not an official Formula 1 product, an F1 25 replica, or a commercially validated simulator. Physics coefficients are documented approximations, and the repository does not claim AAA parity, flawless AI, or measured performance on every device. See the [coverage ledger](docs/IMPLEMENTATION_MATRIX.md) for delivered and partial requirements.

## ✨ What you can explore

|     | System                | What is implemented                                                                                                                                                                             |
| --- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🏎️  | Vehicle dynamics      | Six-degree-of-freedom chassis, four suspension contacts, nonlinear load-sensitive tire forces, combined slip, and forces applied at physical attachment points.                                 |
| 🛞  | Tires and brakes      | Soft, medium, hard, intermediate, and wet compounds; surface/carcass temperature, pressure, wear, contamination, flat spots, brake heat, and fade.                                              |
| ⚡  | Powertrain            | Torque-curve engine, eight forward gears, automatic/manual shifting, reverse, limited-slip differential approximation, fuel consumption, hybrid deployment, and regeneration.                   |
| 🌬️  | Aerodynamics          | Separate front wing, rear wing, floor, and drag terms; ride-height response, ground-effect choking, dirty air, slipstream, and damage-sensitive loads.                                          |
| 🌦️  | Evolving circuit      | Spatial water, rubber, marbles, and temperature; clear, wet, and changing-weather sessions; shared track geometry for visuals and contact queries.                                              |
| 🤖  | AI and race rules     | Shared player/AI physics, speed preview, lane commitment, traffic response, starting lights, ordered lap gates, penalties, classification, and results.                                         |
| 🔧  | Pit lane and setup    | Physically driven pit approach, stopping, tire service, and exit; garage settings for wings, brake bias, differential, suspension, pressures, camber, and toe.                                  |
| 🎨  | Original presentation | Procedural car and circuit, PBR materials, articulated suspension and driver, fitted live mirrors, shaped steering wheel with recorded-state selectors, weather effects, and four camera views. |
| 🔊  | Procedural sound      | Web Audio engine harmonics, tire/surface noise, wind, weather, impacts, and nearby-car spatial audio.                                                                                           |
| 📊  | Engineering tools     | Telemetry graphs, lap-distance comparison, CSV export, force/debug overlays, and bounded pose replay with seeking and playback-speed controls.                                                  |
| 🎮  | Browser integration   | Keyboard, gamepad, and touch controls; optional cockpit mouse look; versioned IndexedDB preferences and best-lap records.                                                                       |

## 🎛️ Tune the presentation without changing the physics

The garage exposes independent render resolution, real texture-detail limits, shadows, mirror quality, local scene reflections, particles, vegetation, crowds, bloom, FXAA and anisotropic filtering. Presets initialize these controls; individual overrides persist. Patterned flags and high-contrast instruments accompany the existing remapping, calibration and camera-shake controls.

The reference-led cockpit pass adds fitted mirror apertures, a bevelled butterfly wheel, real-state bias/differential/ERS selectors, cloth microdetail, glove reinforcement and seams. Replay seeks invalidate stale mirror/probe imagery without rebuilding material programs. [See the actual scope, tests and graphics cost](docs/COCKPIT_REFERENCE_CONTINUATION.md); this is not a claim of F1 25 visual parity.

The reference-led circuit pass adds profiled concrete barriers, metre-scaled filtered catch fencing, eight terraced grandstands with structural supports and instanced seating, construction/weathering surface detail, a shared bank-aware grass apron with embedded barrier footings, and weather-consistent sky radiance. [See the circuit evidence and remaining fidelity limits](docs/CIRCUIT_REFERENCE_CONTINUATION.md).

Trackside mode uses twenty fixed camera rigs with coverage-based cuts and predictive panning. Keyboard, touch and controller sampling runs on its own 60 Hz timer rather than waiting for a rendered frame. See [presentation and input engineering](docs/PRESENTATION_AND_INPUT.md) for ownership, tests and remaining boundaries.

## 🚀 Get started

Use **Node.js 22.12 or newer** and a browser with **WebGL2 and module-worker support**.

```sh
git clone https://github.com/cheshmakzanoon-ops/Experiment-3.git
cd Experiment-3
npm ci
npm run dev
```

Open the local address printed by Vite, configure a session, and select **Enter Circuit**. For an immediate demonstration, choose **Free practice** and press **G** to enable the explicitly labelled AI demonstration driver. Press **G** again to take control.

**No backend, account, API key, paid service, or downloaded car/track assets are required.** Geometry, textures, and audio are generated locally. Audio starts after the user enters the circuit.

### 📦 Build and serve

```sh
npm run build
npm run preview
```

The production output is in `dist/`. Deploy that directory to a static HTTPS host. Relative asset paths support subdirectory hosting. Serve the application over HTTP/HTTPS rather than opening `index.html` directly; its modules and physics worker require an HTTP origin. The Vite development server is for local development, not public production hosting.

## 🎮 Controls

| Input                       | Action                                                           |
| --------------------------- | ---------------------------------------------------------------- |
| **W / ↑**                   | Throttle                                                         |
| **S / ↓ / Space**           | Brake                                                            |
| **A, D / ←, →**             | Steer                                                            |
| **[ / ]**                   | Downshift / upshift; switches to manual shifting                 |
| **B + throttle**            | Reverse when nearly stationary                                   |
| **C**                       | Cycle chase, cockpit, pod, and trackside cameras                 |
| **P**                       | Request/cancel a pit stop; automatic approach, service, and exit |
| **E**                       | Cycle harvest, balanced, and attack hybrid modes                 |
| **G**                       | Toggle AI demonstration driving                                  |
| **T**                       | Telemetry and CSV export                                         |
| **R**                       | Replay                                                           |
| **F3**                      | Engineering overlay and contact-load arrows                      |
| **M**                       | Mute                                                             |
| **Escape**                  | Pause and release cockpit mouse look                             |
| **Double-click in cockpit** | Optional mouse look                                              |

Standard gamepads use the left stick and triggers, with shoulder-button manual shifting. Automatic shifting remains active until a manual shift is requested; restarting the session restores it.

Choose **Sport** for filtered steering, traction control, and ABS, or **Unassisted** for the raw tire model. Garage setup changes apply to the **next session**; graphics, audio, and interface changes apply immediately. Heavy-rain sessions select full-wet tires by default; slicks in heavy rain are deliberately much harder to drive.

## 🛠️ Tech stack

Versions below are pinned in [`package.json`](package.json) and [`package-lock.json`](package-lock.json).

| Layer                  | Technology                                   | Responsibility                                                                       |
| ---------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------ |
| Language               | **TypeScript 5.9.3**                         | Strictly typed simulation state, browser integration, and worker messages.           |
| Rendering              | **Three.js 0.180.0 / WebGL2**                | Scene, procedural geometry, PBR materials, shadows, environment, and postprocessing. |
| Build                  | **Vite 7.1.7**                               | Development server, production bundling, worker compilation, and static output.      |
| Simulation concurrency | **Web Workers**                              | Dedicated fixed-step simulation, isolated from rendering.                            |
| Data transport         | **Typed arrays / transferable ArrayBuffers** | Reusable snapshot buffers and compact simulation-to-renderer data.                   |
| Audio                  | **Web Audio API**                            | Synthesized vehicle, tire, surface, weather, and impact sound.                       |
| Input                  | **Keyboard / Gamepad / Pointer APIs**        | Input filtering, device controls, touch interaction, and optional pointer lock.      |
| Persistence            | **IndexedDB**                                | Versioned preferences, setup-related data, and best-lap records.                     |
| Unit testing           | **Vitest 3.2.4**                             | Physics relationships, determinism, race logic, recording, and geometry tests.       |
| Browser testing        | **Playwright 1.55.1**                        | Chromium workflows, screenshots, traces, and console/error checks.                   |
| Code quality           | **ESLint 9.36.0 / Prettier 3.6.2**           | Linting, TypeScript-aware rules, and consistent formatting.                          |
| Automation             | **GitHub Actions**                           | Clean install, lint/test/build checks, simulation scenarios, and browser artifacts.  |

Three.js is the only direct runtime npm dependency. The simulation does not depend on a heavyweight game engine or a separate physics engine.

## ⚙️ Engineering under the bodywork

### 🧵 Rendering and simulation have separate clocks

[`physics.worker.ts`](src/workers/physics.worker.ts) owns the simulation. A **120 Hz fixed-step accumulator** advances the world; each tick uses **two 240 Hz contact/rigid-body substeps**. Rendering interpolates snapshots instead of supplying an arbitrary frame delta to the physics solver.

A pool of **five transferable buffers** carries snapshots. Old buffers are returned for reuse. Pausing resets wall-clock accounting; stale player input triggers a braking fallback. Physics errors stop the worker and surface visibly rather than silently resetting the car.

```text
Keyboard / gamepad / touch
          │ bounded controls + explicit commands
          ▼
Physics worker ── 120 Hz world / 240 Hz contact substeps
          │
          ├── vehicle, tires, brakes, aero, fuel, hybrid
          ├── track surface, collisions, weather
          └── AI, timing, race rules, pits
          │ reusable typed-array snapshots
          ▼
Main thread ── interpolated Three.js rendering
          ├── HUD and live steering-wheel display
          ├── procedural Web Audio
          └── telemetry, replay, and persistence
```

### 🛞 Tires are a force model, not a steering animation

The chassis accumulates linear force and torque at suspension and aerodynamic application points. Four suspension contacts generate dynamic loads through springs, bump/rebound damping, anti-roll coupling, and bump stops.

Tire forces use nonlinear, load-sensitive curves with a combined-force limit. A backward-Euler wheel-angular solve with bisection addresses stiff low-speed behavior; braking includes a condition that prevents the brake from accelerating a stopped wheel backwards. Surface and carcass thermal masses respond to slip energy, heat transfer, and cooling.

These are **engineering approximations**, not proprietary tire measurements or a full multibody/finite-element vehicle model. The [architecture notes](docs/ARCHITECTURE.md) explain the assumptions.

### 🌧️ Weather changes the surface beneath each wheel

The Aurel circuit uses an arc-length-indexed spline and shared ribbon geometry. A **512 × 7 surface grid** stores water, rubber, marbles, and temperature. Rain, drainage, evaporation, and tire passage evolve the local cells; contact queries and wet-road shading use the corresponding state.

This permits spatial differences instead of making the whole track a single global wetness value. The track is an original procedural design, not a scanned real-world circuit.

### 🤖 AI drives the same car model

AI strategy runs at **2 Hz**, traffic decisions at **12 Hz**, and control at **120 Hz** inside the physics worker. Curvature preview and a backward braking envelope determine target speed. Tire grip, fuel mass, and aerodynamic condition influence planning.

AI produces controls for the same vehicle code used by the player. Pit service requires reaching the assigned box and stopping; it does not teleport the car into place. Race timing uses ordered gates and forward progression to prevent repeated finish-line crossings from farming laps.

### 📼 Instrumentation is part of the architecture

Telemetry records physics-tick player state at **60 Hz** into a **15-minute ring buffer**. CSV columns use explicit units and expose actual sample timing. Lap comparison aligns traces by lap distance.

Replay stores **full-session numeric pose history at 15 Hz** in paged storage, interpolated for display. It does not advance the live simulation or claim to restore the entire physical world. Storage errors, worker failures, and graphics-context loss have visible failure paths.

### 🎨 Assets are generated by the project

Car bodywork, wings, wheels, halo, cockpit, trackside infrastructure, textures, and sound are procedural. Static geometry is merged by material; repeated elements use instancing. Wheels and suspension remain articulated from simulated state. Generated environment lighting, directional shadows, PBR surfaces, and restrained high-setting bloom complete the renderer.

No proprietary game assets, real team liveries, external fonts, or extracted recordings are bundled. See [asset provenance](docs/ASSET_PROVENANCE.md).

## 🗂️ Repository layout

These are regular source files and folders, not an archive that must be unpacked inside the repository.

```text
Experiment-3/
├── .github/workflows/ci.yml   # Automated build, tests, and browser validation
├── docs/                     # Architecture, coverage, provenance, measured reports
├── e2e/                      # Playwright browser workflows
├── public/                   # Static application icon
├── scripts/                  # Scenario and endurance runners
├── src/
│   ├── audio/                # Web Audio synthesis and state-driven sound
│   ├── core/                 # Math, units, stepping, and reusable primitives
│   ├── input/                # Keyboard, gamepad, touch, filtering
│   ├── rendering/            # Car, circuit, geometry, effects, renderer
│   ├── simulation/           # Physics, tires, aero, AI, track, race, collisions
│   ├── storage/              # IndexedDB, telemetry, replay, CSV
│   ├── ui/                   # Menus, HUD, engineering interface, styles
│   ├── workers/              # Physics worker and snapshot transport
│   └── main.ts               # Application lifecycle and coordination
├── tests/                    # Unit, property, and rendering-geometry tests
├── index.html
├── package.json
├── package-lock.json
├── playwright.config.ts
├── tsconfig.json
├── vite.config.ts
└── vitest.config.ts
```

`src/simulation/` does not import Three.js or DOM APIs. That boundary allows the vehicle and race logic to run in headless Node.js tests as well as the browser worker. Generated `dist/`, `node_modules/`, and transient test output are not committed.

## 📼 Current recording and rendering checkpoint

The current source adds a physically open cockpit, live rear-view cameras, carbon/wet-road shaders, a budgeted local reflection probe, spatial circuit culling and three-level car detail. The rendering integration passed seven Chromium workflows before publication in commit `77c4d3b`.

The recording extension captures **228 telemetry channels at 60 Hz** and **all-car pose replay at 15 Hz** from physics ticks, independently of display rate. Replay pages and spatial surface history use a bounded IndexedDB cache; CSV formatting runs in a separate worker. Rendered punctures, suspension damage and detached components consume actual simulation state. Read [recording and replay architecture](docs/RECORDING_AND_REPLAY.md) for storage failure behavior and verification limits. The [telemetry and keyboard interface](docs/TELEMETRY_AND_INPUT_UI.md) adds eight graph groups, complete-lap distance comparison, and conflict-checked remapping for fifteen keyboard actions.

The original validation results below are historical baseline measurements, not certificates for every later feature.

## 🧪 Testing and validation

**Current circuit continuation:** 541 unit/property/regression tests in 55 files; 31 browser cases in the complete suite. Local lint, strict build and focused renderer/construction checks are recorded separately from the normal GitHub workflow, which gates publication on the complete suite and native scenarios. Read [the reproducible circuit evidence and remaining acceptance work](docs/CIRCUIT_REFERENCE_CONTINUATION.md). Test counts alone do not certify photorealism or the full master directive.

```sh
npm run check            # ESLint + Vitest + TypeScript + Vite production build
npm run test:physics     # Four-car dry, changing-weather, and wet scenarios
npm run test:endurance   # 100-lap single-car endurance fixture
npx playwright install chromium
npm run test:e2e         # Chromium workflows, screenshots, and traces
```

### 🔬 Recorded evidence and its limits

**Historical foundation checkpoint:** the recovered source was checked on **September 17, 2026**: **49 unit/property tests passed**, along with linting, strict TypeScript checking, and the production build. The live badge above reports GitHub's workflow status separately.

The included [endurance report](docs/endurance-results.json) records **100 dry solo laps**, **two physical pit stops**, approximately **3.424 m maximum non-pit lateral offset**, and intact front-wing/floor health. Its explicitly configured **113 kg starting fuel load** affects real vehicle mass. It is not the short-race menu's standard fuel load.

The included [scenario report](docs/scenario-results.json) covers **four cars × three weather scenarios × 320 simulated seconds**. Every car completed at least four laps; all four fitted intermediates in the changing-weather scenario. Some scenarios include contact damage: the report is not evidence of flawless racing.

These JSON files are measured snapshots from the original validation run. Re-running the scripts refreshes them, including machine-dependent wall-clock measurements. A passing build or headless test is **not proof of visual fidelity, 100 flawless multi-car wet laps, or target-device frame rate**. Browser artifacts and outcomes are available under [GitHub Actions](https://github.com/cheshmakzanoon-ops/Experiment-3/actions).

### 🎮 Calibrated controls and complete race classification

The new device editor explicitly selects unmapped wheels, captures asymmetric steering and independent throttle/brake/clutch endpoints, configures paddles, and pauses safely on disconnect. Settings migrate to version 3. A finite-inertia friction clutch produces actual free-revving and pedal-controlled torque transfer; the clutch channels are included in the current **228-channel** schema and eight graph groups. These are browser Gamepad inputs, not a claim of native wheel force feedback or hardware certification. See [device calibration and clutch](docs/DEVICE_CALIBRATION_AND_CLUTCH.md).

Race timing now preserves all three interpolated sectors, checks all four tire footprints against local track width, finishes the entire field including lapped cars, and labels unresolved competitors DNF instead of manufacturing times. The pit controller reserves pedal-response distance and does not reverse into queues. See [race control and pit response](docs/RACE_CONTROL_AND_PIT_RESPONSE.md).

## 🧭 Current boundaries

The project intentionally distinguishes implemented systems from future fidelity work:

- **Physics:** approximate tire/aero coefficients, BVH ribbon contact, and oriented chassis-box collisions; no experimentally fitted tire dataset, unsprung multibody solver, arbitrary-mesh crash system, or detailed battery chemistry.
- **Presentation:** live rear-view cameras, local probes and car LOD are implemented; screen-space/ray-traced reflections, motion blur, full skeletal driver animation and a streamed external-asset pipeline are not implemented.
- **Racing and devices:** AI still needs broader adversarial traffic testing; no network multiplayer, safety-car/championship system, browser wheel force feedback, or certified device-performance targets.

See the [148-section coverage ledger](docs/IMPLEMENTATION_MATRIX.md) before treating an aspirational requirement as a shipped capability.

## 📚 Documentation

| Document                                                   | Contents                                                                                          |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [⚙️ Architecture](docs/ARCHITECTURE.md)                    | Coordinate system, SI units, ownership, numerical methods, approximations, lifecycle, and errors. |
| [🧩 Specification coverage](docs/IMPLEMENTATION_MATRIX.md) | Section-by-section implementation status and explicit omissions.                                  |
| [🎨 Asset provenance](docs/ASSET_PROVENANCE.md)            | Original procedural content and third-party dependency boundaries.                                |
| [🏁 Endurance results](docs/endurance-results.json)        | Recorded 100-lap dry single-car measurements.                                                     |
| [🌦️ Scenario results](docs/scenario-results.json)          | Recorded dry, changing-weather, and wet four-car measurements.                                    |

---

<div align="center">

**🏎️ Drive the lap. 📊 Inspect the data. 🔧 Understand the system.**

An original browser racing engineering project — with its assumptions and limits documented alongside the code.

</div>

### 🚩 Local race control

Incidents now create local yellow or double-yellow zones instead of slowing the whole field. AI brakes before the zone, may avoid stationary hazards, and must not overtake moving rivals under yellow. Lapped drivers receive blue flags. Pit speeding applies equally to every car, and the automatic limiter reduces power rather than forcing vehicle speed. These are original APEX session rules; see [rules and validation](docs/MARSHAL_RULES.md).

### 🧠 Driver strategy and functional pit service

Seeded driver traits now influence tire care, deployment, reaction time, overtaking cost and early defensive choices. Bounded control mistakes respond to pressure and conditions without changing the vehicle's physical capability. Pit queues account for the future service corridor rather than only current separation. A six-person instanced crew and wheel removal follow actual unloaded service state. The cockpit display adds real best-lap distance delta, brake bias, differential and RPM-driven shift LEDs. See [implementation and validation](docs/DRIVER_STRATEGY_AND_PIT_SERVICE.md).

### ⏱️ Prioritized loading and measured endurance

The initial circuit now builds through cooperative, prioritized work rather than one blocking geometry pass. Loading progress reflects completed chunks. The current simulation also passed ten-car **50-lap and 100-lap dry endurance runs with zero contact**, including a physical tire stop for every car in the 100-lap run. These are recorded fixture results, not universal performance or AI guarantees. See [construction and endurance evidence](docs/CONSTRUCTION_AND_ENDURANCE.md).

## 📈 Reproducible performance captures

Pause a running session and choose **Performance capture**. The app warms up for
five seconds and records thirty seconds of raw live frame intervals, renderer CPU
cost, draw calls, triangles, worker-reported tick cost and valid asynchronous GPU
queries. Pauses, resize and workload changes interrupt the capture instead of
silently dropping bad frames. Exported reports identify the actual built source.

```sh
npm run test:performance -- baseline.json candidate.json
```

The comparison command rejects mismatched machines/configurations, incomplete
runs and significant regressions. Read [measurement definitions and limits](docs/PERFORMANCE_VALIDATION.md)
before comparing reports. CI software rendering is not a consumer GPU benchmark.

## 🎥 Optional motion blur

The garage now offers bounded, depth-aware camera and rigid-object motion blur.
It is off by default and independently adjustable from the graphics preset. The
HTML instruments remain sharp, and camera cuts, replay seeks and long stalls
reset motion history. Unsupported float-render-target devices keep the normal
unblurred renderer. See [implementation and GPU tests](docs/MOTION_BLUR.md).

## 🌦️ Weather that reaches the tires, brakes and replay

The changing-weather session now follows validated cloud/rain/temperature/wind
keyframes through a storm and retreat. Wind affects aero and recorded particles;
water persists after rainfall stops. Grounded tire work drives spray and smoke,
and fractional emission keeps light rain visible at high refresh rates.

Sport ABS now releases regenerative as well as friction braking. Automatic
anti-stall no longer drives through a light brake below coupled idle speed.
Wet-slick AI reserves real control margin and merges toward pit entry instead of
passing away from it. Ten-car wet and initially-slick pit regressions require real
tire replacement and exit, with minor contact explicitly recorded rather than
mislabelled zero-contact success. See [weather and braking](docs/WEATHER_AND_BRAKING.md).

The exact 148-section [original master directive](docs/MASTER_DIRECTIVE.md) is now
versioned alongside the coverage ledger, so continuation does not depend on
remembering a different numbered attachment. Its byte identity is tested.

### Connected marble state and continuous driving regression

Loose rubber now transfers from actual loaded road cells to individual tires,
changes lasting grip, and sheds as the tire rolls. Live/replayed cell density
drives road flecks; individual dirt, wear, blistering and graining drive tread
materials. Solid pickup chips consume physical cumulative counters rather than
a throttle/race-time animation. The 211-channel CSV schema preserves all earlier
199 column positions.

`npm run test:journey` executes a continuous six-car changing-weather race with
ordinary control requests: wheelspin, lock/release, kerb and grass, dirty-tire
recovery, a real intermediate-tire stop, rejoin, deliberate contact, damaged aero,
classification, historical replay and CSV verification. It is included in
`test:physics`; failures are saved and return a failing exit code. This does not
claim the full manual audiovisual acceptance is finished.

Physics and CSV workers are now self-contained inline-worker bundles, avoiding
the Worker constructor's external-asset-origin failure when the application is
loaded through a CORS-enabled CDN. The browser suite executes both real workers
under two distinct test origins and verifies cleanup. Restrictive host policies
must permit `blob:` workers; no browser security setting is disabled.

Read [the exact subsystem scope and validation boundaries](docs/MARBLES_AND_SURFACE_STATE.md).

### Replay effects, camera audio and engineering inspection

Replays now reconstruct spray, rain, smoke, dust, sparks and pickup effects from
recorded state rather than suppressing all particles. Paused simulation time
freezes their births and motion. The active camera controls engine voice selection,
stereo placement, distance falloff and Doppler; trackside views hear actual passing
cars instead of a player-locked sound field.

**F3** opens the engineering panel: per-wheel forces/slip/temperature/wear, body
motion/G, aero balance/drag, actual surface cells/rubber and AI speed/path/decision.
Physical contact markers, suspension-query rays and normal-load arrows accompany
an opt-in, timestamped worker probe. Unrecorded probe extras are hidden in replay.

[Read the implementation and measured validation scope](docs/REPLAY_AUDIO_AND_ENGINEERING.md).
The complete master directive is still not declared finished.

### Camera and controller continuation

The camera now remains aligned through slow rendered turns and publishes its
completed mode together with its audio listener. Pauses preserve the view exactly.
Recorded wheel spin, steering and suspension interpolate without the usual wrapped
phase reversal. Garage settings now remap controller action buttons, validate
conflicts, and migrate existing preferences to settings version 6. Held buttons
cannot re-trigger pause/resume or leak drive commands into replay.

The original 148-section directive remains unchanged. The [development status](docs/DEVELOPMENT_STATUS.md)
and [replay/camera evidence](docs/REPLAY_AUDIO_AND_ENGINEERING.md) distinguish local
validation from remote publication and the still-open complete final acceptance.

The integrated candidate also removes the obsolete patch-transfer workflow. Normal
source CI retains the full native and browser gates, and publishes the exact tested
static artifact only after all gates succeed. This configuration has local fixture
evidence, not a completed GitHub run for this unpushed candidate.

## Road-tangent contact and recorded floor strikes

Wheel slip and force now share a road-tangent frame. Four local floor supports
create real pitch/roll moments, dissipate sliding/damping work and drive abrasion
and hard-surface sparks from recorded contact positions. Snapshot protocol 9
appends 17 skid channels; all previous 211 CSV positions are preserved in the
228-column export. The wet pit-entry integration also closes a lead/follower
priority cycle without overriding velocity or weakening the service gate. See
[contact physics and validation boundaries](docs/ROAD_CONTACT_AND_SKIDS.md).

## 100-image reference depth pass

The [individual image review](docs/REFERENCE_100_IMAGE_BY_IMAGE_REVIEW.md) rechecks every numbered file against its original hash. New runtime work adds ten independent flank-text decals, opt-in photo focus, a real mesh-derived point-cloud/render comparison, advisory audio-driving cues, an original inspectable 3D workshop/atrium and a four-week team-economy calendar. Open **Reference Review** for individual inspection routes. These are original implementations, not copied reference artwork or a claim of commercial-game parity.

Run `npm run test:reference-ui` for real browser DOM, Canvas2D texture and OfflineAudioContext evidence; `CHROMIUM_PATH` selects an installed browser and `REFERENCE_EVIDENCE_DIR` selects its output directory. This is explicitly **not** the GPU gameplay suite. See [validation](docs/REFERENCE_100_PASS_VALIDATION.md) for measured results and the WebGL2 limitation.

### Phase 27E presentation and evidence continuation

Original car/cockpit/service-area detail, snapshot-lit wet spray and broadcast
framing now accompany source-linked PNG/reference decisions and optional full-lap
frame/video recording. Open Reference Review for numbered comparisons, or pause
a session and select FULL-LAP VISUAL REVIEW for actual frame observations.

Read [Phase 27E scope, measurements, reproduction and outstanding acceptance](docs/PHASE_27E_PRESENTATION_ACCEPTANCE.md)
before treating any screenshot, passing test or local capture as commercial
visual parity, representative hardware evidence or Steam-release acceptance.

### Phase 27F development candidate

Shared floor/diffuser and wheel-cover LODs, an original shaped helmet, crowd and
planting refinements, a cloudy night dome, solid-aware broadcast framing, and
bounded session/audio/hardware evidence are implemented in the Phase 27F source
increment. See [measurements, reproduction and open acceptance](docs/PHASE_27F_ACCEPTANCE_CONTINUATION.md).
This is not complete 148-section/reference acceptance or a Steam-ready build.
More modes, stronger models/atmosphere and at least 16 genuine maps remain open;
Steam productization is not automatically the next milestone.

### Trackside operations — A08–A10

Aurel’s normal renderer loads authored signal housings/utility cabinets, approach-facing braking and sector boards, and dry/rain broadcast-camera installations. LED panels follow the same recorded local witness as the marshals; replay optical positions and physical track boundaries are preserved. Editable sources and validation details: [Trackside Operations Kit](docs/TRACKSIDE_OPERATIONS_KIT.md).
