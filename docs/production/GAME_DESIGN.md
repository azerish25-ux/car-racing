# Game design: one motorsport world, four disciplines

Scope document for the expansion from a Formula golden race into a multi-discipline game. It
extends masterplan §4–§5 and §11–§12; states and evidence live in `STATUS_REGISTER.md`. Every
mechanic below names the system that implements it, so design and code cannot drift apart.

## 1. Pillars

1. **Machines with honest physics.** Each family has its own dynamics adapter (four-wheel solver,
   two-wheel lean model, deformable-terrain contact). Assists help; they never change grip.
2. **Surfaces that matter.** Rubber, water, marbles, gravel, mud and ruts are authoritative state,
   recorded in replays and visible in presentation.
3. **Places worth travelling to.** Real-world-faithful circuits, original circuits, unconventional
   venues and an open festival region, each built through the same validated pipeline.
4. **Clear consequences.** Penalties, damage, rewards and record categories are explained on screen,
   with the numbers.

## 2. Disciplines

| Discipline | Machines (families) | Venues | Core skill | Session formats |
|---|---|---|---|---|
| **Circuit cars** | Formula, feeder and entry formula, historic formula (1960s, 1970s, 1980s turbo), historic sports prototype, hypercar/prototype, GT3, GT4, touring, club, vintage club, kart, experimental | real-world-faithful and original circuits | braking points, tyre and energy management, racecraft | practice, qualifying, sprint, grand prix, endurance (lap and timed), multi-class |
| **Road motorcycles** | GP prototype, superbike, supersport, classic racer (the road-only naked roadster rides in the festival) | circuits flagged bike-safe (run-off, kerb profile) where the class has passed a seeded race | lean angle, trail braking, body position, front/rear brake split | practice, qualifying, sprint, race |
| **Off-road** | motocross, rally, historic rally, rallycross, trophy truck, desert buggy | dirt/terrain venues, stages, rallycross mixed-surface | throttle on loose ground, jump take-off/landing, ruts and berms | motos, heats, stages, joker-lap rallycross |
| **Festival (open world)** | road supercars, electric hypercars, hot hatch, sports sedan, muscle coupe, classic grand tourer, pickup, rally-bred road car, luxury GT, roadster, naked roadster bike, plus any unlocked race machine | open festival region with road network | exploration, point-to-point, speed traps, drift zones | free roam, road race, sprint, speed zone, drift zone, showcase |

Disciplines share profile, input, garage, replay, photo, audio, accessibility and save systems.
They never share one tyre model, one progress algorithm or one rule set (masterplan §4.2).

## 3. Player journey

```text
first launch → calibration and accessibility → driving academy lesson 1 (circuit car)
  → paddock hub
     ├─ Circuit career  (club → touring/GT → formula ladder; or hypercar endurance)
     ├─ Bike career     (superbike → GP prototype)        unlocked by a bike licence
     ├─ Off-road career (rallycross / motocross / rally)  unlocked by an off-road licence
     ├─ Festival        (open region, events found by driving to them)
     └─ Quick race / time trial / championships / team HQ / photo
```

Each career ladder is a sequence of **licence tests → invitational events → championships**. A
licence teaches one skill at a time (braking, cornering, wet, lean, jump landing) and is scored by
measured skill (distance error at a braking marker, line deviation, landing pitch), never by finishing
position alone.

