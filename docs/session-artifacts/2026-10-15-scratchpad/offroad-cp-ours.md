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
100–0 ≈ 29 m, 1.30 g at 80 km/h; within design bands at both timesteps. Exterior: the procedural
closed-body generator (below) replaced the greybox shell; physics and content hash unchanged
(`b2abb13d`). Known limits: simple cockpit only, no damage geometry variants, own engine sound absent.

**Catalogue machines (WP17/WP30).** Fifteen generic machines are defined from physical target
sheets in `src/simulation/vehicle-catalogue/` (`CATALOGUE`, full briefs in `CATALOGUE_BRIEFS`, bands
in `CATALOGUE_BANDS`). The builder derives wheel centres from weight split and wheelbase, body
placement from CoG height, the aero map from ClA/CdA/balance and the torque curve from net output.
Each brief states skill, strengths and exploitable weaknesses; `tests/vehicle-catalogue.test.ts`
requires it. Measured at 1/240 s (`docs/vehicle-calibration.json`; every value also inside its
band at 1/120 s, drift < 10%):

| Id | Class | Drive (diff) | 0–100 s | Top km/h | 100–0 m | g @ 80 |
|---|---|---|---:|---:|---:|---:|
| JF-2 junior formula | formula-junior | RWD (LSD) | 2.68 | 308 | 20.5 | 1.74 |
| HF-67 historic formula | historic | RWD (LSD) | 4.13 | 274 | 33.4 | 1.03 |
| HY-9 hypercar | hypercar | RWD + front e-axle > 190 km/h | 2.96 | 334 | 22.5 | 1.57 |
| PR-2 prototype | prototype | RWD (LSD) | 2.96 | 312 | 22.4 | 1.57 |
| GT-8F front-engine GT | gt | RWD (LSD) | 3.46 | 279 | 25.1 | 1.37 |
| GT-10M mid-engine GT | gt | RWD (LSD) | 3.32 | 279 | 24.5 | 1.36 |
| GS-4 GT sport | gt-sport | RWD (LSD) | 3.89 | 259 | 28.4 | 1.24 |
| TC-2 touring | touring | RWD (LSD) | 4.13 | 240 | 27.6 | 1.34 |
| CR-1 club roadster | club | RWD (LSD) | 4.41 | 199 | 28.9 | 1.28 |
| RL-2 rally | rally | AWD (locked 50:50, LSD front/rear) | 4.25 | 192 | 33.0 | 1.08 |
| RCX-6 rallycross | rallycross | AWD (LSD centre 45:55, LSD axles) | 2.55 | 237 | 31.8 | 1.12 |
| DX-8 trophy truck | offroad | RWD (high-preload LSD) | 5.40 | 210 | 38.6 | 0.94 |
| SK-125 shifter kart | kart | RWD (locked axle) | 4.05 | 137 | 18.4 | 1.92 |
| EH-3 electric hypercar | road | AWD (LSD centre 45:55) | 2.38 | 348 | 28.5 | 1.19 |
| SC-7 supercar | road | RWD (LSD) | 3.26 | 331 | 28.6 | 1.17 |

Drivetrain model (`src/simulation/differential.ts`): open / clutch-pack LSD (preload + power/coast
ramps, scaled by the setup differential settings) / locked couplings, each an impulse that
equalises output speeds bounded by its friction capacity; AWD splits drive at a centre coupling
with a static front share. Definitions without a `driveline` (APX-01, TC-1) take the previous code
path unchanged. Tyre families (`src/simulation/tire-families.ts`): Formula slick, slick, semi-slick,
road, gravel, all-terrain, kart and historic cross-ply; untagged tyres see surface grip unchanged.

Exteriors (`src/rendering/vehicle-bodies/`, WP30): every catalogue machine and TC-1 has a body
sheet (`body-sheet.ts`) consumed by family generators (closed body incl. truck/roadster styles,
open-wheel incl. historic, kart). Smooth lofted panels with clearcoat flake paint, tinted glass,
carbon, emissive lamps, panel-gap lines, number boards, tyres with sidewall bulge and tread, spoked
rims with discs and calipers, three LODs and a depth-only shadow proxy; wheels, steer, travel and
lamps follow the snapshot; front/rear damage hides aero parts. APX-01 keeps the supplied asset.

