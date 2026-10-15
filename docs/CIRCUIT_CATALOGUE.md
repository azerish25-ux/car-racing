# Circuit catalogue (WP29–WP30)

Twenty new driveable layouts at twelve new venues, authored as data and dressed
by a reusable procedural venue kit. Masterplan §14–§15, WP29 (first venues
through the pipeline) and WP30 (roster scope). State: **integrated** — reachable
from the CIRCUIT menu, built by the production simulation and renderer, and
covered by automated tests and seeded AI races. Nothing here is performance-,
player- or release-accepted, and no layout has had a human art review.

## Rights and provenance

The six **real-world** layouts are approximations of famous circuits built
from public knowledge of their geometry: corner sequence and direction,
approximate straight lengths and radii, published lap length (each layout is
scaled to it and lands within 0.1 %) and, where publicly known, the elevation
character. They are hand-authored turtle paths (straights and arcs), not traced
maps, survey data or third-party geometry files, and they are **not** licensed
reproductions. Venue, layout and corner names are neutral and original;
`validate:content` rejects a list of protected real circuit, series, sponsor
and corner names in catalogue copy. No official logos, liveries, signage or
branding are used; all trackside signage is fictional. Using official names
would require a licence (see `docs/ASSET_PROVENANCE.md`).

The six **unconventional** venues are original designs.

## Roster

| Layout | Group | Lap (m) | Reference (m) | Corners | DRS | Pit | Elevation (m) | Max grade | Max bank | Special |
|---|---|---:|---:|---:|---:|---|---:|---:|---:|---|
| Parco Reale Autodromo — Grand Prix (`parco-reale`) | real-world | 5793 | 5793 | 7 | 2 | right | 8 | 1.3% | 1° | |
| Ardennes Forest Circuit — Grand Prix (`ardennes`) | real-world | 7004 | 7004 | 14 | 2 | left | 98 | 15.6% | 1° | brook compression and ridge climb |
| Northfield Airfield GP — Grand Prix (`northfield`) | real-world | 5891 | 5891 | 14 | 3 | right | 6 | 0.9% | 1° | asphalt run-off |
| Northfield Airfield GP — Classic (`northfield-classic`) | real-world | 5141 | 5141 | 12 | 3 | right | 6 | 0.8% | 1° | earlier route without the arena loop |
| Kansai Figure-Eight — Grand Prix (`kansai`) | real-world | 5807 | 5807 | 11 | 2 | right | 17 | 4.0% | 1° | bridge, 10.3 m headroom |
| Kansai Figure-Eight — East Course (`kansai-east`) | real-world | 2243 | 2243 | 4 | 1 | right | 17 | 5.0% | 1° | |
| Riviera Harbour Street Circuit — Grand Prix (`riviera`) | real-world | 3337 | 3337 | 13 | 1 | left | 41 | 10.1% | 1° | curving tunnel, harbour, 2.6 m walls |
| Texas Hill Country Circuit — Grand Prix (`texas-hill`) | real-world | 5513 | 5513 | 9 | 2 | left | 28 | 10.0% | 1° | anticlockwise |
| Neon City Street Circuit — Grand Prix (`neon-city`) | unconventional | 4874 | — | 8 | 2 | right | 3 | 1.8% | 1° | night, two tunnels |
| Neon City Street Circuit — Reverse (`neon-city-reverse`) | unconventional | 4874 | — | 8 | 2 | left | 3 | 1.8% | 1° | night, two tunnels |
| Col d’Argent Mountain Pass — Ascent (`alpine-pass`) | unconventional | 7276 | — | 13 | 2 | right | 220 | 8.8% | 1° | five stacked switchbacks |
| Col d’Argent Mountain Pass — Descent (`alpine-pass-reverse`) | unconventional | 7276 | — | 13 | 2 | left | 220 | 8.8% | 1° | downhill switchbacks |
| Mesa Speedbowl — Tri-Oval (`speedbowl`) | unconventional | 4005 | — | 3 | 2 | left | 0 | 0.0% | 31° | SAFER walls |
| Mesa Speedbowl — Infield Road Course (`speedbowl-infield`) | unconventional | 4486 | — | 8 | 2 | left | 0 | 0.0% | 31° | banking plus infield |
| Red Mesa Canyon Circuit — Grand Prix (`desert-canyon`) | unconventional | 5604 | — | 11 | 2 | right | 38 | 5.6% | 1° | slot canyon, jump-free crests |
| Red Mesa Canyon Circuit — Reverse (`desert-canyon-reverse`) | unconventional | 5604 | — | 11 | 2 | left | 38 | 5.6% | 1° | |
| Cap Lumière Cliff Road — Grand Prix (`coastal-cliff`) | unconventional | 4710 | — | 9 | 2 | left | 98 | 10.4% | 1° | corniche above the sea |
| Cap Lumière Cliff Road — Reverse (`coastal-cliff-reverse`) | unconventional | 4710 | — | 9 | 2 | right | 98 | 10.4% | 1° | |
| Iron Quay Docklands — Grand Prix (`dockyard`) | unconventional | 4600 | — | 8 | 1 | right | 10 | 3.4% | 1° | flyover, 9.9 m headroom |
| Iron Quay Docklands — Reverse (`dockyard-reverse`) | unconventional | 4600 | — | 8 | 1 | left | 10 | 3.4% | 1° | flyover |