**Implemented (`src/career/`, CAREER in the paddock menu).** The four disciplines, their tiers and
every event are derived from the registries (`VEHICLES`, `CIRCUIT_IDS`, `RULESETS`, `EVENTS`, the
snapshot protocol) by `src/career/registry.ts` and `ladder.ts`: a machine's family comes from an
explicit `family` field, else its dynamics adapter, else its class; a discipline with no machine,
venue or race ruleset is shown **COMING** with the missing items listed, never hard-coded. With the
current catalogues, circuit cars and road bikes are open (the superbike and GP bike race under the
motorcycle ruleset; no circuit declares bike safety yet, so bike events use every paved circuit and
say so); off-road is open (see below) and festival is open: the Solvane region is registered as a
career venue (venue kind `festival`), so the road machines and the road-only motorcycle race there
(section 8.1).
Circuit-car tiers: club, vintage and touring → grand touring → Formula ladder (entry, feeder, junior,
the three historic eras, top tier) → endurance prototypes (incl. the historic sports prototype) →
unlimited experimental; bike and festival tiers exist as data and fill when their classes are
registered. A registered class that no tier names joins an automatic open tier.

**Off-road (implemented, WP37–WP42).** Tiers motocross and supercross (MX-450, MX-250, SM-450) →
rallycross (RCX-6, RX-E) → rally and trophy trucks (RL-2, DX-8, BG-2, and the historic RL-7 and
GB-4). A terrain venue names the classes it admits and the formats it is built for, so a tier only
races where its machines are admitted and an event takes the venue's own format (gate motos at
Valley Ridge and Arena Nord, the joker heat at Kestrel, the timed stage at Pinewood). The recovery
meeting and the jump-landing licence run on the MX-250 loaner at Valley Ridge; the authored off-road
events (two Valley Ridge motos, the Arena Nord main, a supermoto race, the Kestrel heat, the
Pinewood stage) appear in their tiers.

| Licence | Measured from the snapshot | Gold / silver / bronze | State |
|---|---|---|---|
| Braking marker | stopping distance from a marker at the end of the venue's longest straight, after a gate at 45 % of the machine's top speed | ≤ 1.5 / 4 / 8 m | integrated |
| Cornering line | mean distance from the AI racing line through the tightest named corner, at ≥ 62 % of the grip-limited corner speed; measured only on a lap still valid when the corner starts (an earlier breach waits for the next lap), and a track-limits breach inside the corner voids the attempt | ≤ 0.75 / 1.5 / 2.5 m | integrated |
| Wet control | peak body slide angle on a valid heavy-rain flying lap at ≥ 30 % of top speed; an invalid or slow lap is not measured and the next lap is another try | ≤ 4 / 7 / 11° | integrated |
| Lean and trail braking (bikes) | share of corner entry braking while leaned > 10°, lean read from the protocol v12 bike block (`BIKE_BASE + B.LEAN`) | ≥ 50 / 35 / 20 % | integrated: open with the registered superbike, scored from a real bike practice session in tests |
| Jump landing (off-road) | pitch error at touchdown in the surveyed landing zone, against that jump's declared landing slope (a venue's `jumps` entries with `takeoff`, `landing`, `landingLength` and `landingPitch`); touchdowns elsewhere are not scored | ≤ 3 / 6 / 10° | integrated: Valley Ridge declares six surveyed jumps; open on the MX-250 loaner |

Thresholds are provisional design targets: the production AI scores gold on the cornering, wet and
lean tests, so human calibration in the playtest protocol is the next step. Licences run solo on the
player's active machine or a loaned entry machine; attempts driven by the AI earn nothing.

## 4. Progression and economy

* **Credits** are earned by completion, improvement over the player's own previous result, clean
  racing (no penalties, low contact energy) and event objectives. Calculation is shown on the results
  screen (`rewardIncome`) and paid once per session id (idempotent, `paidSessions`).
* **Reputation** per discipline unlocks invitations; it is not spendable and cannot be bought.
* **Vehicles** are bought with credits or awarded by events. Prices follow class, not raw power. A
  reduced-stakes event series is always available so a broke player can recover.
* **Upgrades** change the `VehicleDefinition` (new hash and record category). Performance index per
  class keeps balance visible; restricted classes cap it.
* **No pay-to-win and no loot boxes.** Nothing that changes performance is sold.