Known limits (catalogue): glass is blended, not transmissive; interiors are a seat, driver and
dash only; the cockpit camera uses the Formula socket for every car; trophy-truck suspension travel
is limited by the shared solver (≈0.13 m bump, ≈5 cm droop) so it is not a long-travel truck yet;
the EV draws energy from the fuel-mass proxy; dirt machines race on asphalt until a dirt venue
exists; per-car setup limits share the global setup screen (a default setup resolves to the car's
own baseline); in seeded 4-car traffic AI incident rates are ≈0–0.17 per lap for most cars but
≈0.3–0.4 for GS-4 and SC-7; no engine-sound families (WP26) and no handling sign-off.

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
| Formula | 3 | car launch | 2 (APX-01, JF-2) |
| GT | 4 | car launch | 3 (GT-8F, GT-10M, GS-4) |
| Touring | 3 | car launch | 2 (TC-1, TC-2) |
| Lightweight club | 2 | car launch | 1 (CR-1) |
| Endurance prototype | 3 | circuit expansion | 2 (HY-9, PR-2) |
| Historic | 3 | circuit expansion | 1 (HF-67) |
| Rally | 3 | dirt expansion | 1 (RL-2; races the Pinewood special stage) |
| Rallycross | 3 | dirt expansion | 1 (RCX-6; races the Kestrel joker heat) |
| Off-road truck/buggy | 3 | dirt expansion | 1 (DX-8; limited suspension travel) |
| Kart | 2 | small-vehicle slice | 1 (SK-125) |
| Road sport motorcycle | 3 | bike expansion | 1 (SBK-1000, integrated, procedural art) |
| Prototype GP-style motorcycle | 3 | bike expansion | 1 (GP-R1, integrated, procedural art) |
| Motocross | 4 | dirt-bike expansion | 2 (MX-450, MX-250; integrated, procedural art) |
| Supermoto | 3 | after bike/dirt gates | 1 (SM-450; integrated, procedural art) |
| Flat-track | 2 | after bike/dirt gates | 0 |
| Experimental | 4 | extreme expansion | 0 |

"Present" means integrated (definition, calibration, AI envelope, procedural exterior, menu
entry); none of these meets the §1.1 definition of done (no audio identity, damage variants,
authored source assets or sign-off). Two road machines (EH-3, SC-7) exist outside the 48-model
destination list for open-world use.

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
venues (`src/simulation/test-venues.ts`).

WP29–WP30 add a **layout authoring builder** (`src/simulation/circuit-catalogue/`: straights and arcs
with elevation, width, banking, run-off, barrier, tunnel, frontage, rock, drop, stand and DRS
properties; closure by least-squares straight adjustment; scaling to a reference length; reverse
layouts), `Track` hooks for authored run-off, barrier offset and roofed (rain-sheltered) rows,
**geometry validation** in `validate:content` (section-corridor overlap, bridge headroom, pit-straight
curvature, racing line, reference length, protected names), a seeded **AI race script per layout**
(`npm run test:catalogue-races` → `docs/circuit-catalogue-races.json`) and a **procedural venue kit**
(`src/rendering/venue-kit/`). Still missing: visual editors, surface painter, AI lane overlay, camera
previewer, performance heat map (§14.4), and person-time records for the stages (§14.7).

### 2.3 Venue vision (§15)

