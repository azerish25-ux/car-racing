# Build and CPU integration evidence

## Final frozen build

[final-build-checks.json](./final-build-checks.json) records the successful complete TypeScript/Vite build, lint and content validation for the final combined source. [final-validated-source.json](./final-validated-source.json) contains every source digest, the build fingerprint and main bundle identities. All 670 production files and 12 build/test context files matched before and after the final build and the subsequent sequential renderer checkpoint.

| Command | Result | Preserved output |
| --- | --- | --- |
| `npm run build` | Exit 0; TypeScript passed; 652 modules; Vite 18.83 s | [final-build.log](./final-build.log) |
| `npm run lint` | Exit 0 across the complete `src`, `tests`, `e2e` and `scripts` trees | [final-lint.log](./final-lint.log) |
| `npm run validate:content` | Exit 0; content valid | [final-content.log](./final-content.log) |

Source digest: `acfc1a799a933ff9c135046aee17daa741366549f7808b8091200accf69f874d`. Build fingerprint: `a5a1575e169f6475439722adeb3ac6ae569bc91b6d604f14e465faf7eccc6de4`. The build commit field is null because the combined work was verified before publication; it is preserved without inventing a commit association. The existing large JavaScript chunk warning remains. The browser and race evidence records their own outcomes separately.

## Final replay-camera placement checks

[camera-placement.json](./camera-placement.json) records **53 passing tests in two files**. The two complete-venue geometry tests inspect the actual seven-mesh camera platforms, with 140 meshes and 4,400 vertices in each venue. Their complete horizontal envelopes clear every legal ribbon plus a 0.4 m band, the ordinary grandstands and actual stadium seating. All forty visible supports remain; their bases follow the real terrain, and physical optical origins match their replay-director positions exactly.

The other 51 controls preserve all 880 original camera records across 44 non-MX/SX venues, all forty dirt view metadata records, authored camera heights and dense terrain sightlines toward the corresponding course centers. The independent native file durations are **2.143158447 seconds** and **4.757375244 seconds**; these are separate measurements, not a combined wall time. Source and reporter hashes, all original/corrected optical positions, moved-site counts and actual footprint findings are retained in the JSON.

The [incoming-change audit](./remote-preservation.json) preserves all **198 paths** through `d4dd3e541433a0eb7513b0b9124c932911a64bdb`: **179 exact incoming byte matches** and **19 reviewed combined differences**. There are no missing/deleted incoming paths, mode mismatches or unexpected differences. The preceding 3162620 audit and its earlier history remain reconstructable in the record.

## Final shared integration checks

The complete motocross journey is retained at its actual **667-source** camera-clearance build, source `7733bb95ae33dc962eb2e6d07b2d3480dac3276a50753733268a68b22f500d36`, build `82b5018336f9fb2c9ae1c2fcc7d11d1c3011209ec2e1c8471be5111c033c52e8`. Its original build outputs are archived in [camera-clearance-build](./camera-clearance-build/README.md), and its eight individually reviewed full-app images remain in [gameplay](../gameplay/README.md).

The [six-modified/three-new runtime-path record](./r31-r4-isolation.json) reconstructs that earlier source from the final 670-file inventory. All 661 other original production files remain unchanged. It records the actual scope of the late changes: GP-only high-model components and road brake fade, six additional shared paint textures allocated per entrant but unused by dirt meshes, and the generic crowd shader used in Valley and the initial road-menu background. SX uses its separate stadium crowd. The crowd mask excludes skin and shoes; some close accessories can receive its textile effect as well.

| Final check | Actual result | Scope and record |
| --- | --- | --- |
| GP construction, materials and caliper budget | 38 distinct latest passing cases in nine files | [CPU evidence](../compatibility/r31-r4/cpu-validation.json) preserves the original 28/30 failure report, 26/26 repaired rerun and 7/7 glow/paint/control batch; every batch retains its actual source boundary |
| GP brake fade and dirt controls | 20 tests in three files, 19.24 s; 36 controlled production-adapter states | [Physics evidence](./r31-r4-physics.json) verifies independent GP axle response and non-GP/dirt force preservation. Assigned temperatures establish binding and eligibility, not natural heating/cooling time |
| Production CrowdCluster GPU | One pass, eight captures, 6.979 s | [Crowd record](./shared-crowd/README.md): real colour/depth/shadow programs, held/rewound state, motion, LOD handoff and stable resources |
| Production GP models GPU | One pass, fourteen captures, 107.540 s | [GP record](../compatibility/r31-r4/README.md): original model/call limits, four onboards and same-instance weather |
| Production MX models GPU | One pass, twenty-one captures, 40.767 s | [MX record](../bike/r31-r4/README.md): both dirt machines, all LODs, reachable poses, six onboards and reversible mud |