Grades are the steepest smoothed centreline gradient; banking is the steepest
cross-slope (catalogue cross-fall elsewhere is 1–2 %). Sectors are thirds of
the lap, as on Aurel and Vellamar (the timing system and HUD assume thirds).

## Authoring format

`src/simulation/circuit-catalogue/` (no Three.js, no DOM):

- `dsl.ts` — `S(length, props)` straights, `A(radius, degrees, props)` arcs
  (+ left), and the two paddock templates (`gpPit` = the validated standard
  geometry; `compactPit` for short street straights). Pit side is per layout.
- Segment properties: end elevation `y`, half-width `w`, banking `bank`
  (degrees, outside raised), `runoff` (grass/gravel/asphalt, per side or
  inside/outside), `barrier` kind and offset, `tunnel`, `facades`, `rock`,
  `drop`, `stands`, `drs`, corner `name`.
- `builder.ts` — closes the turtle path (heading error shared between arcs by
  turn; position error by a least-squares change of straight lengths, so radii
  and the corner sequence survive), resamples a spline control polygon with
  spacing that tightens in corners, scales to the reference length, centres the
  venue, and maps every authored feature to lap distance using `Track`'s own
  1536-sample construction (lengths agree to the metre). Elevation, width and
  banking are smoothed profiles; run-off, barrier offset/kind and tunnels are
  2 m lookup tables; self-crossings are found and their headroom recorded.
- `reverse: true` drives the same path the other way (banking hand, sides and
  spans mirror; the paddock is on the other side of travel).

`Track` reads three optional hooks (`runoff`, `barrier`, `covered`): contact
surfaces and grip on run-off, the collision boundary, and **sheltered water rows**
under tunnels — rain never falls there (`Track.evolve`), initial wet water is
zero, `Track.isCovered(s)` is the zone flag, and the renderer suppresses rain
particles under the roof. A steeply banked road stays one layer for
`Track.nearest(.., y)`. Aurel and Vellamar define none of the hooks and are
unchanged (their physics, recordings and determinism tests are untouched).

## Validation

`npm run validate:content` builds every circuit and checks, in addition to the
definition rules: barrier corridors of separate same-layer sections never
overlap (progress could otherwise snap to the wrong road), every self-crossing
has ≥ 6.5 m bridge headroom, the paddock straight is straighter than R150 m,
the racing line solves inside the road, real-world layouts are within 3 % of
their reference length and were authored within 0.85–1.2× of it before
scaling, tunnels shelter at least one water row, banking stays ≤ 33°, and no
protected name appears.

`npm run test:catalogue-races` runs a seeded 6-car, 2-lap AI race on every
layout through the production simulation, AI and race control and writes
[`circuit-catalogue-races.json`](circuit-catalogue-races.json): every car must
classify, no car may be stuck (below 1 m/s on track) for over 8 s, and best laps
must average 90–320 km/h. Tests: `tests/circuit-catalogue.test.ts` (registry,
lengths, validation, pit side and a left-hand street pit stop, crossing layers
and a flyover lap without progress jumps, 31° banking layer, tunnel rain
shelter, authored run-off/barriers, events, recorded race evidence, live AI
laps) and `tests/venue-kit.test.ts`.

Recorded run (seed 29030, 6 cars, 2 laps; AI pace on the default setup, not reference lap records):

