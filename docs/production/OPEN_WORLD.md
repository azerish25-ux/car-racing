# Open world: the Solvane Coast festival region

State: **integrated** (reachable from SESSION → *Festival · open world*, covered by unit tests and
`npm run test:open-world`). The region now has **18 events** (a head-to-head touge battle and a
quarter-mile drag race among them), a hold-to-rewind, rolling skill activities, manual-driving
skill chains, and keyboard/gamepad navigation through the pause menu, map and photo controls. Region,
places and roads are fictional; no real-world map data is used.

The [100-reference implementation ledger](HORIZON_REFERENCE_IMPLEMENTATION.md) records the individual
visual observations, original adaptations and explicit limits. The changes retain the existing
vehicle, tyre, contact and road-network physics; still images are not used as measured dynamics data.
Final integrated scene captures and build/test figures belong to the integration verification report.
This document does not establish reference-hardware performance or human playtest acceptance.

## 1. What exists

| Area | Implementation | Evidence |
|---|---|---|
| Region (8.19 × 8.19 km, seed `0x50a1e`) | `region-data.ts` (authored features), `terrain-field.ts` (deterministic heightfield: gradient-noise fbm/ridged relief, coast with beach and quay, Varda massif and spurs, Ashvale valley with river channel, flats for Port Ilse, Kestrel airfield and a village, forests, farmland, snow line) | `tests/open-world.test.ts` (determinism, authored features) |
| Road network (70.9 km, 60 edges, 37 junctions, 20 bridges) | `road-network.ts`: centripetal Catmull-Rom splines per authored road, junction detection with snapping (a node made of road ends also joins any road whose carriageway it lies on), overpass pins, grade-limited vertical profile per class, level junction pads (every branch held at the node height until it is clear of the other roads' footprints, side roads on the through road's crown, no superelevation across the pad), crown and curvature bank, guardrail and bridge flags, 32 m spatial grid, layer-aware `nearest` and `covering` | classes: highway 19.8 km, country 16.7, mountain switchbacks 11.6, dirt 9.9, town streets 8.6, runway 4.4; `validateRoute` on the whole network as one RouteGraph; `validateRegion` checks that every control point shared by several roads is a junction joining all their branches |
| Carved terrain tiles | `terrain-tiles.ts`: 256 m tiles at 4 m, road bed carved per segment, bridges not carved; one triangulation shared by physics (`gridHeight`) and render meshes; LRU cache with a hard residency budget and look-ahead prefetch | exact-interpolation test; budget test while crossing the region |
| World surface for physics | `open-world-track.ts`: `OpenWorldTrack` answers every `Track` member (conformance test) — road surface with crown/bank, markings, shoulders falling to the drawn verge edge, rails one-sided at the guardrail face; off road: grass, soil, rock, sand, snow, town paving, water depth; each on the shared ground-material ids of simulation v2 (dirt road and shoulder are dirt, not a gravel trap; beaches sand; snow; river and sea bed mud); layer-aware on bridges; weather and wetness. Soft boundaries, no laps. One continuous ground: every road whose footprint covers a point counts (true distance; a dead end stops at its end line), the highest road inside a carriageway is the surface (the ribbon drawn on top), each road fades in across its shoulder so overlaps meet without a step, the class comes from the carriageway the point is in (paved first); beside the roads the 4 m terrain tile is met over a one-tile-step run-out from the shoulder edge | surface, bridge, ray-cast and rail tests; continuity tests: every junction carriageway is road, no step in junction mouths over 0.3 m at 0.5 m spacing (measured worst 0.17 m at 0.25 m: a highway crown under a side road's shoulder), shoulder edge within 5 cm of the ground beyond (worst 4 mm), dead ends end at their end line, every event race line on road |
| Free roam session | `session.ts` (`OpenWorldSimulation`), `src/workers/open-world.worker.ts` (120 Hz fixed step, 2 substeps; the frame pool is refilled whenever an event changes the field size), `src/session/free-roam.ts` (host glue), `src/session/festival-controls.ts` (pause and input ownership), `src/ui/festival-hud.ts`, `src/ui/festival-map.ts` (map projection) | reset to the nearest road (upturned, drowned, fallen, out of region); during an event, back at the legal progress (never more than 8 m ahead of it); time of day and weather, autopilot cruise, fast travel to discovered events (held behind the loading screen until the destination has streamed in), placed cars hold on the brakes until the driver acts, discoveries persist in the festival save, world map and heading-up minimap in the same orientation as the 3D view (east on the left of the north-up map); paused overlays turn driving input off so actions are reachable with Tab, Space/Enter and Escape; standard-gamepad D-pad, accept/back and pause actions navigate the menu, map and photo controls; `tests/open-world-worker.test.ts` runs a race through the real worker protocol; `e2e/49-festival-menu-access.spec.ts` |
| Events (18) | `festival-events.ts`, `route-path.ts`: road race (coast to summit, 10.2 km), circuits built from road routes (18.2 km grand loop, Port Ilse streets, Kestrel airfield), sprints (valley, Thornwood dirt stage), speed traps, speed zones (average speed), drift zones (`scoring.ts`), runway showcase; added Harbour Opening Run, Kestrel Drift Playground and Kestrel Launch Run; the Varda Touge Battle (`touge`) and the Kestrel Quarter Mile (`drag`, `drag.ts`), see §2 | events are discovered within 380 m; race cards require a slow approach below 4 m/s; explicit race starts use a grid and route-following rivals; passive activities preserve the car and momentum through their entry gate; legal progress via `RouteProgress` (no shortcut credit); measured finish distances and retained route checks are below |
| Route AI | `route-driver.ts`: pure pursuit on a minimum-curvature line inside the road, scaled by the understeer measured from the car's own yaw rate; the circuit AI's capability envelope (`envelopeCornerSpeed`, `envelopeProfile`, `peakGrip` of the real contact); crest and loose-road speed reserves; follow/pass, reverse-out recovery, reset request | `npm run test:open-world` drives 10.17 km of asphalt and a 5.14 km dirt stage in the default road car without stalls, resets or off-route time; on simulation v2 physics a historical development sweep drove both routes to the finish in the 15 festival machines admitted at that time (road, GT, club, touring, rally, off-road, prototype, Formula), four of them with one off-route moment of about a second on the long route |
| Result for career | `FestivalResult` (kind `festival-result`, version 2, `festival-result.ts`): run id (`<session id>:<run number>`, the session id is a fresh UUID per festival session), event, vehicle, completed/abandoned, position/entrants, time, trap speed, average speed, drift score and lines, stars, legal distance, off-route seconds, standings, assisted | dispatched as a `festival-result` window event and kept in the festival save (`festival:v1`); the career consumes it (next row) |
| Career festival discipline | `src/career/festival.ts`: the region is a career venue (`festivalRegion`/`festivalVenue` in `liveRegistry`, venue kind `festival`, admitted classes from `festivalVehicles()`); `CareerController.listen(window)` validates each `festival-result` (`validateFestivalResult`) and settles it with `settleFestival` once per run id (`festival:<run id>` in `paidSessions`; unpaid runs — autopilot, unfinished, a machine not in the garage, a locked event — are settled too); pay lines: completion (races: plus rivals beaten), new stars above the event's best, first completion, personal best, on the route; reputation only from new stars and first completions; owned festival machines pay at their tier's rate, the career's loaned machine (entered from CAREER; `festivalLoaner`: the festival's default car, never saved as the festival save's machine) at 0.25, with its own record (`loaner`) so a later own-machine run is measured against own-machine runs only, and a per-event `reputation` count caps an event at two per star plus one; a festival entered from SESSION select in a machine the career does not own is ignored (nothing written, no toast); unlocks are rules by event kind (`FESTIVAL_RULES`: reputation 0 for traps, zones, drift zones, sprints and the drag strip, 6 road race and touge battle, 12 circuit, 20 showcase; a rewound run is paid but earns no clean-route bonus, a red-lit drag is not completed) plus discovery in free roam; per-event records in career save version 2 (`festival`, migrated from version 1) | `tests/festival-career.test.ts` (paid once per run id through the controller's event listener, refusals settled, loaner rate, a loaned run then an own-machine run, the festival loaner, runs outside the career ignored, unlocks, migration, hub tab); the hub's FESTIVAL tab (`src/ui/career-hub.ts`) lists every event with kind, state, reasons, discovery and your best, and starts free roam or fast travel to a discovered event in the active festival machine (or the loaner) |
| Ambient traffic | `ambient-traffic.ts`: kinematic cars on the lanes of highways, country roads and town streets (registry road-class machines), following road-network edges and choosing the next edge at each junction (deterministic hash); intelligent-driver-model car following of the traffic and the player in the lane, curvature and turn speeds, junction claims (first come, first served, minor roads wait for close higher-priority traffic, nobody enters while the player is in the junction); spawned in a ring 180–440 m from the player (never in the forward view inside 340 m), at most 24 alive and a per-256 m-tile cap from the tile's road length (≤ 3), removed beyond 620 m; cleared while an event runs; the player collides through a box contact with an impulse at the traffic car's mass (the traffic car keeps the speed change along its lane, slides, then stops with hazards); the free-roam autopilot follows traffic in the right-hand lane and never overtakes into the oncoming lane; HUD toggle in the festival menu (*Ambient traffic*, kept in the festival save); presentation `src/rendering/traffic-cars.ts` uses four shared instanced material batches (paint, glazing, wheels/trim and lamps) with a tapered compact shell, open wheel arches, sloped glass, rounded tyres/alloys and layered lamps; registry extent scaling, per-ID pose interpolation and brake/hazard brightness remain driven by the traffic block sent with each frame | `tests/festival-traffic-visuals.test.ts` (bounded material batches, geometry and pose/material contracts); `tests/open-world-traffic.test.ts` (determinism, caps, spawn distance, off during events and toggle, following, collision impulse and momentum); `npm run test:open-world` measures it separately (`docs/open-world.json` → `traffic`) |
| Motorcycles | road motorcycles and the supermoto run on the bike adapter (`BikeVehicle`; the SM-450 on `DirtBikeVehicle`) on the open-world surface: placed by `placeFree`, the bike block in the frame, the circuit's procedural bike and rider (`src/rendering/festival-riders.ts` drives `BikeShells`), crashes and remounts by the adapter's own bounded recovery (a rider down over 20 s is reset); rivals of a rider are riders; the route driver steers a bike with the bike AI's lean-intent law, a corner-speed reserve on public roads and a walking-pace turn-round | `tests/open-world-bikes.test.ts`; bike roam and races measured separately in `npm run test:open-world` (`docs/open-world.json` → `bikes`) |
| Rendering | `src/rendering/open-world/`: quadtree terrain LOD (levels 0–6 over 16 km, skirts, tile worker), PBR splat blending (grass/rock/soil/sand/snow with wetness and snow tint), road ribbons with markings, verges, runway thresholds, bridge decks/piers/parapets, W-beam guardrails, town lamps; instanced vegetation (broadleaf, conifer, shrubs) with near/mid LOD, where the finest level always draws every tree that has a trunk collider (the density setting thins shrubs and the far level only); procedural town buildings with emissive windows at night, added architectural trim and commercial/festival dressing; sea and river water; route chevrons and checkpoint flags; speed-responsive cameras, local reflections on supported settings, tyre-contact trails and surface-aware wheel effects; paused orbit/zoom photo view; reuses the circuit sky, daylight palette, clouds, environment, post stack and the ULTRA pipeline | the [reference ledger](HORIZON_REFERENCE_IMPLEMENTATION.md) links the presentation modules and per-image decisions; final integrated scene evidence and statistics are recorded by the integration owner, separately from these system contracts; no reference-hardware acceptance is claimed here |

