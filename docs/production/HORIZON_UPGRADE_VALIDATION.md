# Horizon upgrade: implementation and validation

**Review date: 16 October 2026.** The original MOTOBOUND Festival / Solvane upgrade is implemented.
The retained evidence covers the individual reference review, gameplay physics, shared-system
regressions, rendering contracts, interface navigation and a completed real browser session.
The Festival closeout day, rainy-night and mountain views, normal application entry, and its guarded
production build are recorded in section 7. Sections 8–10 record the subsequent integration of
concurrent MotoGP changes and the final validated publication build identity.

## 1. Reference method and implementation scope

The [100-reference implementation ledger](HORIZON_REFERENCE_IMPLEMENTATION.md) records IDs
**001–100 exactly once**, with an individual observation, implementation decision, source links
and limitations for each image. The review opened every image individually: 37 vehicle images,
25 environment/lighting images and 38 gameplay/UI/mixed images. The merged record was checked
for missing and duplicate IDs; both counts were zero.

The pack includes vehicle portraits, scenery, actual interface views, advertising, hardware
infographics and illustrations. Those categories remain explicit in the ledger. A promotional
reward panel can inform visual hierarchy without establishing that a seasonal service was
implemented. A vehicle still can guide visible geometry and material separation without measuring
tyre forces, engine output or handling. Reference screenshots are not shipped as game textures.
New vehicle details, architecture, signs and scenery geometry are original; the existing
photographic vegetation assets retain their existing provenance.

**Blender was not needed for this pass.** The existing TypeScript/Three.js procedural mesh pipeline
allowed added detail to stay attached to vehicle pose, damage groups, quality levels and resource
lifetime, while environment details could follow the existing road heights and building
footprints. The work extends that runtime directly. [OPEN_WORLD.md](OPEN_WORLD.md) describes the
complete current Festival behavior and its continuing limitations.

### What changed

| Area | Implemented result | Primary code and evidence |
| --- | --- | --- |
| Vehicle presentation | Physical front/rear fascia apertures, recessed ducts and cores, layered optics, hollow exhausts, louvres, trim and race hardware; differentiated original road-body profiles. Existing wheel, cabin, damage and paint systems remain connected. | [Body details](../../src/rendering/vehicle-bodies/festival-detail.ts), [body construction](../../src/rendering/vehicle-bodies/closed-body.ts), [profiles](../../src/rendering/vehicle-bodies/body-sheet.ts). |
| Vehicle integration | Road/Formula switching follows the current entrant holder; Formula rivals use distance/quality LOD. Material/reflection registration follows vehicle changes, and owned resources are released on clear. | [Festival cars](../../src/rendering/open-world/festival-cars.ts), [switch/lifetime tests](../../tests/festival-car-switch.test.ts). |
| Roads, architecture and scenery | Road-paint wear, town paving/drainage, shaped guardrails and reflectors; architectural trim and varied roofs/windows; original commercial signs, awnings, planted setbacks, meadow, harbour lights/lanterns and coastal workboats. | [Roads](../../src/rendering/open-world/roads.ts), [buildings](../../src/rendering/open-world/buildings.ts), [dressing](../../src/rendering/open-world/horizon-dressing.ts); per-image decisions and CPU geometry bounds are in the reference ledger. |
| Ambient traffic | A shaped original compact body with open wheel arches, sloped glass, wheels and layered lamps replaces the simple body presentation. Four shared instanced material batches retain registry scaling, pose interpolation and lamp state. | [Traffic rendering](../../src/rendering/traffic-cars.ts), [geometry/material tests](../../tests/festival-traffic-visuals.test.ts). |
| Driving view and grounding | Speed-responsive camera framing, supported local reflections, route chevrons/checkpoint flags, contact trails, surface-aware cloud tint and motorcycle-specific contact filtering. The carved-ground query aligns off-road placement with the rendered mountain cut surface. | [Renderer](../../src/rendering/open-world/festival-renderer.ts), [guidance](../../src/rendering/open-world/horizon-guidance.ts), [contacts](../../src/rendering/open-world/festival-contacts.ts), [ground query](../../src/simulation/open-world/ground-height.ts). |
| Activities and scoring | Three new activities bring the region to 16 events. Rolling skill activity entry preserves the car's state. Legal speed-zone progress and drift validity/live-score consistency are corrected. Manual free-roam drift/clean-speed chains bank after a clean interval and lose unbanked points on invalidation. | [Region](../../src/simulation/open-world/region-data.ts), [session](../../src/simulation/open-world/session.ts), [event scoring](../../src/simulation/open-world/festival-events.ts), [skill chains](../../src/simulation/open-world/skill-chain.ts). |
| HUD, map and photo | Visible skill/status hierarchy, filterable map with route preview and discovery-gated travel, paused orbit/zoom photo mode, focus retention, and keyboard/gamepad access. Paused photo actions cannot start a background event. | [HUD](../../src/ui/festival-hud.ts), [controls](../../src/session/festival-controls.ts), [host integration](../../src/session/free-roam.ts), [six DOM regressions](../../e2e/49-festival-menu-access.spec.ts). |

