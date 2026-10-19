# Charlottetown — campus route

## Play

For city-first loading, append **`?map=charlottetown`** to the game's URL. This
opens a lightweight launcher without loading the original Aurel circuit and
its garages. Select F1, MotoGP or Horizon, graphics quality, weather and assists.
`&discipline=formula`, `&discipline=motogp` and `&discipline=horizon` preselect a
button; a user click starts play and audio. Exit returns to the city launcher;
**CIRCUIT & FESTIVAL MENU** opens the unchanged main game. This is free play,
not a separate career entry: event bests use the same city save, and career
rewards remain owned by the original main-game career host.

The direct launcher shares the production `FestivalSession`, worker, vehicle
physics, renderer, cameras and HUD. It does not duplicate the simulation or
substitute a scenery viewer. Keyboard, saved gamepad mappings and coarse-pointer
touch controls are supported. The existing main-menu map card remains available.

On the main menu, use the **CHARLOTTETOWN** map card and choose **F1**, **MotoGP**, or **Horizon**. These launch the same geographic region with the production Formula, GP motorcycle, or road-car physics respectively. The normal circuit and Solvane festival menus remain available.

The map uses the weather and assists selected on the main menu. High and Ultra graphics enable the existing higher-quality lighting, shadows, reflection and image-processing paths; the city uses distance-based detail on every preset. No particular hardware frame-rate target has been certified.

The first event card offers **Maloney → Holland College**. Enter starts the point-to-point time trial; Not Now leaves you in free drive. `WASD` / arrows drive, `C` changes camera, `T` opens the map, and `Escape` opens the pause menu. All four events are visible immediately; the pause/map menus can travel to them without an unlock. The pause menu also offers day/sunset/night, machine switching, optional traffic and photo mode.

The campus route is **not a fabricated closed Grand Prix circuit**. There is no invented return road, pit lane, DRS zone or Formula championship venue. Reverse travel and racing are virtual closed-road game activities, not real-world directions or traffic permission.

## Geometry and evidence

The earlier reference pack contained 100 Street View **viewpoint links**, not 100 acquired or verified photographs. This implementation does not claim otherwise and does not download, scrape, embed or train on Google imagery.

Route: **26 Maloney Drive → Queen Street → Kent Street → Weymouth Street → Holland College, Prince of Wales Campus**. The supplied OSRM route measured 1,706.1 m. Reconstructing its alignment against the downloaded OSM street network produces approximately 1,705.72 m. OSRM coordinates were rounded; endpoints and inspection stations are checked against the resulting centreline with a one-metre tolerance. This is not a survey-grade accuracy certification.

Checked-in source data:

| Feature                  | Count | Evidence                                              |
| ------------------------ | ----: | ----------------------------------------------------- |
| Route vertices           |    62 | Supplied OSRM/OpenStreetMap alignment                 |
| Inspection stations      |   100 | Evenly sampled along the route; not image files       |
| Street polylines         |    98 | OpenStreetMap snapshot                                |
| Building ground plans    |   836 | Closed OSM building ways near the route               |
| Green-space polygons     |   144 | OSM mapped parks, gardens and related land uses       |
| Parking polygons         |    99 | OSM mapped parking areas                              |
| Footway/service segments |   612 | OSM mapped ways                                       |
| Tree positions           |   130 | OSM mapped individual trees; height usually estimated |
| Crossing/signal nodes    |   179 | OSM points; visual treatment is estimated             |

The local WGS84 metric frame has **X west, Y up, Z north**. This preserves geographic orientation in Three.js and the existing festival minimap instead of mirroring east and west. Terrain, road queries, the simulation worker, tile worker, renderer, event routing, spawn and map UI all resolve the same region.

Building walls use their actual mapped concave polygons rather than randomly placed boxes. Collision and camera clearance use those same polygons, so concave yards are not filled by invisible rectangular colliders. The Holland College ground plan and institution labels are retained from the data.

**Not measured or photo-verified:** façade colours and materials without explicit source tags, window and door arrangements, roof pitch, cornices, chimneys, road/sidewalk widths without OSM width tags, road markings, sign treatments, decorative street-light positions and most building/tree heights. Elevation is an explicitly estimated restrained plane, not a DEM. Some OSM relation-only buildings or unmapped features are absent. This is a geographically grounded procedural recreation, **not a finished photo-exact 1:1 replica**.

