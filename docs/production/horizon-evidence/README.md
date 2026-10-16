# Retained Horizon upgrade evidence

These files support [HORIZON_UPGRADE_VALIDATION.md](../HORIZON_UPGRADE_VALIDATION.md).
Logs, JSON, comparison images and browser screenshots were copied without changing their bytes. The
[manifest](evidence-manifest.json) records their SHA-256 hashes, sizes and original capture paths.
Original scratch paths inside the copied test summary are provenance fields; the relative links
below locate the retained copies in this repository.

| Evidence | What it records |
| --- | --- |
| [Initial broad unit-test log](broad-unit-tests-initial.log) | `npm test`: 356 files and 3,009 tests; 353 files / 3,000 tests passed, with nine failures in three files. |
| [Targeted rerun log](broad-unit-tests-targeted-rerun.log) | The same three failed files, rerun outside the restricted subprocess wrapper: all 13 tests passed. No source or test changes were made for this rerun. |
| [Broad-run summary](broad-unit-tests-summary.json) | Exact initial/rerun commands and counts, failure descriptions, the `spawnSync` EPERM probe, and the recovery of the original still-open full-suite log. |
| [Rendering regressions](rendering-regressions-71-tests.log) | 71 tests passed across 13 files, including the later vehicle, traffic, ground-contact and effect integration changes. |
| [Festival menu DOM regressions](festival-menu-dom-6-tests.log) | Six final keyboard, pointer, map, photo and synthetic-gamepad checks passed with GPU/WebGL disabled. |
| [Real browser journey](journey/journey.json) | Completed production Festival session journey, nine recorded passing checks, source fingerprint, renderer, viewport, movement, assisted race result and exit resource counters. |
| [Journey map](journey/journey-map.png) | Rendered map state from that journey. |
| [Journey photo](journey/journey-photo.png) | Paused orbit-photo state from that journey. |
| [Journey event](journey/journey-event.png) | Started Harbour Opening Run with the real session and renderer. |
| [Journey result](journey/journey-results.png) | Completed, explicitly assisted Harbour Opening Run result. |

## Festival closeout scenes before concurrent MotoGP integration

All three Festival closeout capture sets below retain runtime fingerprint
`8f7a38bbeeec13ef12dc344ffc20a310887e78f0091e17e30c6b1ef4707782b0`, matching the guarded production
build of that composition before concurrent MotoGP integration. The later validated integrated build is
recorded in the separate section below. Original capture pixels and JSON are unchanged. These
captures use native presets on SwiftShader with selected GPU frame submissions; no hardware FPS
claim is made.

| Evidence | What it records |
| --- | --- |
| [Original Medium view](visuals/baseline-medium-day.png) | Baseline runtime at commit `f91463cf506f6feced1a4db9c43af48ac3632410`; 1280 × 720. |
| [Final Medium driving](visuals/accepted-medium-day.png) | Updated vehicle, buildings, windows, streets and HUD. |
| [Final Festival menu](visuals/accepted-medium-festival-menu.png) | Garage, lighting, travel, photo and skill guidance. |
| [Final map](visuals/accepted-medium-map.png) | Route preview and event filters, with the menu hidden beneath the overlay. |
| [Final Medium photo](visuals/accepted-medium-photo.png) | Orbit view, body detail and photo controls. |
| [Medium state](visuals/accepted-medium-state.json) | Original Festival closeout source identity, settings, camera state, renderer counters and empty recorded error lists. |
| [High rainy-night driving](visuals/accepted-high-night-drive.png) / [photo](visuals/accepted-high-night-photo.png) | Final headlight/fill/window balance, red player body and shaped ambient traffic at 960 × 540. |
| [Night state](visuals/accepted-high-night.json) | Exact settings, source identity, native High preset and error/counter observations. |
| [Varda golden-hour driving](visuals/accepted-varda-drive.png) / [photo](visuals/accepted-varda-photo.png) | Mountain cut, camera/tyre grounding, guardrails and slope-following guidance at 960 × 540, Medium. |
| [Varda state](visuals/accepted-varda.json) | Isolated saved discoveries, production travel/start commands, camera positions and recorded errors. This is not a human speed-zone run. |
| [Production main entry](main-entry.json) | Four passing UI checks through the actual main menu and shared application canvas, including photo and return from Festival. Its earlier source fingerprint remains explicit. |
| [Night regressions](night-regressions-41-tests.log) | 41 tests across six suites; later fill-value adjustment passed scoped lint. |
| [Photo/bridge regressions](photo-bridge-regressions-19-tests.log) | 19 tests across three suites, including the actual camera branch with normal 3.5 m orbits on either bridge level. |
| [Festival closeout gate record](closeout-gates.json) | Exact commands, timestamps, exit codes and hashes for the pre-integration lint/content/build checks. |
| [Festival closeout guarded build](closeout-guarded-build.log) | Successful full TypeScript check and Vite production build after the Festival lighting/photo corrections, with no protected source changes. |
| [Lint](closeout-lint.log) / [content validation](closeout-content.log) | Successful complete project lint and content validation. |

