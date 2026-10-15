p = 'docs/production/STATUS_REGISTER.md'
s = open(p).read()
a = "| Off-road dirt bikes (MX-450, MX-250, SM-450) | integrated (procedural art) | `src/simulation/offroad/dirt-bike-vehicle.ts`, `dirt-bikes.ts`, `tests/offroad.test.ts`, `docs/offroad-calibration.json` | Human feel review of flight and landing; audio identity | Physics lead |"
b = "| Off-road dirt bikes (MX-450, MX-250, SM-450) | integrated (procedural art) | `src/simulation/offroad/dirt-bike-vehicle.ts`, `dirt-bikes.ts`, `tests/offroad.test.ts`, `docs/offroad-calibration.json`; engine voices from the synthesised single-cylinder families (`single-mx` for the 450s, the two-stroke single for the MX-250) | Human feel review of flight and landing; recorded audio, airborne and landing cues (D047) | Physics lead |"
assert s.count(a) == 1
s = s.replace(a, b)
open(p, 'w').write(s)