## 2. Automated verification results

The following runs are separate evidence. Some test selections overlap, and the working tree was
still receiving integration changes during the long broad run. Their counts are not combined
into an invented single all-green run.

These historical rows describe the Festival implementation and closeout before the concurrent
MotoGP integration. The post-integration gates and focused results are recorded separately in
section 8; the earlier counts and outcomes have not been relabelled as integrated runs.

| Check | Recorded outcome | Evidence |
| --- | --- | --- |
| Initial broad `npm test` | **353 passed / 3 failed files**, 356 total; **3,000 passed / 9 failed tests**, 3,009 total. Exit 1; 1,607.39 seconds. | [Original complete output](horizon-evidence/broad-unit-tests-initial.log), [structured summary](horizon-evidence/broad-unit-tests-summary.json). |
| Isolated rerun of the three failed files | **3/3 files and 13/13 tests passed**. Exit 0; 32.61 seconds. No source or test edits for the rerun. | [Rerun output](horizon-evidence/broad-unit-tests-targeted-rerun.log). |
| Later rendering/integration selection | **13/13 files and 71/71 tests passed**, 70.32 seconds. | [Rendering output](horizon-evidence/rendering-regressions-71-tests.log). |
| Final Festival menu DOM selection | **6/6 tests passed**, 40.3 seconds, with GPU and WebGL disabled. | [DOM output](horizon-evidence/festival-menu-dom-6-tests.log). |
| Night-lighting integration selection | **6/6 files and 41/41 tests passed**; the later fill-value adjustment also passed scoped lint. | [Night test output](horizon-evidence/night-regressions-41-tests.log). |
| Final bridge/contact/photo selection | **3/3 files and 19/19 tests passed**, including the actual photo-camera branch on both bridge levels. | [Final bridge/photo output](horizon-evidence/photo-bridge-regressions-19-tests.log). |
| Source-guarded production build | **Passed, exit 0**, after the last runtime changes; full TypeScript checking and Vite bundling completed without changing protected inputs. | [Build output](horizon-evidence/closeout-guarded-build.log), [structured gate record](horizon-evidence/closeout-gates.json). |
| Full TypeScript check | Passed, exit 0, including the final production build after the photo/lighting corrections. | [Guarded build log](horizon-evidence/closeout-guarded-build.log), [gate records](horizon-evidence/closeout-gates.json). |
| Full project lint | Passed, exit 0; the final renderer adjustments also passed scoped ESLint. | [Full lint log](horizon-evidence/closeout-lint.log), [gate records](horizon-evidence/closeout-gates.json). |
| Content validation | Passed, exit 0. | [Content log](horizon-evidence/closeout-content.log), [gate records](horizon-evidence/closeout-gates.json). |
| Retained real-physics route harness | Four route runs produced completed results with zero off-route seconds and zero player recovery replacements. | [Harness](../../scripts/horizon-gameplay-validation.ts), [complete results and source hashes](horizon-gameplay-validation.json). |

The Festival closeout gate record contains the exact commands, start/end times, process exit codes and log
hashes. Full lint and content validation preceded the last small renderer corrections; those
changed modules passed scoped lint, and that guarded build ran after all Festival closeout runtime
changes, before the concurrent MotoGP integration.
The command was `node --experimental-transform-types scripts/source-stability.ts -- npm run build`.
It was **not** a run of `npm run check:stable`, and did not repeat the broad unit suite. The existing
Vite warning about chunks larger than 500 kB remains visible in the successful build log.

### Initial failures and targeted rerun

