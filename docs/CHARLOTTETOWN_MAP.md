# Charlottetown — campus route

## Play

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

**Not measured or photo-verified:** façade colours, window and door arrangements, roof pitch, cornices, chimneys, materials, road/sidewalk widths without OSM width tags, road markings, sign treatments, decorative street-light positions and most building/tree heights. Elevation is an explicitly estimated restrained plane, not a DEM. Some OSM relation-only buildings or unmapped features are absent. This is a geographically grounded procedural recreation, **not a finished photo-exact 1:1 replica**.

## Rendering

The city is authored entirely in TypeScript/Three.js: deterministic generated brick, siding, roof, stone and concrete texels; generated window/interior treatments and sign atlas; polygonal wall extrusions; pitched roofs clipped to the ground plans; divided windows, sills, lintels, cornices and chimneys. Campus lettering is generated as text, not copied from a photograph.

Geometry is merged by material and 128-metre spatial chunk. Shells, windows and close façade detail have separate distance budgets. The same building and tree collision shapes remain in place across presets. Materials, geometry and city scene nodes are disposed on exit.

Charlottetown disables the Solvane-specific water, islands, boats, authored countryside dressing, photographic vegetation, photographed sky and scanned ground layers. It retains the production vehicle renderer, physical sky, lighting pipeline, weather, effects, streaming and controls. Original maps retain their existing asset paths.

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
npx playwright test e2e/charlottetown.spec.ts
```

The new unit/integration suite checks geographic orientation, metric scale, source provenance, route continuity and length, start/finish positions, every inspection station, all three actual machines driving and completing the campus run, save separation, concave collisions/camera clearance, finite generated geometry and disposal. The browser suite exercises the real menu, simulation worker, movement, campus travel, map, rendering, lighting and return to the original menu.

`e2e/fixtures/charlottetown-scene.ts` is an offline visual fixture using the actual city and road classes. Its scenery renders are not represented as full-game screenshots or physical-GPU performance evidence. Read-only `window.apexDiagnostics().festival` reports active region, vehicle/status, render counts and city evidence for browser checks.

## Attribution and data licence

Map data © OpenStreetMap contributors, available under the Open Database License (ODbL) 1.0. The adapted geographic database and route in this change remain under ODbL, separate from the repository's software licence. Attribution is displayed in the in-game HUD and recorded in the dataset.

- https://www.openstreetmap.org/copyright
- https://opendatacommons.org/licenses/odbl/1-0/

No Google Street View image or Google-derived 3D content is included.
