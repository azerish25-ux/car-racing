# Solvane R2 — street construction, vehicle grounding and corner guidance

## Delivery and acceptance boundary

This change integrates the actual R2 source, Blender library and runtime assets into the normal repository paths. It replaces the temporary compressed source-transfer arrangement; the game no longer requires a candidate-hydration workflow to obtain these files. The earlier R1 shopfronts, balconies, boats, checkpoint flags and EH-3 wing remain intact.

**This is a source delivery with recorded partial acceptance, not a finished release or Forza graphics-parity claim.** The original R2 preparation, three visual compositions and complete input journey passed. Its separate pace browser check failed because the review waited for a race Start card at a drive-through drift zone. The review has been corrected, and two simulation regressions pass. The corrected hosted browser check was still queued when this integration record was written; it is not counted as successful.

The repository's wider Build and validation workflow and publication gates are unchanged. Committing this source does not assert that those gates passed or that a new live build was published.

## Implemented changes

| Area | Actual implementation | Explicit boundary |
| --- | --- | --- |
| Blender street library | Original awning, wall condenser and drainage geometry, each with near/far templates. Canvas has shaped thickness, seams and a scalloped valance; condensers have recessed fans, guards, louvres, brackets and plumbing; drainage has elbows, collars and mounts. | Three component families, not individually rebuilt buildings or new interiors. |
| Runtime street placement | Road-facing placement on existing building footprints, colour variation, cell/frustum culling, distance ordering and near/far hysteresis. Up to fifteen material/LOD batches. | The 2,458 planned placements are not simultaneous unique rendered models. |
| Vehicle grounding | Ground-conforming body and tyre darkening from physical wheel contact telemetry; rejects surface-height discontinuities, fades with clearance/load and clears on travel or rewind. | Approximate local contact shading, not ray-traced ambient occlusion. At most eight vehicles, forty patches, 320 triangles and one draw. |
| Corner guidance | Reads the actual event route and integrates a conservative speed envelope using curvature, grip, wetness and downhill grade; includes a 0.7-second reaction look-ahead. | Advisory tuning, not a vehicle-specific optimal lap or automatic steering/braking. |
| Driving interface | Separate direction/severity, bend distance, target speed and prepare/lift/brake cue; suppresses inappropriate cancelled, finished, reverse, wrong-layer and off-route advice. | Existing scoring, legal road limits and drive-through event rules are retained. Final hosted pace-layout acceptance remains pending. |
| Resource ownership | Authenticated compressed/native acquisition, bounded decompression, cancelled-load disposal, shared material/geometry cleanup and session-exit checks. | Functional/resource checks do not establish target-device frame rate. |

The six template names are `awning_near`, `awning_far`, `service_near`, `service_far`, `pipe_near` and `pipe_far`. See the [authoring guide](../../authoring/solvane/README-STREET-R2.md) for units, component counts, quality budgets and export commands.

## Source and native asset identity

The accepted preparation used checkout `0353eb55d5300fdf440b5465c50c166a79af7f0d` with the authenticated R2 file overlay. Its production source fingerprint is `81e89e8d42158958a7084493bfa7647b38187bc921cedacdfebe71569f40b5e7`; its build correctly records `commit: null` because the candidate was not the clean checkout tree.

GitHub's complete comparison from that checkout through integration parent `55b2c522effaf9a7def55aa346f17c84f11c845f` contains only `.github` files. It therefore does not replace the accepted production source with a newer, untested game implementation. The corrected browser helper and added regression tests do not change the application's runtime files. Concurrent MotoGP R5 and motocross development are retained by building on the current parent, not resetting to an older archive.

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| Editable `street-kit.blend` | 158,461 | `c3c1188f0ea5a1d5c6a42749bcf6c104a2e3ed8b7af978b4e6b0546635f5c233` |
| Runtime `street-kit.glb` | 166,988 | `3dbf14c8a2e476ee1e426026e950aaf97de4c905b425accbc4a62bcf94869ca7` |
| Lossless compressed `street-kit.bin` | 50,019 | `2d55c24083a2ffe3150465e76256271cccb75e5a77e39da378e1baab44210906` |

The `.bin` contains the gzip transport of the same GLB, not another model. The runtime verifies both transport and expanded geometry. Browsers without native gzip decompression can request the ordinary GLB. There are no embedded reference photos, external texture resources, copied trademarks or font files in the new native library.

Both the successful hosted preparation and the resumed local Blender 5.2.2 LTS execution reopened the saved `.blend` and produced byte-identical GLB, transport and manifest files. Rebuilding geometry from the recipe was not substituted for reopening the saved source. The [source receipt](solvane-r2-source-receipt.json) records all twenty-one delivered source/asset files individually.

## Recorded validation