## Controlled vehicle comparisons

These earlier static geometry-review images use the same camera and lighting within each pair.
They are separate from the later Festival closeout world-lighting captures above.

| Vehicle view | Before | After |
| --- | --- | --- |
| RH3 front | [Original](vehicles/rh3-front-before.png) | [Detailed apertures and optics](vehicles/rh3-front-after.png) |
| SC7 rear | [Original](vehicles/sc7-rear-before.png) | [Detailed cooling and rear lamps](vehicles/sc7-rear-after.png) |

[Vehicle look-development statistics](vehicles/lookdev-stats.json) retain the measured draw and
triangle counts for those controlled scenes. World comparisons have different framing, traffic
states and capture-frame/pass counts and must not be treated as matched performance benchmarks.

The broad run and targeted rerun are separate results. The later focused rendering tests overlap
some broad-suite coverage and must not be added to its test total. CPU tests and software-rendered
browser captures do not establish a target-device frame rate.

## Reproduction entry points

Run from the repository root. These commands describe the same check selections; the complete
broad-run and rerun shell commands are also retained in the JSON summary.

```sh
npm test
npx vitest run tests/studio-qa-tools.test.ts tests/review-tools.test.ts tests/pit-release.test.ts
npx vitest run \
  tests/reflections.test.ts tests/ibl-energy.test.ts \
  tests/festival-vehicle-detail.test.ts tests/festival-car-switch.test.ts \
  tests/probe-detail.test.ts tests/wet-reflection.test.ts \
  tests/festival-presentation.test.ts tests/festival-traffic-visuals.test.ts \
  tests/spray-lighting.test.ts tests/effects-upload.test.ts \
  tests/festival-ground-height.test.ts tests/festival-effects-integration.test.ts \
  tests/spray-plume.test.ts
node --experimental-transform-types scripts/horizon-gameplay-validation.ts
```

The DOM run uses [the six-test specification](../../../e2e/49-festival-menu-access.spec.ts) with
an isolated Playwright configuration: one worker, no retries, headless Chromium, 60-second test
timeout, 10-second expectation timeout, and browser arguments `--disable-gpu --disable-webgl`.
It does not start a renderer/worker fixture or a global graphics-backend probe. The specification
builds its production HUD/input fixture through Vite. The recorded invocation was:

```sh
npx playwright test --config /workspace/scratch/3a81635718f0/festival-dom-playwright.config.mjs
```

For the real browser journey, serve the repository through Vite or serve a production review build
that includes `e2e/fixtures/horizon-session.html`. The retained script accepts the target URL,
output directory and graphics quality through these variables:

```sh
HORIZON_REVIEW_URL=http://127.0.0.1:4188 \
HORIZON_REVIEW_OUTPUT=test-results/horizon-review \
HORIZON_REVIEW_QUALITY=low \
node scripts/horizon-browser-review.mjs
```

The browser script deliberately holds GPU submissions between requested still frames for
software-renderer readback. Simulation and input continue normally; race completion uses the
production autopilot and is marked assisted. See the validation report for the exact scope and
each capture's source identity and interpretation limits.

## Concurrent main integration

The validated local checkpoint `06e20b2162158e04c499e48600aefbf531076fef` preserves the concurrent MotoGP commit
`6e93a4ef452764f2ee0b69797817f91a908d897e` as its parent. The integrated production build records
runtime fingerprint `13a1175f3deddf9bb25dbed0efadda0da0888c8d3f9aefe13d75b8f0b9b5f283`.
These post-integration checks are separate from the earlier Festival closeout records above.
The original build identity's commit field names the local checkpoint. A further motorcycle
slipstream integration and the final publication build are recorded below. Original JSON fields
remain unchanged.

