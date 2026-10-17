# Solvane Blender continuation — validation and handoff

## Recorded result

The playable Festival/Solvane runtime upgrade is committed as [`2cacf1d1709ac0e58328a06d1ffcb0790b46d033`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/2cacf1d1709ac0e58328a06d1ffcb0790b46d033). The [dedicated committed-source validation run](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/39001905847) passed **all eight jobs**: native-source re-export, build/contracts, five in-game compositions and one complete input journey. The saved Blender geometry is actually loaded by the game; it is not a render-only replacement.

This is an implemented and tested continuation, **not a claim of commercial-reference graphics parity or a finished release**. The original [Festival reference pass](HORIZON_REFERENCE_IMPLEMENTATION.md) and its [historical evidence](HORIZON_UPGRADE_VALIDATION.md) retain their own source identities. They are not relabelled as results from this commit.

## What changed in the runtime

| Area | Implemented change | Boundary |
| --- | --- | --- |
| Native detail library | Editable Blender source and reproducible export; original moulded shopfronts, recessed joinery, projecting balconies and mounted rail finials. Near/far geometry is inserted into existing collision-backed building footprints. | Repeated modules, not individually authored commercial-image buildings or new interiors. |
| Coastal scenery | Three work launches with shaped hulls, cabins, deck equipment, rigging, rails and fenders; distance-based detail and small water motion. | Scenery, not a boat-driving mode. |
| Checkpoints and vehicle aero | Cloth-shaped checkpoint flags and separate EH-3 main plane, flap and support geometry; current-event colours survive quality changes. | The moving air-brake flap is presentation, not a newly measured aerodynamic device. |
| Lighting and materials | Nearby warm street pools, non-compounding wet finish response and integration with the existing reflection system. | Four/six/eight unshadowed pools on Medium/High/Ultra; Low retains emissive fixtures. |
| Driving presentation | Anticipatory braking guidance with conservative wetness response; camera boom tests oriented buildings and vertical bounds, including after damping. | Advisory speed cues and camera clearance, not physics inferred from screenshots. |
| Skills and transitions | Non-contact front-to-back traffic passes and sustained left/right drift transitions feed bounded skill bonuses; lifecycle and cancelled-load protections remain. | Original rules with regression coverage, not a recovered commercial scoring algorithm. |
| Runtime integration repair | Corrected a leading slash that made the asset URL protocol-relative; tests now exercise actual same-origin acquisition, parsing and cancellation. | The successful current browser results are after this fix. Earlier failed candidate captures are not passes. |

The region plans **1,232 frontage bays and 1,467 balcony placements**, but submits a culled and budgeted subset. These numbers do not describe thousands of simultaneously rendered unique assets.

## Source, native asset and build identity

| Record | Value |
| --- | --- |
| Runtime commit | `2cacf1d1709ac0e58328a06d1ffcb0790b46d033` |
| Production source fingerprint | `776130cd7a4d65893c70038d2019a7e4203045fc05839b8e8d692c3a0610f3e0` |
| Blender | 5.2.2 LTS, build `d13f752e3b9c` |
| Editable source | [`authoring/solvane/detail-kit.blend`](../../authoring/solvane/detail-kit.blend) |
| Runtime GLB | [`public/models/solvane/detail-kit.glb`](../../public/models/solvane/detail-kit.glb) |
| GLB size | 1,794,216 bytes; twelve named templates; no embedded textures or external buffers |
| GLB SHA-256 | `aa9da4d19a73889affaf59a5e10ff1d5d8f18f8dbb3195f7d87f4e22734fbb1c` |

The committed native-source job reopens the actual `.blend`, exports into a temporary directory and compares the bytes with the shipped GLB. A separate local Blender invocation repeated that check successfully. It does not rebuild geometry and then assume that the saved source matches.

The resumed local workspace was reconstructed from the retained source archive and the exact authored-source receipt. **All 1,258 runtime/source, public-asset, script and browser-fixture hashes matched the committed day-driving identity**, with zero missing or different entries. This proves that stated runtime scope, not complete Git-tree equivalence: some historical workflow files in the archive were older. The local build correctly reports `commit: null`, because an archive is not a Git checkout, while reproducing the exact production fingerprint above.

Detailed identities and checksums are retained in [`solvane-validation-summary.json`](solvane-validation-summary.json). The handoff archive includes the raw browser reports, native export log, local build receipt, source-equivalence receipt and complete local test log.

## Tests and playable checks

| Check | Result and exact scope |
| --- | --- |
| Committed focused suite | **58 tests in seven files passed** in the dedicated CI contracts job. |
| Committed lint/content/type/build | Passed with the source-change guard. Production build includes normal warnings about large chunks; it is not a zero-warning claim. |
| Local full unit/integration suite | **3,274 tests in 393 files passed** using the unmodified configuration: one worker, 120,000 ms per-test timeout. Recorded duration 1,144.66 seconds. |
| Local production build | Exit code **0** under the source-change guard; fingerprint matches committed CI. |
| Native-source round trip | Byte-identical GLB from committed-source CI and the independent local reopen/export. |
| Scripted gameplay harness | Four completed checks: Harbour Opening Run, the runway autopilot pass, and full-throttle TC-1/EH-3 runway passes. No post-start pose forcing or off-route time in those recorded checks. This is scripted simulation, not human playtesting. |
| Browser compositions | All five views passed at the original viewport/preset and frame counts, with the authored asset loaded and no recorded page/console errors or failed HTTP assets. |
| Real input journey | All nine stages passed, including keyboard throttle/brake, map/discovery restrictions, photo orbit, garage changes, event entry, results and session disposal. |
| Reference-audit utility | Original uploaded ZIP passed all 100 checks; **fourteen synthetic rejection/success tests passed**. |