Vehicles are read from the registry (`festivalVehicles()` in `festival-machines.ts`: every
four-wheel definition except karts, road cars first, then every road motorcycle and the supermoto;
knobby motocross machines stay on the dirt venues) and drawn by the shared procedural body library
(cars) or the procedural bike presentation (motorcycles); a road machine or road motorcycle chosen in
MACHINE starts the festival. Rivals are drawn from the player's class, riders against riders (the
showcase pace car is the fastest registry car).

## 2. Activities, skills and controls

### New routes on the existing roads

The three additions use the existing road network. The measured event ends 60 m before each
authored path ends, leaving a braking runout. HUD event distances and speed measurements use the
measured section; the extra runout is not credited as driven distance.

| Activity | Kind / setting | Measured event distance | Authored path including runout | Targets |
| --- | --- | ---: | ---: | --- |
| Harbour Opening Run (`harbour-welcome`) | Sprint through the waterfront, market and upper streets; two rivals | 2,579.525 m | 2,639.525 m | Existing race position/star rules |
| Kestrel Drift Playground (`kestrel-drift`) | Broad airfield taxiway bend; 30 m running width | 706.316 m | 766.316 m | 100 / 300 / 600 points |
| Kestrel Launch Run (`runway-launch`) | Straight runway acceleration speed trap | 1,239.981 m | 1,299.981 m | 110 / 160 / 210 km/h |