**Implemented (`src/career/economy.ts`).** A career race pays the `rewardIncome` lines scaled by the
tier's pay rate, plus low contact (≤ 5 kJ absorbed, measured from the snapshot impact channel by
`ContactMeter`), improvement on the player's own best position and best lap at that event, and
objectives (podium; two places gained from a fifth-place start). The itemised lines are shown under
the classification and booked once per session id (`paidSessions`); AI-driven or unclassified
sessions are settled with nothing paid and the reason shown. Licence medals pay once per level.
Reputation is per discipline, capped at 100, earned only by results and medals. Prices follow class
(`CLASS_PRICES`; an unlisted class is priced by its tier). The dealership lists every registered
machine but sells only those that can race in this build: a machine whose discipline is coming, or
whose class no race ruleset admits, shows what is missing instead of a price button, and the purchase
is refused if requested directly. A championship win pays a bonus and awards the cheapest unowned
machine of the next tier, but only when every round was the player's own driving: AI-driven rounds
count in the table and are marked on the calendar, and a season with any of them earns no title,
bonus or prize (the results screen says so). A season keeps the calendar and the machine it started
with; changing the active machine never restarts it, and ending a season early is an explicit
ABANDON SEASON choice that names the rounds lost. The championship card lists the calendar (venue,
weather and laps of every round) and describes the round raced next. The **club meeting** (two laps, four cars, loaned
machine, quarter rates) is always open when a discipline has content, so a driver with no credits and
no machine can rebuild. Career sessions pay the career wallet, not the Team HQ ledger, which keeps
paying every other racing session. **Upgrades are not implemented**: the dealership sells stock
definitions only, because an upgrade must create a new `VehicleDefinition` hash and record category.

## 5. Garage, setup and tuning

Setup exposes only what a machine genuinely has (`setupFor`). Car: wings, ride height, springs,
dampers, anti-roll bars, camber/toe, brake bias, differential preload/ramp, gearing, tyre pressures.
Bike: preload, compression/rebound, steering damper, gearing, traction/wheelie/engine-brake maps.
Off-road: suspension travel and sag, tyre type. Every change shows its expected effect in plain
language and in telemetry.

**Implemented (`src/career/economy.ts`, Garage page).** Owned machines, one active machine per
discipline, and up to six setup presets per machine saved from the current GARAGE & SETTINGS values;
a preset stores only the machine's `setupKeys` (the `setupFor` keys) and the selected preset is the
setup of that machine's career sessions. Every non-default value is explained in plain language
(`SETUP_EFFECTS`). Bike and off-road setup parameters do not exist yet in `Setup`.

**Persistence (`src/career/save.ts`, `controller.ts`).** The career is one versioned save (`career`,
version 1, a migration table for later versions) written with `SaveStore.writeWithBackup`; the primary
and its backup are read and chosen with `recoverSave`. A corrupt primary falls back to the backup;
with neither usable a new career starts, the player is told, and the unreadable copy is kept under
`career:unreadable` before the first overwrite, so the backup rotation cannot discard it. A career
saved by a **newer build** is never overwritten: this build shows what it can read (an older backup,
else a new career), saves nothing and says so on the CAREER screen; the player may choose SAVE IN THIS
BUILD, which first copies the newer career to `career:newer`. If storage cannot be read at all, the
career is played for the session without saving. Every write carries a revision: a write first
re-reads the stored career and, when another tab has saved a different revision, applies the change
to that copy (so purchases, medals and rounds from both tabs survive); where the browser offers Web
Locks, writes from all tabs are also serialised. A first career is seeded once from existing saves:
Team HQ reputation above its founding value, classified `championship:v1` rounds, paid session ids and
the garage setup as a preset. The team and championship saves are never rewritten by the career.