## Rendering

The continuation fixes unsupported chimney placement on concave roof plans:
a roof-triangle interior point must have clearance from every footprint boundary.
The chimney base intersects the sloped roof under all four corners; unsafe sites
are omitted. Stone caps and dark flue openings are generated geometry.
Crosswalk bars use the road's local normal and tangent rather than swapping axes
on oblique streets. Parking and service asphalt now use generated aggregate and
height maps with the existing wet response. These details remain procedural
estimates, not photographed evidence.

Festival rendering now retains at most one submitted GPU frame, using a real
WebGL fence and non-blocking polls. The input pump and simulation worker remain
independent; no frame completion is invented. Startup waits for a real first
frame before revealing the scene. Original-circuit drawing is suspended while
its GL context transfers to the festival. This is queue control, not a measured
frame-rate improvement or physical-GPU certification.

The city is authored entirely in TypeScript/Three.js: deterministic generated brick, siding, roof, stone and concrete texels; generated window/interior treatments and sign atlas; polygonal wall extrusions; pitched roofs clipped to the ground plans; divided windows, sills, lintels, cornices and chimneys. Campus lettering is generated as text, not copied from a photograph.

Geometry is merged by material and 128-metre spatial chunk. Shells, windows and close façade detail have separate distance budgets. The same building and tree collision shapes remain in place across presets. Materials, geometry and city scene nodes are disposed on exit.

Charlottetown disables the Solvane-specific water, islands, boats, authored countryside dressing, photographic vegetation, photographed sky and scanned ground layers. It retains the production vehicle renderer, physical sky, lighting pipeline, weather, effects, streaming and controls. Original maps retain their existing asset paths.

## Street detail and campus guidance continuation

