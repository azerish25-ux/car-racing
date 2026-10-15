# Circuit catalogue (WP29–WP30 and wave 2)

Forty driveable layouts at twenty-nine new venues, authored as data and dressed
by a reusable procedural venue kit: wave 1 (twenty layouts at twelve venues)
and wave 2 (twenty layouts at seventeen venues — motorcycle grand-prix
circuits, two endurance mega-circuits, more real-world approximations and two
original industrial venues). Masterplan §14–§15, WP29 (first venues through the
pipeline) and WP30 (roster scope). State: **integrated** — reachable from the
CIRCUIT menu, built by the production simulation and renderer, and covered by
automated tests and seeded AI races. Nothing here is performance-, player- or
release-accepted, and no layout has had a human art review.

## Rights and provenance

The **real-world** layouts (six in wave 1, fifteen venues / seventeen layouts in
wave 2) are approximations of famous circuits built from public knowledge of
their geometry: corner sequence and direction,
approximate straight lengths and radii, published lap length (each layout is
scaled to it and lands within 0.1 %) and, where publicly known, the elevation
character. They are hand-authored turtle paths (straights and arcs), not traced
maps, survey data or third-party geometry files, and they are **not** licensed
reproductions. Venue, layout and corner names are neutral and original;
`validate:content` rejects a list of protected real circuit, series, sponsor
and corner names in catalogue copy. No official logos, liveries, signage or
branding are used; all trackside signage is fictional. Using official names
would require a licence (see `docs/ASSET_PROVENANCE.md`).

The **unconventional** venues (six in wave 1, two in wave 2) are original
designs.

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

### Wave 2

Twenty layouts at seventeen venues, appended to `CATALOGUE_CIRCUIT_IDS` after
wave 1 (wave-1 geometry, sampling and seeded race results are unchanged; a
geometry hash of every wave-1 layout and of Aurel/Vellamar was compared before
and after). Authored in `motorcycle-gp.ts`, `endurance.ts`,
`real-world-classics.ts`, `night-and-street.ts` and `industrial.ts`. Each real-
world layout is in the style of a famous circuit named here only by its
character; names are original.