Eight initial failures came from `studio-qa-tools.test.ts` and `review-tools.test.ts`, whose child
CLI processes produced empty output under the execution wrapper. A read-only `spawnSync` probe
recorded **`EPERM` with status 0 and empty stdout/stderr**. Both unchanged test files passed when
rerun with the approved local process escalation. The raw probe, exact commands and failure list
are retained in the [summary JSON](horizon-evidence/broad-unit-tests-summary.json).

The remaining failure was the existing pit-release scenario, “anticipates the future service-bay
sweep before a moving car becomes trapped beside a serviced car.” It exceeded its **30,000 ms**
limit during the broad run, at **31,079 ms**. The isolated rerun passed in **16,921 ms**, with the
same assertions and timeout. No persistent assertion failure remained after the targeted rerun.

The broad run initially appeared to stop logging while its workers continued executing. Its
pathname had been replaced while Vitest still held the original file descriptor open. The complete
output was recovered read-only from that descriptor, including the final summary. The copied
original bytes and hashes are retained in the [evidence archive](horizon-evidence/README.md).

The broad run collected **356 test files** before four later visual integration files were added.
Those later changes are covered by the focused rendering selection; the evidence does not claim
one all-green, immutable-source 360-file run.

### What the focused tests establish

The 71-test selection checks reflection/IBL behavior, actual front/rear cooling apertures, lamp
material grouping, geometry lifetime, Formula/road switching and Formula LOD, probe detail,
wet reflections, grade-aligned route guidance, bounded traffic geometry, ground-height queries,
contact placement, motorcycle effects and actual cloud tint uploads. These checks construct and
exercise production modules. They do not measure the appearance or frame rate of a full rendered
world. [The evidence index](horizon-evidence/README.md) records the exact selection for reproduction.

The six DOM tests exercise the production HUD and input/control code with a controlled status
fixture. They cover every keyboard pause-menu action, a normal results click during incoming status
updates, map filtering/selection/focus across redraws, photo return with a background race card,
fresh synthetic-gamepad presses across overlay transitions, and denied Gamepad API access. GPU and
WebGL were disabled. This is separate from the real worker/renderer journey in section 5 and does
not establish physical gamepad, wheel or pedal compatibility.

## 3. New events and real-physics route checks

The three activities use the existing road/airfield network. Their measured event distances exclude
the **60 m braking runout** included in each authored open path.

| Activity | Measured event distance | Authored path including runout | Targets / field |
| --- | ---: | ---: | --- |
| Harbour Opening Run | 2,579.525 m | 2,639.525 m | Sprint with two rivals. |
| Kestrel Drift Playground | 706.316 m | 766.316 m | 100 / 300 / 600 points; 15 m half-width. |
| Kestrel Launch Run | 1,239.981 m | 1,299.981 m | 110 / 160 / 210 km/h. |

The [retained harness](../../scripts/horizon-gameplay-validation.ts) constructs
`OpenWorldSimulation`, starts events through the normal command path and advances its actual
physics at **120 Hz with two substeps per tick**. Its fixed settings are clear weather, Sport
assist, seed 73021, tile budget 12 and ambient traffic disabled. It does not force pose or velocity
after event start, issue recovery/reset commands, or write career records. Source hashes and each
complete typed result are retained in [horizon-gameplay-validation.json](horizon-gameplay-validation.json).

| Run | Controller | Recorded outcome | Elapsed simulation time |
| --- | --- | --- | ---: |
| Harbour Opening Run, TC1 | Production session autopilot. | Completed in **105.667 event seconds** after the three-second countdown; third of three, two stars. | 108.667 s |
| Kestrel Launch Run, TC1 | Production session autopilot. | Completed at **85.488 km/h**, zero stars; its conservative route-end braking makes this a continuity check. | 30.633 s |
| Kestrel Launch Run, TC1 | Scripted route steering, throttle 1 and brake 0 through normal `setInput`. | **230.109 km/h**, three stars. | 27.967 s |
| Kestrel Launch Run, EH3 | The same scripted full-throttle method. | **348.698 km/h**, three stars. | 18.267 s |

All four runs completed with **zero off-route seconds and zero player recovery replacements**.
The full-throttle checks establish that the authored three-star speed target is mechanically
reachable through the existing physics. They are assisted scripted runs: the external steering
controller is still assistance even though those two game result objects have `assisted: false`
because the in-session autopilot was disabled. None is a human driving record.

