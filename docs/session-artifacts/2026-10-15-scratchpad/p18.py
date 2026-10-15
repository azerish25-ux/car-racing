import sys
p = sys.argv[1]
s = open(p).read()
def rep(a, b):
    global s
    assert a in s, a[:80]
    s = s.replace(a, b, 1)
rep("__CLEAR__", "49.6–51.1 s")
rep("__CHANGEABLE__", "51.4–55.8 s")
rep("__RAIN__", "66.0–69.0 s")
rep("__RAINTOP__", "282 km/h")
rep("__WETPIT__", "234.7 s, zero impacts")
rep("| AI lap: tyre surface temperature (F/R) | 82/93 °C | 81/94 °C |", "| AI lap: tyre surface temperature (F/R) | 82/93 °C | 81/91 °C |")
rep("| AI lap: hot pressure | 154/148 kPa | 153/146 kPa |", "| AI lap: hot pressure | 154/148 kPa | 153/146 kPa |\n| AI lap: single-car best (dry) | 49.84 s | 49.90 s |")
rep("* Standing water costs about 6% of wet top speed (heavy-rain AI scenario: 293 → 281 km/h).",
    "* Standing water costs about 4% of wet top speed (heavy-rain AI scenario: 293 → 282 km/h).")
rep("__COST__", """Five interleaved rounds of 60 simulated seconds each:

| Measure | Baseline (median, range) | v2 (median, range) | Change |
|---|---|---|---|
| Process CPU per 120 Hz tick | 3.90 ms (3.85–3.96) | 4.38 ms (4.33–4.40) | **+12%** |
| Wall time per tick | 5.39 ms (4.42–6.09) | 6.14 ms (4.86–6.76) | +14% |
| `Vehicle.step` wall time per tick | 4.51 ms (3.71–5.10) | 5.15 ms (4.11–5.68) | +14% |
| `Vehicle.step` wall time per car-substep | 113 µs | 129 µs | +14% |

The budget is +40%. On an idle machine before any change, the baseline measured 3.58 ms per tick
(76 µs per car-substep). The wall times above are inflated by other jobs, and CPU time is the steady
figure. In a CPU profile, contact queries already in the baseline (BVH raycast and
`Track.nearest`) still dominate at about 37%. The new tyre law, thermal model and hub solve together
take about 10%. The lateral terms of the combined law are cached across the implicit wheel solve's
16 bisection steps, which halves its curve evaluations. No car retired in any run.""")
open(p, 'w').write(s)
print('ok')