| Layout | Group | Lap (m) | Reference (m) | Corners | DRS | Pit | Elevation (m) | Max grade | Max bank | Special |
|---|---|---:|---:|---:|---:|---|---:|---:|---:|---|
| Poggio Alto Autodromo (`poggio-alto`) | real-world | 5245 | 5245 | 17 | 1 | right | 31 | 6.5% | 1° | bike-safe; Tuscan-hills style: 1.1 km straight, fast uphill rights |
| Cape Wrenna Island Circuit (`cape-wrenna`) | real-world | 4448 | 4448 | 11 | 1 | left | 24 | 4.8% | 1° | bike-safe; island cliff-top, anticlockwise, very fast lefts |
| Haarveld Circuit (`haarveld`) | real-world | 4542 | 4542 | 12 | 2 | right | 2 | 0.3% | 1° | bike-safe; flat flowing "cathedral" style, final chicane |
| Montejaral Circuit (`montejaral`) | real-world | 4423 | 4423 | 13 | 2 | right | 8 | 2.2% | 1° | bike-safe; Andalusian tight technical, final left hairpin |
| Hochwald Forest Ring — Forest Ring (`hochwald`) | real-world | 20832 | 20832 | 33 | 1 | right | 274 | 9.3% | 16° | day-night lit; forest ring, blind crests, banked hairpin; 4864 samples |
| Loirette Endurance Circuit — Endurance (`loirette`) | real-world | 13626 | 13626 | 14 | 3 | right | 26 | 2.1% | 1° | day-night lit; closed public roads with two chicanes; 3072 samples |
| Loirette Endurance Circuit — Club Circuit (`loirette-club`) | real-world | 4185 | 4185 | 8 | 1 | right | 9 | 2.0% | 1° | bike-safe, day-night lit; permanent club loop, a right and a left hairpin |
| Serra Verde Autódromo (`serra-verde`) | real-world | 4309 | 4309 | 10 | 2 | left | 31 | 8.2% | 1° | anticlockwise bowl, uphill final climb |
| Mount Ardlow Circuit — Mountain Circuit (`mount-ardlow`) | real-world | 6213 | 6213 | 12 | 3 | left | 172 | 14.5% | 1° | steep climb, walled ridge, plunge, 1.7 km straight |
| Arroyo Oro Raceway (`arroyo-oro`) | real-world | 3602 | 3602 | 11 | 1 | left | 49 | 17.4% | 1° | bike-safe; corkscrew-like blind left-right drop |
| Autodromo Fiume Verde (`fiume-verde`) | real-world | 4909 | 4909 | 8 | 1 | left | 31 | 11.1% | 1° | bike-safe; old-school chicanes, river lake by the straight |
| Duinwijk Circuit (`duinwijk`) | real-world | 4259 | 4259 | 10 | 1 | right | 13 | 4.3% | 19° | dunes; right hairpin, 19° banked left hairpin, blind crest, 18° banked final right |
| Ramla Desert Circuit (`ramla-night`) | real-world | 5412 | 5412 | 11 | 3 | right | 11 | 3.8% | 1° | night, floodlit desert, downhill double left, asphalt run-off |
| Ramla Desert Circuit — Outer Circuit (`ramla-outer`) | real-world | 3543 | 3543 | 7 | 2 | right | 6 | 1.2% | 1° | night, short outer loop |
| Mirvari Boulevard Street Circuit (`mirvari`) | real-world | 6003 | 6003 | 9 | 3 | left | 24 | 5.3% | 1° | Caspian-style streets: ~2 km flat-out, 8.6 m fortress section |
| Lantern Bay Street Circuit (`lantern-bay`) | real-world | 4940 | 4940 | 10 | 3 | left | 1 | 0.9% | 1° | night street circuit, river bridge, bayfront |
| Lotus Hill Harbour Circuit (`lotus-hill`) | real-world | 6120 | 6120 | 13 | 2 | right | 31 | 5.1% | 1° | harbour streets, narrow hilltop, two switchback hairpins |
| Gantry Point Container Terminal (`gantry-point`) | unconventional | 5379 | — | 8 | 2 | right | 10 | 2.4% | 1° | night, figure-eight flyover (9.3 m headroom), crane gantries |
| Gantry Point Container Terminal — Reverse (`gantry-point-reverse`) | unconventional | 5379 | — | 8 | 2 | left | 10 | 2.4% | 1° | night, flyover, crane gantries |
| Bright Basin Salt Flat Airbase — High-Speed Course (`salt-flat`) | unconventional | 6800 | — | 7 | 2 | right | 0 | 0.0% | 1° | 2.2 km runway, sweepers on the salt, hangar apron |

Every wave-2 real-world layout was authored within 0.93–1.12× of its
published length before scaling (validate:content allows 0.85–1.2).

### Motorcycle safety (`bikeSafe`)

`CircuitDefinition.bikeSafe` (and `catalogue.bikeSafe`) marks a circuit
assessed for motorcycles. It is a claim that validate:content **re-measures**
with `bikeSafetyReport` (`geometry-checks.ts`) from the same run-off, barrier
and contact data the physics reads: outside every corner tighter than 250 m the
run-off is gravel or asphalt (not grass) and the barrier stands ≥ 10 m beyond
the asphalt; ≥ 6 m anywhere else; the kerb band rises ≤ 50 mm above the road
plane (the shared flat rumble kerb measures 41 mm; no raised sausage elements
exist); banking ≤ 15°; no tunnels or street frontage. Violations shorter than
16 m (spline transitions at segment ends) are tolerated.

Flagged: Aurel, Vellamar, Parco Reale, Ardennes, Northfield (both), Kansai
(both), Texas Hill (wave 1, flag only — geometry unchanged) and Poggio Alto,
Cape Wrenna, Haarveld, Montejaral, Loirette Club, Arroyo Oro and Fiume Verde
(wave 2, laid out with 12–14 m gravel traps). Street, walled, banked-oval and
tunnel venues are not flagged, and the measurement fails for them.

Consumers: the `gp-motorcycle` and `motorcycle-class-sprint` rulesets declare
`bikeSafeCircuits`, so `sessionIncompatibilities` rejects a motorcycle race on
any other circuit (practice, qualifying and time trial stay open everywhere);
every built-in motorcycle event is on a flagged circuit; the career's
`disciplineVenues(…, 'road-bikes')` now lists only flagged circuits and the
"not assessed" caveat is gone.

