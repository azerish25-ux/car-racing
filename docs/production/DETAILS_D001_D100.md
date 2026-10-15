# One hundred small details — status register

Masterplan §19. States as in `STATUS_REGISTER.md`. "foundation" means the authoritative state exists
(in snapshots or simulation) but its presentation or acceptance observation has not been reviewed.
Evidence paths are starting points, not acceptance. **Next** is the smallest step that would produce
the acceptance observation. Nothing below is player-accepted.

## 19.1 Vehicle mechanics

| ID | Detail | State | Evidence / next |
|---|---|---|---|
| D001 | Tyre contact follows load and travel | integrated | wheel `COMPRESSION`/`LENGTH` drive wheel pivots (`car.ts`); next: kerb-strike capture |
| D002 | Brake-disc thermal appearance | integrated | disc emissive follows recorded `W.DISC_TEMP` (`car.ts`), so it cools with the physics; TC-1 provisional body has no discs |
| D003 | Steering wheel matches steering | integrated | supplied rig `driverPose().wheelRadians`; next: both-lock clip review |
| D004 | Aero surfaces show DRS/damage state | integrated | `R.DRS_FLAP`, health fields in replay |
| D005 | Body pitch from acceleration/braking | integrated | rigid-body pitch in snapshot; next: camera-only-pitch audit |
| D006 | Gear shift interrupts motion/sound | integrated | `shiftClock` torque cut; audio layers; next: event-window capture |
| D007 | Powertrain-appropriate exhaust/electric cues | integrated | per-family synthesis (`sound-profiles.ts`): turbo only where fitted, crackle by family, electric motor whine; next: listening test |
| D008 | Broken parts stay broken | integrated | health/detached state in snapshots |
| D009 | Debris bounded lifetime/collision policy | integrated | `DebrisPool` (fixed 4 pieces/car) |
| D010 | Lights obey class/event rules | foundation | rain light from brake input; headlight rules per class absent |

## 19.2 Tyres and road contact

| ID | Detail | State | Evidence / next |
|---|---|---|---|
| D011 | Flat-spot feedback | foundation | `W.FLAT`, radius modulation; vibration/sound strength review |
| D012 | Dirt pickup and clearing | integrated | `W.DIRT` history in tyre model |
| D013 | Marbles where deposited | integrated | track marble field + `MARBLE_PICKUP_*` |
| D014 | Squeal by slip and surface | integrated | `src/audio/surface-audio.ts`: asphalt, grass, gravel, kerb and (terrain/open-world material ids) dirt, mud, sand and snow layers; slip on loose ground throws soil instead of squealing (`tests/airborne-audio.test.ts`); next: per-material listening test |
| D015 | Kerb vs rough asphalt | integrated | `W.SURFACE` per wheel, kerb heights |
| D016 | Wet trails from tyres | integrated | per-wheel spray/trail emitters; next: capture |
| D017 | Wheel rotation stable at replay speeds | foundation | `W.ROTATION` recorded; next: ¼× replay review |
| D018 | Puncture ride height coherent | integrated | `W.RADIUS` 0.77× when punctured, shared by physics and presentation |
| D019 | Lockup smoke from locking contact | foundation | per-wheel slip available; next: per-wheel emitter audit |
| D020 | Per-wheel surface transitions | integrated | per-wheel `W.SURFACE` |

## 19.3 Cockpit and controls

| ID | Detail | State | Evidence / next |
|---|---|---|---|
| D021 | Instruments agree with HUD | integrated | both read the same snapshot (`drawSteeringDisplay`) |
| D022 | Night instrument brightness adjustable | absent | next: brightness setting |
| D023 | Mirrors useful in close racing | integrated | mirror quality setting; next: close-racing capture |
| D024 | Seat/eye position preference | partial | `cockpitFov` setting; eye position absent |
| D025 | Look left/right/rear on controller | foundation | look offsets exist (`lookX`); controller binding audit |
| D026 | Prompts follow active device | foundation | device selection exists; prompt audit open |
| D027 | Clutch/shift explain unavailable actions | partial | shift blocked above limiter silently — next: HUD reason |
| D028 | Wipers match rain/vehicle | absent | no closed-cockpit vehicle has wiper geometry yet |
| D029 | Restrained cockpit reflections | foundation | review in capture suite |
| D030 | Pause/disconnect removes stale inputs | integrated | input sanitation + disconnect handling (`src/input/controller.ts`) |

## 19.4 Rider and motorcycle

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
| D044 | Suspension bottoming visible | foundation | full fork/shock stroke is shown and `O.BOTTOM` is recorded; a bump-stop clack plays as it rises (`surface-audio.ts`); no dedicated visual cue |
| D045 | Rut edges influence lines | integrated | physics ruts change grip; dirt-bike AI chooses lines by `lineCost()` |
| D046 | Wet vs dry berm | integrated | moisture term in soil contact grip and softness; rain soaks the session soil |
| D047 | Airborne audio stops on lift-off | integrated | unloaded wheels make no ground sound; with `O.AIRBORNE` (dirt bikes, cars on terrain venues) the engine voices and power-unit layers unload to a quarter of their load while the revs follow the free-spinning wheel (`src/audio/airborne-audio.ts`, `tests/airborne-audio.test.ts`); next: listening test |
| D048 | Landing effects at contacting wheel | foundation | landing record (pitch error, impact speed) in `O.LANDING_*`; a touchdown thump scaled by the impact speed plays on the contact bus (`landingThump`); no landing effect drawn |
| D049 | Start gate synchronized | integrated | one release for every slot, jump-start detection judged once by the format (`session.ts`, `tests/offroad.test.ts`); hinged gate model falls from race time and has a panel for every rider the session lines up (`start-gate.ts`) |
| D050 | Track reset restores whole terrain | integrated | a new session resets the course terrain; the worker's first keyframe replaces the rendered field (`terrain-view.ts`) |

