# Open world: the Solvane Coast festival region

State: **integrated** (reachable from SESSION → *Festival · open world*, covered by unit tests and
`npm run test:open-world`). Not performance-, player- or release-accepted: no reference-hardware
capture or player session has been recorded. Region, places and roads are fictional; no real-world
map data is used.

## 1. What exists

| Area | Implementation | Evidence |
|---|---|---|
| Region (8.19 × 8.19 km, seed `0x50a1e`) | `region-data.ts` (authored features), `terrain-field.ts` (deterministic heightfield: gradient-noise fbm/ridged relief, coast with beach and quay, Varda massif and spurs, Ashvale valley with river channel, flats for Port Ilse, Kestrel airfield and a village, forests, farmland, snow line) | `tests/open-world.test.ts` (determinism, authored features) |
| Road network (70.9 km, 60 edges, 37 junctions, 20 bridges) | `road-network.ts`: centripetal Catmull-Rom splines per authored road, junction detection with snapping (a node made of road ends also joins any road whose carriageway it lies on), overpass pins, grade-limited vertical profile per class, level junction pads (every branch held at the node height until it is clear of the other roads' footprints, side roads on the through road's crown, no superelevation across the pad), crown and curvature bank, guardrail and bridge flags, 32 m spatial grid, layer-aware `nearest` and `covering` | classes: highway 19.8 km, country 16.7, mountain switchbacks 11.6, dirt 9.9, town streets 8.6, runway 4.4; `validateRoute` on the whole network as one RouteGraph; `validateRegion` checks that every control point shared by several roads is a junction joining all their branches |
| Carved terrain tiles | `terrain-tiles.ts`: 256 m tiles at 4 m, road bed carved per segment, bridges not carved; one triangulation shared by physics (`gridHeight`) and render meshes; LRU cache with a hard residency budget and look-ahead prefetch | exact-interpolation test; budget test while crossing the region |
| World surface for physics | `open-world-track.ts`: `OpenWorldTrack` answers every `Track` member (conformance test) — road surface with crown/bank, markings, shoulders falling to the drawn verge edge, rails one-sided at the guardrail face; off road: grass, soil, rock, sand, snow, town paving, water depth; each on the shared ground-material ids of simulation v2 (dirt road and shoulder are dirt, not a gravel trap; beaches sand; snow; river and sea bed mud); layer-aware on bridges; weather and wetness. Soft boundaries, no laps. One continuous ground: every road whose footprint covers a point counts (true distance; a dead end stops at its end line), the highest road inside a carriageway is the surface (the ribbon drawn on top), each road fades in across its shoulder so overlaps meet without a step, the class comes from the carriageway the point is in (paved first); beside the roads the 4 m terrain tile is met over a one-tile-step run-out from the shoulder edge | surface, bridge, ray-cast and rail tests; continuity tests: every junction carriageway is road, no step in junction mouths over 0.3 m at 0.5 m spacing (measured worst 0.17 m at 0.25 m: a highway crown under a side road's shoulder), shoulder edge within 5 cm of the ground beyond (worst 4 mm), dead ends end at their end line, every event race line on road |
| Free roam session | `session.ts` (`OpenWorldSimulation`), `src/workers/open-world.worker.ts` (120 Hz fixed step, 2 substeps; the frame pool is refilled whenever an event changes the field size), `src/session/free-roam.ts` (host glue), `src/session/festival-controls.ts` (pause and keyboard), `src/ui/festival-hud.ts`, `src/ui/festival-map.ts` (map projection) | reset to the nearest road (upturned, drowned, fallen, out of region); during an event, back at the legal progress (never more than 8 m ahead of it); time of day and weather, autopilot cruise, fast travel to discovered events (held behind the loading screen until the destination has streamed in), placed cars hold on the brakes until the driver acts, discoveries persist in the festival save, world map and heading-up minimap in the same orientation as the 3D view (east on the left of the north-up map); the pause menu turns driving input off so every action is reachable with Tab, Space/Enter and Escape (a gamepad pauses and resumes); `tests/open-world-worker.test.ts` runs a race through the real worker protocol; `e2e/49-festival-menu-access.spec.ts` |
| Events (13) | `festival-events.ts`, `route-path.ts`: road race (coast to summit, 10.2 km), circuits built from road routes (18.2 km grand loop, Port Ilse streets, Kestrel airfield), sprints (valley, Thornwood dirt stage), speed traps, speed zones (average speed), drift zones (`scoring.ts`), runway showcase | events are discovered within 380 m; stopping at the marker opens the card; races start in place with a grid and route-following rivals; legal progress via `RouteProgress` (no shortcut credit test) |
| Route AI | `route-driver.ts`: pure pursuit on a minimum-curvature line inside the road, scaled by the understeer measured from the car's own yaw rate; the circuit AI's capability envelope (`envelopeCornerSpeed`, `envelopeProfile`, `peakGrip` of the real contact); crest and loose-road speed reserves; follow/pass, reverse-out recovery, reset request | `npm run test:open-world` drives 10.17 km of asphalt and a 5.14 km dirt stage in the default road car without stalls, resets or off-route time; on simulation v2 physics a development sweep drove both routes to the finish in all 15 festival machines (road, GT, club, touring, rally, off-road, prototype, Formula), four of them with one off-route moment of about a second on the long route |
| Result for career | `FestivalResult` (kind `festival-result`, version 1): event, vehicle, completed/abandoned, position/entrants, time, trap speed, average speed, drift score and lines, stars, legal distance, off-route seconds, standings, assisted | dispatched as a `festival-result` window event and kept in the festival save (`festival:v1`); the career module does not consume it yet |
| Rendering | `src/rendering/open-world/`: quadtree terrain LOD (levels 0–6 over 16 km, skirts, tile worker), PBR splat blending (grass/rock/soil/sand/snow with wetness and snow tint), road ribbons with markings, verges, runway thresholds, bridge decks/piers/parapets, W-beam guardrails, town lamps; instanced vegetation (broadleaf, conifer, shrubs) with near/mid LOD, where the finest level always draws every tree that has a trunk collider (the density setting thins shrubs and the far level only); procedural town buildings with emissive windows at night; sea and river water; event markers; reuses the circuit sky, daylight palette, clouds, environment, post stack and the ULTRA pipeline | built and checked in headless Chromium with a software rasteriser at 640×360 (town by day and night, golden hour on the pass, coast highway, cards, pause menu, world map); fixes from that check are in the history. Not captured on reference hardware |

Vehicles are read from the registry (`festivalVehicles()`: every four-wheel definition except
karts, road cars first) and drawn by the shared procedural body library; a road machine chosen in
MACHINE starts the festival. Rivals are drawn from the player's class (the showcase pace car is the
fastest registry machine). Motorcycles are not offered until their dynamics adapter is validated
on open-world surfaces.