The three GPU cases ran sequentially in one single-worker Playwright process on the final 670-source build. The complete reporter duration is **157.599915 seconds**, with three expected passes and no errors, flaky results or skips. All 43 original PNGs were individually displayed and reviewed, with separate hashes and observations. Each component record retains the combined command and its own native test duration. SwiftShader measurements establish behavior in this environment, not consumer-hardware performance.

The completed full off-road gate retains its own fourteen source/script fingerprints and original result: twenty jump calibrations, three starts, ten races, 74 classified entrant starts and zero retirements. Thirteen fingerprints still match the final source. The sole changed file is the shared road `BikeVehicle`; the actual dirt adapter bypasses its changed step. That boundary and the passing focused controls are explicit in the [physics record](./r31-r4-physics.json), and the historical full-gate files are unchanged.

## Earlier completed CPU integration runs

These records preserve two completed CPU runs during integration of the motocross upgrade with concurrent MotoGP and Festival work. They are exact summaries of the original Vitest JSON reports, with every test filename, count, outcome and timestamp-derived duration retained. No tests were rerun to create this folder. These runs preceded subsequent AI repairs and the final release gates.

| Run | Result | Files | Reporter start to last file result | Integration scope |
| --- | --- | ---: | ---: | --- |
| [Combined R2 CPU](./r2-combined-cpu.json) | 219 passed; 0 failed, pending or todo | 28 | 135.8692288 s | Motocross combined with MotoGP R2 parent `6e93a4ef452764f2ee0b69797817f91a908d897e` |
| [R3 shared CPU](./r3-shared-cpu.json) | 34 passed; 0 failed, pending or todo | 9 | 18.2709075 s | Incoming GP R3 and Festival shared changes through `493e937b5f48b22a4dc08804a8a17323d539186b` |

The R2 report starts at **2026-10-16 22:45:24.855 UTC**; the R3 report starts at **2026-10-16 23:16:00.329 UTC**. All 37 file results passed, and the per-file assertions reconcile to their respective report totals. No failure messages or skipped/todo assertions are present. The two runs remain separate; this folder does not present their sum as a unique test inventory.

## Counts and duration interpretation

Vitest reports 71 total suites for R2 and 19 for R3 because its suite counters include nested suites. The actual test-file counts are 28 and 9, taken from `testResults.length`.

The JSON reports do not contain a process wall-duration field. The table therefore labels the precise window from `report.startTime` to the latest `testResults[].endTime`. Each file's `durationMs` is derived from its reported end/start timestamps using decimal arithmetic. These values do not include later teardown or report writing, and the file durations are not summed to estimate wall time. Original Unix millisecond timestamps are retained for reproduction.

## Source identity and limits

The R2 summary includes the adjacent `motocross-r2-validation/validated-source.json` record, captured at **2026-10-16 22:47:45.140996 UTC**, after the last CPU result timestamp. It records 655 source files, source digest `307df6de70e0cfd3df261023245a72102e25d4e4b04d290fa8bab888b970379c`, build fingerprint `85c14e6784442ab806d98b4d4fb0559f02affe8a92d9894ec010ed081b7f97f9`, the JS/CSS bundle hashes, and the recorded 636-module build, lint and content-validation outcomes. Its build commit field is null and is preserved as such. The CPU reporter itself does not embed a fingerprint or per-test source attestation.

The R2 source digest reproduces from compact JSON using the recorded `sourceHashes` property order. Its original encoding label calls that mapping sorted; applying a fresh lexicographic key sort gives a different serialization and digest. The summary preserves the original identity and label, records the exact successful reproduction method, and includes the alternate sorted-key digest. The original source record and frozen component evidence have not been edited.

The R3 reporter has no commit, source digest or build fingerprint. Its integration-parent scope comes from the integration task context. No later build identity is attached to this historical run. Neither record establishes validation of the final AI source, the final full-application journey, or a new GPU result.

## Original report identities

| Original record | Bytes | SHA-256 |
| --- | ---: | --- |
| `motocross-r2-combined-cpu.json` | 78,266 | `b6eb1408d3321f0a51b8c311418764ce2267d26f3b30382c7008a379fc3fd09e` |
| `motocross-r3-shared-cpu.json` | 14,209 | `fa4f258f125da30669d333bb68e5de11a94f85b02010dc55b0a24b435e638525` |
| R2 `validated-source.json` | 72,457 | `8e8e1b02930e574842687b9a83f4c19e85b9d4a8861b0d756449a1ba67568b0d` |

To reproduce a summary, parse the matching original report, project all `testResults` file entries, count their `assertionResults` by status, and subtract the serialized start/end timestamps. The summary's `reportedResult` preserves the original reporter counters; `derivedResult` records the independent reconciliation.
