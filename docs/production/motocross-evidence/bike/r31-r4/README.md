# Final MX component verification after R3.1 / R4

The production motocross component case passed on the integrated **670-source** build, upstream parent `d4dd3e541433a0eb7513b0b9124c932911a64bdb`. Its native test duration is **40,767 ms**. It ran third in the retained three-case crowd / GP / MX process, which passed **3/3** with no reported errors; the native combined reporter duration is **157599.91499999998 ms**. The combined duration includes the other two cases and process overhead.

Source SHA-256: `acfc1a799a933ff9c135046aee17daa741366549f7808b8091200accf69f874d`. Build fingerprint: `a5a1575e169f6475439722adeb3ac6ae569bc91b6d604f14e465faf7eccc6de4`. The exact [before-source](before-source.json) and [after-source](after-source.json) records agree on all 670 production source files, 12 context files, build identity and both main bundles. The [environment record](environment.json) identifies WebGL2 through ANGLE / SwiftShader and explicitly records that physical hardware was not validated.

## Result and preserved data

All **21 original PNGs and 21 original metrics JSONs** are retained byte-for-byte, together with the exact [attachment manifest](attachment-manifest.json) and [native MX test report](test-report.json). The original PNG names are at the directory root; metrics are under `raw-metrics/`. The unchanged manifest uses the original checkpoint filenames. [test-run.json](test-run.json) records the actual command, native timings, source identity, budgets and complete onboard results. The [combined report](combined-report.json), [combined console log](combined-run.log) and [checkpoint summary](checkpoint-summary.json) retain execution provenance.

| Exterior detail, both MX250 and MX450 | Constructed model triangles | Scene render calls | Resident geometries / textures / programs |
| --- | ---: | ---: | --- |
| High | 74,562 | 64 | 76 / 16 / 12 |
| Mid | 44,649 | 60 | 72 / 16 / 12 |
| Far | 11,195 | 45 | 57 / 10 / 12 |

The original `<130,000` triangle and `<200` call limits remain unchanged. All captures contain finite geometry and zero GL errors. The lowest actual transformed vertex is **−0.8573 mm**, within the original **greater than −6 mm** floor limit. Every hand/ankle target error remains the intended **20 mm** inset, below the **30 mm** reach limit. See [the measurement projection](metrics.json) and each original JSON for exact floating-point values.

## Six production onboard contracts

Both MX250 and MX450 are captured at rest, standing under steering input at 25 m/s, and braced under braking/lean at 30 m/s. These use the production camera mount, speed-dependent lens, model and rider presentation. Each of the six cases retains **3/3 visible controls**, **15/15 clear forward samples**, two visible hands, hidden first-person head/torso, and sleeve entries outside the forward image boundary. Every control projection stays within the original bounds. Onboard draw calls are **29–31**; the resident resource counts are **69 geometries / 12 textures / 11 programs**.

The four-sample mud sequence reuses one model instance and holds **76 geometries / 16 textures / 12 programs** throughout. Dry and muddy pixels differ, the held muddy frame repeats exactly, and clearing mud restores the initial dry pixel hash. The exact sequence is **1036874890 → 1438494632 → 1438494632 → 1036874890**.

## Separate continuity evidence and scope

All 21 PNGs are byte-identical to the earlier complete R2 component checkpoint in this environment. Eleven numerical/contract fields also match for every corresponding case; per-run instance UUIDs are deliberately excluded from that cross-run comparison. [continuity-comparison.json](continuity-comparison.json) records the exact fields and hashes. This is a separate later execution with its own native report and source identity. Root owns the individual fresh-display observations in `visual-review.json`.

The [earlier component record](../test-run.json) and [full-game journey](../../gameplay/README.md) retain their actual historical identities. This controlled component page does not recreate full-track riding, traffic or world effects. Its SwiftShader duration is not a physical-GPU performance measurement.

## Every original capture

| Capture | Original PNG | Original JSON |
| --- | --- | --- |
| mx450-high | [mx450-high.png](mx450-high.png) | [Original measurements](raw-metrics/mx450-high-metrics.json) |
| mx450-mid | [mx450-mid.png](mx450-mid.png) | [Original measurements](raw-metrics/mx450-mid-metrics.json) |
| mx450-far | [mx450-far.png](mx450-far.png) | [Original measurements](raw-metrics/mx450-far-metrics.json) |
| mx250-high | [mx250-high.png](mx250-high.png) | [Original measurements](raw-metrics/mx250-high-metrics.json) |
| mx250-mid | [mx250-mid.png](mx250-mid.png) | [Original measurements](raw-metrics/mx250-mid-metrics.json) |
| mx250-far | [mx250-far.png](mx250-far.png) | [Original measurements](raw-metrics/mx250-far-metrics.json) |
| standing-side | [standing-side.png](standing-side.png) | [Original measurements](raw-metrics/standing-side-metrics.json) |
| braced-front | [braced-front.png](braced-front.png) | [Original measurements](raw-metrics/braced-front-metrics.json) |
| inside-foot-dab | [inside-foot-dab.png](inside-foot-dab.png) | [Original measurements](raw-metrics/inside-foot-dab-metrics.json) |
| rear-components | [rear-components.png](rear-components.png) | [Original measurements](raw-metrics/rear-components-metrics.json) |
| helmet-and-gear | [helmet-and-gear.png](helmet-and-gear.png) | [Original measurements](raw-metrics/helmet-and-gear-metrics.json) |
| mx250-production-onboard-0 | [mx250-production-onboard-0.png](mx250-production-onboard-0.png) | [Original measurements](raw-metrics/mx250-production-onboard-0-metrics.json) |
| mx250-production-onboard-1 | [mx250-production-onboard-1.png](mx250-production-onboard-1.png) | [Original measurements](raw-metrics/mx250-production-onboard-1-metrics.json) |
| mx250-production-onboard-2 | [mx250-production-onboard-2.png](mx250-production-onboard-2.png) | [Original measurements](raw-metrics/mx250-production-onboard-2-metrics.json) |
| mx450-production-onboard-0 | [mx450-production-onboard-0.png](mx450-production-onboard-0.png) | [Original measurements](raw-metrics/mx450-production-onboard-0-metrics.json) |
| mx450-production-onboard-1 | [mx450-production-onboard-1.png](mx450-production-onboard-1.png) | [Original measurements](raw-metrics/mx450-production-onboard-1-metrics.json) |
| mx450-production-onboard-2 | [mx450-production-onboard-2.png](mx450-production-onboard-2.png) | [Original measurements](raw-metrics/mx450-production-onboard-2-metrics.json) |
| same-instance-mud-0 | [same-instance-mud-0.png](same-instance-mud-0.png) | [Original measurements](raw-metrics/same-instance-mud-0-metrics.json) |
| same-instance-mud-1 | [same-instance-mud-1.png](same-instance-mud-1.png) | [Original measurements](raw-metrics/same-instance-mud-1-metrics.json) |
| same-instance-mud-2 | [same-instance-mud-2.png](same-instance-mud-2.png) | [Original measurements](raw-metrics/same-instance-mud-2-metrics.json) |
| same-instance-mud-3 | [same-instance-mud-3.png](same-instance-mud-3.png) | [Original measurements](raw-metrics/same-instance-mud-3-metrics.json) |
