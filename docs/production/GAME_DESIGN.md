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

**Implemented (`src/career/`, CAREER in the paddock menu).** The four disciplines, their tiers and
every event are derived from the registries (`VEHICLES`, `CIRCUIT_IDS`, `RULESETS`, `EVENTS`, the
snapshot protocol) by `src/career/registry.ts` and `ladder.ts`: a machine's family comes from an
explicit `family` field, else its dynamics adapter, else its class; a discipline with no machine,
venue or race ruleset is shown **COMING** with the missing items listed, never hard-coded. Today
circuit cars are open; road bikes, off-road and festival are coming (no two-wheel machine, no dirt
venue, no festival region registered). Circuit-car tiers: club and touring → grand touring → Formula
ladder → endurance prototypes; bike, off-road and festival tiers exist as data and fill when their
classes are registered. A registered class that no tier names joins an automatic open tier.

| Licence | Measured from the snapshot | Gold / silver / bronze | State |
|---|---|---|---|
| Braking marker | stopping distance from a marker at the end of the venue's longest straight, after a gate at 45 % of the machine's top speed | ≤ 1.5 / 4 / 8 m | integrated |
| Cornering line | mean distance from the AI racing line through the tightest named corner, at ≥ 62 % of the grip-limited corner speed, track limits respected | ≤ 0.75 / 1.5 / 2.5 m | integrated |
| Wet control | peak body slide angle on a valid heavy-rain flying lap at ≥ 30 % of top speed | ≤ 4 / 7 / 11° | integrated |
| Lean and trail braking (bikes) | share of corner entry braking while leaned > 10° | ≥ 50 / 35 / 20 % | scorer tested; coming until a lean channel and a bike are registered |
| Jump landing (off-road) | pitch error at touchdown after ≥ 0.25 s airborne | ≤ 3 / 6 / 10° | scorer tested; coming until a venue declares surveyed jumps |

Thresholds are provisional design targets: the production AI scores gold on the cornering and wet
tests, so human calibration in the playtest protocol is the next step. Licences run solo on the
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
(`CLASS_PRICES`; an unlisted class is priced by its tier). A championship win pays a bonus and awards
the cheapest unowned machine of the next tier. The **club meeting** (two laps, four cars, loaned
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

**Persistence (`src/career/save.ts`).** The career is one versioned save (`career`, version 1, a
migration table for later versions) written with `SaveStore.writeWithBackup` and read with
`readRecovered`: a corrupt or newer primary falls back to the backup, and with neither usable a new
career starts and the player is told. A first career is seeded once from existing saves: Team HQ
reputation above its founding value, classified `championship:v1` rounds, paid session ids and the
garage setup as a preset. The team and championship saves are never rewritten by the career.

**Designed, not yet implemented.** Festival free roam and events found by driving to them; bike and
off-road setup parameters; performance upgrades and a per-class performance index; showing setup
effects in telemetry (the plain-language hints exist); a choice of licence venue (tests use the first
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
