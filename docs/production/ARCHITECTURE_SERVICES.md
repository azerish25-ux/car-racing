# Service ownership and content contracts

Masterplan §6. Current owners of each responsibility, and the boundary each must keep.

| Service | Owns | Where it lives now | Must not own |
|---|---|---|---|
| Session coordinator | lifecycle, loading, cancellation, pause, selected event | `src/main.ts` (`GameApp`) | tyre equations, meshes |
| Simulation world | authoritative physical state, tick | `src/simulation/world.ts` in the worker | DOM, renderer timing, audio |
| Vehicle dynamics adapter | class forces, controls, constraints | `Vehicle` + `VehicleDefinition` (four-wheel); `Bike` prototype (separate family) | career money, camera shake |
| Race rules engine | starts, legal routes, penalties, scoring, classification | `RaceDirector` + `RulesetDefinition`; `RouteProgress`; `stage-rules.ts` | force corrections |
| Content registry | validated vehicle, circuit/route, ruleset, event definitions | `vehicles.ts`, `circuits.ts`, `route-graph.ts`, `events.ts`; `content-validation.ts` | per-race state |
| Presentation world | interpolation, meshes, effects, camera, sound cues | `src/rendering`, `src/audio`, `TouringShells` | race results |
| Replay service | recording spans, versioning, seek, playback clock | `SessionReplay`, `ReplayClock` | waiting on a drawn scene for logical progress |
| Profile/progression | saves, results, idempotent rewards, migrations | `SaveStore` (+ backup/recovery), `team-career.ts`, `championship.ts`, `TimeTrialRecords` | trusting client results for ranked play |
| Platform adapter | files, devices, FFB, overlays, cloud | browser APIs (`src/input`) | remote code execution |
| Developer evidence tools | inspection, captures | `?dev` surface | player primary navigation |

## Contracts in code (§6.3)

* `VehicleDefinition` — id, version, class, dynamics kind, spec (mass, inertia, wheels, powertrain,
  brakes), drivetrain, aero body scale, collision extents, body stations, tyre family, hybrid/DRS,
  setup schema, AI capability envelope.
* `CircuitDefinition` + `PitLaneDefinition` — design, profiles, corners, DRS, pit/grid/service.
* `RouteSpec` — directed edges, permitted transitions, checkpoints, branch kinds, bounds.
* `RulesetDefinition` / `EventDefinition` — sessions, eligible classes, tyres, service,
  classification (laps/timed), points, DRS, assists; resolved through `eventSession()`.
* `RecordedSessionIdentity` — format and simulation versions, tick rate, circuit/ruleset/vehicle
  content hashes, assists, seed.
* `SNAPSHOT_SCHEMA` — per-car blocks; unknown formats rejected.

Presentation replay (recorded poses) is distinct from deterministic resimulation: the server
prototype shows same-process repeatability only; cross-platform float determinism is not claimed
(§6.5).

## Migration order followed (§6.6)

1. Protect recordings and behaviour (identity, record categories, unchanged Formula numerics).
2. Vehicle and event identities (`VehicleDefinition`, rulesets).
3. Route/pit data (`PitLaneDefinition`, layer-aware progress, RouteGraph).
4. Mixed car definitions (TC-1 alongside APX-01 in one field).
5. Bike-specific blocks, terrain state and online authority — prototypes only, not in sessions.
