import re
# ---------------- STATUS_REGISTER
p='docs/production/STATUS_REGISTER.md'
s=open(p).read()
def rep(old,new):
    global s
    assert s.count(old)==1, old[:70]
    s=s.replace(old,new,1)
rep("""| WP37–WP38 | prototype | Terrain tiles with checkpoints. |
| WP39–WP41 | absent | Dirt bike, AI lines, motocross slice. |
| WP42 | prototype | Stage/joker classification on RouteGraph. |""","""| WP37 | integrated (procedural art) | Dirt bikes on the bike adapter (`src/simulation/offroad/dirt-bike-vehicle.ts`): MX-450 four-stroke, MX-250 two-stroke and SM-450 supermoto with ~300 mm travel, a 2-DOF sprung chassis (rising-rate springs, digressive damping, bump stop), knobby/supermoto tyre families on the surface-material model, ballistic flight with body and rear-wheel (throttle / rear brake) pitch control, landing judgement (pitch error, impact, bottoming → clean / bottomed / crash), standing pose and foot dab in the snapshot (protocol v13 off-road block). Calibration bands in `npm run test:offroad` (`docs/offroad-calibration.json`: 0–60 m from the gate, flight distance against the ballistic distance, landing windows, rolling); asphalt runway bands in `docs/vehicle-calibration.json`. Human feel review, hardware and audio open. |
| WP38 | integrated | Session-scale deformable course terrain (`course-terrain.ts`, a `TerrainTile` in the Track frame: 0.25 m × 0.5 m cells, soil kind and moisture per cell, session wetness): every loaded contact patch ruts and compacts in a fixed order; ruts change grip and rolling resistance and the AI's `lineCost`; reset per session; identical across runs and after a flashback re-simulation (`tests/offroad.test.ts`). The worker exports rut deltas with each surface keyframe for the renderer and replays. No relaxation inside a session (a course is re-prepared between motos); no network delta format. |
| WP39 | integrated (procedural art) | Four original terrain venues in the catalogue builder (`venues.ts`): Valley Ridge outdoor motocross (start-gate straight, tabletops, doubles, a triple, whoops, rollers, berms), Arena Nord indoor supercross (night, tight, triple rhythm lane, whoops), Kestrel rallycross (asphalt and gravel, joker road) and Pinewood gravel special stage (point to point with two splits). Surveyed jumps feed the landing licence; `npm run validate:content` passes. Art beyond the procedural venue kit, human laps and performance captures open. |
| WP40 | integrated | Off-road AI (`src/simulation/offroad/ai.ts`): dirt-bike line choice across ruts and berms by `lineCost`, straight lines over jumps and whoops, jump speed control (hold speed for the landing face measured per feature kind, a clear/roll decision locked where braking runs out, rolling over gap jumps after a fall), gate launch, crash recovery and marshal push-out; rally and rallycross car AI with surface-ahead grip envelopes, crest caps and a planned joker lap. Seeded races with bounded crashes in `npm run test:offroad` (`docs/offroad-races.json`). Not tuned against human riders; overtaking is the shared race craft. |
| WP41 | integrated (partial) | Motocross / supercross slice in player sessions: menu machines, gate start, terrain mesh with ruts and moisture, roost, mud coat, dirt-bike model and standing rider, start gate, stadium bowl, off-road HUD line, career tier. Slice acceptance (players, hardware, art, audio) open; nothing accepted. |
| WP42 | integrated | Formats on the off-road session (`session.ts`, `formats.ts`): two-moto meetings with moto points and combined classification, gate pick by qualifying order, synchronised gate with jump-start detection and the holeshot (D049), rallycross heats with exactly one joker lap enforced at the flag, rally stages with staggered starts, splits on the stage RouteGraph, a stop control and parking. Rulesets and events registered; the career's off-road discipline (motocross, rallycross, rally tiers) opens from the registry. The two-moto meeting is a classification function, not yet a menu session. |""")
rep("""| WP25 | integrated (partial) | Licence tests per vehicle family: circuit-car braking, cornering and wet and the bike lean licence are reachable from CAREER and scored from snapshots; the off-road landing scorer is a prototype until a dirt venue declares a surveyed jump. |""","""| WP25 | integrated (partial) | Licence tests per vehicle family: circuit-car braking, cornering and wet, the bike lean licence and the off-road jump-landing licence (surveyed jumps at Valley Ridge, on the MX-250 loaner) are reachable from CAREER and scored from snapshots. |""")
# features table: add rows after the per-entry definitions? find the features table end (before ## 2.)
idx=s.index("\n## 2. Work packages")
rows="""| Off-road dirt bikes (MX-450, MX-250, SM-450) | integrated (procedural art) | `src/simulation/offroad/dirt-bike-vehicle.ts`, `dirt-bikes.ts`, `tests/offroad.test.ts`, `docs/offroad-calibration.json` | Human feel review of flight and landing; audio identity | Physics lead |
| Deformable course terrain | integrated | `src/simulation/offroad/course-terrain.ts`, `src/rendering/offroad/terrain-view.ts`, `tests/offroad.test.ts` | Hardware capture of the terrain mesh update cost | Physics lead |
| Off-road venues and formats | integrated (procedural art) | `src/simulation/offroad/venues.ts`, `session.ts`, `formats.ts`, `docs/offroad-races.json` | Human motos and heats; art pass on the venues | Game design |
"""
# insert rows at end of features table: find last table line before idx
before=s[:idx].rstrip('\n')
s=before+"\n"+rows+s[idx:]
open(p,'w').write(s)

