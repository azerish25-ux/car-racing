# Programme plan

Masterplan §4, §5, §11–§13, §20–§23, §25–§27. Quantities and dates are planning envelopes to
re-baseline against accepted slices (§27.3), not commitments.

## 1. Product identity and scope (§4.2, §5)

Identity: *a motorsport world built around convincing machines, consequential surfaces and
extraordinary places*, in three branches — **Circuit**, **Dirt**, **Extreme** — that share profile,
content tooling, input, replay and presentation but never one tyre model, wheel layout, progress
algorithm or rule set.

| Layer | Scope | Gate |
|---|---|---|
| Golden race | Formula family; Aurel, Vellamar | G1 |
| Focused car release | 12 cars / 4 classes; 6 venues; 12 layouts | G3 |
| Discipline expansions | road bikes; dirt bikes and loose surfaces | G4, G5 |
| Full vision | 48 models; 24 venues; ~60 layouts; online and creators | G6–G9 |

Not required for the first car release: open world, 48 vehicles, motorcycles, public UGC, ranked
online, VR, soft-body crashes, every weather type, console certification (§5.3).

## 2. Comparative evaluation protocol (§4.3)

Benchmarks (official materials only): Forza Motorsport, Gran Turismo 7, EA SPORTS F1 25, MotoGP 26,
Supercross 25, The Crew Motorfest. Repeatable comparisons: hairpin braking, wet-corner recovery,
two-wide contact avoidance, chase-camera crests, bike transitions, jump landings, pit entry,
controller-only restart. Record device, assists, weather, view, resolution, duration; use the
three cohorts in `HARDWARE_DEVICE_PLAYTEST_PROTOCOLS.md`.

## 3. Milestones (§25)

```text
G0 stable release → G1 golden race → G2 vehicle/event/route/replay contracts
   ├─ G3 focused car product
   ├─ G4 road-bike slice ─ G5 dirt slice
   ├─ G6 extreme topology
   └─ G7 online slice          (G8 creators needs mature validation + G6/G7)
```

**Days 1–30.** Close F01 on hosted CI and publish the validated artifact; name reference hardware and
capture the workload matrix; run human races on both circuits; freeze unrelated visual churn.
*Delivered in source:* F01 mechanism and fixes, status register, replay-clock regression,
shadow-pass reduction, dashboards and protocols.

**Days 31–60.** Vehicle/event extraction behind adapters (done: `VehicleDefinition`, rulesets), a
mechanically different second car (done: TC-1, provisional art), an independent pit/route test venue
(done: left-pit and overpass venues), schema/replay policy (done), one approved optimization
prototype of the supplied player (open: WP07), authoring tools for constants engineers used to edit
(partial: content validation, venue data).

**Days 61–90.** Finish G2 with normal-user integration (machine choice and EVENTS are in the menu),
greybox the first new car venue with the new data contracts (open), re-run human and hardware
acceptance (open). Bounded motorcycle experiment (done in isolation: `bike.ts`); go/no-go on bike R&D
after its review.

## 4. Modes roadmap (§11.2)

| Mode | Present | Next depth |
|---|---|---|
| Quick race | race mode, start slot, machine choice | estimated duration on the card |
| Practice | practice programme | session goals per vehicle family |
| Time attack | ghosts, local boards by vehicle/physics | validity explanation on the HUD |
| Race weekend | qualifying → race grid | configurable sequence |
| Championship | calendar, points, countback | rival identity, save recovery |
| Team career | departments, research, ledger | one result identity with championship |
| Endurance | lap and **timed** classification | fuel/service choices, stint persistence |
| Rally / rallycross | stage and joker rules (prototype) | point-to-point venue |
| Motocross / supercross | terrain prototype | G5 |
| Drift / freestyle | explainable scoring (prototype) | challenge content |
| Elimination, relay, creator, split-screen | absent | later phases |

## 5. Career (§12)