**Festival discipline (integrated).** The career consumes the festival's typed results: each run
(`festival-result`, version 2, with a run id) is paid once — completion (races: plus rivals beaten),
new stars above your best, a first completion, a personal best and staying on the route, at the
machine's tier rate (the career's loaned machine at a quarter); reputation comes from new stars and
first completions only, at most two per star and one for completing an event. The loaned machine is
a car (the festival's own default machine), not the cheapest festival machine, and it is never saved
as the festival's machine. Loaned runs keep their own record: they are measured against every run of
the event, but a later run in your own machine is measured against your own-machine record only, so
borrowing never uses up an event's full-rate star, first-completion or reputation pay (a loaned run's
reputation, one at most, counts towards the event's total). Events unlock by kind (festival
reputation 0 for skill challenges and sprints, 6 road races, 12 circuits, 20 the showcase) and the
career sends you only to events you have discovered in free roam; the FESTIVAL tab lists every event
with its state, discovery and your best (stars with a text alternative). A run the autopilot drove,
an unfinished run, a machine not in your garage or a locked event pays nothing and is still recorded
as settled. A festival entered from SESSION select in a machine the career does not own is not a
career run: the career ignores it, writes nothing and shows nothing.

**Designed, not yet implemented.** Festival seasons; bike and off-road setup parameters; performance upgrades and a per-class performance
index; showing setup effects in telemetry (the plain-language hints exist); a choice of licence
venue (tests use the first
admitted venue); championship qualifying (career rounds start the player fifth); rival identity
across career seasons; one result identity shared with Team HQ (WP23). The full-application journey
(menu → career session → results) is covered by unit tests and a DOM-only browser test, not yet by a
rendered end-to-end run or a human playtest.

## 6. Racecraft and AI

AI uses the same physics and pedals as the player, layered strategic (2 Hz), tactical (12 Hz),
control (120 Hz). Passing is an explicit commitment with abort conditions (gap opening, lost closing
speed, defender covering before overlap, no safe lane) and a retry hysteresis (`TrafficPlanner`
pass state); defence is one early line choice per corner (`DefensiveLine`). Personalities vary
aggression, consistency, wet skill and tyre management, never grip. Bikes add lean-limited corner
speed; off-road AI adds surface-aware lines and jump speed control (implemented: line choice across
ruts by the terrain's `lineCost`, a straight line over jumps and whoops, a lip speed per feature kind
that lands on the landing face, a clear-or-roll decision locked where braking runs out, rolling under
a yellow flag, a flat-out launch from the gate; rally and rallycross cars brake for the grip of the
surface ahead and take one planned joker lap).

## 7. Rules and stewarding

Rulesets are data (`src/simulation/events.ts`): track limits, unsafe release, pit speed, mandatory
stops, energy deployment, DRS, timed classification, multi-class. Stewarding explains every penalty
with its consequence and how to avoid another. Bikes: long-lap penalty, track-limit warnings.
Off-road (implemented in `src/simulation/offroad/session.ts`, rules in `formats.ts`):