Kestrel Drift Playground passed route-graph resolution and width/target checks. Its scoring rules
have focused regressions, but this retained harness did **not** complete a scripted or human
drift-playground run. Free-roam skills are session-local, separate from career settlement; their
tests cover clean banking and invalidation by crash, spin, airborne/reverse conditions, reset and
autopilot. [OPEN_WORLD.md](OPEN_WORLD.md) explains the resulting rules and event-entry continuity.

The JSON's wall-clock durations are execution timings under concurrent work, not frame-rate
measurements or hardware benchmarks. Reproduce the gameplay record with:

```sh
node --experimental-transform-types scripts/horizon-gameplay-validation.ts
```

## 4. Daytime and vehicle comparisons

The retained **1280 × 720, Medium-quality** views compare the original Festival at commit
`f91463cf506f6feced1a4db9c43af48ac3632410` with the Festival closeout composition before the concurrent
MotoGP integration. The baseline checkout's
`src`, `index.html`, `vite.config.ts` and `package-lock.json` were unchanged. The new camera framing,
architecture, paving, signs, traffic, vehicle detail and HUD are all visible in the actual game.

| View | Retained image |
| --- | --- |
| Original Medium driving view | [Baseline](horizon-evidence/visuals/baseline-medium-day.png). |
| Final Medium driving view | [Updated](horizon-evidence/visuals/accepted-medium-day.png). |
| Final Festival menu | [Menu](horizon-evidence/visuals/accepted-medium-festival-menu.png). |
| Final world map | [Map](horizon-evidence/visuals/accepted-medium-map.png). |
| Final orbit photo mode | [Photo](horizon-evidence/visuals/accepted-medium-photo.png). |

[Baseline state](horizon-evidence/visuals/baseline-medium-state.json) and
[Festival closeout state](horizon-evidence/visuals/accepted-medium-state.json) retain renderer/error observations.
That state retains its original served build fingerprint. These are presentation comparisons, not
matched performance benchmarks: camera framing, traffic state and frame/pass counts differ.

Controlled vehicle look-development images use the same static camera and lighting for each
before/after pair: [RH3 before](horizon-evidence/vehicles/rh3-front-before.png) and
[after](horizon-evidence/vehicles/rh3-front-after.png), plus
[SC7 before](horizon-evidence/vehicles/sc7-rear-before.png) and
[after](horizon-evidence/vehicles/sc7-rear-after.png). They show the added apertures, ducts, optics
and material depth. These are earlier geometry-review iterations, with their own
[recorded statistics](horizon-evidence/vehicles/lookdev-stats.json); they are not represented as
the later Festival closeout world-lighting captures. That world set is separately identified below.

All retained PNGs are unmodified renderer/browser output. The
[evidence manifest](horizon-evidence/evidence-manifest.json) records their exact bytes and hashes.

## 5. Completed real browser journey

The [retained browser script](../../scripts/horizon-browser-review.mjs) completed a production
Festival-session journey against the review server at port 4188. It used the actual
`FestivalSession`, workers, `InputController` and renderer, with natural initial discovery rather
than pre-populated discovery records. The [journey JSON](horizon-evidence/journey/journey.json)
contains **nine recorded checks, all passed**, and `completed: true`.

| Capture property | Recorded value |
| --- | --- |
| Graphics setting | Low |
| Viewport | 960 × 540 |
| Renderer | ANGLE / Vulkan / SwiftShader Device (Subzero), a software renderer |
| Source fingerprint | `9ebc826ed95d012520bb1c2c7296f255d15f47c4dfae77e609aee296c66bbb47` |
| Commit field | `null` in the served identity; no commit is inferred from the fingerprint. |
| Recorded page/console errors | 0 |
| Recorded asset HTTP error responses | 0 |

GPU submissions were held between deliberate rendered states so software-GPU readback could
finish. Simulation and real input continued normally, without simulation acceleration. The
launch/brake input was sent through keyboard controls; the race completion deliberately used the
production autopilot and was marked assisted. This methodology validates the integrated workflow
and selected rendered states; it does not measure continuous-play frame rate.

