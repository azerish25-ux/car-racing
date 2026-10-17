# Final motocross race verification

The original `npm run test:offroad` exited **0** on the final integrated simulation and passed **20 jump calibrations, three standing starts and all ten race scenarios**. All **74 entrant starts** receive a classification, and no entrant retires. Every original per-event crash, per-rider crash, stop, terrain and calibration bound passes. These are deterministic seeded CPU simulations; they do not measure graphics performance or establish success for every possible race seed.

The exact validator outputs are [offroad-races.json](../../../offroad-races.json) and [offroad-calibration.json](../../../offroad-calibration.json). [final-regression.json](./final-regression.json) records the command, isolated working directory, report hashes, all **fourteen relevant simulation/script fingerprints** and compact results. The fingerprints match the frozen source and include the preserved MotoGP R2 core, BikeVehicle and R3 slipstream helper. Presentation-only chain and venue edits are outside this CPU gate. Both original validation scripts are byte-identical to baseline commit `f91463cf506f6feced1a4db9c43af48ac3632410`; no acceptance threshold was relaxed.

## Final results

| Original scenario | Classified | Race time | Bike crashes | Longest measured stop |
| --- | ---: | ---: | ---: | ---: |
| Valley Ridge motocross moto | 8 / 8 | 301.76 s | 2 | 10.13 s |
| Arena Nord supercross main | 8 / 8 | 274.57 s | 0 | 10.40 s |
| Kestrel rallycross heat | 5 / 5 | 246.29 s | — | 0.00 s |
| Pinewood special stage | 4 / 4 | 178.62 s | — | 0.39 s |
| Built-in Valley Ridge Moto 1 | 10 / 10 | 390.28 s | 2 | 9.78 s |
| Built-in Valley Ridge Moto 2, changeable weather | 10 / 10 | 777.94 s | 1 | 17.67 s |
| Built-in Arena Nord six-lap supercross | 10 / 10 | 564.64 s | 5 | 13.49 s |
| Built-in Valley Ridge Supermoto | 8 / 8 | 401.12 s | 3 | 11.82 s |
| Built-in Kestrel rallycross heat | 5 / 5 | 246.29 s | — | 0.00 s |
| Built-in Pinewood special stage | 6 / 6 | 219.23 s | — | 0.39 s |

Race time is the validator's `raceSeconds`; individual classified times include penalties and can exceed that value. Bike crashes include the original validator's continued simulation after an individual rider completes the scheduled laps. The per-rider maximum is `max(1, ceil(scheduled laps / 2))`, so the four-lap motos permit two and the six-lap stadium event permits three. Four-wheel scenarios have no corresponding bike-crash counter. The stop clock excludes entrants already in the pits, finished, parked or awaiting their start; it is not a complete accounting of delay.

All twenty surveyed jump cases and all three original acceleration checks have no reported failures. The calibrated jump speeds, suspension, landing limits and validator assertions are retained.

## Reproduced problems and final comparison

[race-before-after.json](./race-before-after.json) preserves exact original baseline evidence, final results, the [pre-R2 passing integration](./pre-r2-integration/README.md) under `preR2Integration`, the earlier pre-caution gate under `precedingIntegration`, and isolated diagnostic runs under `intermediateAfter`. Their original numerical figures are retained. The [initial R2 integration failure](./r2-before-control-corrections/README.md) and [later stop-bound failure](./r2-before-effort-pause/README.md) are also archived.

- The fixed three-lap stadium race originally reached its timeout with **4 / 8 riders classified and 42 crashes**. The final source classifies **8 / 8 in 274.57 seconds with 0 crashes**; the recorded rate changes from **1.75 to 0.000 per scheduled rider-lap**.
- The built-in wet outdoor moto originally retired **six healthy riders stuck in prohibited pit service**. The final source classifies **all ten in 777.94 seconds, with one crash and no retirements**. The [pit-service reproduction](../wet-valley-pit-regression.json) independently records the failure on the exact baseline.
- The final six-lap stadium event classifies **all ten in 564.64 seconds with 5 crashes**. Its worst rider has 2 crashes, within its unchanged limit of three.
- After the concurrent MotoGP R2 changes were retained, the dry outdoor moto exposed another genuine control/contact problem: one rider exceeded its unchanged two-crash cap. The final dry event classifies **all ten in 390.28 seconds with 2 total crashes**. The full earlier failing report remains available; the repair was verified with physical regression witnesses as well as the original event.