Automatic skill-zone entry retains the same vehicle, velocity, pose, gear, tyres, damage and controls.
The car must cross the entry plane at the correct road height and travel in the route direction;
passing beneath or approaching behind a marker does not activate it. Race cards require a slow
approach, so normal driving past a race marker does not open a card. Explicit starts still use the
normal grid/start procedure. Speed-zone averages use legal net route progress and elapsed time;
reversing and re-driving a section cannot inflate the measured distance.

The retained [physics report](horizon-gameplay-validation.json) records a legal Harbour Opening Run
in the `tc1` using the in-session autopilot: 105.667 s of event time plus the three-second countdown,
third of three and two stars. Both runway full-throttle checks reached the three-star target:
230.109 km/h in the `tc1` and 348.698 km/h in the `eh3`. All four retained route runs completed with
zero off-route time and no player recovery replacement. The ordinary autopilot's separate runway
run reached 85.488 km/h because its speed envelope brakes toward the route end; it is a route
completion check, not a maximum-speed attempt.

These are scripted runs using actual simulation physics. The full-throttle checks take steering
from `RouteDriver`, set throttle to 1 and brake to 0 through the ordinary input API, and leave
in-session autopilot off. Their game result therefore has `assisted: false`, but the external
scripted steering is assistance: these are not human or unassisted records. Drift playground route
geometry has been validated; no completed human or scripted drift trial is claimed here. The
[harness](../../scripts/horizon-gameplay-validation.ts) preserves the exact reproduction command.