| Recorded check | Observation |
| --- | --- |
| Session boot and discovery | The real session started in the TC1 and naturally discovered Harbour Opening Run. |
| Keyboard driving and braking | The car moved **6.927685 m**, reached **15.579923 km/h**, and braked to **0.015531 km/h** with autopilot off. |
| World map | Route preview and the undiscovered-event fast-travel gate worked; closing returned to the paused menu. |
| Paused photo mode | Orbit changed the camera position by **4.433357 m** while the simulation stayed paused; Escape returned to driving. |
| Garage round trip | Formula → RH3 → TC1 changes passed through the real worker and renderer. |
| Event travel and start | Travel to the discovered event, start card, countdown, real rivals and route presentation worked. |
| Completed result | Harbour Opening Run finished in **105.666667 seconds**, third of three, two stars, zero off-route seconds, with `assisted: true` and exactly one typed result. |
| Results continuation | Continue returned to free roam. |
| Session exit | The HUD was removed, the session reported no longer ready, geometry count fell **644 → 1**, and texture count fell **40 → 17**. Shared/global resources remain retained; this single exit check is not a long-duration memory-leak benchmark. |

The four retained views are [map](horizon-evidence/journey/journey-map.png),
[photo](horizon-evidence/journey/journey-photo.png),
[event](horizon-evidence/journey/journey-event.png) and
[results](horizon-evidence/journey/journey-results.png). These PNGs and the JSON were copied without
modification and are covered by the [evidence manifest](horizon-evidence/evidence-manifest.json).

This journey enters the actual Festival session through the review fixture. The normal main-menu
entry route separately passed through the production application, as recorded in section 7. The
journey and main-entry captures predate the final night and bridge refinements; their original
source identity remains explicit rather than being relabelled as the final one.

## 6. Interpretation and continuing limits

The evidence supports original improvements to geometry, materials, ground alignment, effects,
Festival navigation and activity rules. It also demonstrates representative integrated driving,
event completion, results flow and cleanup. The 100 still images provide visual direction and an
auditable decision trail; they do not establish perfect commercial-game parity.

The existing tyre, suspension, drivetrain and damage systems remain the physics foundation.
The route checks test the new activities through those systems and do not infer new force models
from photographs. Existing AI limitations remain documented in [OPEN_WORLD.md](OPEN_WORLD.md).
Ambient traffic still uses one original generic compact scaled to registered vehicle extents and
the existing kinematic traffic simulation; its presentation does not add individual licensed
traffic models or new simulated wheel telemetry.

No target-device **60 FPS** result, universal hardware compatibility or sustained high-quality
performance acceptance is claimed. The real journey used SwiftShader with selected frame
submissions, and the DOM tests disabled graphics. Physical controllers, wheels and pedals were
not part of those automated checks. Long-duration memory stability and every vehicle/weather/
camera combination require their own evidence.

The pass does not establish new seasonal reward services, premium entitlements, online modes or
licensed reference-game vehicles. Marketing and hardware images remain classified honestly in
the [reference ledger](HORIZON_REFERENCE_IMPLEMENTATION.md). Distant landforms and sparse mountain
planting retain a procedural appearance. The pass improves that presentation but does not claim
a complete photogrammetric landscape or equivalence to the reference game.

## 7. Festival closeout captures before concurrent MotoGP integration

The completed Festival closeout capture sets and guarded build used this runtime fingerprint:

```text
8f7a38bbeeec13ef12dc344ffc20a310887e78f0091e17e30c6b1ef4707782b0
```

It matched both the frozen production review build and the successful guarded production build of
that composition. These captures predate the concurrent MotoGP integration in section 8; they are
retained with their original pixels, JSON and source identity, not presented as captures of the
new integrated fingerprint.
The identity hashes the runtime sources, lockfile, application HTML and Vite configuration. Its
`commit` field was `null` because the captures/build preceded publication; it is not an invented
commit identifier. Evidence/doc additions do not change that runtime fingerprint.

### Rendered scenes from the Festival closeout