| Check | Recorded result and scope |
| --- | --- |
| Original R2 preparation | [Run 39060789251](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/39060789251): preparation passed native generation/reopen, 102 tests in 13 files, lint, content validation, scripted driving and production build. The run as a whole is **not green** because its original pace review failed. |
| Original R2 visual compositions | Low chase/HUD, fixed-camera street construction and fixed-camera night/rain checks passed with actual authored assets loaded. Their baseline and candidate captures are retained separately. |
| Original R2 complete input journey | All nine stages passed: loading/discovery, keyboard launch/brake, map restrictions, photo orbit, garage changes, race entry, assisted result, Continue and session exit. |
| Local resumed targeted suite | 130 tests in 18 files passed with exit code zero on the restored `e53f010` source plus R2. This includes the new event-entry regressions. It is **not** a full-suite result for the newer combined repository. |
| Corrected entry contract tests | Coast to Summit produces a race card and wet right-turn advice. Kestrel does not produce a race card; real throttle input starts its drive-through zone, braking stops the car and cancellation returns to free roam. |
| Corrected hosted entry/pace check | [Run 39076920152](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/39076920152), checkout `b0b1841098d061ddb45e6dde440d3799fffa8c96`: queued at integration record. No successful browser result is inferred from the simulation tests. |
| Original reference ZIP | All 100 distinct image hashes, sizes, paths and attributed URLs matched; fourteen synthetic audit tests passed. |
| Current full release pipeline | Not certified by this record. Existing required checks remain authoritative. |

The original keyboard journey moved the car 5.035 metres, reached 15.904 km/h and braked to 0.037 km/h. Its Harbour race used the **explicit production assistance feature**, completed in about 105.67 seconds and returned through the real results interface. This was neither a human-driven win nor a simulated claim of human playtesting. Renderer resource counters on exit changed from 674 to 1 geometries and 40 to 17 textures; renderer-owned residual allocations are not claimed to be zero.

The original pace failure was a review error: `kestrel-drift` is a drive-through `drift-zone`, so waiting for its Start card can never succeed. The repaired helper uses `coast-to-summit` for the race-card lifecycle and a separate real-keyboard Kestrel entry. It retains the original timeout rather than weakening acceptance, and now saves actual game state on failure. Local Chromium navigation was blocked by administrator policy, so that attempted local browser run is recorded as blocked, not passed.

## Actual visual evidence

These are **Chromium 140 / Mesa llvmpipe software-rendered game captures**. Native Blender component inspections are stored separately and are never presented as gameplay screenshots. No hardware FPS or rendering-speed improvement is inferred from software-GPU timings.

| View | Preset and presentation | Observed R2 street submission | CI artifact |
| --- | --- | --- | --- |
| Low drive | 1280 × 720; normal chase camera and HUD | 0 near / 31 far instances, 7 material/LOD batches | [Low drive](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/39060789251/artifacts/12111971242) |
| Street construction | 1280 × 720 Medium; explicitly paused fixed-camera inspection | 3 near / 0 far instances, 5 batches | [Street construction](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/39060789251/artifacts/12112710843) |
| Night/rain | 1280 × 720 Medium; explicitly paused fixed-camera inspection | 11 near / 43 far instances, 15 batches | [Night/rain](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/39060789251/artifacts/12111854511) |
| Input journey | 960 × 540 Low; real interface and keyboard, assisted race explicitly labelled | Actual session lifecycle, not a frame-budget benchmark | [Input journey](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/39060789251/artifacts/12111597209) |

The three compositions each recorded one grounded vehicle with five contact patches, forty contact triangles and one contact draw. Street batch counts exclude other scenery, vehicles, shadow passes and post-processing. They must not be presented as whole-frame budgets. The handoff ZIP contains the original captures/reports and labelled before/after comparisons because hosted artifacts have finite retention.

Visual review confirms added facade construction and contact cues, but still shows repetitive building masses, simplified windows and vehicle surfaces, and uneven overall scene richness. The street model addition is visible; it is not a transformation of every building or the hero-car bodywork.

## All 100 references

The [individual R2 ledger](SOLVANE_R2_REFERENCE_LEDGER.md) retains every numbered image and its narrow interpretation: **80 inform R2 additions, 14 retain earlier interpretations, and 6 are context-only promotional/hardware images**. Shared implementations overlap: 77 rows mention contact shading, eight street detail and eight pace guidance. These are not 100 independently completed game features.

Archive SHA-256: `fa010b4b80fe39eb68b51d67bac06de1f3845619ab4ed546083d3caaffc65e59`. Visual continuity used numbered contact sheets and individual observations, not 100 matched full-resolution game recreations. The source pack contains mixed official media and does not establish that every image is a PS5 gameplay capture. Reference photographs are not copied into the public runtime or redistributable handoff.

## Reproduction and remaining work

The read-only `Solvane R2 source validation` workflow now operates on committed source: it reopens the actual Blender file, compares exports, runs focused contracts/lint/content/driving/build, and exercises runtime compositions plus the corrected entry and input journeys. It does not hydrate a hidden patch, depend on an expiring candidate archive, move branches or publish a release.

Local core checks from a normal repository checkout:

```sh
npm ci
npx vitest run tests/solvane-*.test.ts tests/festival-ground-height.test.ts tests/festival-effects-integration.test.ts tests/festival-skill-chain.test.ts tests/festival-car-switch.test.ts tests/festival-presentation.test.ts
npm run lint
npm run validate:content
npm run build
```

The full unit suite, sustained High/Ultra free-roam performance on target hardware, extended streaming and all events driven by a person remain separate acceptance work. The wider visual brief still needs substantial hero-body surfacing, interior/glass treatment, more distinct architecture and stronger landscape/vegetation composition. The corrected hosted pace-layout result must also be inspected before that specific browser acceptance is closed. None of these are represented as finished by this source integration.