The full-suite log contains intentional rejection messages from the source-stability unit tests operating on temporary fixtures. Those are expected test outputs, not mutations of the actual application. The complete Vitest success summary and absence of an outer-guard mutation diagnostic are preserved; the first detached full-suite launcher did not retain a separate subprocess exit-code receipt. The dedicated CI contracts and later local build do retain authoritative successful command outcomes.

The keyboard journey moved the car **5.45 metres**, reached **16.90 km/h**, then braked to **0.053 km/h**. The longer Harbour race explicitly used the production assistance feature, produced a completed result at approximately **105.67 seconds**, and returned through the visible results screen. It was not a manual win. Resource counters fell from **666 to 1 geometries** and **40 to 17 textures** on exit; these are measured renderer counters, not a claim that every renderer-internal allocation is zero.

## Actual browser evidence

All captures below come from Chromium 140 with **Mesa llvmpipe software rendering**. Day/Low driving views retain the normal chase camera and HUD. The storefront, coast and night/rain views are explicitly labelled paused fixed-camera inspections; only their interface is hidden. The input journey uses a 960 × 540 Low viewport; the five composition views use 1280 × 720.

| View | Preset / capture | Submitted draw calls | Submitted triangles | CI artifact |
| --- | --- | ---: | ---: | --- |
| Day driving | Medium; normal chase/HUD | 343 | 1,169,907 | [Day drive](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/39001905847/artifacts/12089832686) |
| Shopfront and balcony | Medium; fixed camera | 157 | 618,344 | [Storefront](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/39001905847/artifacts/12090715749) |
| Night/rain street | Medium; fixed camera; four active lamp sockets | 310 | 1,155,283 | [Night/rain](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/39001905847/artifacts/12090860977) |
| Coastal launch | Medium/sunset; fixed camera | 132 | 542,045 | [Coast](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/39001905847/artifacts/12089818288) |
| Low driving | Low; normal chase/HUD; no near facade instances | 229 | 668,070 | [Low drive](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/39001905847/artifacts/12090042358) |
| Complete input journey | Low; manual launch/brake, explicitly assisted race | Not a frame-budget benchmark | Not a frame-budget benchmark | [Journey](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/39001905847/artifacts/12090058896) |

These are submitted-frame observations, **not hardware FPS, a before/after speedup, or a representative worst-case benchmark**. Raw software-render timings remain in the original reports but are not converted into target-device claims. The retained native Blender inspection images are separately labelled and are never substituted for game captures. CI artifacts have finite retention; the handoff archive contains the actual images and reports as well.

## All 100 supplied references

The [individual continuation ledger](SOLVANE_REFERENCE_CONTINUATION.md) accounts for every numbered image: **39 inform additional changes, 55 retain the earlier implementation, and six are promotional/hardware context only**. All 100 source images have distinct validated hashes, matching byte counts, filenames and original source URLs. The original archive SHA-256 is `fa010b4b80fe39eb68b51d67bac06de1f3845619ab4ed546083d3caaffc65e59`.

The resumed visual revisit used ten labelled contact sheets and the existing individual observations. It is not 100 matched full-resolution before/after game captures. The source archive identifies mixed official media; it does not establish that each image is a PS5 gameplay capture. No proprietary reference image is included in the new game asset library or this public evidence record.

The read-only [reference audit tool](../../tools/solvane/verify_reference_pack.py) verifies the supplied ZIP against the [manifest-anchored JSON integrity record](solvane-reference-integrity.json) and original ledger. It makes no network requests and extracts no media. See the [native authoring guide](../../authoring/solvane/README.md) for export and verification commands.

## Limitations and next acceptance work

The inspected images still show repetitive architecture, simplified base vehicle surfaces and glass/interior treatment, and weak grounding on Low. The new near-detail library improves construction and silhouette detail but does not erase those limitations. Distinct hero-body surfacing, richer facade variation, better Low-preset contact cues and target-device profiling remain substantial work.

High/Ultra free-roam performance, extended streaming drives, every event driven by a person, mobile/console certification, and a complete 100-scene commercial-reference recreation were not established. The three scenery launches do not add boat gameplay; new storefronts do not add traversable rooms; reference sales/hardware panels do not become invented game modes.

The wider repository [Build and validation run](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/39001905825) was still queued at the recorded checkpoint. The green dedicated run does **not** declare that wider release pipeline green, publish a new live build, or certify production readiness. Existing release gates were left unchanged. This documentation/audit handoff does not alter the validated runtime.