| Scene | Settings and result | Evidence |
| --- | --- | --- |
| Harbour Front, day | Medium, 1280 × 720. Driving, menu, map and paused photo views rendered successfully. Updated map background hides the underlying menu; the vehicle rear duct is enclosed and dark. | [Day/menu/map/photo state](horizon-evidence/visuals/accepted-medium-state.json), images in section 4. |
| Harbour Front, rainy night | High, 960 × 540, RH3. The final view separates roof, rear quarter, door panels and wheel arches while keeping tyres and recesses in deep shadow. Traffic retains coloured paint, dark glazing and distinct lamps. Window frames/interior variation remain readable without the earlier broad clipping. | [Driving](horizon-evidence/visuals/accepted-high-night-drive.png), [photo](horizon-evidence/visuals/accepted-high-night-photo.png), [settings/state/errors](horizon-evidence/visuals/accepted-high-night.json). |
| Varda Pass, golden hour | Medium, 960 × 540, RH3, clear weather. Camera clearance, tyre placement, road cut and guardrail alignment were visually accepted. Chevrons follow the sloping bend; photo mode hides them correctly. | [Driving](horizon-evidence/visuals/accepted-varda-drive.png), [photo](horizon-evidence/visuals/accepted-varda-photo.png), [settings/state/errors](horizon-evidence/visuals/accepted-varda.json). |

These closeout sets use the native presets and actual session, worker and renderer on ANGLE/Vulkan
**SwiftShader**, a software GPU. Rendering is held after selected frame submissions so readback
can complete. The JSONs retain settings, camera/vehicle positions, source identity and raw
rendering counters. Counters include the passes performed by that frame, including environment
and local-probe updates when scheduled; they are not stable-frame or hardware performance
benchmarks. Page/console error lists and recorded HTTP error responses were empty in all three
capture sets. The HTTP hook observes status 400 and above, not every possible network failure.

Only the mountain review seeds all discoveries in its isolated fixture so the production travel
path can reach the remote event. It starts `pass-zone` using the public session command to expose
route guidance. This changes no normal player save and is not a human speed-zone result. The
completed nine-step journey in section 5 used natural discoveries and real keyboard input.

### Defects resolved during visual acceptance

The first rainy-night view exposed excessive headlight illumination, flat luminous windows and a
nearly black player. The final festival calibration uses a shorter, softer inverse-square dipped
beam, lower exposure, restrained window emission with mullions/transoms/interior variation, and
stronger authored diffuse fill. This changes no light count, shadow-map count, render-pass count
or geometry count. It adds a small amount of facade fragment shading. It is a presentation
calibration, not a measured real-world illumination model.

Height-aware road queries now reject a mismatched bridge layer and a distant segment whose
lateral offset alone happened to be small. Contact particles/trails and route samples pass their
known world height. Both chase and photo cameras use the photographed/driven subject's layer.
A reproduced normal 3.5 m photo orbit previously snapped 4.37 m upward to the bridge; the final
production-camera tests verify that it stays on the intended layer for both lower-road and
upper-deck subjects. Shared road-selection policy and simulation physics remain unchanged.

### Normal production application entry

The [main-entry record](horizon-evidence/main-entry.json) contains **four checks, all passed**:
production main menu/circuit preview loads; Session selection enters Festival on the shared
application canvas; pause/photo/return works; and exiting restores the production session menu.
It used a fresh isolated IndexedDB profile with supported Low graphics at 960 × 640 and ordinary
UI actions. It had no renderer, worker, input or capture stubs. Recorded page/console errors and
HTTP error responses were zero. Its original fingerprint is the earlier
`9ebc826ed95d012520bb1c2c7296f255d15f47c4dfae77e609aee296c66bbb47`, matching the separately recorded
full journey rather than the later visual corrections.

### Publication checks

The final review found all 100 ledger IDs exactly once and all local implementation links valid.
Production source and build configuration contain no scratch-directory dependencies or references
to the review fixture. The evidence files are ordinary repository files; build outputs and
`node_modules` are excluded. Source and documentation whitespace checks passed. Raw test logs retain their original diagnostic
whitespace and blank lines; the final staged whitespace check excludes those unchanged log bytes.
The subsequent integration described below preserves the existing history and unrelated modes. The repository's
existing remote validation/release workflow remains authoritative for any distributed playable
release; these local results do not predeclare that remote workflow successful.

## 8. Concurrent main integration and validated build identity

The Festival implementation was validated at the local integration checkpoint
`06e20b2162158e04c499e48600aefbf531076fef`, with the concurrent MotoGP improvement commit
`6e93a4ef452764f2ee0b69797817f91a908d897e` retained as its parent. The integration used a clean
rebase; the README overlap merged automatically. The MotoGP changes were preserved rather than
being replaced by the earlier Festival-only composition.