| Evidence | What it records |
| --- | --- |
| [Integrated gate record](integrated-gates.json) | Exact lint/content/source-guarded build commands, UTC timestamps, exit 0 for each check, log hashes and integrated build identity. |
| [Integrated lint](integrated-lint.log) | Complete project ESLint over `src tests e2e scripts`, passed. |
| [Integrated content validation](integrated-content.log) | `Content valid` on the combined runtime. |
| [Integrated guarded build](integrated-guarded-build.log) | Full TypeScript check and Vite production build, passed under the source guard. This is not a run of `npm run check:stable`. |
| [Integrated regressions](integrated-regressions-58-tests.log) | 58 passing tests in eight files, covering shared road/startup/race-view/motorcycle presentation and Festival vehicle/guidance/ground/effects integration. |
| [Integrated production main entry](integrated-main-entry.json) | Four passing UI checks on the exact `13a1175…` runtime/local checkpoint: main menu and circuit preview, RH3 Festival entry on the shared canvas, pause/photo/return, and exit to the session menu. Low, 960 × 640, isolated profile, no stubs or simulation/capture hooks; empty recorded runtime and HTTP error lists. |

These six artifacts were copied without modifying their original bytes. The integrated gates did
not repeat the broad unit suite, and none of the earlier images or capture JSONs was relabelled to
the new source fingerprint. The fresh production main-entry JSON remains dated evidence for its
recorded checkpoint and is included in the manifest with the integrated gate/test artifacts.

## Motorcycle slipstream integration checkpoint

This source checkpoint preserves main commit `8f1823ee566815c0f0469c84519e9f3c57be91e8`.
Its source-guarded production build records runtime fingerprint
`4d7d70ed9b2c8c927c4fa419bfc57ca29b570e54c9a8121bd11c075e64a9e419` and local checkpoint
`1e45b1ec30a844586b8bb5241141f9bb51cb862d`. Section 9 of the validation report explains how
this small motorcycle-physics change relates to the unchanged Festival rendering and main-entry
paths. The earlier browser records keep their original source identities.

| Evidence | What it records |
| --- | --- |
| [Publication gate record](publication-gates.json) | Exact final commands, timings, successful exits, original log hashes and final runtime identity. |
| [Final targeted regressions](publication-slipstream-tests.log) | 14/14 passing tests across motorcycle slipstream, motorcycle presentation and Festival effects. |
| [Final scoped lint](publication-slipstream-lint.log) | Successful lint over all three files in the incoming motorcycle change. |
| [Final guarded production build](publication-guarded-build.log) | Full TypeScript check and Vite build with protected source inputs unchanged throughout. |

The earlier [initial publication gate record](publication-initial-gates.json) and
[partial build log](publication-initial-guarded-build-partial.log) are also retained. That first
successful build lost the later output at its replaced live log pathname; the final guarded build
above was repeated with buffered output to retain a complete log. Both builds emitted the same
runtime fingerprint. No earlier test or image evidence was rewritten.

## Final composition with the concurrent motorcycle bodywork

The final source preserves main commit `8523372aa27e831e826807982c225f203d6e23ff` and
records runtime fingerprint `b2e96b50396e622c1f490b05f09931ec0a203d3525f28d25dca7574796ac213b` at validated local checkpoint
`6023ba632af8822d9d45339508267d4899fc503f`. Section 10 of the validation report explains the integration
and the exact scope of earlier capture evidence.

| Evidence | What it records |
| --- | --- |
| [Final gate record](final-gates.json) | Exact commands, successful exits, timings, log hashes and final runtime identity. |
| [Final bodywork integration tests](final-bodywork-regressions.log) | 18/18 passing tests in four files: cooling geometry, motorcycle presentation, Festival effects and vehicle switching. |
| [Final bodywork lint](final-bodywork-lint.log) | Lint of all incoming TypeScript files, passed. |
| [Final guarded production build](final-guarded-build.log) | Complete captured TypeScript and Vite build output, with protected inputs unchanged during the command. |