### Touge battle, drag strip and rewind

Measured from the FH6 gameplay references (ledger: [fh6-r4/gameplay-events.md](fh6-r4/gameplay-events.md)).

| Activity | Rules | Evidence |
| --- | --- | --- |
| Varda Touge Battle (`varda-touge`, kind `touge`) | One rival, standing start side by side (columns ±1.7 m in the 3.5 m lanes, ref 048) 4 m down the route, 7 m short of the start arch and its night flares, from below the summit; 3,501 m downhill (502 → 245 m) through the four Varda hairpins (R 12–20 m), finish after the last; staged at dusk (`lighting: 'sunset'`: a day session switches to golden hour for the run and back after it). The HUD's big value is the live gap to the rival from both cars' legal distance-time traces; stars by the margin at the finish: within 3 s 1, a win 2, a win by 2 s 3 | `tests/festival-events-r4.test.ts`; development run: the TC-1 on the autopilot 109.7 s, the rival TC-3 (route driver at 0.92) 101.0 s, no resets |
| Kestrel Quarter Mile (`kestrel-drag`, kind `drag`) | Up to three rivals in four 5 m lanes on the runway, fronts staged on the festival hub's launch line; a full tree (pre-stage, stage after 1 s, a 0.6–1.4 s automatic delay, three ambers 0.5 s apart, green 0.5 s after the last); the brakes hold a staged car while its throttle is closed (rev against them to launch); leaving the stage beam (0.3 m roll-out) before green is a red light: disqualified, last, not completed. Per lane, interpolated each step: reaction from green, 60 ft, eighth mile, quarter-mile elapsed time from leaving the line and the trap speed over the last 66 ft; the race clock is reaction plus elapsed time and the result waits up to 4 s for the other lanes' slips. AI lanes react 0.11–0.23 s after green and stay in lane. The hub's two shoulder trees and a portable centre tree (shown only during a run) sequence with the frame clock (`rendering/open-world/drag-strip.ts`), as does the HUD tree | `tests/festival-events-r4.test.ts` (tree sequence, step-rate independent timing, staging, red light, brake-torque launch, lamp sequencing); development run in the TC-1: reaction 0.501 s, 60 ft 2.13 s, ET 12.87 s at 177 km/h |
| Rewind (`rewind.ts`) | Hold Backspace (or the Flashback binding; a controller button rewinds 3 s): the worker scrubs back through a 10 s history sampled every 0.1 s of driving at twice real time, posing every car (nothing is integrated); release restores the frame at the cursor — fresh cars (as a reset) with the recorded pose, velocities, wheel spin, gear and engine speed; legal progress, the event clock, drift-meter and touge-trace state — and drops everything newer. Available in free roam off the autopilot and in running races and skill challenges; never on the drag strip, in a countdown or on a result; cleared by a reset, a new machine, travel, the autopilot and every event start/end. Results carry `rewinds` | `tests/festival-events-r4.test.ts` (history bounds, scrub and restore within one sample, motion resumes, progress and clock restored, no rewind on the strip, cleared by a reset) |

