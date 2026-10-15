import os
os.chdir('/home/user/Experiment-3/.claude/worktrees/agent-ac7432dc5f9d804f3')

# ---------------------------------------------------------------- CONTENT_PIPELINE
p = 'docs/production/CONTENT_PIPELINE.md'
s = open(p).read()
old_tc1_tail = """100–0 ≈ 29 m, 1.30 g at 80 km/h; within design bands at both timesteps. Known limits: provisional
greybox exterior (`touring-shell.ts`), no interior, damage variants, LODs or own engine sound."""
new_tc1_tail = """100–0 ≈ 29 m, 1.30 g at 80 km/h; within design bands at both timesteps. Exterior: the procedural
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
path unchanged. Tyre families (`src/simulation/tire-families.ts`) tag slick, semi-slick, road,
cross-ply, gravel, all-terrain and kart compounds; only tagged tyres react to loose surfaces.

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
≈0.3–0.4 for GS-4 and SC-7; no engine-sound families (WP26) and no handling sign-off."""
assert old_tc1_tail in s
s = s.replace(old_tc1_tail, new_tc1_tail)

old_table = s[s.index('| Formula | 3 | car launch |'):s.index('| Road sport motorcycle |')]
new_table = """| Formula | 3 | car launch | 2 (APX-01, JF-2) |
| GT | 4 | car launch | 3 (GT-8F, GT-10M, GS-4) |
| Touring | 3 | car launch | 2 (TC-1, TC-2) |
| Lightweight club | 2 | car launch | 1 (CR-1) |
| Endurance prototype | 3 | circuit expansion | 2 (HY-9, PR-2) |
| Historic | 3 | circuit expansion | 1 (HF-67) |
| Rally | 3 | dirt expansion | 1 (RL-2; no dirt venue yet) |
| Rallycross | 3 | dirt expansion | 1 (RCX-6; no dirt venue yet) |
| Off-road truck/buggy | 3 | dirt expansion | 1 (DX-8; limited suspension travel) |
| Kart | 2 | small-vehicle slice | 1 (SK-125) |
"""
s = s.replace(old_table, new_table)
s = s.replace("""| Experimental | 4 | extreme expansion | 0 |
""", """| Experimental | 4 | extreme expansion | 0 |

"Present" means integrated (definition, calibration, AI envelope, procedural exterior, menu
entry); none of these meets the §1.1 definition of done (no audio identity, damage variants,
authored source assets or sign-off). Two road machines (EH-3, SC-7) exist outside the 48-model
destination list for open-world use.
""", 1)
open(p, 'w').write(s)

# ---------------------------------------------------------------- STATUS_REGISTER
q = 'docs/production/STATUS_REGISTER.md'
s = open(q).read()
old_row = "| TC-1 touring car (front drive) | integrated (provisional art) | `TOURING_TC1`, `docs/vehicle-calibration.json`, `src/rendering/touring-shell.ts` | Final exterior/interior, audio identity, handling sign-off (§10.2) | Vehicle gameplay |"
new_row = """| TC-1 touring car (front drive) | integrated (procedural art) | `TOURING_TC1`, `docs/vehicle-calibration.json`, `src/rendering/vehicle-bodies/` | Interior, audio identity, handling sign-off (§10.2) | Vehicle gameplay |
| Multi-class catalogue (15 machines) | integrated | `src/simulation/vehicle-catalogue/`, `tests/vehicle-catalogue.test.ts`, `docs/vehicle-calibration.json` | Per-class target review, audio, dirt venue, hardware/AI review of mixed grids | Vehicle gameplay |
| AWD and per-axle differentials | integrated | `src/simulation/differential.ts`, `tests/drivetrain.test.ts` | Human feel review on split-μ and loose surfaces | Physics lead |
| Procedural vehicle bodies (3 LODs + shadow proxy) | integrated | `src/rendering/vehicle-bodies/`, `tests/vehicle-bodies.test.ts` | Art-director review, LOD/material timings on reference hardware (§18.3) | Vehicle art |
| Class-grouped MACHINE menu and class events | integrated | `src/ui/machine-options.ts`, `src/simulation/catalogue-events.ts`, `tests/catalogue-menu-events.test.ts` | Controller/accessibility audit of the grouped list | Gameplay lead |"""
assert old_row in s
s = s.replace(old_row, new_row)
s = s.replace(
    "| WP17 | integrated | Calibration lab with design-brief bands and timestep drift. |",
    "| WP17 | integrated | Calibration lab with design-brief bands and timestep drift; AWD with centre split, open/LSD/locked axle differentials, tyre families. Every catalogue machine in band at both timesteps (APX-01 top speed 319.8 vs 320 km/h floor is a pre-existing exception). Human feel review open. |",
)
s = s.replace(
    "| WP18 | integrated (provisional) | TC-1 mechanics, AI, setup, snapshot identity; final art absent. |",
    "| WP18 | integrated (provisional) | TC-1 plus fifteen catalogue machines: mechanics, AI envelopes, setup limits, snapshot identity, procedural exteriors. Interiors, audio families, damage variants and sign-off absent. |",
)
s = s.replace(
    "| WP30 | absent | Twelve-car/six-venue scope. |",
    "| WP30 | integrated (partial) | Car side: 17 machines across 11 families with procedural bodies, class-grouped menu, multi-class endurance ruleset and GT/hypercar/touring/kart/rallycross events. Six-venue scope, dirt venue, audio and art acceptance open. |",
)
open(q, 'w').write(s)

# ---------------------------------------------------------------- ARCHITECTURE_SERVICES
r = 'docs/production/ARCHITECTURE_SERVICES.md'
s = open(r).read()
s = s.replace('`src/rendering`, `src/audio`, `TouringShells`', '`src/rendering`, `src/audio`, `VehicleBodies`')
open(r, 'w').write(s)
print('ok')
