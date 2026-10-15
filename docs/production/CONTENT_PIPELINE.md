# Content pipeline: vehicles, venues, art and assets

Masterplan §10, §14, §15, §17, §18, WP17–WP18, WP27, WP29–WP30. Machine-checkable parts of these
contracts are enforced by `npm run validate:content` (`src/simulation/content-validation.ts`).

## 1. Vehicles

### 1.1 Definition of done (§10.2)

A model may appear in a paid release only with: source assets and provenance; runtime geometry with
LODs and a shadow proxy; material/texture budgets; damage variants; collision shape; cockpit or rider
view; correct pivots and wheel/suspension mapping; audio; AI capability data; setup limits;
thumbnail/selection presentation; localization strings; input guidance; tests; event eligibility and
a balance policy derived from representative tracks (not peak power). Class balance and assists stay
separate; nobody is secretly slowed for choosing a strong car.

### 1.2 Acceptance packet (§10.3)

| Item | Where |
|---|---|
| Definition id, version, content hash | `vehicles.ts`; `vehicleHash()` |
| Physical target sheet and measurements | `scripts/vehicle-calibration.ts` → `docs/vehicle-calibration.json` |
| Authoring/export report | asset manifest (§4.3) |
| LOD screen comparisons, material-pass costs | capture suite (§3) |
| Full-race capture | hardware protocol |
| Cockpit/rider clip tests, audio demonstration | capture suite |
| AI results across venues | seeded AI races |
| Known limits and owner signatures | this file |

### 1.3 Design briefs

**APX-01 Formula (apx01 v1).** Intended skill: intermediate–expert. Strengths: braking, high-speed
downforce, hybrid deployment. Exploitable weakness: wake sensitivity, cold tyres, kerb strikes on
the floor. Sound: high-revving V6 with electric layer. Silhouette: open wheels, wings. Event role:
grand prix, endurance. Status: integrated; supplied exterior awaiting rights and runtime derivative.

**TC-1 Touring (tc1 v1).** Intended skill: novice–intermediate, close racing. Strengths: kerb
compliance, contact tolerance, traction out of slow corners. Weaknesses: front-tyre saturation and
understeer on power (front drive), weight transfer under late braking, no downforce at speed. Sound:
four-cylinder turbo identity (not yet produced). Silhouette: closed-wheel saloon. Event role: touring
sprint, exhibition. Measured (`docs/vehicle-calibration.json`): 0–100 km/h ≈ 5.1 s, top ≈ 232 km/h,
100–0 ≈ 29 m, 1.30 g at 80 km/h; within design bands at both timesteps. Known limits: provisional
greybox exterior (`touring-shell.ts`), no interior, damage variants, LODs or own engine sound.

**GP-R1 Prototype (gpr1 v1).** Original 1000 cc prototype-class racing motorcycle: ~300 hp
(224 kW), 157 kg plus a 72 kg rider, carbon wings (front-biased downforce), seamless six-speed.
Intended skill: intermediate–expert. Strengths: braking stability, top speed (~350 km/h), drive
out of slow corners under wheelie control. Weaknesses: lean-limited mid-corner speed, rear
overload when trail-braking hard, contact intolerance. Measured (`docs/vehicle-calibration.json`):
0–100 ≈ 3.0 s, top ≈ 354 km/h, 100–0 ≈ 36 m (stoppie-limited), 1.31 g at 80 km/h, within bands.
Event role: GP motorcycle sprint. Known limits: procedural bike/rider art (`rendering/bike.ts`,
`rendering/rider.ts`), no damage variants or authored LOD assets, shared engine voice, the pit
crew still animates a four-wheel service.

**SBK-1000 Superbike (sbk1000 v1).** Original production-based 1000 cc superbike: ~215 hp
(160 kW), 200 kg plus rider, no wings, quickshifter six-speed. Intended skill: novice–intermediate.
Measured: 0–100 ≈ 3.2 s, top ≈ 308 km/h, 100–0 ≈ 39 m, 1.20 g at 80 km/h, within bands.
Known limits as GP-R1.

### 1.4 Destination catalogue (§10.1, 48 models)

| Family | Models | Delivery | Present |
|---|---:|---|---|
| Formula | 3 | car launch | 1 (APX-01) |
| GT | 4 | car launch | 0 |
| Touring | 3 | car launch | 1 (TC-1, provisional art) |
| Lightweight club | 2 | car launch | 0 |
| Endurance prototype | 3 | circuit expansion | 0 |
| Historic | 3 | circuit expansion | 0 |
| Rally | 3 | dirt expansion | 0 |
| Rallycross | 3 | dirt expansion | 0 |
| Off-road truck/buggy | 3 | dirt expansion | 0 |
| Kart | 2 | small-vehicle slice | 0 |
| Road sport motorcycle | 3 | bike expansion | 1 (SBK-1000, integrated, procedural art) |
| Prototype GP-style motorcycle | 3 | bike expansion | 1 (GP-R1, integrated, procedural art) |
| Motocross | 4 | dirt-bike expansion | 0 |
| Supermoto | 3 | after bike/dirt gates | 0 |
| Flat-track | 2 | after bike/dirt gates | 0 |
| Experimental | 4 | extreme expansion | 0 |

