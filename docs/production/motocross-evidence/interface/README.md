# Motocross interface evidence

Final passing component run after integrating the concurrent MotoGP R2 update of `e2e/44-motocross-interface.spec.ts`: **24.647 seconds** for the test, **26.216708 seconds** for the report, started **2026-10-16T22:51:24.189Z**. One expected test; zero unexpected, flaky or skipped results.

The fixture instantiates the production Interface, imports the same Saira variable fonts and base stylesheet as `main.ts`, and creates the real external RadioCaption, RadioArbiter and nearby-traffic logic. HUD flight, flags and nearby-rider positions are explicitly synthetic snapshots. These images establish DOM layout and interaction behavior; they do not show a rendered game world or measure GPU performance.

## Menu integration

The motocross setup spans both columns of the inherited session form. The original ENTER CIRCUIT submitter has native form association and a reserved row below an independently scrolling setup area. It remains visible without drawing over form controls. Leaving motocross restores its exact original form parent and removes the temporary scroll/dock nodes.

| Viewport / HUD scale | Form and venue-card width | Scrollport height | Primary action rectangle | Controls focused and hit-tested |
| --- | ---: | ---: | --- | ---: |
| 1280 × 800 / 1 | 440 px | 516 px | x 61.75, y 645, w 440, h 57 | 10 |
| 1280 × 800 / 1.35 | 440 px | 516 px | x 61.75, y 645, w 440, h 57 | 10 |
| 640 × 400 / 1 | 556 px | 178 px | x 40, y 269, w 556, h 57 | 10 |
| 375 × 667 / 1.35 | 317.5 px | 440.30 px | x 26.75, y 536, w 317.5, h 57 | 10 |

At each size the actual outdoor and stadium card widths match the form width, measured title/preset text fits in at most two lines, horizontal overflow is zero, and every native setup select plus PREPARE GRID is exposed by keyboard focus. The smallest measured gap between a focused control and the primary row is 15.55 px. Short screens necessarily scroll through the setup; overview and focused-settings captures show both states. Menu typography follows the existing menu sizing, while the 1.35 setting enlarges the in-race HUD.

The test also submits the actual form through ENTER CIRCUIT, checks validated preset values and selected machines, retains all nine paddock actions, and checks road-menu restoration.

## In-race interface

At all four sizes the test checks both full and held double-yellow states, the real radio caption, jump readout, holeshot message, both rider-proximity cues, instruments and touch controls using actual DOM rectangles. All measured status elements have zero horizontal overflow and no overlaps. At 640 × 400 the status column ends at x 308 and the instruments begin at x 325, leaving 17 px. At 375 × 667 / 1.35 the full caption ends at y 306.69 and the instruments begin at y 396.84, leaving 90.16 px.

A single initial frame must replace the old template telemetry with eight riders, three laps and the actual initial fuel. Sparse ticks 121 → 151 → 149 must update RPM/speed immediately, including the short backwards seek. Landing states, short rewind reset, MX briefing, suppressed road-only indicators and original road HUD/caption DOM restoration remain covered.

## Files and inspection

`test-run.json` contains the exact result and durations. `motocross-interface-measurements.json` contains all menu, field-reachability and HUD measurements. `visual-review.json` records one-by-one observations and SHA-256 hashes for all **17 individually inspected PNGs**: eight outdoor menu/field-focus views, one stadium menu view, and eight HUD alert views.

This combined-build rerun preserves the full-width MX setup, native submitter and scrolling behavior, status stack, landing states and compact proximity cues. The R2 MOTOBOUND branding and selected-machine metadata remain visible. The road-bike-specific instrument panel is excluded from MX so the original MX instrument layout is not duplicated or hidden. Separate R2 interface and road-surface compatibility captures are retained under `../compatibility/r2-interface/` and `../compatibility/r2-environment/`. Superseded MX-only reports remain outside this committed evidence directory.

## Validated source

All **655 source files** matched the frozen combined build when this run was checkpointed. Integrated remote parent: `6e93a4ef452764f2ee0b69797817f91a908d897e`. Build fingerprint: `85c14e6784442ab806d98b4d4fb0559f02affe8a92d9894ec010ed081b7f97f9`. Exact source and spec hashes are recorded in `test-run.json`. The compatibility tests preserve immediate motorcycle readouts and the car HUD’s original close-frame cadence while requiring a sparse or backwards snapshot to refresh.
