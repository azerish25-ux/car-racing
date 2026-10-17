# Earlier main45 run: before camera-support clearance correction

**Historical passing automation; superseded for final visual acceptance.** This run predated the stadium replay-camera support placement correction. Subsequent review found supports overlapping nearby legal riding lanes; the two retained stadium views document that earlier state. The corrected-source journey and its separate final image review are now retained in the [parent gameplay evidence](../README.md). This archive preserves the earlier measurements and images without relabeling them as corrected-source evidence.

## Exact run identity

The normal production application and worker passed **one test in 555.915 seconds**, from **2026-10-17T00:04:45.586000Z** through **2026-10-17T00:14:01.501000Z**. The complete Playwright reporter duration was **565.929439 seconds**, from **2026-10-17T00:04:44.289000Z** through **2026-10-17T00:14:10.218439Z**. These are execution measurements from the saved report, not the longer memory-sampler span.

```sh
npx playwright test -c playwright.motocross.config.ts e2e/45-motocross-gameplay.spec.ts
```

The historical build fingerprint is `d90b8bb6e400a4764cf0e079d822edf13cd0c1979218ecc855a096fda28269f5`, with source SHA-256 `dc8777face456bed880b57643191beec29101678c5581085a5adc0e8d9140c6f` across **665 source files** and the recorded **12 context files**. Its integrated parent is `577a6e3ac010ab0ec9e8f5c53e4f1c2c385af2f7`. These values identify this earlier run rather than any subsequent clearance repair.

The observed backend is **WebGL2 through ANGLE / Vulkan SwiftShader**, at a recorded render size of **1280 × 800** using the medium graphics configuration. The separately preserved backend probe reports GL error 0, the expected clear/readback pixel and no physical-hardware validation. This is functional software-renderer evidence, not a hardware FPS or load-time benchmark.

## What the automation established

Visible controls select outdoor Valley Ridge with MX450 and stadium Arena Nord with MX250. Each session reaches its complete production preparation gate with eight correctly indexed machines, tick 0, manual control and no pace-car phase. The test clicks the start-gate control, applies real player throttle with W, and only then explicitly enables the built-in AI demonstration with G. Diagnostics are read without changing application or simulation state.

| Observation checkpoint | Machine | Signed course progress after AI enable | Persisted qualifying airtime | Recorded landing speed |
| ---------------------- | ------- | -------------------------------------: | ---------------------------: | ---------------------: |
| valley-ridge-mx        | mx450   |                              210.474 m |                   1.095833 s |           4.232067 m/s |
| arena-nord-sx          | mx250   |                              155.893 m |                   0.562500 s |           3.669504 m/s |

The checks also require at least 20 simulated seconds after AI enable, at least 100 m of signed wrap-aware progress, a grounded touchdown with nonzero landing telemetry, at least 10 seconds of presentation-time advancement, and finite frame values. The maximum observed safety-car phase is 0 in both venues. Separate W-input observations record AI disabled and throttle 1. The complete original journey records preserve their exact numeric values and every observation.

For each venue, the test captures the actual menu and chase view, presses C and verifies the onboard mode, presses Escape and verifies the acknowledged worker pause and unchanged tick, then returns to the paddock and verifies reset presentation clocks. It finally asserts no collected page or console errors. The extended course traversal is explicitly AI-assisted; the screenshot timing is later than the landing-observation checkpoint. Full-race classification and final screenshot approval are separate checks.

## Memory: execution windows only

The cgroup limit was **8,589,934,592 bytes (8 GiB)**. The highest sampled `memory.current` within both actual execution windows was **7,229,112,320 bytes (6.732635498 GiB)** at **2026-10-17T00:12:22.357994+00:00**. This is the maximum of approximately five-second samples, not an instantaneous high-watermark or Chromium-only memory. The shared cgroup includes process memory, filesystem cache and kernel memory.

The nearest baseline before the run was **3,312,734,208 bytes** at **2026-10-17T00:04:42.231554+00:00**. Cumulative event counters were unchanged across the execution windows and their immediate bracketing samples: `max` stayed 295191, `oom` stayed 4, and `oom_kill` stayed 3. Thus this run added **zero OOM or OOM-kill events**; the nonzero historical totals belong to earlier activity.

| Window            |     Duration | Included samples | Before-window samples | Later samples excluded |
| ----------------- | -----------: | ---------------: | --------------------: | ---------------------: |
| Test execution    |    555.915 s |              111 |                     2 |                     53 |
| Complete reporter | 565.929439 s |              113 |                     2 |                     51 |

The raw sampler contains **166 samples**, beginning at **2026-10-17T00:04:37.218047+00:00** and ending at **2026-10-17T00:18:22.620941+00:00**. It continued after the reporter finished. Those **51 late samples** are preserved in `memory.jsonl` and excluded from the reporter-window summary. The nearest boundary samples are retained separately to compare cumulative event counters; their memory readings do not enter the in-window maximum.

## Retained historical files

- `arena-nord-sx-actual-chase.png` and `arena-nord-sx-actual-onboard.png` are original, unmodified captures of the stadium state before camera-support clearance was corrected. They are not final visual approval images.
- `valley-ridge-mx-journey.json`, `arena-nord-sx-journey.json` and `motocross-production-journey.json` are the three complete original telemetry attachments.
- `test-run.json` records the exact result, command, source identity, all 12 original attachment hashes, visible actions, error assertion and diagnostic limitations.
- `browser-backend.json` is the actual setup probe written during this reporter window. `environment.json` extracts selected graphics, preparation, asset and presentation diagnostics from the original records.
- `memory-summary.json` separates the reporter and test windows; `memory.jsonl` preserves every raw sample, including the explicitly excluded later interval.
- `main45.log` preserves the original run output, and `journey-actions.log` preserves the original action-log attachment.

The complete outside-repository checkpoint, including all eight original PNGs, all 12 attachments, HTML/decoded reports and the validated source record, remains preserved at `motocross-release-validation/main45`. The repository archive includes only the two relevant stadium PNGs to avoid duplicating all earlier images. The passing test used `trace: retain-on-failure`, so it did not retain a `trace.zip`; no missing trace is presented as recorded evidence.