# ---------------- DETAILS
p='docs/production/DETAILS_D001_D100.md'
s=open(p).read()
old_start=s.index("## 19.4 Rider and motorcycle (prototype model only)")
old_end=s.index("## 19.6 Weather and atmosphere")
new="""## 19.4 Rider and motorcycle

| ID | Detail | State | Evidence / next |
|---|---|---|---|
| D031 | Tuck follows speed/state | integrated (procedural art) | rider pose reads `B.TUCK` from the snapshot (`rider.ts` `ride()`); off-road riders sit up instead; next: onboard review |
| D032 | Hands on bars | integrated (procedural art) | two-bone IK to the steered grips every frame (`bike.ts`, `dirt-bike-model.ts`) |
| D033 | Boots on pegs | integrated (procedural art) | two-bone IK to the pegs; a dabbed foot leaves its peg (D043) |
| D034 | Mass shift has matching pose | integrated (procedural art) | hang-off from `B.RIDER_OFFSET`; off-road body fore/aft from `O.BODY` |
| D035 | Fork compression on braking | integrated | fork lowers slide with the recorded `B.FORK`; dirt bikes show their full ~300 mm stroke |
| D036 | Chain follows drive state | absent | chain runs are static geometry |
| D037 | Knee/boot scrape needs contact | absent | slider pucks are drawn; no contact effect |
| D038 | Stable optional horizon | absent | chase roll is a fixed fraction of lean (`BIKE_CHASE_ROLL`); no player option |
| D039 | Crash keeps rider/bike identity | integrated | one `BikeVehicle` owns crash → separated → remount, reported to race control; dirt bikes add landing crashes |
| D040 | Remount and control return agree | integrated | inputs ignored until remount completes (`tests/bike.test.ts`) |

## 19.5 Dirt and jumps

| ID | Detail | State | Evidence / next |
|---|---|---|---|
| D041 | Roost follows rear contact/slip | integrated (presentation) | `src/rendering/offroad/roost.ts` emits from driven wheels by recorded load, slip and surface; never written back to the soil (by design) |
| D042 | Mud by exposed region | integrated (procedural art) | per-entrant `O.MUD` coat (`mud.ts`) heavier on low parts; dry dust vs wet mud by `O.MOISTURE`; next: art review of coverage |
| D043 | Standing pose for rough sections | integrated (procedural art) | `O.STANDING` (whoops, rollers, jump faces, flight) and `O.DAB` drive the rider (`rider.ts`) |
| D044 | Suspension bottoming visible | foundation | full fork/shock stroke is shown and `O.BOTTOM` is recorded; no dedicated visual or audio cue |
| D045 | Rut edges influence lines | integrated | physics ruts change grip; dirt-bike AI chooses lines by `lineCost()` |
| D046 | Wet vs dry berm | integrated | moisture term in soil contact grip and softness; rain soaks the session soil |
| D047 | Airborne audio stops on lift-off | absent | airborne state is in the snapshot (`O.AIRBORNE`); audio not wired (WP47) |
| D048 | Landing effects at contacting wheel | foundation | landing record (pitch error, impact speed) in `O.LANDING_*`; no landing effect drawn |
| D049 | Start gate synchronized | integrated | one release for every slot, jump-start detection (`session.ts`, `tests/offroad.test.ts`); hinged gate model falls from race time (`start-gate.ts`) |
| D050 | Track reset restores whole terrain | integrated | a new session resets the course terrain; the worker's first keyframe replaces the rendered field (`terrain-view.ts`) |

"""
s=s[:old_start]+new+s[old_end:]
open(p,'w').write(s)

# ---------------- CONTENT_PIPELINE
p='docs/production/CONTENT_PIPELINE.md'
s=open(p).read()
for old,new in [
  ("| Rally | 3 | dirt expansion | 1 (RL-2; no dirt venue yet) |","| Rally | 3 | dirt expansion | 1 (RL-2; races the Pinewood special stage) |"),
  ("| Rallycross | 3 | dirt expansion | 1 (RCX-6; no dirt venue yet) |","| Rallycross | 3 | dirt expansion | 1 (RCX-6; races the Kestrel joker heat) |"),
  ("| Motocross | 4 | dirt-bike expansion | 0 |","| Motocross | 4 | dirt-bike expansion | 2 (MX-450, MX-250; integrated, procedural art) |"),
  ("| Supermoto | 3 | after bike/dirt gates | 0 |","| Supermoto | 3 | after bike/dirt gates | 1 (SM-450; integrated, procedural art) |"),
]:
    assert old in s, old
    s=s.replace(old,new)
old="""Catalogue layouts C01–C12 (20 layouts, [roster and limits](../CIRCUIT_CATALOGUE.md)) have passed the"""
new="""**Terrain venues (WP39).** Four original off-road venues are built with the same layout builder plus
a course description (`src/simulation/offroad/venues.ts`): a longitudinal jump profile with surveyed
take-off and landing faces, berms on the outside of turns, whoops/rollers, soil zones and a
deformable terrain band. Valley Ridge (outdoor motocross: gate straight, 2 tabletops, 2 doubles, a
triple, a kicker, whoops, rollers), Arena Nord (indoor supercross at night: triple rhythm lane, double,
tabletop, whoops, finish triple), Kestrel (rallycross: asphalt start and finish, gravel loop, crest,
joker road) and Pinewood (gravel special stage, ~2.8 km, three crests, two splits). Each passes
`validate:content`, has seeded AI races in `docs/offroad-races.json` and admits only its machine
classes (motorcycles at motocross/supercross, cars at rallycross/stages). Not done: art pass beyond
the procedural venue kit, human races, performance capture, §15.3 approval.

Catalogue layouts C01–C12 (20 layouts, [roster and limits](../CIRCUIT_CATALOGUE.md)) have passed the"""
assert old in s; s=s.replace(old,new)
open(p,'w').write(s)
