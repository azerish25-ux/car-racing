# GP R3.1 / R4 integration evidence

This directory records the GP drivetrain, caliper, rotor-glow and shared-paint integration on top of the validated motocross work. The final integrated build contains **670 source files**, source SHA-256 `acfc1a799a933ff9c135046aee17daa741366549f7808b8091200accf69f874d`, build fingerprint `a5a1575e169f6475439722adeb3ac6ae569bc91b6d604f14e465faf7eccc6de4`, and upstream parent `d4dd3e541433a0eb7513b0b9124c932911a64bdb`.

The [earlier compatibility evidence](../README.md) and [full-game motocross journey](../../gameplay/README.md) retain their actual **667-source** identity. They are not results of this later build.

## CPU integration and the unchanged budget

The initial integrated GP-R1 high model contained **110,708 expanded triangles** and failed the existing `<110,000` limit in two independent tests. The repair reduced small-caliper tessellation while retaining the authored profile, exact measured envelope, piston/jaw arrangement, rotor slot, hydraulic detail, materials, mount and four material batches. Each caliper fell from **2,048 to 1,576 triangles**; the complete GP-R1 high model is now **109,764**. GP-R2 high contains **100,220**. The rendered `<220` draw-call gate remains unchanged and is evaluated separately by the browser fixture.

| Actual CPU batch                   | Result                     | Coverage                                                                                                                                                                                |
| ---------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Incoming R3.1/R4 before the repair | **28/30 passed; 2 failed** | The retained failures both report `expected 110708 to be less than 110000`; chain mechanics, louver facing, component geometry, body construction and instance disposal already passed. |
| Targeted repair rerun              | **26/26 passed**           | Both failed model gates, all chain integrity checks, the three caliper cases, GP reference contracts, and MX250/MX450/SM450 cockpit controls.                                           |
| Subsequent glow/paint/MX follow-up | **7/7 passed**             | Three rotor-glow cases, deterministic filtered paint maps, and the three production dirt/supermoto cockpit controls.                                                                    |

These batches contain **38 distinct cases across nine test files with their latest results passing**; repeated executions are not presented as new coverage. Their exact commands, case names, durations, file hashes, the failing report and construction measurements are retained in [cpu-validation.json](cpu-validation.json). The three `vitest-*.json.gz` files are lossless copies of the original reporter JSON, with compressed and uncompressed hashes in that record.

The independent rotor-slot regression checks both mirrored sides. At each of three heights, rays toward either rotor face first hit the pad backing at **10.99999994 mm**, matching the authored 22 mm slot, and the measured bounds match the incoming component to eight decimal places. Complete model counts expand every instanced link; the 0.52 m review chain has 96 links and **12,960 expanded triangles**.

The new shared `BikeMaterials` paint maps are allocated for MX entrants but unused by their separate dirt plastic meshes; their texture fields are covered by the existing material owner cleanup. GP41 provides rendered coverage for the new paint finish. The GP-only disc-glow branch and all motocross socket, plate, sleeve, control and exterior-restoration behavior are preserved.

## Browser evidence

The existing **GP41 production-model fixture passed in 107,540 ms** on the frozen 670-source build above. It ran second in one single-worker process with the filtered crowd shader case and MX42; all three passed with no reporter errors. The complete three-case reporter duration was **157,599.91499999998 ms**, which is separate from the GP test duration. The observed WebGL2 backend was **SwiftShader**; these durations are test execution time, not hardware frame-rate measurements.

All **14 original PNGs and 11 original JSON attachments** are retained here. [test-run.json](test-run.json) records source/build integrity, actual test scope and assertions; [attachment-manifest.json](attachment-manifest.json) records names, order, dimensions and byte hashes. [metrics.json](metrics.json) combines the JSON data for convenient inspection, while `raw-metrics/` preserves their original bytes. The complete test-owned report, all shared test results, original backend probe and before/after source captures are preserved in the `motocross-release-validation/r4-renderer-regression` checkpoint.

| Model / exterior | Complete model triangles, instances expanded | Renderer submitted triangles | Render calls |
| ---------------- | -------------------------------------------: | ---------------------------: | -----------: |
| GP-R1 high       |                                      109,764 |                      218,632 |          210 |
| GP-R1 mid        |                                       44,953 |                       89,057 |          166 |
| GP-R1 far        |                                       12,538 |                       24,318 |           85 |
| GP-R2 high       |                                      100,220 |                      200,180 |          206 |

The complete-model column is the quantity checked against the unchanged `<110,000` ceiling. Submitted triangles include the renderer's repeated color/transmission work and depend on the camera. Every exterior remains below the unchanged `<220` render-call gate. The wet GP-R1 capture uses the same counts as its dry high-detail view.

GP-R1 preparation recorded **55 → 55 → 55 programs** over the three identical dry samples, with **118 geometries and 26 textures**. The fixture retains its second/third preparation equality and every later weather-resource equality. A single retained model and renderer then produced dry/wet/held-wet/rewound-dry image hashes **3004651270 → 2258845372 → 2258845372 → 3004651270**, with the same resources throughout and no mutation of the supplied snapshot. No budget or resource-growth allowance was added.

All four actual road-bike onboard sockets passed **9/9 instrument visibility rays**, in-frame corner bounds and a display-facing value of **0.9607822416911271**. GP-R1, GP-R2 and SBK-1000 recorded 33 onboard calls; SS600 recorded 35. All captured GL errors were zero, and the spec's accumulated page/console-error assertion passed.

### Retained captures and visual review

The six exterior captures cover GP-R1 high/mid/far, GP-R2 high, wet GP-R1 and the repeated dry GP-R1. Four onboard captures cover GP-R1, GP-R2, SBK-1000 and SS600. Four `same-instance-weather-*.png` captures preserve dry, wet, held-wet and rewound-dry states separately, including their intentionally identical bytes.

The individual observations for all fourteen captures are owned separately by root in [visual-review.json](visual-review.json). The test pass reported above describes the automated assertions; this packaging record does not substitute for that visual review.