**Per-class clearance (`bikeClasses`).** Safe run-off does not show that a
class can ride a circuit: in seeded races the classic class (CR-750) fell
12–30 times in three laps on the hairpin circuits while the GP, superbike and
supersport classes rode them cleanly. Every flagged circuit therefore also
declares `CircuitDefinition.bikeClasses`, the motorcycle race classes with a
passing seeded race there. `npm run test:bike-clearance` races every class
(8 riders, 3 laps, test:bikes criteria: finished, every rider classified, no
rider parked 20 s, at most 6 falls) on every flagged circuit, writes
[`bike-clearance.json`](bike-clearance.json) and fails when a declared class
fails or a passing class is not declared; validate:content requires the list
exactly on bike-safe circuits. The motorcycle rulesets refuse a class that is
not cleared ("Classic motorcycle riders are not cleared for …"), and the bike
career builds its generated invitationals and championships only on venues
that clear every machine of the tier. All four classes are cleared on Aurel,
Vellamar, Parco Reale, Northfield (both), Kansai East, Cape Wrenna, Haarveld
and Fiume Verde; the classic class is not cleared on Ardennes, Kansai, Texas
Hill, Poggio Alto, Montejaral, Loirette Club and Arroyo Oro. `npm run
test:bikes` now also races every built-in motorcycle event as it loads (its own
field, laps and weather); the Loirette Club event is a supersport sprint (the
classic class is not cleared there), and Arroyo Oro's straights before the long
hairpin and the final turn were lengthened (260 m and 150 m authored) so a
superbike field brakes upright instead of running wide (14 falls in the
five-lap event before, none after).

### Long laps and day-night venues

Laps authored over 9 km get more Track samples (`trackSamplesFor`: ~4.5 m
apart — 4864 on the forest ring, 3072 on the endurance circuit) and up to one
control point per 12 m (validation allows up to 2048 control points with at
least three samples each); the contact ribbon keeps ~0.9 m rows. Every shorter
layout keeps the standard 1536 samples, so wave-1 geometry is bit-identical.
`dayNight` venues (Hochwald, Loirette, Loirette Club) open in daylight but are
lit along the whole lap (floodlight towers) for running into the night with
the lighting control; `night` venues (Ramla ×2, Lantern Bay, Gantry Point ×2)
open floodlit.

### Venue kit additions

Twelve new dressing themes (Tuscan hills, island coast, heath, sierra, urban
bowl, highland, golden hills, dunes, night desert, Caspian city, bay city, salt
flat) and per-venue fictional signage. Theme behaviour that was keyed to a
theme name is now a style flag (`streetLamps`, `tallFacades`, `cliffs`,
`desertScrub`) with wave-1 values unchanged. `gantry` spans build portal
cranes straddling the road (legs beyond both barriers, girders 16 m up, lit
at night) and container stacks behind the barrier; they keep clear of other
sections and of the flyover.

### Events

Twenty wave-2 events (`circuit-catalogue/events.ts`): GP motorcycle,
superbike and supersport races on the bike-safe circuits;
45-minute and one-hour multi-class endurance races on Hochwald and Loirette;
formula grands prix at Serra Verde, Duinwijk, Ramla (night, two rule sets),
Mirvari and Lantern Bay (night, changeable); touring at Mount Ardlow; GT at
Arroyo Oro; historic masters at Fiume Verde; feeder formula at Ramla Outer and
Lotus Hill; a hypercar night sprint at Gantry Point and the unlimited showcase
at Bright Basin. All resolve through `eventSession` in validate:content.

`npm run test:endurance-events` runs every catalogue endurance event as the
player loads it (own mixed-class field, duration, weather and seed) to the
flag and writes [`endurance-event-races.json`](endurance-event-races.json):
the race must finish, every car must be classified, no car may be parked for
30 s and no marshal recovery may be needed. Two faults it guards against were
found in review. A GT car spun on the forest ring's narrow verge and pressed
its nose against the armco; the AI's reverse-out recovery cancelled itself as
soon as the reversing car exceeded 0.7 m/s, so it never cleared the barrier
and the safety car stayed out for the rest of the race. The manoeuvre now runs
its full four seconds (cars only; a bike has no reverse), the car stops before
leaving reverse gear, and as a backstop marshals place an AI car that has
asked for drive yet covered under 20 m in 30 s back at the track edge
(`MARSHAL_RECOVERY`, race-control event `CAR_RECOVERED`). Second, lapped cars
were classified DNF 180 s after the winner although a GT lap of the 13.6 km
circuit takes over five minutes: the finish grace is now one lap at 25 m/s
where that is longer (`finishGraceSeconds`; laps up to 4.5 km keep 180 s).
The forest ring's grid also sat on a 4.6–4.9 % climb, so every car rolled back
during the lights and took a jump-start penalty; the climb now ends 400 m
before the line (grid ~1 %).