## 2. Streaming budgets

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

## 3. Commands

* `npm run test:open-world` — region, network and event checks, AI drives (coast-to-summit
  10.17 km, Thornwood dirt stage), a race in the session with a typed result; writes
  `docs/open-world.json`.
* `npx vitest run tests/open-world.test.ts tests/open-world-session.test.ts tests/open-world-worker.test.ts tests/festival-map.test.ts tests/route-graph.test.ts`.
* `npx playwright test e2e/49-festival-menu-access.spec.ts` — the real HUD, controls and input
  controller in Chromium (keyboard menu access, results card clicks).

## 4. Known limits (honest)

* No traffic; the region is empty except for event rivals.
* Rendering has not been captured on reference hardware; frame time, draw calls and memory under
  the budgets above are unmeasured. Software-rasteriser (CI) loading is slow.
* AI keeps a reserve on loose roads (41 m/s cap) and over crests; it is not a rally driver and does
  not use the full width of narrow gravel at speed. Road cars reach over 300 km/h on the coast road;
  there is no speed limit enforcement or police mechanic.
* Karts are not offered (no road clearance); motorcycles are not offered yet.
* Building interiors, pedestrians, parked cars, road signs and destructible scenery are absent;
  buildings and trunks are static collision only.
* Career consumes no festival results yet (the `festival-result` event hook only; the career's
  festival discipline does not list the region as a venue); online play is not supported.
* Surface audio voices grass and gravel only, so dirt, sand and snow roll silently.
* Bridges carry the road deck; terrain below is not shaped as river banks under every bridge.
* Where two road footprints touch without overlapping at different heights (8 points of the
  32,574 shoulder-edge samples, worst 10 cm) the surface steps between them; a road's square end
  at a junction leaves an undrawn wedge on the outside of a sharp joint that physics reads as
  shoulder.
* No gamepad navigation inside the festival menu (pause and resume only, as in the circuit pause).
