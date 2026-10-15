p='docs/production/GAME_DESIGN.md'
s=open(p).read()
def rep(old,new):
    global s
    assert s.count(old)==1, old[:70]
    s=s.replace(old,new,1)
rep("""say so); off-road is coming (rally, rallycross and off-road machines exist, no dirt venue does) and
festival is coming (road machines exist, no region does). Circuit-car tiers: club and touring →
grand touring → Formula ladder → endurance prototypes; bike, off-road and festival tiers exist as data
and fill when their classes are registered. A registered class that no tier names joins an automatic
open tier.""","""say so); off-road is open (see below) and festival is coming (road machines exist, no region
does). Circuit-car tiers: club and touring → grand touring → Formula ladder → endurance prototypes;
bike and festival tiers exist as data and fill when their classes are registered. A registered class
that no tier names joins an automatic open tier.

**Off-road (implemented, WP37–WP42).** Tiers motocross and supercross (MX-450, MX-250, SM-450) →
rallycross (RCX-6) → rally and trophy trucks (RL-2, DX-8). A terrain venue names the classes it
admits and the formats it is built for, so a tier only races where its machines are admitted and an
event takes the venue's own format (gate motos at Valley Ridge and Arena Nord, the joker heat at
Kestrel, the timed stage at Pinewood). The recovery meeting and the jump-landing licence run on the
MX-250 loaner at Valley Ridge; the authored off-road events (two Valley Ridge motos, the Arena Nord
main, a supermoto race, the Kestrel heat, the Pinewood stage) appear in their tiers.""")
rep("""| Jump landing (off-road) | pitch error at touchdown in the surveyed landing zone, against that jump's declared landing slope (a venue's `jumps` entries with `takeoff`, `landing`, `landingLength` and `landingPitch`); touchdowns elsewhere are not scored | ≤ 3 / 6 / 10° | scorer tested; coming until a dirt venue declares a surveyed jump |""","""| Jump landing (off-road) | pitch error at touchdown in the surveyed landing zone, against that jump's declared landing slope (a venue's `jumps` entries with `takeoff`, `landing`, `landingLength` and `landingPitch`); touchdowns elsewhere are not scored | ≤ 3 / 6 / 10° | integrated: Valley Ridge declares six surveyed jumps; open on the MX-250 loaner |""")
rep("""Off-road: course cutting by route progress (RouteProgress), jump-landing contact rules.""","""Off-road (implemented in `src/simulation/offroad/session.ts`, rules in `formats.ts`):

| Rule | Implemented | Designed, not implemented |
|---|---|---|
| Synchronised start gate | one release for every slot; a machine pushing the gate in the last 0.4 s or creeping into it is a jump start (time penalty); the AI is held until the drop; the holeshot is the first machine past the first-corner line | gate-drop randomisation, a 30-second board |
| Gate pick | slots chosen in qualifying order, inside of the first corner first (`pickGates`) | a player-facing pick screen |
| Motos | moto points 25-22-20-18-16-15…1 and the combined classification of two motos (tie: the better last moto) as a tested function | a two-moto meeting session in the menu |
| Rallycross joker | the joker is counted at the joker road's timing line; exactly one per heat, each missing or extra joker costs 30 s at the flag | semi-finals and finals, joker on the first lap rules |
| Rally stage | staggered starts at the ruleset interval from a start control, a jump start at the control, two split checkpoints and the finish on the stage RouteGraph, a stop control and parking | a multi-stage rally with service parks and road sections |
| Course limits | a tape margin beyond the groomed width and berm faces count as track; track-limit warnings as for circuits | cutting by route progress, jump-landing contact rules |
| Recovery | a fallen rider remounts (shared bike sequence); a machine pinned against a wall is pushed out by the marshals | flagged marshal posts on the course |""")
rep("""speed; off-road AI adds surface-aware lines and jump speed control.""","""speed; off-road AI adds surface-aware lines and jump speed control (implemented: line choice across
ruts by the terrain's `lineCost`, a straight line over jumps and whoops, a lip speed per feature kind
that lands on the landing face, a clear-or-roll decision locked where braking runs out, rolling under
a yellow flag, a flat-out launch from the gate; rally and rallycross cars brake for the grip of the
surface ahead and take one planned joker lap).""")
rep("""| Off-road | motocross terrain parks, rallycross mixed surface, rally stages | discipline-specific skills |""","""| Off-road | motocross terrain parks, rallycross mixed surface, rally stages — implemented: Valley Ridge (outdoor motocross), Arena Nord (indoor supercross), Kestrel (rallycross), Pinewood (gravel stage) | discipline-specific skills |""")
open(p,'w').write(s)

p='docs/production/PHYSICS_MODEL.md'
s=open(p).read()
s=s.rstrip('\n')+"""

## Off-road machines and terrain (WP37–WP38)

**Dirt bikes** (`src/simulation/offroad/dirt-bike-vehicle.ts`) run the shared two-wheel core
(lean, steer, tyre forces, rider aids) with a vertical model of their own: a 2-DOF sprung chassis
(heave and pitch) over the two contact patches, rising-rate springs (`k·c·(1 + p·(c/T)²)`),
digressive damping with harder rebound, and a stiff, lossy bump stop whose shaft speed is the
bottoming measure. Longitudinal tyre forces pitch the chassis (squat and dive). Take-off is
detected when both wheels stay unloaded for three substeps; the flight is ballistic at the plan-view
speed of the face the rear wheel left, with drag, and the chassis pitch is the integral of the body
torque (rider fore/aft) and the rear wheel's spin reaction (throttle spins it up and pitches the nose
up, the rear brake stops it and pitches the nose down). The AI's (and the Sport aid's) pitch control
aims a little nose-up of the predicted landing slope. A touchdown is judged once: a nose-down or
nose-up error beyond the machine's limits with a real impact crashes, and the bump-stop shaft speed
over the first quarter second bottoms (a speed loss) or crashes. Hops at walking pace are never
judged on pitch. Calibration: 0–60 m from the gate, the flight distance against the ballistic
distance of the measured take-off speed (0.85–1.15) and the landing windows per surveyed jump
(`npm run test:offroad`, `docs/offroad-calibration.json`); asphalt runway bands in
`docs/vehicle-calibration.json` (acceleration is wheelie-limited with a 0.86 m combined CG).

**Course terrain** (`course-terrain.ts`) is a `TerrainTile` laid in the Track frame (columns across,
rows along the lap; 0.25 m × 0.5 m) over a band around the course. The base height is the Track's
cross-section plus the static relief (the jump profile with faded sides, berms on the outside of
turns, the joker island, braking chop). Every loaded contact patch, in fixed entrant and wheel
order, depresses and compacts its cell (and half as much each side): sinkage grows with load, slip,
moisture and the soil's softness and falls as the cell compacts. Contact reads the deformed height
and normal, soil friction with compaction and moisture terms, and bulldozing resistance from the rut
depth; asphalt cells never deform. Session wetness rises with rain and falls in dry, sunny air.
Determinism: the field is a pure function of the step sequence (identical across runs and after a
flashback re-simulation; `hash()` fingerprints it). No relaxation runs inside a session; a new
session starts on prepared ground.
"""
open(p,'w').write(s+"\n")