Skill chains add **Air** (time off the ground at 14 m/s or more, 0.35–1.5 s, landed cleanly on
the road: 260 points a second, AIR / GREAT / AWESOME / ULTIMATE AIR) and name the traffic pass
**Near Miss**; longer flights are falls (the region has crests, not ramps). There are no
destructible roadside objects, so no Wreckage skill.

### Manual-driving skill chains

[`FestivalSkillChain`](../../src/simulation/open-world/skill-chain.ts) scores real grounded, on-road
drifts and sustained clean-speed driving during free roam and passive skill activities. Its
time-based multiplier grows from 1× to a maximum of 5×. Four simulation seconds without another
awarded skill banks the pending total once the car is on the road and grounded. Brief straightening
can link maneuvers; wheelspin at rest, reverse motion, airborne speed and driving inputs alone earn
nothing.

A crash, spin, reset, new machine, fast travel, manual event start or prolonged off-road driving
loses unbanked points. Switching on autopilot drops a pending chain and automated driving cannot
earn it; previously banked session totals remain. Race participation does not generate a second
free-roam skill payout. The HUD receives active/banked/lost state, base score, multiplier, projected
bank, timer, last bank, best chain and session total in the normal low-rate status message. These
are session-local driving points, separate from event results, persistent career currency and
reputation.

Drift-zone scores remain a separate activity measurement. `DriftMeter` allows a 0.35-second
straightening interval, invalidates impacts during that interval as well as resets, spins and
airborne slides, and uses the same scoring calculation for the live total and final result.
The focused gameplay tests cover sample-rate independence, bank/loss behavior, rolling car
continuity, race-card interruption and speed-zone distance accuracy.

### Overlay input ownership

| Flow | Current behavior |
| --- | --- |
| Pause / resume | Escape, or the configured gamepad pause action (Start on the standard default mapping). Pausing turns driving input off and focuses Resume. |
| Keyboard navigation | Tab / Shift+Tab cycle within the active menu, map or photo controls; Space / Enter activate the focused button. Returning to driving restores driving input. |
| World map | Open from the pause menu or the default `T` shortcut while driving. All / Races / Skills filter the event list; selecting an event previews its route and details. Fast travel is offered only for discovered events. Initial focus goes to Close; event-list redraws preserve selection-button focus. Escape or gamepad Back closes the map to the still-paused menu first. |
| Photo mode | Open from the pause menu. Drag to orbit, scroll to zoom, or activate the two orbit buttons; Hide Controls leaves a Show Controls button. Return to Drive, Escape or gamepad Back resumes driving. Enter on a photo control cannot activate a background event card or result. |
| Standard gamepad menus | D-pad moves focus, A accepts and B goes back through the top overlay. Held A/B/Start/D-pad buttons do not create repeated actions across an overlay transition. The controller polling path tolerates denied Gamepad API access. |

The six DOM regressions in
[`e2e/49-festival-menu-access.spec.ts`](../../e2e/49-festival-menu-access.spec.ts) exercise the real HUD,
festival controls and application input controller without a scene renderer or simulation worker.

## 3. Streaming budgets

* Physics: one LRU cache of LOD0 tiles shared by every car in the session worker (64 tiles,
  about 4 km², by default). The acceptance drive holds a single car to 24 tiles (peak 24/24) with
  no synchronous stall over 10 km; tiles are prefetched 2.5 s ahead of each car within about
  1.2 ms every other step (one tile at least; typical build 4–8 ms, worst 22 ms in Node).
* Render: quadtree split factor / max tiles / tiles in flight / tree density per tier —
  low 1.25 / 110 / 3 / 0.45, medium 1.6 / 150 / 4 / 0.7, high 2.1 / 220 / 6 / 1. The tree
  density thins the far level and, on the finest level, only shrubs: physics collides with every
  trunk, so each is drawn. Over 121 sampled tiles that is 2.0× the previous near-level tree
  count on low and 1.35× on medium (high unchanged); its cost is unmeasured. The default
  preset keeps ULTRA effects off; ULTRA uses the existing opt-in pipeline.
* Region build (heightfield, network, events, placements): about 0.5 s in Node.

## 4. Commands and retained evidence

* `npm run test:open-world` — region, network and event checks, AI drives (coast-to-summit
  10.17 km, Thornwood dirt stage), a race in the session with a typed result — all with ambient
  traffic off, so they do not depend on it — then, measured separately, two minutes of free roam
  with traffic (caps, spawn distance, determinism, cost) and motorcycles (free roam on three bikes,
  a road sprint and the dirt stage on bikes); writes `docs/open-world.json`.