Explicit `building:material`, `building:colour`, `roof:shape`, and `roof:colour`
tags now take precedence over procedural guesses. Wood-clad apartment buildings
no longer turn into brick simply because they are large; mapped concrete and
literal colours (including the source's unprefixed hex colour) are retained.
Commercial gables and both tagged mansard roofs are generated over the original
triangulation. Uniform, bounded roof subdivision keeps concave courtyards open.
Unspecified pitches and all façade joinery remain authored estimates.

Entrances select an exterior face toward the building's mapped address street,
falling back to the nearest suitable street-facing wall. Door positions are not
claimed to be surveyed. Ground-floor window bays leave the doorway clear;
commercial frontages use broader glazing, and accessory garages/sheds do not
receive rows of house windows. Generated frames, handles, garage panels and
threshold-height entrances remain close to the original collision footprint.
Individual windows vary their illumination, and night emission follows the
procedural interior texture rather than illuminating an entire solid pane.

A single generated atlas contains the 160 available building names/house-number
labels from this snapshot. Label geometry is merged into distance-limited chunks;
no separate mesh or downloaded image is created per label. Plaque styling and
placement are estimates, and the atlas is bounded to 256 entries and disposed
with the city. Nothing in this change moves streets, buildings or collision
polygons or imports Google imagery.

During free drive in all three modes, a campus navigation panel follows the
actual polyline through Maloney, Queen, Kent and Weymouth. It shows the next turn,
distance remaining, nearest numbered route reference, wrong-way and off-route
warnings, and arrival. **Reverse route** changes the guidance destination without
teleporting the vehicle. These are closed-road game directions, not real-world
traffic advice. Guidance does not award race progress or alter checkpoints, and
it is hidden with the other free-drive UI during events, menus, maps and photos.
The existing event pace coach and original Solvane exploration UI are unchanged.

## Events and saves

- **Maloney → Holland College:** solo point-to-point time trial; starts at the first station, finish at the last metre.
- **Holland College → Maloney:** reverse-direction solo run on the same route.
- **Queen Street Sprint:** short race with three same-class opponents.
- **Kent Street Flow:** road-car drift skill zone.

The sprint uses sparse interior routing anchors while preserving all 62 geometry vertices. Passing every rounded GPS point separately to the route planner caused alternating junction-edge snaps and long loops; regression tests prohibit that.

Short run-out events now let AI drivers cross the finish instead of stopping six metres before an endpoint gate. Original events keep their default braking buffer. The campus solo grid starts half a metre into the actual route rather than using the multi-car grid offset.

Persistence is isolated in `festival:charlottetown:v1`; Solvane keeps `festival:v1`. Selecting Formula explicitly on the new card takes precedence over a previously saved festival road car. No career unlock is required.

## Rebuild the geographic snapshot

`src/simulation/open-world/charlottetown/data.json` contains the adapted geographic database, attribution and original XML SHA-256. `reference/charlottetown/route.geojson` contains the route source; `scripts/import-charlottetown.py` is the deterministic offline importer.

```sh
python scripts/import-charlottetown.py --osm charlottetown.osm --route reference/charlottetown/route.geojson
```

The acquisition URL and bounding rectangle are recorded in the JSON source metadata. Re-downloading OSM later may produce a changed snapshot and different counts. Retain the original XML for byte-for-byte reproduction of that snapshot; do not claim a later download has the same source hash.

## Validation

```sh
npm run build
npx vitest run tests/charlottetown.test.ts
npx vitest run tests/charlottetown-geometry.test.ts tests/charlottetown-architecture.test.ts tests/charlottetown-navigation.test.ts tests/gpu-frame-gate.test.ts
npx playwright test e2e/charlottetown-direct.spec.ts
npx playwright test e2e/charlottetown.spec.ts
```

The new unit/integration suite checks geographic orientation, metric scale, source provenance, route continuity and length, start/finish positions, every inspection station, all three actual machines driving and completing the campus run, save separation, concave collisions/camera clearance, finite generated geometry and disposal. The browser suite exercises the real menu, simulation worker, movement, campus travel, map, rendering, lighting and return to the original menu.

`e2e/fixtures/charlottetown-scene.ts` is an offline visual fixture using the actual city and road classes. Its scenery renders are not represented as full-game screenshots or physical-GPU performance evidence. Read-only `window.apexDiagnostics().festival` reports active region, vehicle/status, render counts and city evidence for browser checks.

## Attribution and data licence

Map data © OpenStreetMap contributors, available under the Open Database License (ODbL) 1.0. The adapted geographic database and route in this change remain under ODbL, separate from the repository's software licence. Attribution is displayed in the in-game HUD and recorded in the dataset.

- https://www.openstreetmap.org/copyright
- https://opendatacommons.org/licenses/odbl/1-0/

No Google Street View image or Google-derived 3D content is included.

### Earlier city-launch validation scope

Local targeted verification passed **58 tests in seven files**, TypeScript checking,
ESLint on touched TypeScript, and a production build. The offline procedural
scenery fixture rendered Maloney, Queen, Kent and the campus without page errors.
These fixture views are not full-game or hardware-performance evidence. The new
`charlottetown-direct.spec.ts` exercises real browser launch, vehicle movement,
campus travel, high/night presentation, exit and a second entry. Its independent
GitHub Actions workflow preserves failures, traces and diagnostics for each mode.
The original main-menu test is retained rather than silently replaced: its prior
run timed out before reaching the city at the original circuit cold startup.
Consult the exact workflow run for browser results; writing a test is not a pass.

### Street-detail continuation validation

Local verification passed **95 targeted tests in 11 files**, a production build
and ESLint on all touched TypeScript. These checks include all three production
vehicles driving and finishing the campus route, all 100 navigation stations,
forward/reverse turn directions in the X-west coordinate frame, source-colour
precedence, doorway clearance, atlas bounds/disposal and concave mansard roofs.

The local software WebGL2 framebuffer probe passed on Mesa llvmpipe. The local
full-game browser attempt was blocked before application loading by
`net::ERR_BLOCKED_BY_ADMINISTRATOR` at the game URL; it is not a passing browser
run. The existing GitHub Actions three-mode workflow now includes these new
regressions and navigation UI assertions. Consult its exact run for full-game
browser acceptance. No physical GPU, Android device or frame-rate acceptance is
claimed. Independent offline scenery screenshots use the real scene classes
but are not substitutes for full-application testing.
