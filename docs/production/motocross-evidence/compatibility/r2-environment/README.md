# Combined MotoGP R2 road-surface compatibility

The unchanged `e2e/42-motogp-environment.spec.ts` passed on the integrated source: **45.488 seconds** for the test, **47.816762 seconds** for the report, started **2026-10-16T22:52:54.767Z**. One expected result; no unexpected, flaky or skipped results. These new compatibility results do not replace the remote update’s historical records.

## Scope and loaded assets

This is the existing controlled surface fixture. It calls the production `CircuitScene` ribbon builder and family switch on two bounded Aurel segments, constructs the real road/runoff/kerb/verge material chain and the production tyre-mark cache, and loads shipped asphalt, concrete, lawn and meadow color/normal/ORM WebP bytes through the production PBR loader. All four scan layers were resident, all four registered materials were scanned, the high-preset hex path was active and no maps failed.

The fixture uses neutral hemisphere/key lighting, a plain sky and fixed apex, edge and launch cameras at **800 × 500**. It omits buildings, vegetation populations, riders and full-Renderer reflection passes. The dark wet-road images establish reversible material behavior under these controlled conditions; they are not a complete wet-race appearance or frame-rate benchmark.

## Exact results

WebGL error: **0**. Every capture had **400,000 nonzero pixels**. No page or console errors were recorded. Both tyre-mark families remained bounded to **two cached layers**: motorcycle marks report 0.18 m tread width and six active meshes; car marks report 0.30 m and four active meshes.

| Capture | Pixel hash | Draw calls | Triangles | Geometries / textures / programs |
| --- | ---: | ---: | ---: | --- |
| apex-bike-dry | 1456878152 | 16 | 27,840 | 17 / 20 / 6 |
| apex-car-dry | 1527667693 | 16 | 27,392 | 17 / 20 / 6 |
| apex-bike-held | 1456878152 | 16 | 27,840 | 17 / 20 / 6 |
| apex-bike-wet | 475091431 | 16 | 27,840 | 17 / 20 / 6 |
| apex-bike-wet-held | 475091431 | 16 | 27,840 | 17 / 20 / 6 |
| apex-bike-rewound | 1456878152 | 16 | 27,840 | 17 / 20 / 6 |
| kerb-runoff-verge | 2309978390 | 15 | 26,480 | 17 / 20 / 6 |
| launch-bike | 1741214278 | 14 | 27,936 | 31 / 20 / 6 |
| launch-car | 1021897926 | 14 | 27,936 | 31 / 20 / 6 |
| launch-bike-restored | 1741214278 | 14 | 27,936 | 31 / 20 / 6 |

The dry bike hash equals the held and rewound hashes. The wet hash differs from dry and equals its held result. Bike and car apex/launch hashes differ, and restoring bike mode exactly restores the launch hash. Fixed-camera family/wetness/hold operations do not grow resource counts. Moving to the separately constructed launch segment legitimately uploads additional ribbon geometries, from 17 to 31, while texture and program counts remain 20 and 6.

All ten full PNGs were individually inspected. `visual-review.json` records their observations, dimensions and SHA-256 hashes; `environment-material-metrics.json` contains the original returned metrics and scan status. `test-run.json` contains the exact result, source/spec hashes and duration.

## Validated source

All **655 source files** matched the frozen combined build at checkpoint time. Integrated remote parent: `6e93a4ef452764f2ee0b69797817f91a908d897e`. Build fingerprint: `85c14e6784442ab806d98b4d4fb0559f02affe8a92d9894ec010ed081b7f97f9`. No production or fixture changes were needed during this run. The separate complete-venue CPU regression covers the MX/SX pit-ribbon and road-hardware exclusion plus retained real lights; this bounded road fixture does not claim that coverage.