* `npx vitest run tests/open-world.test.ts tests/open-world-session.test.ts tests/festival-skill-chain.test.ts tests/open-world-worker.test.ts tests/open-world-traffic.test.ts tests/open-world-bikes.test.ts tests/festival-career.test.ts tests/festival-map.test.ts tests/route-graph.test.ts`.
* `npx playwright test e2e/49-festival-menu-access.spec.ts` — the real HUD, controls and input
  controller in Chromium. Its six tests cover all keyboard pause-menu actions; results clicks during
  incoming status; map filters, discovery/travel eligibility and focus retention; photo return with
  a background event card; D-pad/accept/back press edges through map/photo transitions; and denied
  Gamepad API access. The focused development run passed all six with GPU and WebGL disabled;
  this fixture supplies no rendered-world or physical-controller acceptance evidence.
* `node --experimental-transform-types scripts/horizon-gameplay-validation.ts` — runs the retained
  [route harness](../../scripts/horizon-gameplay-validation.ts) and writes
  [horizon-gameplay-validation.json](horizon-gameplay-validation.json), including complete event
  results, source hashes, fixed-step settings, controller method, tick/event time and separate
  execution wall time. It uses no browser or renderer and writes no career records.
* `npm test` — the broader shared-system regression suite. Final aggregate totals and the final
  source/build gate are reported by the integration owner.

## 5. Known limits (honest)

* Ambient traffic is deliberately simple: kinematic cars with no tyre model, no lane changes or
  overtaking, no indicators, no pedestrians or parked cars, U-turns never (a dead end stops a car
  and it is removed out of sight); cars can cross a junction together after a claim times out (8 s);
  traffic does not collide with traffic or with event rivals (it is off during events); it is
  silent (no engine voices). Its four material batches still describe one generic compact scaled to
  each machine's existing half-extents; individual traffic models and new wheel rotation/steering
  telemetry are not implemented. The render capacity is 48 while the simulation cap remains 24; spawning
  follows the player's position, not the rendered tile residency; its frame and draw cost on
  reference hardware are unmeasured (Node: see `docs/open-world.json`).
* Rendering has not been captured on reference hardware; frame time, draw calls and memory under
  the budgets above are unmeasured. Software-rasteriser (CI) loading is slow.
* AI keeps a reserve on loose roads (41 m/s cap) and over crests; it is not a rally driver and does
  not use the full width of narrow gravel at speed. Road cars reach over 300 km/h on the coast road;
  there is no speed limit enforcement or police mechanic.
* Karts are not offered (no road clearance), nor the motocross machines (knobby tyres).
  Motorcycles on the route driver keep a large reserve (a corner-speed factor of 0.88 and the
  sharpest point of each 12 m sample window), so AI riders are much slower than AI cars on the
  same route; a rider down is recovered by the bike adapter, and the 10 km coast route on a
  superbike had one autopilot fall in development runs. No human riding review.
* Building interiors, pedestrians, parked-car populations and destructible scenery are absent;
  buildings and trunks are static collision only.
* The career pays festival runs from the moment they are delivered in the same tab; a result
  delivered while the career cannot save is counted for that session only. There are no festival
  seasons or championships; online play is not supported.
* Surface audio voices grass and gravel only, so dirt, sand and snow roll silently.
* Rewind restores fresh cars (damage repaired, tyres and brakes at their initial temperatures, engine
  speed and gear as recorded) and drops unbanked skill points; ambient traffic is frozen while
  scrubbing and cars within 18 m of the restored player are removed. It is a 10 s history at 0.1 s
  steps, so a release lands on the sample at or before the cursor. Controllers rewind a fixed 3 s.
* The drag strip has no lane walls, painted burnout boxes or win lights; the trees are on the
  shoulders and a centre tree is drawn only during a run (nothing stands on the runway otherwise, as
  other events drive through the line). The touge has no lead/chase format, contact rule or
  rematch; a touge rival is one AI on the same route driver as every race.
* Bridges carry the road deck; terrain below is not shaped as river banks under every bridge.
* Where two road footprints touch without overlapping at different heights (8 points of the
  32,574 shoulder-edge samples, worst 10 cm) the surface steps between them; a road's square end
  at a junction leaves an undrawn wedge on the outside of a sharp joint that physics reads as
  shoulder.
* Menu/gamepad regressions use a synthetic standard controller. Physical controllers, wheels and
  human driving/riding sessions have not been accepted by those tests; browser policy may deny the
  Gamepad API, in which case keyboard and pointer interaction remain available.
