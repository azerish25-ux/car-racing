# Open world: the Solvane Coast festival region

State: **integrated** (reachable from SESSION → *Festival · open world*, covered by unit tests and
`npm run test:open-world`). Not performance-, player- or release-accepted: no reference-hardware
capture or player session has been recorded. Region, places and roads are fictional; no real-world
map data is used.

## 1. What exists

| Area | Implementation | Evidence |
|---|---|---|
| Region (8.19 × 8.19 km, seed `0x50a1e`) | `region-data.ts` (authored features), `terrain-field.ts` (deterministic heightfield: gradient-noise fbm/ridged relief, coast with beach and quay, Varda massif and spurs, Ashvale valley with river channel, flats for Port Ilse, Kestrel airfield and a village, forests, farmland, snow line) | `tests/open-world.test.ts` (determinism, authored features) |
| Road network (70.9 km, 59 edges, 37 junctions, 20 bridges) | `road-network.ts`: centripetal Catmull-Rom splines per authored road, junction detection with snapping, overpass pins, grade-limited vertical profile per class, crown and curvature bank, guardrail and bridge flags, 32 m spatial grid, layer-aware `nearest` | classes: highway 19.8 km, country 16.7, mountain switchbacks 11.6, dirt 9.9, town streets 8.6, runway 4.4; `validateRoute` on the whole network as one RouteGraph |
| Carved terrain tiles | `terrain-tiles.ts`: 256 m tiles at 4 m, road bed carved per segment, bridges not carved; one triangulation shared by physics (`gridHeight`) and render meshes; LRU cache with a hard residency budget and look-ahead prefetch | exact-interpolation test; budget test while crossing the region |
| World surface for physics | `open-world-track.ts`: `OpenWorldTrack` answers every `Track` member (conformance test) — road surface with crown/bank, markings, shoulders, rails one-sided at the guardrail face; off road: grass, soil, rock, sand, snow, town paving, water depth; layer-aware on bridges; weather and wetness. Soft boundaries, no laps. | surface, bridge, ray-cast and rail tests |
| Free roam session | `session.ts` (`OpenWorldSimulation`), `src/workers/open-world.worker.ts` (120 Hz fixed step, 2 substeps), `src/session/free-roam.ts` (host glue), `src/ui/festival-hud.ts` | reset to the nearest road (upturned, drowned, fallen, out of region), time of day and weather, autopilot cruise, fast travel to discovered events, world map |
| Events (13) | `festival-events.ts`, `route-path.ts`: road race (coast to summit, 10.2 km), circuits built from road routes (18.2 km grand loop, Port Ilse streets, Kestrel airfield), sprints (valley, Thornwood dirt stage), speed traps, speed zones (average speed), drift zones (`scoring.ts`), runway showcase | events are discovered within 380 m; stopping at the marker opens the card; races start in place with a grid and route-following rivals; legal progress via `RouteProgress` (no shortcut credit test) |
| Route AI | `route-driver.ts`: pure pursuit on a minimum-curvature line inside the road, the circuit AI's capability envelope (`envelopeCornerSpeed`, `envelopeProfile`, `peakGrip` of the real contact), crest and loose-road speed reserves, follow/pass, reverse-out recovery, reset request | `npm run test:open-world` drives 10.17 km asphalt and 5.14 km dirt without stalls, resets or off-route time |
| Result for career | `FestivalResult` (kind `festival-result`, version 1): event, vehicle, completed/abandoned, position/entrants, time, trap speed, average speed, drift score and lines, stars, legal distance, off-route seconds, standings, assisted | dispatched as a `festival-result` window event and kept in the festival save (`festival:v1`); the career module does not consume it yet |
| Rendering | `src/rendering/open-world/`: quadtree terrain LOD (levels 0–6 over 16 km, skirts, tile worker), PBR splat blending (grass/rock/soil/sand/snow with wetness and snow tint), road ribbons with markings, verges, runway thresholds, bridge decks/piers/parapets, W-beam guardrails, town lamps; instanced vegetation (broadleaf, conifer, shrubs) with near/mid LOD; procedural town buildings with emissive windows at night; sea and river water; event markers; reuses the circuit sky, daylight palette, clouds, environment, post stack and the ULTRA pipeline | type-checked and built; not yet captured on reference hardware |

Vehicles are read from the registry (`festivalVehicles()`: every four-wheel definition, road/GT
first); rivals are chosen from the same list. Motorcycles are not offered until their own
dynamics adapter exposes the festival contact contract.

## 2. Streaming budgets

* Physics: one LRU cache of LOD0 tiles shared by every car in the session worker (64 tiles,
  about 4 km², by default). The acceptance drive holds a single car to 24 tiles (peak 24/24) with
  no synchronous stall over 10 km; tiles are prefetched 2.5 s ahead of each car within about
  1.2 ms every other step (one tile at least; typical build 4–8 ms, worst 22 ms in Node).
* Render: quadtree split factor / max tiles / tiles in flight / tree density per tier —
  low 1.25 / 110 / 3 / 0.45, medium 1.6 / 150 / 4 / 0.7, high 2.1 / 220 / 6 / 1. The default
  preset keeps ULTRA effects off; ULTRA uses the existing opt-in pipeline.
* Region build (heightfield, network, events, placements): about 0.5 s in Node.

## 3. Commands

* `npm run test:open-world` — region, network and event checks, AI drives (coast-to-summit
  10.17 km, Thornwood dirt stage), a race in the session with a typed result; writes
  `docs/open-world.json`.
* `npx vitest run tests/open-world.test.ts tests/open-world-session.test.ts tests/route-graph.test.ts`.

## 4. Known limits (honest)

* No traffic; the region is empty except for event rivals.
* Rendering has not been captured on reference hardware; frame time, draw calls and memory under
  the budgets above are unmeasured. Software-rasteriser (CI) loading is slow.
* AI keeps a reserve on loose roads (41 m/s cap) and over crests; it is not a rally driver and does
  not use the full width of narrow gravel at speed.
* Building interiors, pedestrians, parked cars, road signs and destructible scenery are absent;
  buildings and trunks are static collision only.
* Career consumes no festival results yet (event hook only); online play is not supported.
* Bridges carry the road deck; terrain below is not shaped as river banks under every bridge.
