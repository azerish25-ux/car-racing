# Wet Valley service eligibility regression

The built-in `valley-ridge-mx-moto-2` event now classifies all ten entrants under the original race validation gates. The investigation reproduced six retirements in the isolated `f914` baseline and identified an invalid pit strategy request, independent of the supercross recovery/checkpoint investigation.

## Baseline evidence

The production event was loaded with `eventSession` over the default options: four laps, ten mixed MX250/MX450 riders, changeable weather and seed 41002. The read-only trace recorded actual simulation state and the caller of each transition to `retired`; it did not change controls or physics. Its final race time, retired entrants and crash counts exactly matched the saved pre-fix report.

| Baseline observation                     | Recorded result                          |
| ---------------------------------------- | ---------------------------------------- |
| Race time at retirement                  | 836.227 seconds                          |
| First finish crossing                    | 656.220 seconds                          |
| Existing finish grace                    | 180 seconds                              |
| Retired entrants                         | 0, 1, 2, 4, 5, 7                         |
| Retirement caller                        | `RaceDirector.step`, finish grace branch |
| Final decision for every retired entrant | `PIT SERVICE`                            |
| Final target / brake                     | 0 m/s / full brake                       |
| Approximate stopped speed                | 0.05 m/s                                 |
| Suspension damage                        | Zero for every retired entrant           |
| Front component health                   | At least 0.973 for every retired entrant |

Several riders had spent more than 700 seconds on their current lap while creeping along the generic pit corridor. The six retirements were caused by the finish grace expiring while they were in this service sequence, rather than by damage or the terrain fall-through safeguard. The trace also recorded sixteen station discontinuities above 15 metres. In the recorded Valley cases, their next timing gates remained ahead of the restart destination; the pit deadlock was the decisive shared failure.

## Production correction

The loaded off-road rules already declare `service.pitStops: false`. `DriverBrain.update` had ignored that flag when requesting a tyre stop for wet weather or wear. Those requests activated the generic road pit approach and service logic on a terrain moto.

The existing service flag now guards three boundaries:

- AI strategy can request a tyre stop only when the session permits service.
- `Simulation.requestPit` applies the same rule to the player's pit command.
- `Simulation.step` advances pit service only in an eligible session.

The change does not alter finish grace, timing gates, course definitions, race classifications or the service sequence of eligible sessions. It follows the session rules rather than a vehicle-class exclusion: permitted practice still allows stops for Formula, GP motorcycle and Supermoto machines.

## Completed verification

`tests/pit-session-eligibility.test.ts` covers five built-in off-road events under wet/worn-tyre conditions, confirms that AI and manual requests cannot enter service, and checks that actual tyre state is not modified by the rejected request. Three positive cases retain weather and manual requests for Formula, GP motorcycle and Supermoto practice. These eight cases passed together with the existing driver-brain, motorcycle service and pit-sequence tests: 37 tests across four files.

The original complete event validator passed with the integrated simulation fixes:

```sh
OFFROAD_RACE=valley-ridge-mx-moto-2 node --experimental-transform-types scripts/offroad-races.ts
```

| Final event gate              | Recorded result |   Original bound |
| ----------------------------- | --------------: | ---------------: |
| Classified entrants           |        10 of 10 |     All entrants |
| Retired entrants              |               0 |             Zero |
| Race time                     |  808.45 seconds |     1200 seconds |
| Crashes per rider per lap     |            0.10 |     At most 0.50 |
| Maximum crashes for one rider |               2 |        At most 2 |
| Longest stop                  |   15.17 seconds | Below 20 seconds |
| Deformed terrain cells        |          61,534 |   At least 1,000 |
| Deepest rut                   |         5.45 cm |    At least 1 cm |

Final per-rider crashes were `[0, 0, 0, 1, 0, 0, 0, 2, 0, 1]`. This complete event run includes the integrated collision, AI and recovery corrections; its lower crash count should not be attributed solely to the pit eligibility guard. The retained [regression data](./wet-valley-pit-regression.json) includes the baseline retirement states and the original passing event report. Whole-catalogue race and whole-application validation are recorded by the integration report separately.
