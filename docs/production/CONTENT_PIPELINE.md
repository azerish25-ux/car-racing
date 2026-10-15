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

**Catalogue growth (WP30, 35 machines; 54 registered with the 19 above).** Thirty-one cars are
appended to `CATALOGUE` from physical target sheets in `vehicle-catalogue/` (`single-seaters.ts`,
`prototypes.ts`, `gt-layouts.ts`, `touring-club-2.ts`, `dirt-2.ts`, `experimental.ts`,
`road-festival.ts`) and four road motorcycles to `BIKE_ADDITIONS` (`bike-definitions.ts`),
registered after the catalogue so every existing snapshot index and content hash is unchanged
(the 19 earlier hashes are pinned by `tests/vehicle-catalogue-growth.test.ts`). Dirt bikes and
supermoto belong to the off-road programme and are not part of this list. New classes:
`formula-feeder`, `formula-entry`, `historic-aero` (1970s), `historic-turbo` (1980s),
`historic-prototype`, `vintage`, `historic-rally`, `experimental`, `supersport`, `classic-bike`
and the open-world `road-bike` (no race ruleset, like `road`). New rulesets: feeder-formula sprint
(DRS where the car has it), heritage sprint (one historic class per grid), historic masters (three
single-seater eras on one road, scored per class), historic-rally heat, unlimited showcase and the
motorcycle class sprint. Every machine of a racing class enters at least one built-in event (23
new events, including the first events for JF-2, RL-2 and SBK-1000). One solver addition: the
fan-assisted floor of XF-2 (`VehicleDefinition.fan`, PHYSICS_MODEL.md §4), present on no other
definition; and one new tyre family, the 1970s–80s historic slick (grip 0.68–0.90).

Bands were written with each brief before the first measurement and none was changed afterwards;
where a first measurement fell outside, the definition moved (gearing, low-rpm torque, tyre grip
or stagger, brake capacity, mass), never the band. The brief's "about" figures are design intent;
the bands are the acceptance criteria. Measured at 1/240 s (`docs/vehicle-calibration.json`; every
value inside its band at 1/120 s as well, largest timestep drift 0.24 %):

| Machine | Class | Drive (diff) | 0–100 s | Top km/h | 100–0 m | g @ 80 | Sound family |
|---|---|---|---:|---:|---:|---:|---|
| FX-26 formula | formula | RWD (LSD) | 2.40 | 341 | 18.8 | 1.91 | v6-turbo-hybrid |
| FR-3 feeder formula | formula-feeder | RWD (LSD) | 2.97 | 267 | 21.5 | 1.66 | v6-na |
| FE-4 entry formula | formula-entry | RWD (LSD) | 3.61 | 208 | 23.2 | 1.59 | i4-turbo |
| HF-76 historic formula | historic-aero | RWD (LSD) | 3.14 | 285 | 25.2 | 1.35 | v8-na |
| HF-86 turbo formula | historic-turbo | RWD (LSD) | 3.00 | 321 | 21.2 | 1.52 | v6-turbo |
| HY-11 hypercar | hypercar | RWD (LSD) | 2.93 | 318 | 22.5 | 1.56 | v8-crossplane-turbo |
| PR-3 open prototype | prototype | RWD (LSD) | 3.10 | 295 | 22.4 | 1.55 | v6-turbo |
| SP-71 long-tail prototype | historic-prototype | RWD (LSD) | 3.47 | 336 | 28.7 | 1.08 | flat12-na |
| GT-6R rear-engine GT | gt | RWD (LSD) | 3.53 | 291 | 24.6 | 1.33 | flat6-na |
| GT-6S straight-six GT | gt | RWD (LSD) | 3.55 | 281 | 25.8 | 1.36 | i6-turbo |
| GS-6M mid-engine GT sport | gt-sport | RWD (LSD) | 3.99 | 257 | 28.6 | 1.19 | v6-na |
| TC-3 AWD touring | touring | AWD (LSD centre 40:60, LSD/LSD axles) | 3.60 | 245 | 28.5 | 1.24 | i4-turbo |
| HH-2 hot-hatch racer | club | FWD (LSD) | 4.83 | 229 | 31.0 | 1.16 | i4-turbo |
| VC-62 vintage roadster | vintage | RWD (LSD) | 6.40 | 193 | 35.4 | 1.04 | i4-na |
| RL-7 classic rally | historic-rally | RWD (LSD) | 5.49 | 185 | 34.0 | 1.09 | i4-na |
| GB-4 group rally | historic-rally | AWD (LSD centre 35:65, LSD/LSD axles) | 3.50 | 221 | 31.7 | 1.14 | i5-turbo |
| RX-E electric rallycross | rallycross | AWD (locked 50:50, LSD/LSD axles) | 2.50 | 226 | 32.7 | 1.09 | electric |
| BG-2 desert buggy | offroad | RWD (LSD) | 4.60 | 191 | 38.6 | 1.01 | v6-turbo |
| DK-100 direct-drive kart | kart | RWD (locked axle) | 9.39 | 117 | 41.1 | 1.77 | two-stroke-kart |
| XF-2 fan prototype | experimental | RWD (LSD) | 2.61 | 316 | 14.7 | 2.33 | v8-na |
| XE-1 electric time attack | experimental | AWD (LSD centre 45:55, LSD/LSD axles) | 2.17 | 256 | 19.7 | 1.75 | electric |
| XH-3 hydrogen prototype | experimental | AWD (LSD centre 35:65, LSD/LSD axles) | 2.96 | 316 | 23.5 | 1.46 | fuel-cell |
| XT-1 track hypercar | experimental | RWD (LSD) | 2.54 | 355 | 22.4 | 1.48 | v12-na |
| RH-3 hot hatch | road | FWD (LSD) | 5.20 | 260 | 33.0 | 1.09 | i4-turbo |
| RS-5 sports sedan | road | AWD (LSD centre 30:70, LSD/LSD axles) | 3.48 | 302 | 31.7 | 1.09 | i6-turbo |
| RM-8 muscle coupe | road | RWD (LSD) | 4.76 | 295 | 32.5 | 1.08 | v8-na |
| RG-63 classic grand tourer | road | RWD (LSD) | 6.15 | 267 | 38.1 | 0.96 | v12-na |
| RP-6 desert pickup | road | AWD (LSD centre 40:60, open/LSD axles) | 5.15 | 187 | 40.6 | 0.88 | v6-turbo |
| RR-4 rally-bred road car | road | AWD (LSD centre 41:59, LSD/LSD axles) | 4.98 | 265 | 32.6 | 1.09 | flat4-turbo |
| LX-12 luxury GT | road | RWD (LSD) | 4.04 | 333 | 35.5 | 1.00 | v12-turbo |
| RD-2 roadster | road | RWD (LSD) | 6.32 | 233 | 34.4 | 1.17 | i4-na |
| GP-R2 prototype | gp-bike | chain, rear | 3.07 | 343 | 34.3 | 1.31 | i4-bike |
| SS-600 supersport | supersport | chain, rear | 3.48 | 265 | 37.9 | 1.15 | i4-bike |
| NR-900 naked roadster | road-bike | chain, rear | 3.34 | 224 | 40.7 | 0.95 | i3-bike |
| CR-750 classic racer | classic-bike | chain, rear | 4.21 | 237 | 48.1 | 0.92 | two-stroke-bike |