The [integrated gate record](horizon-evidence/integrated-gates.json) identifies that commit and
the validated integrated runtime fingerprint:

```text
13a1175f3deddf9bb25dbed0efadda0da0888c8d3f9aefe13d75b8f0b9b5f283
```

The gate record's `buildIdentity.commit` identifies that validated local checkpoint. A subsequent
motorcycle slipstream integration is recorded in section 9, with its own final runtime fingerprint.
The original JSON commit field is preserved; it is not relabelled as the publication commit.

The prior `8f7a38bbeeec13ef12dc344ffc20a310887e78f0091e17e30c6b1ef4707782b0` capture identity in
section 7 remains historical evidence of the Festival closeout before this composition. None of
those images, capture JSON files or previous test-output files was edited or relabelled to claim
the new fingerprint.

### Checks after integration

| Check | Recorded outcome | Evidence |
| --- | --- | --- |
| Full project lint | Passed, exit 0; 22.474 seconds. | [Integrated lint](horizon-evidence/integrated-lint.log), [gate record](horizon-evidence/integrated-gates.json). |
| Full content validation | Passed, exit 0; `Content valid`; 4.558 seconds. | [Integrated content validation](horizon-evidence/integrated-content.log), [gate record](horizon-evidence/integrated-gates.json). |
| Source-guarded production build | Passed, exit 0; 49.513 seconds. `npm run build` completed full TypeScript checking and Vite production bundling, with the configured source inputs unchanged across the guarded command. | [Integrated guarded build](horizon-evidence/integrated-guarded-build.log), [gate record](horizon-evidence/integrated-gates.json). |
| Focused shared/Festival regressions | **8/8 files and 58/58 tests passed**, 22.95 seconds. | [Integrated regression output](horizon-evidence/integrated-regressions-58-tests.log). |

The gate JSON preserves the exact commands, UTC start/end times, process exit codes and log hashes.
The retained copies match those hashes. The guarded command was:

```sh
node --experimental-transform-types scripts/source-stability.ts -- npm run build
```

This was a source-guarded **build**, not `npm run check:stable`, and it did not repeat the earlier
3,009-test broad unit suite. The integrated 58-test selection covers road detail and vehicle-family
wear, Festival car switching, route presentation, ground/bridge/photo heights, race-view continuity,
Festival effects, startup and motorcycle presentation. Its counts are separate from every earlier
test row. The Vite build retained its chunk-size advisory while completing successfully; the log
does not claim a new bundle-size or frame-rate acceptance result.

### Production main entry on the integrated checkpoint

The [integrated main-entry record](horizon-evidence/integrated-main-entry.json) reports
`completed: true` and **four checks, all passed**, with the same local checkpoint commit
`06e20b2162158e04c499e48600aefbf531076fef` and runtime fingerprint
`13a1175f3deddf9bb25dbed0efadda0da0888c8d3f9aefe13d75b8f0b9b5f283` as the integrated build.
The production main menu and circuit preview loaded; Session selection entered the RH3 Festival
on the shared application canvas; pause/photo/return worked; and exiting restored the production
session menu. The recorded page/console error and HTTP error lists were both empty.

This check used supported Low graphics at **960 × 640** in a new isolated IndexedDB profile, with
ordinary UI actions and no renderer, worker or input stubs or simulation/capture hooks. It is
dated evidence for the specified integrated checkpoint, separate from the earlier full Festival
journey and visual capture sets. Its original JSON and the five integrated gate/test artifacts
are retained unchanged and included in the [evidence manifest](horizon-evidence/evidence-manifest.json).

## 9. Motorcycle slipstream integration checkpoint

Before publication, `main` advanced to `8f1823ee566815c0f0469c84519e9f3c57be91e8`.
That commit adds a bounded motorcycle slipstream calculation, applies it to the existing bike drag
solver, and adds three tests. Its only changed paths are `src/simulation/bike-slipstream.ts`,
`src/simulation/bike-vehicle.ts` and `tests/bike-slipstream.test.ts`. The Festival upgrade was
rebased cleanly onto it. These concurrent MotoGP commits remain in the publication's history.

The slipstream integration fingerprint is:

```text
4d7d70ed9b2c8c927c4fa419bfc57ca29b570e54c9a8121bd11c075e64a9e419
```