### 1.5 Customization (§10.4)

Mechanical upgrades must change the `VehicleDefinition` (and therefore its hash and record
category), never only a garage statistic. User graphics need texture-size limits, safe parsing,
moderation and deletion before any sharing.

## 2. Venues and layouts

### 2.1 Pipeline (§14.3)

1. **Layout concept** — classes, speed range, overtaking places, braking rhythm, elevation, landmarks.
2. **Driveable greybox** — `CircuitDefinition` (or a `RouteSpec` for branches/stacked roads) with
   `pit: PitLaneDefinition`; must pass `validate:content`; slowest and fastest vehicles drive it.
3. **Operational pass** — pit/service, marshals, penalties, runoff, starts, cameras; AI race and
   crash/recovery before art.
4. **Art pass** — venue kit, material library, lighting plan; braking references and road edges keep
   their silhouette.
5. **Performance pass** — streaming cells, LOD/HLOD, shadow/mirror representations, warm-up list.
6. **Acceptance pass** — human and AI races, replay, save/restart, cameras, surface agreement,
   shortcut attempts (RouteProgress), device/UI checks.

Record person-time and elapsed time for each stage of the first and second venue (§14.7).

### 2.2 Tooling that exists

Pit/grid geometry as data (`STANDARD_PIT`, left-pit test course), layer-aware progress and a
RouteGraph with validation naming disconnected edges, unknown transitions, zero-length segments and
bounds, content validation for vehicles/circuits/events, sandboxed creator import, development
venues (`src/simulation/test-venues.ts`). Missing: visual editors, surface painter, AI lane overlay,
camera previewer, performance heat map (§14.4).

### 2.3 Venue vision (§15)

| ID | Venue | Status |
|---|---|---|
| T01 | Aurel | integrated |
| T02 | Vellamar | integrated |
| T03–T06 | Lowmere Harbour, High Valley, Solar Basin, Cinderstone Ring | proposed launch venues; not started |
| T07–T12 | Pine Ridge, Black Fen, Redcut, Atlas, Whitewater, Frostline | dirt/surface programme; not started |
| T13–T24 | Tidal Dry Dock … Neon Switchback | extraordinary venues; engineering prerequisites prototyped (layer-aware progress, moving surfaces, magnetic frames) |

Selection (§15.3): rank by new racing created, reuse, readability, vehicle fit and risk; approve
only after a greybox lap, an AI race, a recovery demonstration and a rough performance capture.

## 3. Art direction: target board and capture suite (§17.2, WP27)

Fixed evaluation framings, same resolution and exposure policy between revisions:

| # | Shot | Judged for |
|---|---|---|
| 1 | Cockpit, low speed, pit exit | instrument legibility, glare, hands/wheel |
| 2 | Chase, high speed, main straight | speed sense, ground contact, silhouette |
| 3 | Side-by-side racing | rival readability, mirror usefulness |
| 4 | Wet braking into turn 1 | spray origin, drying line, reflections |
| 5 | Sunset into the sun | exposure, flare restraint |
| 6 | Night traffic | silhouettes, light pools |
| 7 | Pit entry and service | crew contact, shadows |
| 8 | Wide replay | composition, crowd cost |
| 9 | Close photo | materials, decals, carbon/paint |

Moving sequences for fencing, thin rods, vegetation, wheels and specular highlights are part of
the suite (temporal stability, §17.6). Priorities (§17.3): silhouette and ground contact, road/kerb,
stable lighting/shadows, coherent materials, believable motion, readable rivals, scale, weather,
then lens decoration.

Material library families (§17.5): asphalt families, wet road, paint markings, rubber, carbon,
metallic paint, bare metal, glass, textiles, soil, vegetation, concrete — one scale/roughness
convention, wear masks from actual exposure.

## 4. Asset contracts (§18)

### 4.1 Export contract

Units metres; +Z forward, +Y up, +X toward the driver's left (`protocol.ts`); transforms applied;
named wheel centres, steering axes, suspension travel, driver/rider sockets, camera anchors, LOD
identity and collision naming. Automated checks: scale, unapplied transforms, missing materials,
invalid skin weights, unexpected bones, flipped normals, non-finite vertices, oversized textures,
unsupported extensions, missing anchors.

### 4.2 Geometry budgets to investigate (§18.3; hypotheses)

| Representation | Range |
|---|---:|
| Followed car exterior | 100k–250k tris |
| Separate cockpit | 50k–150k |
| Nearby rival | 40k–100k |
| Mid-distance rival | 10k–30k |
| Far rival | 1k–8k or impostor |
| Vehicle shadow proxy | 2k–15k |

### 4.3 Asset manifest fields (§18.6)

source, creator, allowed uses, attribution, derivative permissions, version, hash, export settings,
owner, human art review (and generation/edit history for procedural or AI-assisted content).