Licences/invitations teach one skill at a time, then branch: Circuit (club → touring/GT/Formula),
Dirt (rallycross or bike development), Extreme (optional invitations). Players choose driver career
or team management. Rewards: completion, improvement and clean racing, with the calculation shown
(`rewardIncome`); transactional, idempotent per session; no pay-to-win; a recovery route for broke
teams (reduced-stakes events). Saves: versioned, backed up before overwrite, recoverable.

## 6. AI programme (§13)

Layers: strategic (2 Hz), tactical (12 Hz), control (120 Hz), recovery — present. Capability
envelopes now follow the vehicle (`VehicleDefinition.ai`), including zero-downforce classes. Next:
explicit passing commitment with abort conditions and lane hysteresis (WP20), surface-aware braking
and forecast parity in the wet, seeded mistake models with context. QA suite (§13.7): three-wide
approach, overlapping wheels, slow car on the line, blocked pit entry, wet crossover, blue flags,
safety-car restart, damaged steering, lapped traffic; measure contacts, stuck time, illegal
shortcuts (RouteProgress), completion and clean passes.

## 7. Audio programme (§20)

Structured brief per powertrain family (intake, exhaust, transmission, motor/inverter, tyres,
suspension, wind, vibration), mapped to RPM, load, gear, slip, speed, camera and damage. TC-1 needs
its own family. Spaces: zone transitions before any acoustic simulator. Radio: arbiter with urgency,
cooldowns, expiry and captions (present). Music: menus and casual modes, independently mutable; a
provenance record per track.

## 8. Online programme (§22)

Stages: shared ghosts → private unranked → authoritative racing → rankings/leagues/creators. The
server owns accepted inputs, simulation, legal progress (RouteProgress), penalties and results.
Physics tick (120 Hz), input cadence and network snapshot cadence are separate: the WP49 measurement
shows a compact 20 Hz state is ~44 kbit/s per client for 8 cars versus ~8 Mbit/s for full render
snapshots, at ~0.2 s CPU per simulated second per race on the measurement machine. WP50–WP54 now
exist as an in-memory prototype ([ONLINE_SLICE.md](ONLINE_SLICE.md)): redundant input commands,
local-car prediction with smoothed reconciliation, server collision authority, content-version
agreement on join, verified records by headless re-simulation, lobbies and resilience. Measured for 8
clients at 100 ms RTT / 2% loss: ~60 kbit/s down and ~28 kbit/s up per client on the wire, local-car
prediction error p95 ≈ 0.14 m. Next: a real transport and a player session reaching it.

## 9. Platform (§21.6, §23.7)

Browser remains a measured target. A desktop package adds files, devices, FFB, overlay and cloud
saves through a bounded native bridge — no arbitrary commands, bounded force values, stop on pause /
focus loss / disconnect. VR and split-screen each need their own performance and comfort gate.

## 10. Staffing and cost arithmetic (§27)

Illustrative focused-product shape (not a claim about available staff): production 1, technical
direction 1, physics/vehicle 2, gameplay/tools 2, rendering/platform 2, AI 1, UI/UX 1, technical
art 2, vehicle art 2, environment art 3, animation 1, audio 1, QA 2 — 21 people.

Sensitivity model at a hypothetical CAD 12,000 per person-month with 30% contingency:
6 × 18 months ≈ CAD 1.68M; 20 × 18 ≈ CAD 5.62M; 40 × 30 ≈ CAD 18.72M. Excludes licensing,
marketing, outsourcing, platform and service operations. Re-estimate after the second vehicle and
the second use of a venue kit.

## 11. Ticket template (§26.5)

```text
ID / title:
Player or production problem:
Evidence and pinned source references:
Current implementation state (STATUS_REGISTER state):
Proposed change and explicit non-goals:
Accountable owner / reviewers:
Dependencies:
Source/content ownership scope:
Functional acceptance:
Human-play acceptance:
Performance and memory budget:
Replay/save/network compatibility:
Asset-rights and accessibility impact:
Test fixtures and evidence links:
Estimate range / confidence / unresolved assumptions:
Rollback or migration plan:
```