AI envelopes of the new cars are the measured lateral and braking fits (aero terms zero without
downforce); the bike envelopes come from `bikeEnvelope`, which now also caps braking at the brake
force a drum-era machine can deliver (GP-R1 and SBK-1000 are stoppie-limited, so unchanged). Four
identical AI cars per machine ran 200–240 s of practice on Aurel and on Vellamar while tuning: the
first pass showed SP-71, GB-4, BG-2, XT-1, RG-63 and CR-750 spinning or running off, fixed by rear
tyre stagger (SP-71 1.25, XT-1 1.14, RG-63 1.08 with a 0.62 forward brake bias) and gentler AI
margins (SP-71, GB-4, BG-2, XT-1, RS-5, RM-8, RG-63, CR-750). Six seeded bike races
(`npm run test:bikes`, now including GP-R1 vs GP-R2, an SS-600 grid and a CR-750 grid) finish with
no crash.

Review pass (definitions moved, bands unchanged; the figures above are the re-measured ones):
RH-3 had sat on its 0–100 floor (5.000 s) with more grip than the HH-2 racer, so its road tyres
drop from 0.78 to 0.72 (1.09 g against HH-2's 1.16 g); BG-2's brakes drop to 7.2 kN m and LX-12's
to 8.2 kN m with a CdA of 0.88 (both had been within 1 % of an edge, and "long braking" is in both
briefs); FR-3's race engine gains a weak bottom end below its idle speed, which the clutch launch
reaches (0–100 2.97 s, from 1 % over its floor). HF-86, GB-4, RR-4 and PR-3 now simulate the turbo
lag their briefs name (`CatalogueSheet.turbo`, PHYSICS_MODEL.md §3), which moves their 0–100
toward the briefs (3.00, 3.50, 4.98 and 3.10 s). GP-R2 had beaten GP-R1 on every metric: its mass
now sits further back (it brakes 1.7 m shorter but lifts its front wheel sooner), and the weaker
bottom end and draggier fairing cost it 0.04 s to 100 km/h and 11 km/h at the top. Eight-bike
fields of either machine lap Aurel and Vellamar within 0.1 s of each other; in the alternating
GP-R1/GP-R2 race GP-R2 still finishes ahead in three of four pairs (its braking passes in
traffic). XF-2's AI envelope carries the fan's share of its limits, so the AI plans on the grip a
damaged floor leaves (`fanBase`). GB-4 drives with gentler AI corner margins (0.68 / 0.60) after
its turbo lag; four-car AI practice of every changed machine on Aurel and Vellamar runs without
a retirement, and the only stranded car is a BG-2 in a Vellamar gravel trap, as before the review.
Rules and career: a car built without a DRS flap (FE-4 on the feeder-formula sprint) is never
eligible for DRS, and the event card, the setup line, the race message and the HUD flag say DRS
only when a car on the grid carries one (`gridDrs`, `RaceDirector.drsActive`); the career admits
every class an authored grid lists (HF-76 and HF-67 owners now enter the historic masters), files
the road-only NR-900 under the festival instead of an open circuit-bike tier, and never awards a
championship prize that cannot race in this build.

Briefs, bands, sound, body and events (the full brief strings live in `CATALOGUE_BRIEFS`):

* **FX-26 Formula (`fx26` v1, formula).** Top-tier single-seater to an electrified rule set, distinct from APX-01: a 1.6 L turbo V6 limited to about 400 kW plus a 350 kW crankshaft motor (4 MJ store), 768 kg with driver, a smaller, narrower car with about a quarter less downforce and less drag than APX-01, DRS (active rear-wing opening). Intended skill: expert. Strengths: deployment out of slow corners, top speed while the store lasts, braking. Weaknesses: energy clipping on long straights, less high-speed grip than APX-01, wake sensitivity. Targets: 0–100 about 2.6 s, peak 335–360 km/h with full deployment, 100–0 under 30 m, about 2 g at 80 km/h. Bands: 0–100 2.2–3.1 s, top 325–365 km/h, 100–0 15–30 m, 1.75–2.6 g. Sound: `v6-turbo-hybrid`. Body: open-wheel modern, halo, airbox. Events: `vellamar-formula-two-rule-sets`.
* **FR-3 Feeder Formula (`fr3` v1, formula-feeder).** Third-rung spec single-seater: naturally aspirated 3.4 L V6, about 280 kW, 675 kg with driver, simple two-element wings and a flat floor, DRS, steel-carbon brakes. Intended skill: novice–intermediate on the Formula ladder. Strengths: honest balance, tow-heavy pack racing. Weaknesses: modest power, front-wing wake loss in traffic. Targets: 0–100 about 3.2 s, 265–285 km/h, about 1.7 g at 80 km/h. Bands: 0–100 2.8–3.8 s, top 255–295 km/h, 100–0 18–34 m, 1.5–2.2 g. Sound: `v6-na`. Body: open-wheel modern, halo, airbox. Events: `aurel-feeder-formula-sprint`.
* **FE-4 Entry Formula (`fe4` v1, formula-entry).** First single-seater rung: 1.4 L turbo four, 120 kW, 570 kg with driver, halo, small single-element wings, steel brakes, no DRS. Intended skill: novice. Strengths: low inertia and a forgiving limit that teaches braking points. Weaknesses: little power to correct mistakes, slipstream decides races. Targets: 0–100 about 4 s, 210–230 km/h, about 1.5 g at 80 km/h. Bands: 0–100 3.4–4.8 s, top 200–235 km/h, 100–0 22–36 m, 1.35–1.9 g. Sound: `i4-turbo`. Body: open-wheel modern, halo. Events: `vellamar-entry-formula-sprint`.
* **HF-76 Historic Formula (`hf76` v1, historic-aero).** A 1976-style winged single-seater: 3.0 L V8, about 360 kW at 10 500 rpm, 650 kg with driver, tall airbox, wedge nose with front wings, a big rear wing on a central pylon, wide bias-ply slicks, steel brakes, five-speed. Intended skill: intermediate–expert. Strengths: power and mechanical grip from the wide rears. Weaknesses: draggy, steel brakes fade and lock, slides at the limit. Targets: 0–100 about 3.4 s, about 285 km/h, about 1.5 g at 80 km/h. Bands: 0–100 2.9–4.2 s, top 265–310 km/h, 100–0 24–40 m, 1.25–1.8 g. Sound: `v8-na`. Body: open-wheel seventies, airbox. Events: `aurel-historic-masters`.
* **HF-86 Turbo Formula (`hf86` v1, historic-turbo).** A 1986-style turbo-era single-seater: 1.5 L turbo V6 in race trim, about 600 kW with a boost-driven torque curve that arrives late, 620 kg with driver, flat bottom, small front wings and a large multi-element rear wing, radial slicks, carbon brakes, six-speed manual. Intended skill: expert. Strengths: enormous straight-line speed. Weaknesses: turbo lag and wheelspin out of slow corners, rear-heavy aero balance, snap oversteer. Targets: 0–100 about 3 s (traction-limited), 315–340 km/h, about 1.6 g at 80 km/h. Bands: 0–100 2.5–3.6 s, top 305–345 km/h, 100–0 20–36 m, 1.4–2 g. Sound: `v6-turbo`. Body: open-wheel eighties. Events: `aurel-historic-masters`.
* **HY-11 Hypercar (`hy11` v1, hypercar).** Top-class endurance prototype built around a spec hybrid, unlike the front-axle HY-9: a 4.0 L twin-turbo V8 (about 470 kW) driving the rear wheels with a 50 kW crankshaft motor-generator, 1030 kg, more downforce and drag than HY-9 (L/D about 3.9). Intended skill: intermediate–expert. Strengths: cornering grip, torque, braking stability. Weaknesses: rear-drive traction from slow corners, less straight-line speed than HY-9, small energy store. Targets: 0–100 about 3.1 s, 315–340 km/h, about 1.6 g at 80 km/h. Bands: 0–100 2.7–3.8 s, top 310–345 km/h, 100–0 20–36 m, 1.45–2.2 g. Sound: `v8-crossplane-turbo`. Body: prototype, swan-neck wing, slim/bar lamps, canards. Events: `vellamar-hypercar-hybrids`.
* **PR-3 Open Prototype (`pr3` v1, prototype).** Open-cockpit second-tier prototype (a barchetta, against the closed PR-2): 3.5 L twin-turbo V6, about 400 kW, 930 kg, high-downforce kit with a short tail. Intended skill: intermediate. Strengths: turbo torque, low-speed downforce, light weight. Weaknesses: draggy at speed, turbo response at corner exit, an open cockpit gives the driver no shelter in rain. Targets: 0–100 about 3.2 s, about 300 km/h, about 1.6 g at 80 km/h. Bands: 0–100 2.8–4 s, top 280–320 km/h, 100–0 20–36 m, 1.45–2.2 g. Sound: `v6-turbo`. Body: prototype (open), full-width wing, pod/strip lamps. Events: `aurel-open-prototype-sprint`.
* **SP-71 Long-Tail Prototype (`sp71` v1, historic-prototype).** A 1971-style long-tail sports prototype: air-cooled 4.9 L flat-12 behind the driver, about 440 kW, 860 kg with driver, a spaceframe under a low-drag long tail with almost no downforce, bias-ply slicks, steel brakes, five-speed. Intended skill: expert. Strengths: very high top speed, a tractable flat-12. Weaknesses: light and nervous at speed, long braking zones, rear weight bias (38/62) snaps on lift-off. Targets: 0–100 about 3.8 s, 330–360 km/h, about 1.2 g at 80 km/h. Bands: 0–100 3–4.6 s, top 320–365 km/h, 100–0 28–44 m, 1.05–1.45 g. Sound: `flat12-na`. Body: prototype, lip wing, round/round lamps, fin. Events: `vellamar-long-tail-sprint`.
* **GT-6R Rear-Engine GT (`gt6r` v1, gt).** Rear-engined GT: 4.2 L naturally aspirated flat-six behind the rear axle, about 380 kW at 8750 rpm, 1270 kg, 39/61 weight split on staggered slicks, swan-neck wing. Intended skill: intermediate–expert. Strengths: traction and braking (the weight sits over the rears), a high-revving engine. Weaknesses: a light nose that understeers on entry and a pendulum on lift-off; rear tyre wear. Targets: 0–100 about 3.4 s, 280–290 km/h, about 1.35 g at 80 km/h. Bands: 0–100 3–4.2 s, top 265–300 km/h, 100–0 24–36 m, 1.3–1.75 g. Sound: `flat6-na`. Body: gt, swan-neck wing, round/strip lamps, exhaust-rear, louvres. Events: `aurel-gt-four-layouts`.
* **GT-6S Straight-Six GT (`gt6s` v1, gt).** Front-engined GT on a long wheelbase: 3.0 L twin-turbo straight-six ahead of the driver, about 400 kW with a flat torque plateau, 1340 kg, 52/48 split, pedestal wing. Intended skill: novice–intermediate. Strengths: stability at high speed and under braking, turbo torque out of slow corners. Weaknesses: the longest, heaviest car in the class, slow direction changes, nose-heavy understeer. Targets: 0–100 about 3.5 s, about 280 km/h, about 1.33 g at 80 km/h. Bands: 0–100 3–4.2 s, top 265–300 km/h, 100–0 24–36 m, 1.3–1.75 g. Sound: `i6-turbo`. Body: gt, pedestal wing, twin/bar lamps, exhaust-side. Events: `aurel-gt-four-layouts`.
* **GS-6M Mid-Engine GT Sport (`gs6m` v1, gt-sport).** Mid-engined entry GT: 3.8 L naturally aspirated V6 behind the driver, about 300 kW, 1400 kg, 43/57 split, small fixed wing, harder slicks. Intended skill: novice–intermediate. Strengths: rotation and a linear throttle, a lighter nose than the front-engined GS-4. Weaknesses: less torque than GS-4, snap oversteer on lift-off, low top speed. Targets: 0–100 about 4.2 s, about 255 km/h, about 1.25 g at 80 km/h. Bands: 0–100 3.6–5 s, top 240–275 km/h, 100–0 28–40 m, 1.15–1.5 g. Sound: `v6-na`. Body: supercar, pedestal wing, slim/twin lamps, exhaust-rear. Events: `vellamar-gt-sport-sprint`.
* **TC-3 AWD Touring (`tc3` v1, touring).** All-wheel-drive touring saloon: 2.0 L turbo four, about 290 kW, 1300 kg (a weight penalty for the driveline), centre clutch-pack differential sending 40% forward, small splitter and wing. Intended skill: novice–intermediate. Strengths: launches, traction in the wet and out of slow corners. Weaknesses: weight, power understeer on entry, the front tyres do two jobs. Shares the touring grid with TC-1 (front drive) and TC-2 (rear drive). Targets: 0–100 about 4.0 s, about 240 km/h, about 1.3 g at 80 km/h. Bands: 0–100 3.4–4.8 s, top 225–265 km/h, 100–0 26–40 m, 1.15–1.5 g. Sound: `i4-turbo`. Body: saloon, full-width wing, slim/strip lamps, exhaust-side, cage, canards. Events: `aurel-touring-three-drives`.
* **HH-2 Hot-Hatch Racer (`hh2` v1, club).** Front-drive hot-hatch club racer: 2.0 L turbo four, about 200 kW, 1180 kg with driver, roll cage, semi-slicks, front clutch-pack differential. Intended skill: novice. Strengths: braking stability, torque, forgiving lift-off rotation. Weaknesses: front tyre overload and torque steer, high centre of gravity, no downforce. Races the CR-1 roadster in the club class: more power, more mass. Targets: 0–100 about 5.4 s, about 230 km/h, about 1.2 g at 80 km/h. Bands: 0–100 4.6–6.4 s, top 215–245 km/h, 100–0 28–42 m, 1.1–1.4 g. Sound: `i4-turbo`. Body: saloon, roof wing, slim/twin lamps, exhaust-side, cage, canards. Events: `vellamar-club-sprint`.
* **VC-62 Vintage Roadster (`vc62` v1, vintage).** A 1962-style vintage club roadster: 1.6 L naturally aspirated four on twin carburettors, about 100 kW, 760 kg with driver, four-speed, cross-ply tyres on wire wheels, front discs and rear drums, no aerodynamics to speak of. Intended skill: novice–intermediate. Strengths: balance, low speeds that forgive mistakes, close slipstream racing. Weaknesses: little grip, long braking, body roll, front lift at speed. Targets: 0–100 about 7 s, about 195 km/h, about 1.0 g at 80 km/h. Bands: 0–100 6–8.5 s, top 180–210 km/h, 100–0 34–50 m, 0.9–1.15 g. Sound: `i4-na`. Body: roadster, no wing, round/round lamps, exhaust-side, cage, bonnet-scoop. Events: `aurel-vintage-club-sprint`.
* **RL-7 Classic Rally (`rl7` v1, historic-rally).** A 1970s-style rear-drive rally saloon: 2.0 L sixteen-valve four, about 180 kW at 8500 rpm, 1100 kg with crew, five-speed dog box with short gearing, clutch-pack rear differential, gravel tyres. Intended skill: intermediate. Strengths: light, agile, drives on the throttle, cheap to repair. Weaknesses: rear-drive traction on loose ground, narrow power band, low top speed. Targets: 0–100 about 5.5 s, about 185 km/h, about 1.1 g at 80 km/h on asphalt. Bands: 0–100 4.6–6.4 s, top 175–200 km/h, 100–0 32–48 m, 0.95–1.25 g. Sound: `i4-na`. Body: rally, no wing, round/round lamps, lamp-pod, mudflaps, exhaust-rear, cage. Events: `aurel-historic-rally-heat`.
* **GB-4 Group Rally (`gb4` v1, historic-rally).** A mid-1980s group-supercar rally car: 2.1 L turbocharged five mounted behind the crew, about 370 kW, 1120 kg, permanent four-wheel drive with a clutch-pack centre differential sending 35% forward, gravel tyres, big rear wing. Intended skill: expert. Strengths: violent acceleration and traction everywhere. Weaknesses: turbo lag, mid-engine snap on lift-off, heavy steering at the limit, unforgiving in contact. Targets: 0–100 about 3.2 s on asphalt, about 220 km/h, about 1.15 g at 80 km/h. Bands: 0–100 2.6–3.8 s, top 205–235 km/h, 100–0 30–46 m, 1–1.35 g. Sound: `i5-turbo`. Body: rally, pedestal wing, twin/bar lamps, lamp-pod, mudflaps, exhaust-rear, cage, louvres. Events: `aurel-historic-rally-heat`.
* **RX-E Electric Rallycross (`rxe` v1, rallycross).** Electric rallycross car: one motor per axle modelled as one equivalent drive (500 kW, 880 N m at the motor, single reduction) coupled front to rear at a fixed 50:50 split, 1490 kg with the battery, gravel tyres. Intended skill: intermediate. Strengths: instant torque, the best launch on the grid, no gear changes. Weaknesses: 190 kg more than RCX-6, heavy in direction changes, single-speed top end. Known limit: energy is drawn from the shared fuel-mass proxy. Targets: 0–100 about 2.3 s, about 230 km/h, about 1.15 g at 80 km/h. Bands: 0–100 1.9–2.8 s, top 215–245 km/h, 100–0 28–44 m, 1–1.4 g. Sound: `electric`. Body: rally, swan-neck wing, bar/bar lamps, mudflaps, cage, canards. Events: `vellamar-electric-rallycross`.
* **BG-2 Desert Buggy (`bg2` v1, offroad).** Mid-engined desert buggy: 3.5 L twin-turbo V6 behind the crew, about 300 kW, 1650 kg, tube frame with minimal body panels, rear drive through a high-preload differential, four-speed sequential, 35-inch all-terrain tyres. Intended skill: intermediate. Strengths: lighter and quicker to turn than the DX-8 truck, traction from the rear weight bias. Weaknesses: tall and narrow-tracked for its height, little top speed, long braking; suspension travel is limited by the current solver (as DX-8). Targets: 0–100 about 5 s, about 190 km/h, about 0.95 g at 80 km/h. Bands: 0–100 4–6 s, top 180–205 km/h, 100–0 36–56 m, 0.8–1.1 g. Sound: `v6-turbo`. Body: tube-frame buggy, exposed arms. Events: `aurel-desert-heat`.
* **DK-100 Direct-Drive Kart (`dk100` v1, kart).** Direct-drive sprint kart: 100 cc reed-valve two-stroke, about 23 kW at 16 500 rpm, one sprocket ratio and a centrifugal clutch, 155 kg with driver, a rear-axle brake only, harder sprint tyres. Intended skill: novice. Strengths: momentum and line discipline, cornering grip per kilogram. Weaknesses: slow to accelerate (no gears), rear-only brakes lock and slide, the locked axle understeers. Targets: 0–100 about 8 s, about 115 km/h, about 2 g at 80 km/h. Bands: 0–100 6–10.5 s, top 105–125 km/h, 100–0 26–44 m, 1.6–2.5 g. Sound: `two-stroke-kart`. Body: kart (compact nose, short pods, air-cooled, enclosed bumper). Events: `vellamar-direct-drive-kart`.
* **XF-2 Fan Prototype (`xf2` v1, experimental).** Fan-assisted downforce prototype: an auxiliary engine drives two fans that evacuate a skirted floor, about 7 kN of suction at any road speed, on a 780 kg closed car with a 3.0 L V8 (about 390 kW) and almost no wings (low drag). Intended skill: expert. Strengths: cornering and braking grip that does not wait for speed, low drag on the straights. Weaknesses: suction is lost when the skirts lift (crests, kerbs, a spin), stiff ride, a failure hands the car back its 780 kg of mechanical grip. Targets: 0–100 about 2.8 s, about 310 km/h, 100–0 under 24 m, well over 2 g at 80 km/h. Bands: 0–100 2.4–3.4 s, top 290–335 km/h, 100–0 13–24 m, 2–3 g. Sound: `v8-na`. Body: prototype, no wing, slim/strip lamps, fan. Events: `aurel-unlimited-showcase`.
* **XE-1 Electric Time Attack (`xe1` v1, experimental).** Electric time-attack prototype: two motors (about 500 kW together, modelled as one equivalent drive at 850 N m, single reduction) through a clutch-pack centre coupling sending 45% forward, 1000 kg with driver, enormous wings and diffuser on wide single-seater-construction slicks. Intended skill: intermediate–expert. Strengths: launches, downforce in medium and fast corners, no gear changes. Weaknesses: drag caps top speed, battery mass, a short single-lap energy budget (fuel-mass proxy). Targets: 0–100 about 2.2 s, about 265 km/h, 100–0 about 22 m, about 2 g at 80 km/h. Bands: 0–100 1.9–2.8 s, top 245–280 km/h, 100–0 16–28 m, 1.7–2.6 g. Sound: `electric`. Body: prototype, full-width wing, bar/bar lamps, canards, fin. Events: `aurel-unlimited-showcase`.
* **XH-3 Hydrogen Prototype (`xh3` v1, experimental).** Hydrogen endurance prototype concept: a fuel-cell stack and buffer battery feeding front and rear motors (about 480 kW, modelled as one equivalent electric drive through a centre coupling sending 35% forward), 1250 kg with the pressure tanks, efficient low-drag endurance aero. Intended skill: intermediate. Strengths: traction, efficient at speed, silent but for compressor and inverter whine. Weaknesses: tank mass, a single reduction gives up acceleration at the top. Known limit: hydrogen is drawn from the shared fuel-mass proxy, and the fuel-cell power curve is a static map. Targets: 0–100 about 2.8 s, about 320 km/h, about 1.6 g at 80 km/h. Bands: 0–100 2.4–3.4 s, top 300–335 km/h, 100–0 20–34 m, 1.4–2.1 g. Sound: `fuel-cell`. Body: prototype, lip wing, slim/strip lamps, fin. Events: `aurel-unlimited-showcase`.
* **XT-1 Track Hypercar (`xt1` v1, experimental).** Track-only hypercar outside any rule book: 6.5 L naturally aspirated V12 revving to 11 100 rpm, about 750 kW, 1120 kg with driver, slicks, a race-car wing and diffuser, seven-speed sequential. Intended skill: expert. Strengths: power everywhere, downforce at speed, a progressive engine. Weaknesses: rear-drive traction on 750 kW, heavier than a prototype, brake heat. Targets: 0–100 about 2.7 s, about 350 km/h, about 1.6 g at 80 km/h. Bands: 0–100 2.3–3.2 s, top 330–370 km/h, 100–0 18–32 m, 1.45–2.2 g. Sound: `v12-na`. Body: supercar, swan-neck wing, slim/strip lamps, exhaust-rear, fin, canards. Events: `aurel-unlimited-showcase`.
* **RH-3 Hot Hatch (`rh3` v1, road).** Road hot hatch: transverse 2.0 L turbo four, about 235 kW, 1500 kg with driver, front drive through a clutch-pack differential, six-speed. Intended skill: novice. Strengths: usable torque, stable under braking, rotates on a lift. Weaknesses: front tyres saturate on power out of slow corners, high centre of gravity, soft road springs. Targets: 0–100 about 5.7 s, about 255 km/h, about 1.05 g at 80 km/h. Bands: 0–100 5–6.6 s, top 245–275 km/h, 100–0 30–42 m, 0.95–1.2 g. Sound: `i4-turbo`. Body: saloon, roof wing, slim/bar lamps, exhaust-rear. Events: none (open-world only).
* **RS-5 Sports Sedan (`rs5` v1, road).** Four-door sports sedan: 3.0 L twin-turbo straight-six, about 375 kW, 1820 kg, rear-biased all-wheel drive (30% forward through a clutch-pack centre), electronic rear differential, seven-speed automatic. Intended skill: novice–intermediate. Strengths: launch, torque, all-weather traction. Weaknesses: mass in braking zones and direction changes, body roll. Targets: 0–100 about 3.7 s, about 300 km/h, about 1.1 g at 80 km/h. Bands: 0–100 3.3–4.3 s, top 285–310 km/h, 100–0 31–40 m, 1–1.25 g. Sound: `i6-turbo`. Body: saloon, lip wing, slim/bar lamps, exhaust-rear. Events: none (open-world only).
* **RM-8 Muscle Coupe (`rm8` v1, road).** Front-engined muscle coupe: 5.0 L naturally aspirated cross-plane V8, about 340 kW at 7000 rpm, 1820 kg, rear drive through a clutch-pack differential, six-speed manual. Intended skill: intermediate. Strengths: torque, a long-legged top gear, rear-drive drifts on demand. Weaknesses: weight and a nose-heavy balance, wheelspin from rest, brakes that fade. Targets: 0–100 about 4.6 s, about 280 km/h, about 1.05 g at 80 km/h. Bands: 0–100 4–5.4 s, top 265–300 km/h, 100–0 32–42 m, 0.95–1.2 g. Sound: `v8-na`. Body: gt, ducktail wing, twin/strip lamps, exhaust-rear, bonnet-scoop. Events: none (open-world only).
* **RG-63 Classic Grand Tourer (`rg63` v1, road).** A 1963-style front-engined grand tourer: 3.0 L V12 on six carburettors, about 220 kW at 7500 rpm, 1250 kg with driver, five-speed, cross-ply tyres on wire wheels, discs all round, no aerodynamic downforce. Intended skill: intermediate. Strengths: a sweet, high-revving engine and a long-legged top speed. Weaknesses: narrow tyres, long braking, roll, front lift at speed. Targets: 0–100 about 6.5 s, about 265 km/h, about 0.95 g at 80 km/h. Bands: 0–100 5.6–7.6 s, top 250–285 km/h, 100–0 36–52 m, 0.85–1.1 g. Sound: `v12-na`. Body: gt, lip wing, round/round lamps, exhaust-rear, louvres. Events: none (open-world only).
* **RP-6 Desert Pickup (`rp6` v1, road).** High-performance pickup truck: 3.5 L twin-turbo V6, about 335 kW, 2650 kg, full-time four-wheel drive (40% forward through a clutch-pack centre, open front, locking rear), long-travel springs, 35-inch all-terrain tyres. Intended skill: novice. Strengths: goes anywhere, torque, the ride over rough ground. Weaknesses: mass, a very high centre of gravity and body roll, long braking, gearing-limited top speed. Targets: 0–100 about 6 s, about 180 km/h, about 0.85 g at 80 km/h. Bands: 0–100 5–7 s, top 170–190 km/h, 100–0 38–54 m, 0.75–0.98 g. Sound: `v6-turbo`. Body: truck, no wing, bar/twin lamps, lightbar, exhaust-rear, mudflaps. Events: none (open-world only).
* **RR-4 Rally-Bred Road Car (`rr4` v1, road).** Rally-bred road car (a homologation special): 2.5 L turbocharged flat-four, about 228 kW, 1600 kg, permanent four-wheel drive with a clutch-pack centre sending 41% forward, bonnet scoop and rear wing, six-speed. Intended skill: novice–intermediate. Strengths: traction on any surface, adjustable on the brakes, sturdy suspension. Weaknesses: turbo lag, understeer on power, modest top speed. Targets: 0–100 about 5 s, about 255 km/h, about 1.05 g at 80 km/h. Bands: 0–100 4.4–5.8 s, top 240–270 km/h, 100–0 32–42 m, 0.95–1.2 g. Sound: `flat4-turbo`. Body: saloon, pedestal wing, twin/twin lamps, bonnet-scoop, exhaust-rear, mudflaps. Events: none (open-world only).
* **LX-12 Luxury GT (`lx12` v1, road).** Luxury grand tourer: 5.2 L twin-turbo V12, about 470 kW and 900 N m, 2080 kg, rear drive with an electronic differential, eight-speed automatic, a long 2+2 cabin. Intended skill: novice. Strengths: effortless torque and top speed, stability. Weaknesses: mass in every corner, wheelspin from rest, long braking. Targets: 0–100 about 3.7 s, about 325 km/h, about 1.05 g at 80 km/h. Bands: 0–100 3.2–4.2 s, top 310–345 km/h, 100–0 32–40 m, 0.95–1.2 g. Sound: `v12-turbo`. Body: gt, ducktail wing, slim/strip lamps, exhaust-rear. Events: none (open-world only).
* **RD-2 Roadster (`rd2` v1, road).** Light front-mid-engined road roadster: 2.0 L naturally aspirated four, about 135 kW at 7000 rpm, 1110 kg, rear drive through a clutch-pack differential, six-speed manual, soft top. Intended skill: novice. Strengths: balance, steering feel, low running cost, easy drifts. Weaknesses: modest power and top speed, roll on road springs. Targets: 0–100 about 6.8 s, about 225 km/h, about 1.05 g at 80 km/h. Bands: 0–100 6–7.6 s, top 210–240 km/h, 100–0 32–42 m, 0.95–1.2 g. Sound: `i4-na`. Body: roadster, no wing, slim/strip lamps, exhaust-rear. Events: none (open-world only).
* **GP-R2 Prototype (`gpr2` v1, gp-bike).** A second prototype-class bike: inline-four
  "screamer" (about 216 kW at 16 500 rpm), 157 kg plus rider, a box wing low on a ducted fairing
  with more downforce (front share 70 %) and drag than GP-R1, seamless six-speed. Intended skill:
  expert. Strengths: front-end grip on the brakes and turn-in. Weaknesses: less low-rpm torque
  than the V4, top-end drag. Bands: 0–100 2.4–3.4 s, top 330–360 km/h, 100–0 30–42 m, 1.15–1.55 g.
  Sound: `i4-bike`. Body: full fairing, box wing, under-belly exhaust, lower screen. Events:
  `aurel-gp-prototype-pair`.
* **SS-600 Supersport (`ss600` v1, supersport).** 600 cc four, about 95 kW at 14 500 rpm, 175 kg,
  road-legal racing tyres (μ 1.55), quickshifter. Intended skill: novice–intermediate. Strengths:
  agility, corner speed. Weaknesses: needs revs, low top speed. Bands: 0–100 2.9–4.0 s, top
  250–280 km/h, 100–0 36–48 m, 1.05–1.4 g. Sound: `i4-bike`. Body: full fairing, twin slit lamps,
  short low can, taller screen. Events: `vellamar-supersport-sprint`.
* **NR-900 Naked Roadster (`nr900` v1, road-bike, open world only).** 890 cc triple, about 88 kW,
  182 kg, upright position (no tuck to speak of), road tyres (μ 1.3), lean limited by the pegs.
  Intended skill: novice. Strengths: torque, wheelie-limited launches, easy to place. Weaknesses:
  drag above 200 km/h, modest lean. Bands: 0–100 2.9–4.2 s, top 210–240 km/h, 100–0 36–50 m,
  0.9–1.2 g. Sound: `i3-bike`. Body: no fairing, round lamp, upright bar, trellis frame, stubby
  tail. Events: none (practice, qualifying and time trial only).
* **CR-750 Classic Racer (`cr750` v1, classic-bike).** A 1970s-style 750 cc two-stroke triple,
  about 75 kW in a narrow band, 160 kg, narrow treaded racing tyres (μ 1.25, crown 65 mm), lean
  limited to 0.9 rad, a single front disc and a rear drum (brake-limited, not stoppie-limited),
  twin shocks. Intended skill: intermediate–expert. Strengths: light, a top-end rush. Weaknesses:
  weak brakes, narrow power band, little lean. Bands: 0–100 3.2–4.6 s, top 230–265 km/h, 100–0
  40–56 m, 0.85–1.15 g. Sound: `two-stroke-bike`. Body: round-nosed fairing, double cradle, spoked
  wheels, three expansion chambers, hump seat, twin shocks. Events:
  `aurel-classic-motorcycle-sprint`.

Exteriors: every new car has its own body sheet; the generators gained a 1970s wedge and a 1980s
flat-bottom era for single-seaters (tall airbox and pylon wing; long pods and big low wing), kart
bodywork variants (compact nose, short pods, air cooling, enclosed bumper), a tube-frame buggy with
exposed long-travel arms, open-cockpit prototypes, laced wire wheels and five furniture extras (fan
shroud, dive planes, rally lamp pod, bonnet scoop, fender louvres). Road bikes have body sheets
(`src/rendering/bike-sheet.ts`: fairing, wings, lamps, exhaust, tail, bars, frame, wheels,
shocks); GP-R1 and SBK-1000 keep the original design. Silhouettes are measured, not asserted:
`tests/vehicle-bodies.test.ts` requires every pair of four-wheel bodies to differ by more than
0.075 m RMS in side and plan outline (closest pair TC-1/RR-4 at 0.080; TC-1/TC-2 of the first
catalogue is 0.088) and `tests/bike-bodies.test.ts` every pair of road bikes by more than 0.02 m
(closest GP-R1/SBK-1000 at 0.032). Ten new sound families (V6 NA and turbo, turbo five, straight-six
turbo, boxer-four turbo, flat-12, twin-turbo V12, fuel cell, bike triple, two-stroke triple);
every registered machine names its family explicitly (`explicitSoundFamily`).

Known limits (catalogue growth): all the limits listed for the first catalogue apply (no authored
assets, damage geometry or handling sign-off; Formula cockpit socket; per-car setup on the shared
screen). Further: the XF-2 fan is a constant suction with a seal fade — no fan power draw from the
main engine and no fan voice; FX-26 deploys its 350 kW to any speed (no deployment taper), so its
peak top speed is reached while the store lasts; electric and fuel-cell machines (RX-E, XE-1,
XH-3) draw energy from the fuel-mass proxy, and XH-3's stack is a static power map; historic tyres
differ from modern ones only by family grip and loose-surface share; BG-2 and RP-6 are travel-limited
like DX-8; DK-100 carries a nominal reverse ratio the validator requires (a direct-drive kart has
none) and brakes on the rear axle through a fixed bias outside the setup screen; the lateral-g
ramp of the laboratory ends at 72 % steering input, so FX-26, XE-1 and XF-2 report lower bounds;
every growth machine keeps at least 1.5 % of each band edge at both timesteps
(`tests/vehicle-catalogue-growth.test.ts`), and the machines closer than 3 % to an edge are listed
in the generated table below; FE-4 tops out at 208 km/h, 2 km/h under its brief's 210–230 km/h
(inside its 200–235 band), GT-6R at 291 km/h against its brief's 280–290, RH-3's launch beats its
brief (5.2 s against about 5.7 s: a front-drive launch on the shared traction control); turbo lag
(HF-86, GB-4, RR-4, PR-3) is a spool-time transient with no rpm × load boost map, its spool
threshold set below the ~2 200 rpm the shared clutch launch drags these engines to; in four-car AI
practice RS-5 and RM-8 still touch occasionally on Vellamar, and
loose-surface machines can still beach in a gravel trap as DX-8 and GS-4 already did; bike art
shares one rider and rider pose, CR-750's twin shocks are static; the naked roadster has no
festival region to ride in yet (the career files it under the festival, not the circuit motorcycle
ladder).

<!-- near-edge:begin (generated by npm run test:vehicles) -->
Metrics within 3 % of a band edge at either timestep (from `docs/vehicle-calibration.json`; † predates the catalogue growth and is frozen):

| Machine | Metric | Edge | Measured | Band edge | Margin |
|---|---|---|---:|---:|---:|
| APX-01 FORMULA † | top speed | floor | 320.5 km/h | 320 km/h | 0.17 % |
| RM-8 MUSCLE COUPE | 100–0 | floor | 32.52 m | 32 m | 1.64 % |
| RM-8 MUSCLE COUPE | top speed | ceiling | 295.0 km/h | 300 km/h | 1.67 % |
| RR-4 RALLY-BRED ROAD CAR | top speed | ceiling | 265.5 km/h | 270 km/h | 1.67 % |
| RP-6 DESERT PICKUP | top speed | ceiling | 186.8 km/h | 190 km/h | 1.68 % |
| RR-4 RALLY-BRED ROAD CAR | 100–0 | floor | 32.59 m | 32 m | 1.85 % |
| XT-1 TRACK HYPERCAR | g at 80 km/h | floor | 1.477 g | 1.45 g | 1.85 % |
| GS-6M MID-ENGINE GT SPORT | 100–0 | floor | 28.58 m | 28 m | 2.09 % |
| RS-5 SPORTS SEDAN | 100–0 | floor | 31.68 m | 31 m | 2.21 % |
| GT-6R REAR-ENGINE GT | 100–0 | floor | 24.58 m | 24 m | 2.41 % |
| GT-6R REAR-ENGINE GT | g at 80 km/h | floor | 1.332 g | 1.3 g | 2.43 % |
| HY-11 HYPERCAR | top speed | floor | 318.1 km/h | 310 km/h | 2.60 % |
| RS-5 SPORTS SEDAN | top speed | ceiling | 301.8 km/h | 310 km/h | 2.65 % |
| SP-71 LONG-TAIL PROTOTYPE | 100–0 | floor | 28.75 m | 28 m | 2.67 % |
| RD-2 ROADSTER | g at 80 km/h | ceiling | 1.167 g | 1.2 g | 2.78 % |
| TC-1 TOURING † | 0–100 | floor | 4.93 s | 4.8 s | 2.78 % |
| GT-10M MID-ENGINE GT † | g at 80 km/h | floor | 1.337 g | 1.3 g | 2.81 % |
| GS-4 GT SPORT † | 100–0 | floor | 28.81 m | 28 m | 2.89 % |
| TC-2 TOURING † | 0–100 | floor | 4.12 s | 4 s | 2.92 % |
| RD-2 ROADSTER | top speed | ceiling | 232.8 km/h | 240 km/h | 2.99 % |
<!-- near-edge:end -->

### 1.4 Destination catalogue (§10.1, 48 models)

| Family | Models | Delivery | Present |
|---|---:|---|---|
| Formula | 3 | car launch | 5 (APX-01, FX-26; feeder ladder JF-2, FR-3, FE-4) |
| GT | 4 | car launch | 6 (GT3: GT-8F, GT-10M, GT-6R, GT-6S; GT4: GS-4, GS-6M) |
| Touring | 3 | car launch | 3 (TC-1 front, TC-2 rear, TC-3 all-wheel drive) |
| Lightweight club | 2 | car launch | 3 (CR-1, HH-2; vintage VC-62) |
| Endurance prototype | 3 | circuit expansion | 4 (HY-9, HY-11, PR-2, PR-3) |
| Historic | 3 | circuit expansion | 4 (HF-67, HF-76, HF-86, SP-71) |
| Rally | 3 | dirt expansion | 3 (RL-2, RL-7, GB-4; the classes race the Pinewood special stage, the historic RL-7 and GB-4 also their own paved heats) |
| Rallycross | 3 | dirt expansion | 2 (RCX-6, RX-E; the class races the Kestrel joker heat) |
| Off-road truck/buggy | 3 | dirt expansion | 2 (DX-8, BG-2; limited suspension travel) |
| Kart | 2 | small-vehicle slice | 2 (SK-125, DK-100) |
| Road sport motorcycle | 3 | bike expansion | 3 (SBK-1000, SS-600, CR-750; procedural art) |
| Prototype GP-style motorcycle | 3 | bike expansion | 2 (GP-R1, GP-R2; procedural art) |
| Motocross | 4 | dirt-bike expansion | 2 (MX-450, MX-250; integrated, procedural art) |
| Supermoto | 3 | after bike/dirt gates | 1 (SM-450; integrated, procedural art) |
| Flat-track | 2 | after bike/dirt gates | 0 |
| Experimental | 4 | extreme expansion | 4 (XF-2 fan car, XE-1 electric time attack, XH-3 hydrogen concept, XT-1 track hypercar) |

"Present" means integrated (definition, calibration inside its bands at both timesteps, AI
envelope, procedural exterior with its own body sheet, explicit sound family, menu entry, class
ruleset and event where the class races); none of these meets the §1.1 definition of done (no
authored source assets, damage variants, recorded audio or sign-off). Counts: 48 cars, 6 road
motorcycles and 3 off-road motorcycles are registered (57 machines; 46 against the destination
families above). Eleven open-world machines sit outside the 48-model destination list: EH-3, SC-7, RH-3 hot hatch, RS-5
sports sedan, RM-8 muscle coupe, RG-63 classic grand tourer, RP-6 pickup, RR-4 rally-bred road
car, LX-12 luxury GT, RD-2 roadster and the NR-900 naked roadster bike (classes `road` and
`road-bike`: practice, qualifying and time trial, no circuit race).

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