The [publication gate record](horizon-evidence/publication-gates.json) associates this fingerprint
with the validated local checkpoint `1e45b1ec30a844586b8bb5241141f9bb51cb862d`.
A subsequent motorcycle-bodywork integration is recorded in section 10 with its own final runtime
fingerprint. This earlier checkpoint's original evidence identity fields are unchanged.

| Check on the slipstream integration | Result | Evidence |
| --- | --- | --- |
| Incoming motorcycle slipstream plus motorcycle presentation and Festival effects | **3/3 files and 14/14 tests passed**. The new physical acceleration/drag behavior and the shared presentation/effect boundary are covered. | [Final targeted tests](horizon-evidence/publication-slipstream-tests.log). |
| Scoped lint of all three incoming files | Passed, exit 0. | [Final scoped lint](horizon-evidence/publication-slipstream-lint.log). |
| Full TypeScript check and source-guarded production build | Passed, exit 0; 39.284 seconds. Protected inputs were unchanged during the command. | [Final guarded build](horizon-evidence/publication-guarded-build.log), [exact commands and hashes](horizon-evidence/publication-gates.json). |

The later slipstream commit changes no Festival rendering, car physics, HUD, application entry or
photo/exit code. The four-step normal entry result in section 8 therefore remains evidence for
those unchanged paths at its recorded `13a1175…` checkpoint. It was not relabelled or claimed as a
new browser run on `4d7d70…`. The earlier full project lint/content validation, broader regression
selections and rendered captures retain their own exact scopes and dates. The complete broad unit
suite was not rerun here. Existing remote validation and playable-release gates remain unchanged.

The first build of this runtime also exited successfully and wrote the same build identity,
but its live log pathname was replaced while the command still held the earlier file open. Only
the prebuild header remained at that pathname. Its [original gate record](horizon-evidence/publication-initial-gates.json)
and [partial log](horizon-evidence/publication-initial-guarded-build-partial.log) are retained unchanged.
The guarded build was repeated with output buffered through a subprocess pipe and written after
completion. The final log linked in the table includes the TypeScript/Vite invocation and complete
successful build output. Targeted tests and lint were not repeated for this capture correction.

## 10. Final source after the concurrent motorcycle bodywork update

The final composition preserves `8523372aa27e831e826807982c225f203d6e23ff`, which adds
original GP cooling-outlet meshes, attaches them to the existing sprung motorcycle body, and
includes its Blender authoring script and geometry tests. Its four paths are `src/rendering/bike.ts`,
`src/rendering/gp-cooling-louvers.ts`, `tests/gp-cooling-louvers.test.ts` and
`tools/motogp/author_gp_cooling_louvers.py`. The Festival changes were rebased cleanly onto this
commit, preserving all three concurrent MotoGP updates.

The final validated runtime fingerprint is:

```text
b2e96b50396e622c1f490b05f09931ec0a203d3525f28d25dca7574796ac213b
```

The [final gate record](horizon-evidence/final-gates.json) identifies local checkpoint
`6023ba632af8822d9d45339508267d4899fc503f`. The publication commit can have different metadata and additional
documentation while retaining this same runtime fingerprint.

| Final check | Result | Evidence |
| --- | --- | --- |
| Motorcycle cooling geometry, motorcycle presentation, Festival effects and car switching | **4/4 files and 18/18 tests passed**. | [Bodywork integration regressions](horizon-evidence/final-bodywork-regressions.log). |
| Lint of all three incoming TypeScript files | Passed, exit 0. | [Bodywork lint](horizon-evidence/final-bodywork-lint.log). |
| Full TypeScript check and source-guarded production build | Passed, exit 0; 42.783 seconds, with protected inputs unchanged. | [Complete final build](horizon-evidence/final-guarded-build.log), [commands, hashes and identity](horizon-evidence/final-gates.json). |

The incoming meshes affect GP motorcycles. They change no Festival car body, road, building,
lighting, HUD, car-event scoring, application entry or photo/exit implementation. The previous
car-world captures and four-step normal-entry result remain attributed to their recorded source
identities; no new GPU capture, hardware performance result or broad-suite run is claimed for this
last integration. The targeted checks and final guarded build above cover this addition. The
remote validation and playable-release workflows remain unchanged and authoritative.
