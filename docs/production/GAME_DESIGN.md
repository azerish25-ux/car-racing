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
| **Circuit cars** | Formula, junior formula, historic formula, hypercar/prototype, GT3, GT4, touring, club, kart | real-world-faithful and original circuits | braking points, tyre and energy management, racecraft | practice, qualifying, sprint, grand prix, endurance (lap and timed), multi-class |
| **Road motorcycles** | GP prototype, superbike | circuits flagged bike-safe (run-off, kerb profile) | lean angle, trail braking, body position, front/rear brake split | practice, qualifying, sprint, race |
| **Off-road** | motocross, rally, rallycross, trophy truck | dirt/terrain venues, stages, rallycross mixed-surface | throttle on loose ground, jump take-off/landing, ruts and berms | motos, heats, stages, joker-lap rallycross |
| **Festival (open world)** | road supercars, electric hypercars, plus any unlocked race machine | open festival region with road network | exploration, point-to-point, speed traps, drift zones | free roam, road race, sprint, speed zone, drift zone, showcase |

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

## 5. Garage, setup and tuning

Setup exposes only what a machine genuinely has (`setupFor`). Car: wings, ride height, springs,
dampers, anti-roll bars, camber/toe, brake bias, differential preload/ramp, gearing, tyre pressures.
Bike: preload, compression/rebound, steering damper, gearing, traction/wheelie/engine-brake maps.
Off-road: suspension travel and sag, tyre type. Every change shows its expected effect in plain
language and in telemetry.

## 6. Racecraft and AI

AI uses the same physics and pedals as the player, layered strategic (2 Hz), tactical (12 Hz),
control (120 Hz). Passing is an explicit commitment with abort conditions (gap opening, lost closing
speed, defender covering before overlap, no safe lane) and a retry hysteresis (`TrafficPlanner`
pass state); defence is one early line choice per corner (`DefensiveLine`). Personalities vary
aggression, consistency, wet skill and tyre management, never grip. Bikes add lean-limited corner
speed; off-road AI adds surface-aware lines and jump speed control.

## 7. Rules and stewarding

Rulesets are data (`src/simulation/events.ts`): track limits, unsafe release, pit speed, mandatory
stops, energy deployment, DRS, timed classification, multi-class. Stewarding explains every penalty
with its consequence and how to avoid another. Bikes: long-lap penalty, track-limit warnings.
Off-road: course cutting by route progress (RouteProgress), jump-landing contact rules.

## 8. Venue roster plan

| Group | Content | Purpose |
|---|---|---|
| Real-world-faithful | layouts approximating famous circuits from public geometry, neutral names until licensed | familiarity, benchmark comparisons |
| Original circuits | Aurel, Vellamar and new originals | identity, art-direction showcases |
| Unconventional | neon city with tunnels, alpine pass, high-banked oval, desert canyon, coastal cliffs, dockyard overpass | spectacle, new racing problems |
| Off-road | motocross terrain parks, rallycross mixed surface, rally stages | discipline-specific skills |
| Festival region | open terrain with a road network, towns, mountain, coast, airfield | exploration and event discovery |

### 8.1 Festival region: implemented vs designed

Implemented (state **integrated**, details in [OPEN_WORLD.md](OPEN_WORLD.md)): the fictional
Solvane Coast region (8.19 km square; coast, Varda mountain, Ashvale valley, Port Ilse town,
Kestrel airfield, forests) with a 70.9 km road network of highways, country roads, mountain
switchbacks, town streets, dirt tracks and a runway. SESSION → *Festival · open world* starts free
roam in any four-wheel registry machine. Physics reads the real surface everywhere through the
`OpenWorldTrack` adapter (soft boundaries, no laps); reset puts the car back on the nearest road.
Thirteen events are discovered by driving near their markers and start in place after a card:
road race, circuits built from road routes, sprints, speed traps, speed zones, drift zones scored
by `scoring.ts`, and a showcase against the fastest registry machine. Rivals follow the route with
the circuit AI's envelope; legal progress is `RouteProgress`, so shortcuts earn nothing. Each event
emits a typed `FestivalResult` for the career hook.

Designed, not implemented: ambient traffic, festival career and reputation (results are emitted,
not consumed), motorcycles and off-road machines in the region, seasons,
online free roam, photo challenges, destructible scenery.

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
