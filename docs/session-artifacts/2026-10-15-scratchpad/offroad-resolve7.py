p = 'docs/production/STATUS_REGISTER.md'
s = open(p).read()
pairs = [
    ("| Registry-derived discipline availability (circuit cars and bikes open; off-road coming until a dirt venue exists, festival until the Solvane region is registered as a career venue) | integrated | `disciplineStatus`, `licenceAvailability`, `purchaseReasons`; unlock tests on synthetic registries independent of the live catalogue; re-checked after the bike, car and circuit catalogues merged | Bike-safety flags on circuits; dirt venue and festival region | Gameplay lead |",
     "| Registry-derived discipline availability (circuit cars, bikes and off-road open; festival coming until the Solvane region is registered as a career venue) | integrated | `disciplineStatus`, `licenceAvailability`, `purchaseReasons`; unlock tests on synthetic registries independent of the live catalogue; re-checked after the bike, car, circuit and off-road catalogues merged (`tests/offroad.test.ts` opens off-road from the terrain venues) | Bike-safety flags on circuits; festival region | Gameplay lead |"),
    ("| Licence test, off-road (jump landing) | prototype | Scored against the surveyed landing slope inside the landing zone (`surveyedJumps`, recorded-sample tests); coming until a dirt venue declares a surveyed jump | Couple to the G5 slice: a venue with surveyed jumps | Terrain lead |",
     "| Licence test, off-road (jump landing) | integrated | Scored against the surveyed landing slope inside the landing zone (`surveyedJumps`, recorded-sample tests); open on the MX-250 loaner at Valley Ridge, whose surveyed jumps the venue declares (`tests/offroad.test.ts`) | Human landing tuning, medal thresholds against player runs | Terrain lead |"),
]
for a, b in pairs:
    assert s.count(a) == 1, a[:60]
    s = s.replace(a, b)
open(p, 'w').write(s)