| ID | Venue | Status |
|---|---|---|
| T01 | Aurel | integrated |
| T02 | Vellamar | integrated |
| C01–C06 | Real-world approximations under neutral names: Parco Reale Autodromo, Ardennes Forest Circuit, Northfield Airfield GP (+ Classic), Kansai Figure-Eight (+ East Course), Riviera Harbour Street Circuit, Texas Hill Country Circuit | integrated (greybox + procedural venue kit); approximations from public geometry, pending a licence for official names; no art, hardware or player acceptance |
| C07–C12 | Unconventional originals: Neon City night streets with tunnels (+ reverse), Col d’Argent mountain pass (ascent/descent), Mesa Speedbowl 31° tri-oval (+ infield road course), Red Mesa canyon (+ reverse), Cap Lumière cliff road (+ reverse), Iron Quay docklands flyover (+ reverse) | integrated (greybox + procedural venue kit); seeded 6-car AI races pass on all 20 layouts; no art, hardware or player acceptance |
| T03–T06 | Lowmere Harbour, High Valley, Solar Basin, Cinderstone Ring | proposed launch venues; not started |
| T07–T12 | Pine Ridge, Black Fen, Redcut, Atlas, Whitewater, Frostline | dirt/surface programme; not started |
| T13–T24 | Tidal Dry Dock … Neon Switchback | extraordinary venues; engineering prerequisites prototyped (layer-aware progress, moving surfaces, magnetic frames) |

Selection (§15.3): rank by new racing created, reuse, readability, vehicle fit and risk; approve
only after a greybox lap, an AI race, a recovery demonstration and a rough performance capture.

**Terrain venues (WP39).** Four original off-road venues are built with the same layout builder plus
a course description (`src/simulation/offroad/venues.ts`): a longitudinal jump profile with surveyed
take-off and landing faces, berms on the outside of turns, whoops/rollers, soil zones and a
deformable terrain band. Valley Ridge (outdoor motocross: gate straight, 2 tabletops, 2 doubles, a
triple, a kicker, whoops, rollers), Arena Nord (indoor supercross at night: triple rhythm lane, double,
tabletop, whoops, finish triple), Kestrel (rallycross: asphalt start and finish, gravel loop, crest,
joker road) and Pinewood (gravel special stage, ~2.8 km, three crests, two splits). Each passes
`validate:content`, has seeded AI races in `docs/offroad-races.json` and admits only its machine
classes (motorcycles at motocross/supercross, cars at rallycross/stages). Not done: art pass beyond
the procedural venue kit, human races, performance capture, §15.3 approval.

Catalogue layouts C01–C12 (20 layouts, [roster and limits](../CIRCUIT_CATALOGUE.md)) have passed the
greybox lap and AI race stages (`docs/circuit-catalogue-races.json`), and the operational pass for
pit/service (venue-owned pit side, a left-hand street pit stop test), marshal posts, run-off and
cameras. Not yet done for any of them: crash/recovery demonstration, human races, rough performance
capture on reference hardware, the art pass beyond the procedural kit, and §15.3 approval.

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

**Capture presets.** Every shot is captured at the player default (Medium) and at High; shots 2, 4,
5, 8 and 9 are also captured at the opt-in **ULTRA** preset (TAA + sharpening, hierarchical SSR on
wet asphalt and paint, temporal GTAO, near/mid/far sun cascades, energy-conserving bloom, sun
shafts, replay lens). Passes, costs and fallbacks: [RENDERING_PIPELINE.md](RENDERING_PIPELINE.md).
Until the live suite is automated, `scripts/ultra-capture.ts` is the deterministic stand-in: a fixed
material/lighting set rendered through High and ULTRA (dry, rain, replay) with a JSON report of
per-pass draws, fetch estimates, GPU timestamps where available and cascade texel sizes; it fails on
shader/GL errors and on held frames that are not byte-identical. Judge ULTRA shots additionally for
reflection stability under motion (shot 4), shaft restraint (shot 5) and focus breathing (shot 8).

Material library families (§17.5): asphalt families, wet road, paint markings, rubber, carbon,
metallic paint, bare metal, glass, textiles, soil, vegetation, concrete — one scale/roughness
convention, wear masks from actual exposure. The shared library in `src/rendering/materials/`
implements metallic paint (`materials.carPaint`), carbon, rubber, bare/brushed/polished/cast metal,
glass, asphalt (fresh/worn/patched), wet road, concrete and vegetation with GPU-generated detail
maps (no downloaded textures) and the shared surface-weather response; textiles, soil and paint
markings remain open. New vehicle and venue kits should take their materials from it so one
roughness convention and the ULTRA reflection mask apply everywhere.

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
