# Combined MotoGP R2 interface compatibility

The actual `e2e/motorcycle-presentation.spec.ts` passed after integration: **9.578 seconds** for the test, **12.134552 seconds** for the report, started **2026-10-16T22:52:11.600Z**. One expected result; no unexpected, flaky or skipped results. These are new combined-build results, separate from the remote MotoGP update’s historical evidence.

The fixture instantiates the production Interface and BikeHud, loads the real Saira variable fonts, and supplies explicitly synthetic motorcycle/car snapshots. It verifies DOM presentation and interaction, not a running race or a 3D showroom.

## Preserved behavior

Each of four separately presented motorcycle snapshots updates speed, gear, RPM and lean immediately. Switching to a car restores its panel immediately. Closely spaced car frames preserve the one-in-three DOM cadence; a large time advance refreshes the telemetry in one call. This assertion combines the R2 immediate-bike contract with the motocross work’s correction for stale telemetry when rendered simulation ticks are sparse.

The responsive checks require real front/rear tyre channels, visible fuel and rear-brake readouts, hidden car battery indicators, the RIDER MFD, and clean restoration of four car tyres, ENERGY/SETUP tabs and car labels. Menu machine changes retain the one `previewMachine(id)` callback and rider/car grid labels. The motocross-specific panel remains covered independently by MX44.

## Measured instrument bounds

| Viewport / HUD scale | Left | Right | Top | Bottom | Horizontal overflow |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1440 × 900 / 1 | 1123.12 | 1401.12 | 558.11 | 834.00 | 0 px |
| 1440 × 900 / 1.35 | 1025.83 | 1401.12 | 504.39 | 834.00 | 0 px |
| 960 × 600 / 1 | 718.00 | 948.00 | 318.89 | 543.00 | 0 px |
| 960 × 600 / 1.35 | 637.50 | 948.00 | 273.30 | 543.00 | 0 px |
| 390 × 844 / 1 | 148.00 | 378.00 | 512.89 | 737.00 | 0 px |
| 390 × 844 / 1.35 | 67.50 | 378.00 | 467.30 | 737.00 | 0 px |

Every tested panel remains inside the viewport and above its reserved bottom controls. The actual desktop RIDER MFD has zero intersection with the instrument rectangle. Four PNGs were opened individually; their observations, dimensions and SHA-256 hashes are in `visual-review.json`. The original assertion results are in `test-run.json`, with all six measured layouts in `layout-measurements.json`.

## Validated source

All **655 source files** matched the frozen combined build at checkpoint time. Integrated remote parent: `6e93a4ef452764f2ee0b69797817f91a908d897e`. Build fingerprint: `85c14e6784442ab806d98b4d4fb0559f02affe8a92d9894ec010ed081b7f97f9`. No production or fixture changes were needed during this run.