The combined repairs cover adjacent-lane barrier projection, extreme terrain overlap, consistent AI steering paths, rejoining, continuous checkpoint-safe recovery, air-to-ground input ownership, actual service eligibility, explicit motocross caution procedure and the contact/control handoffs below. Traffic, flags and terrain couple these outcomes; do not attribute the entire improvement to a single repair.

## R2/R3 compatibility and physical regression witnesses

[r2-control-regression.json](./r2-control-regression.json) records the narrow dirt compatibility repairs and exact observations. The preserved MotoGP ABS and full force-utilization behavior remain intact. Dirt tyre heating uses bounded utilization only while riding on the ground; real Raw-braking tests cover MX250, MX450 and SM450 through a natural fall and recovery. The preserved R3 slipstream helper remains on the road-bike adapter, while DirtBikeVehicle uses its existing full step and standing-dependent drag override.

Four further production defects have direct before/after witnesses:

1. A committed clear touching down before the survey's end previously received the walking gap target and nearly full braking during suspension settlement. The exception now requires that same locked plan, actual landing survey, qualifying flight and a nonnegative age within the existing settlement window. Rolling and beached recovery remain covered.
2. A real tilted two-bike collision moved the bodies by about one centimetre. Differentiating that position correction created false vertical speed and fed the next impact. The adapter now differentiates its previous authoritative pose. The actual two-bike witness, normal heave and place/remount controls pass; the no-collision original calibration report is byte-identical before and after this one-line derivative repair.
3. Heading recovery could brake a locked clear after the planner's abort check. The same committed plan now aborts once when this final guard actually lowers the target on its pre-face approach, preserving a locked roll. Four mirrored real MX250/MX450 approaches change from front crashes to controlled rolling landings without changing nominal jump speeds.
4. Passing traffic briefly held an actually beached rider on the brakes, erasing prior drive effort despite no movement. The AI now pauses that effort during stationary brake holds, resets it on real motion or state changes and assists only while currently requesting drive after the original four accumulated seconds. [The public traffic/reset witnesses](./recovery-effort-regression.json) cover the interrupted rider, a fourteen-second brake-held queue, a physical push and an actual manual remount. The normal five-second remount and shared fallback remain unchanged.

The first seven targeted behavior checks fail on uncorrected source and pass with the three contact/control repairs; two positive no-contact/reset controls pass in both. The interrupted-traffic case then fails on that preceding integration and passes after the effort-clock correction, with its three queue/movement/remount controls passing both. The full owned compatibility set passes **69 tests across seven files**, covering shared bike dynamics/session behavior, riding, AI, collision, caution eligibility and thermal state. The final complete gate above independently runs the same frozen simulation. Compressed exact dry traces are retained as [R2 before](./dry-r2-before.json.gz) and [three-correction diagnostic after](./dry-three-corrections-after.json.gz). Their diagnostic wall times and intermediate counts are not substituted for the final full-gate figures.

## Motocross caution procedure

Only the `motocross-moto` ruleset opts out of global VSC and safety-car deployment. Local yellow and double-yellow warnings, their caution speeds and penalties remain active. Formula, MotoGP and Supermoto retain their existing default, and practice still excludes global neutralisation. The earlier focused production-controller suite passed 29 tests across four files; the final owned set repeats its six dedicated motocross eligibility cases. The final complete race gate includes this guard.

## Earlier air-to-ground pedal regression

[dry-valley-ai-pedal-handoff.json](./dry-valley-ai-pedal-handoff.json) records a clean touchdown whose next physics substep consumed an airborne rear-brake input. The air solver keeps its calculated pedals local and publishes telemetry without overwriting the ground planner's command. Two real takeoff-to-touchdown tests exercise MX250 and MX450.

The historical traces remain as [before](./dry-valley-before-pedal-fix.json.gz) and [after](./dry-valley-after-pedal-fix.json.gz). In that isolated earlier event the affected rider changed from three crashes to zero while the aggregate event count remained seven. Those are historical diagnostic figures, distinct from the final results above.