## 19.6 Weather and atmosphere

| ID | Detail | State | Evidence / next |
|---|---|---|---|
| D051 | Rain begins/ends progressively | integrated | `WeatherTimeline` keyframes |
| D052 | Standing water in plausible places | integrated | drainage field (`surface-drainage.ts`) |
| D053 | Drying line where traffic acts | integrated | `Track.interact` clears water under rolling load |
| D054 | Spray follows speed/tyres/water | integrated | per-wheel water and speed |
| D055 | Consistent wind on flags/particles | integrated | `H.WIND_X/Z` single source |
| D056 | Tunnels block rainfall | absent | no tunnels exist yet |
| D057 | Night rain lights visible | foundation | rain light; quality-preset review |
| D058 | Exposure transitions keep road readable | foundation | auto exposure; tunnel exits absent |
| D059 | Lens droplets camera-specific | integrated | `lensEffects` exterior-only setting |
| D060 | Replay weather uses recorded conditions | integrated | replay surface keyframes; LIVE sky is a menu/live preference |

## 19.7 Grid and pit operations

| ID | Detail | State | Evidence / next |
|---|---|---|---|
| D061 | Grid personnel clear before release | integrated | grid presentation tests |
| D062 | One authority for lights and control | integrated | race director phases |
| D063 | Pit-entry commitment understandable | partial | radio message on entry; commitment line now venue data |
| D064 | Pit speed guidance before the limit | integrated | "PIT LANE · 80 KM/H" message + limiter radio caption |
| D065 | Crew tools contact service points | integrated | A31/A32 contact tests (cars); a motorcycle crew's hands, stands and carried wheels share one `BikeServicePose` (`tests/bike-pit-service.test.ts`), without contact witnesses of its own |
| D066 | Tyre selection matches fitted state | integrated | `NEXT_COMPOUND`/`COMPOUND` fields |
| D067 | Unsafe release policy shared | integrated | `safePitRelease` for AI and player |
| D068 | Repairs alter recorded component | integrated | `repairFrontWing` during phase 5 |
| D069 | Crew reset deterministic after interruption | integrated | pit presentation tests (seek/rewind) |
| D070 | Pit exit restores HUD context | integrated | message returns to flag state |

## 19.8 World and trackside

| ID | Detail | State | Evidence / next |
|---|---|---|---|
| D071 | Braking boards placed/oriented | integrated | track boards (forward layouts only; no reverse layouts exist) |
| D072 | Barrier material/contact identity | partial | barrier looks distinct; contact cues shared |
| D073 | Fence stability in motion | foundation | capture suite moving sequence |
| D074 | Varied, event-driven crowd reactions | integrated | `crowdResponse` per cluster |
| D075 | Marshals react to local incidents | integrated | marshal posts follow local flags |
| D076 | Service vehicles outside racing | integrated | no service traffic on track |
| D077 | Landmarks support navigation | foundation | review per sector |
| D078 | Wear placed where used | integrated | rubber field along racing line |
| D079 | Moving machinery has declared role | integrated (policy) | moving surfaces must be authoritative (`moving-surface.ts`) |
| D080 | Venue sound/light by district | absent | acoustic zones (§20.3) |

## 19.9 Audio and information

| ID | Detail | State | Evidence / next |
|---|---|---|---|
| D081 | Engine tone responds to load | integrated | engine voices take throttle/torque |
| D082 | Pass-bys follow listener position | integrated | spatial listener follows presented camera |
| D083 | Tunnel acoustics | absent | no tunnels |
| D084 | Radio priority and interruption | integrated | `RadioArbiter` |
| D085 | Captions with speaker | integrated | `RadioCaption`, Accessibility toggle |
| D086 | Penalty messages explain consequence | integrated | penalty caption states seconds and how to avoid more |
| D087 | Fuel warnings with lead time | integrated | fuel caption while two laps' margin remains |
| D088 | Separate controller feedback strengths | integrated | `src/input/rumble.ts` + rumble strength setting; next: per-channel (road/engine/contact) strengths |
| D089 | Menu sound levels comfortable | foundation | listening test |
| D090 | Cues survive muted play | partial | captions and visual flags; haptics absent |

## 19.10 Results, replay and polish

| ID | Detail | State | Evidence / next |
|---|---|---|---|
| D091 | Finish order matches classification | integrated | results from race classification |
| D092 | Best-lap validity explained | integrated | `LAST_LAP_VALID`/`ASSISTED`; record categories by vehicle/physics |
| D093 | Replay seek lands on intended event | integrated | `ReplayClock` seek; F01 fix |
| D094 | Replay pause freezes animation | integrated | presented-time clocks (effects, crowd, clouds) |
| D095 | Photo mode restores session | integrated | photo tests |
| D096 | Rewards applied once | integrated | `paidSessions` idempotence, `rewardIncome` shown |
| D097 | Restart restores declared state | integrated | restart rebuilds from options/seed |
| D098 | Safe area, text scale, long translations | partial | `--ui-scale`; captions honour safe-area; localization absent |
| D099 | Save failures visible/recoverable | integrated | save toasts; backup/recovery |
| D100 | Race returns to a useful next action | integrated | results: replay, telemetry, race again, paddock |