## Authoring format

`src/simulation/circuit-catalogue/` (no Three.js, no DOM):

- `dsl.ts` — `S(length, props)` straights, `A(radius, degrees, props)` arcs
  (+ left), and the two paddock templates (`gpPit` = the validated standard
  geometry; `compactPit` for short street straights). Pit side is per layout.
- Segment properties: end elevation `y`, half-width `w`, banking `bank`
  (degrees, outside raised), `runoff` (grass/gravel/asphalt, per side or
  inside/outside), `barrier` kind and offset, `tunnel`, `facades`, `rock`,
  `drop`, `stands`, `drs`, `gantry` (crane gantries over the road), corner
  `name`. `bends(length, r, angle, …)` replaces a long country-road straight
  with a symmetric chain of bends that keeps its heading and line (wave 2).
- Layout properties (wave 2): `bikeSafe` (re-measured, see above),
  `dayNight` (lit along the lap), `signage` (fictional board text).
- `builder.ts` — closes the turtle path (heading error shared between arcs by
  turn; position error by a least-squares change of straight lengths, so radii
  and the corner sequence survive), resamples a spline control polygon with
  spacing that tightens in corners, scales to the reference length, centres the
  venue, and maps every authored feature to lap distance using `Track`'s own
  sample construction — 1536 samples, or `trackSamplesFor(length)` on laps
  over 9 km — so lengths agree to the metre. Elevation, width and
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
scaling, tunnels shelter at least one water row, banking stays ≤ 33°, no
protected name appears in names, descriptions, corners or trackside signage
(the list gained the wave-2 reference circuits, their corners and sections and
nearby brands), every circuit declaring `bikeSafe` passes `bikeSafetyReport`
and names its cleared motorcycle classes, long laps carry at least three Track
samples per control
point, and every built-in event — motorcycle events included, which need a
bike-safe circuit — resolves.

`npm run test:catalogue-races` runs a seeded 6-car, 2-lap AI race on every
layout through the production simulation, AI and race control and writes
[`circuit-catalogue-races.json`](circuit-catalogue-races.json): every car must
classify, no car may be stuck (below 1 m/s on track) for over 8 s, and best laps
must average 90–320 km/h. Tests: `tests/circuit-catalogue.test.ts` (registry,
lengths, validation, pit side and a left-hand street pit stop, crossing layers
and a flyover lap without progress jumps, 31° banking layer, tunnel rain
shelter, authored run-off/barriers, events, recorded race evidence, live AI
laps), `tests/circuit-catalogue-wave2.test.ts` (wave-2 registry, dense long-lap
sampling, bike-safety measurement, the motorcycle-ruleset and career
consumers, crane gantries and night/day-night flags, events and race
evidence), `tests/circuit-catalogue-wave2-review.test.ts` (protected corner
names and signage, the dunes bowl's direction and banking, the desert double
left, the club hairpins, the forest-ring grid gradient and jump starts, the
wedged-car recovery and marshal backstop, per-class bike clearance, the bike
and endurance event evidence, the rules preview), `tests/venue-kit.test.ts` and `tests/venue-kit-wave2.test.ts`
(terrain/plaza plans for every layout; scene builds of the container terminal,
island cliffs and a day-night venue).

Recorded run (seed 29030, 6 cars, 2 laps; AI pace on the default setup, not reference lap records):