| Rule | Implemented | Designed, not implemented |
|---|---|---|
| Synchronised start gate | one release for every slot; a machine pushing the gate in the last 0.4 s or creeping into it is a jump start (the format's time penalty, judged by the format alone: the lights-phase check stands down for gate and stage-control starts); the AI is held until the drop; the holeshot is the first machine past the first-corner line; a field larger than the venue's slots widens the gate (sim and rendered gate alike) | gate-drop randomisation, a 30-second board |
| Gate pick | slots chosen in qualifying order, inside of the first corner first (`pickGates`) | a player-facing pick screen |
| Motos | moto points 25-22-20-18-16-15…1 and the combined classification of two motos (tie: the better last moto) as a tested function | a two-moto meeting session in the menu |
| Rallycross joker | a joker lap is the joker road's three checkpoints (a quarter, half and three quarters along it, where a turf island parts the roads) crossed on it in order; exactly one per heat, each missing or extra joker costs 30 s, applied as each car takes the flag (the last one included) | semi-finals and finals, joker on the first lap rules |
| Rally stage | staggered starts at the ruleset interval from a start control (the first starter waits there through the lights and goes on the green; the others are called 4 s before their start), a countdown on the HUD, a jump start at the control, two split checkpoints and the finish on the stage RouteGraph, a stop control and parking | a multi-stage rally with service parks and road sections |
| Course limits | a tape margin beyond the groomed width and berm faces count as track; track-limit warnings as for circuits | cutting by route progress, jump-landing contact rules |
| Recovery | a fallen rider remounts (shared bike sequence); a machine pinned against a wall is pushed out by the marshals | flagged marshal posts on the course |

## 8. Venue roster plan

| Group | Content | Purpose |
|---|---|---|
| Real-world-faithful | layouts approximating famous circuits from public geometry, neutral names until licensed: grand-prix circuits, motorcycle GP circuits (bike-safe), endurance mega-circuits (20.8 km forest ring, 13.6 km public-road circuit), street and night circuits | familiarity, benchmark comparisons |
| Original circuits | Aurel, Vellamar and new originals | identity, art-direction showcases |
| Unconventional | neon city with tunnels, alpine pass, high-banked oval, desert canyon, coastal cliffs, dockyard overpass, container-port night figure-eight, salt-flat airbase | spectacle, new racing problems |
| Off-road | motocross terrain parks, rallycross mixed surface, rally stages — implemented: Valley Ridge (outdoor motocross), Arena Nord (indoor supercross), Kestrel (rallycross), Pinewood (gravel stage) | discipline-specific skills |
| Festival region | open terrain with a road network, towns, mountain, coast, airfield | exploration and event discovery |

### 8.1 Festival region: implemented vs designed

Implemented (state **integrated**, details in [OPEN_WORLD.md](OPEN_WORLD.md)): the fictional
Solvane Coast region (8.19 km square; coast, Varda mountain, Ashvale valley, Port Ilse town,
Kestrel airfield, forests) with a 70.9 km road network of highways, country roads, mountain
switchbacks, town streets, dirt tracks and a runway. SESSION → *Festival · open world* (or CAREER →
FESTIVAL) starts free roam in any four-wheel registry machine except karts, any road motorcycle or
the supermoto (the bike adapter on the open-world surface). Physics reads the real surface everywhere through the
`OpenWorldTrack` adapter (soft boundaries, no laps); reset puts the car back on the nearest road.
Thirteen events are discovered by driving near their markers and start in place after a card:
road race, circuits built from road routes, sprints, speed traps, speed zones, drift zones scored
by `scoring.ts`, and a showcase against the fastest registry machine. Rivals follow the route with
the circuit AI's envelope; legal progress is `RouteProgress`, so shortcuts earn nothing. Each event
emits a typed `FestivalResult`, which the career pays once per run (section 4). Ambient traffic
(kinematic, deterministic, capped per tile, off during events, toggled in the festival menu) drives
the highways, country roads and towns; the player collides with it.

Designed, not implemented: knobby off-road machines in the region, seasons, traffic lane changes
and pedestrians, online free roam, photo challenges, destructible scenery.

## 9. Presentation

Broadcast cameras, replay director (events ranked explicitly), photo mode, radio with captions,
audio per powertrain family (`src/audio/sound-profiles.ts`), quality presets up to ULTRA (TAA, SSR,
motion blur, depth of field) with the default preset unchanged for existing players.

## 10. Accessibility

Captions with speaker, reduced motion, rumble strength, UI scale and safe area, colour-safe flags,
remappable controls, assists explained. Every timing-critical cue has a non-audio equivalent.

## 11. Online (staged)

Shared ghosts → private unranked lobbies → authoritative racing → rankings and leagues. The server
owns inputs, simulation, legal progress and results (`ARCHITECTURE_SERVICES.md`).

## 12. Acceptance

Content is "integrated" when it runs in normal sessions with tests; "accepted" only after the human
and hardware protocols in `HARDWARE_DEVICE_PLAYTEST_PROTOCOLS.md`. Licensed names, logos and
official series branding require licences and are not shipped without them.