<!-- catalogue-race-table -->
| Layout | Lap (m) | AI best lap | Average | Slowest car best |
|---|---:|---:|---:|---:|
| parco-reale | 5793 | 1:37.126 | 214.7 km/h | 1:44.714 |
| ardennes | 7004 | 2:15.790 | 185.7 km/h | 2:22.001 |
| northfield | 5891 | 1:51.610 | 190.0 km/h | 1:57.658 |
| northfield-classic | 5141 | 1:33.972 | 196.9 km/h | 1:40.372 |
| kansai | 5807 | 1:49.287 | 191.3 km/h | 1:56.513 |
| kansai-east | 2243 | 0:43.646 | 185.0 km/h | 0:48.473 |
| riviera | 3337 | 1:31.104 | 131.9 km/h | 1:37.907 |
| texas-hill | 5513 | 1:55.916 | 171.2 km/h | 2:03.090 |
| neon-city | 4874 | 1:42.549 | 171.1 km/h | 1:49.506 |
| neon-city-reverse | 4874 | 1:42.206 | 171.7 km/h | 1:49.018 |
| alpine-pass | 7276 | 2:32.594 | 171.7 km/h | 2:41.297 |
| alpine-pass-reverse | 7276 | 2:31.660 | 172.7 km/h | 2:39.531 |
| speedbowl | 4005 | 0:48.553 | 296.9 km/h | 0:51.568 |
| speedbowl-infield | 4486 | 1:19.870 | 202.2 km/h | 1:27.630 |
| desert-canyon | 5604 | 1:39.617 | 202.5 km/h | 1:46.311 |
| desert-canyon-reverse | 5604 | 1:38.696 | 204.4 km/h | 1:46.255 |
| coastal-cliff | 4710 | 1:29.319 | 189.8 km/h | 1:37.406 |
| coastal-cliff-reverse | 4710 | 1:29.706 | 189.0 km/h | 1:36.859 |
| dockyard | 4600 | 1:29.455 | 185.1 km/h | 1:36.013 |
| dockyard-reverse | 4600 | 1:29.246 | 185.6 km/h | 1:36.318 |
<!-- /catalogue-race-table -->

## Venue kit (rendering)

`src/rendering/venue-kit/` dresses any catalogue `CircuitDefinition` from its
data; `CircuitScene` hands catalogue venues to it and keeps Aurel/Vellamar's
bespoke construction unchanged.

| Part | Source data | Implementation |
|---|---|---|
| Asphalt, kerbs, lines, pit road, grid | Track | the existing road/kerb/paint ribbons and asphalt shader |
| Verges and run-off | `runoff` hook | grass, gravel (raked finish) or asphalt ribbons exactly where contact reads them |
| Terrain and skirts | landform + lowest road under bridges | theme relief (rolling, hills, mountains, mesas, coast), sea where drops agree, harbour basins, levelled event plaza; skirts skip other sections |
| Barriers | barrier spans on the collision boundary | armco W-beam with instanced posts, concrete with filtered catch fence, two-deep tyre walls, SAFER, canyon rock |
| Paddock | `PitLaneDefinition` | twelve shared garage bays on the venue's pit side (left or right), hospitality floor, race control, pit wall |
| City frontage | `facades` spans | merged facade blocks with mullioned windows that light at night, neon blades |
| Tunnels | `tunnel` spans | walls, roof slab, lit ceiling strips, plaza blocks over city tunnels |
| Bridges | detected crossings | deck slab under the upper road, piers outside the lower corridor |
| Cuttings, cliffs, quays | `rock`, `drop` spans | stratified procedural rock; concrete quay walls into the water |
| Lighting | theme / night | floodlight towers (oval, dock) or street lamps (city); night venues open floodlit |
| Boards, marshals, cameras | corners, lap length | braking boards before corners reached from straights; marshal posts every ~240 m; existing camera rigs keep clear of facades |
| Scatter | theme | instanced boulders and scrub (desert, alpine, cliff, prairie) |

Performance: geometry is built in 60–80 m chunks (frustum culling) and merged
per material; small parts are instanced and grouped into detail cells that are
hidden beyond 520–2400 m of the camera (distance LOD); the existing static
batching, probe-detail survey and far-shadow bake apply unchanged.

## Known limits

- Approximations are not survey-accurate: corner radii, straight lengths and
  elevation are public-knowledge estimates, closed by solver adjustments of up
  to ~10 % on some straights (`catalogue.authoring.closureAdjustment`).
- Sectors are thirds of the lap, not authored per venue.
- The kit's look has been checked in plan view and node scene builds only; no
  in-browser capture-suite review, hardware frame timing or art sign-off exists
  (software-GL capture was impractical on the shared CI machine).
- Tunnels block rain on the surface and in rain particles; spray from cars,
  sky light and reflections inside tunnels are not specially treated.
- The pit lane template still requires a straight of about 365–550 m.
- Lap times are AI pace with the APX-01 on the default setup, not reference
  lap records.