<!-- catalogue-race-table -->
| Layout | Lap (m) | AI best lap | Average | Slowest car best |
|---|---:|---:|---:|---:|
| parco-reale | 5793 | 1:37.186 | 214.6 km/h | 1:44.428 |
| ardennes | 7004 | 2:16.034 | 185.4 km/h | 2:23.020 |
| northfield | 5891 | 1:52.245 | 188.9 km/h | 1:58.269 |
| northfield-classic | 5141 | 1:34.936 | 194.9 km/h | 1:42.005 |
| kansai | 5807 | 1:49.870 | 190.3 km/h | 1:57.363 |
| kansai-east | 2243 | 0:43.733 | 184.6 km/h | 0:48.705 |
| riviera | 3337 | 1:31.387 | 131.5 km/h | 1:38.870 |
| texas-hill | 5513 | 1:56.536 | 170.3 km/h | 2:04.606 |
| neon-city | 4874 | 1:43.180 | 170.1 km/h | 1:50.124 |
| neon-city-reverse | 4874 | 1:42.607 | 171.0 km/h | 1:49.698 |
| alpine-pass | 7276 | 2:33.673 | 170.5 km/h | 2:41.816 |
| alpine-pass-reverse | 7276 | 2:31.875 | 172.5 km/h | 2:40.470 |
| speedbowl | 4005 | 0:48.527 | 297.1 km/h | 0:51.437 |
| speedbowl-infield | 4486 | 1:20.035 | 201.8 km/h | 1:26.844 |
| desert-canyon | 5604 | 1:40.152 | 201.4 km/h | 1:47.285 |
| desert-canyon-reverse | 5604 | 1:39.317 | 203.1 km/h | 1:47.077 |
| coastal-cliff | 4710 | 1:29.821 | 188.8 km/h | 1:38.388 |
| coastal-cliff-reverse | 4710 | 1:30.261 | 187.8 km/h | 1:37.562 |
| dockyard | 4600 | 1:29.959 | 184.1 km/h | 1:36.544 |
| dockyard-reverse | 4600 | 1:29.701 | 184.6 km/h | 1:36.923 |
| poggio-alto | 5245 | 1:39.828 | 189.1 km/h | 1:47.305 |
| cape-wrenna | 4448 | 1:21.587 | 196.3 km/h | 1:28.950 |
| haarveld | 4542 | 1:24.218 | 194.2 km/h | 1:30.755 |
| montejaral | 4423 | 1:32.435 | 172.3 km/h | 1:40.318 |
| hochwald | 20832 | 5:34.670 | 224.1 km/h | 5:43.401 |
| loirette | 13626 | 3:42.973 | 220.0 km/h | 3:49.591 |
| loirette-club | 4185 | 1:31.535 | 164.6 km/h | 1:37.550 |
| serra-verde | 4309 | 1:26.602 | 179.1 km/h | 1:34.576 |
| mount-ardlow | 6213 | 1:53.183 | 197.6 km/h | 2:01.219 |
| arroyo-oro | 3602 | 1:13.502 | 176.4 km/h | 1:20.551 |
| fiume-verde | 4909 | 1:26.106 | 205.2 km/h | 1:33.445 |
| duinwijk | 4259 | 1:31.101 | 168.3 km/h | 1:38.255 |
| ramla-night | 5412 | 1:41.082 | 192.7 km/h | 1:48.485 |
| ramla-outer | 3543 | 1:00.543 | 210.7 km/h | 1:08.036 |
| mirvari | 6003 | 2:05.676 | 172.0 km/h | 2:13.498 |
| lantern-bay | 4940 | 1:56.498 | 152.7 km/h | 2:03.897 |
| lotus-hill | 6120 | 2:02.516 | 179.8 km/h | 2:08.128 |
| gantry-point | 5379 | 1:38.522 | 196.6 km/h | 1:45.158 |
| gantry-point-reverse | 5379 | 1:38.304 | 197.0 km/h | 1:44.899 |
| salt-flat | 6800 | 1:38.811 | 247.7 km/h | 1:45.935 |
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
- Wave-2 approximations were laid out from memory of public maps, not traced:
  corner directions and sequences follow the originals, but several layouts
  are simplified (fewer corners and longer straights than the real circuits,
  notably the desert, dunes and Dutch heath circuits and the forest ring, which
  has 33 named corners against the original's ~70). Closure adjustments were
  kept under ~2 % by refitting straights during authoring.
- `bikeSafe` is a geometric assessment, not a homologation: there is no air-
  fence, run-off depth beyond the barrier distance or rider-impact model, and
  every circuit shares the same 41 mm flat rumble kerb (no per-venue raised
  kerbs exist to exclude). Per-class clearance rests on one seeded AI race per
  circuit and class (3 laps): it shows the AI can ride the class there, not
  that a human can, and the classic class's hairpin falls are an AI
  braking-lag limit (it reaches hairpins several m/s above its target), not
  fixed — the bike AI was left unchanged so existing seeded bike races stay
  identical.
- Long laps: the water/rubber grid keeps 512 rows per lap (40 m rows on the
  forest ring); venue-kit build cost on the 13.6 km and 20.8 km laps has not
  been measured on hardware. Day-night venues have floodlights but no time-of-
  day progression during a race (lighting is the player's control).
- Crane gantries and container stacks are visual only (no collision); the
  Fiume Verde lake is the drop-span water basin beside the straight, not a
  modelled lake shoreline.
