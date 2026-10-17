# Production motocross gameplay evidence

The normal game application and simulation worker passed the complete two-venue journey after the MX/SX replay-camera support clearance correction. This folder contains all **eight original captures**, all **three complete journey records**, exact execution results, and the observed memory/backend evidence. The separately owned [visual-review.json](./visual-review.json) contains the root reviewer's observations for all eight matching images.

## Exact run identity

**One test passed in 661.875 seconds**, from **2026-10-17T00:44:13.664000Z** through **2026-10-17T00:55:15.539000Z**. The complete Playwright reporter duration was **685.546460 seconds**, from **2026-10-17T00:44:11.803000Z** through **2026-10-17T00:55:37.349460Z**. These values come from the saved result; the longer sampler interval is not test execution time.

```sh
npx playwright test -c playwright.motocross.config.ts e2e/45-motocross-gameplay.spec.ts
```

The build fingerprint is `82b5018336f9fb2c9ae1c2fcc7d11d1c3011209ec2e1c8471be5111c033c52e8` and source SHA-256 is `7733bb95ae33dc962eb2e6d07b2d3480dac3276a50753733268a68b22f500d36`, covering **667 production source files** and **12 verification context files**. The integrated parent is `31626200d4a79e8173f70d587a14c09176d0aa7f`. [test-run.json](./test-run.json) retains the exact context and bundle hashes. The complete source inventory, all context hashes, build identity and main bundles match the separately retained post-run source record.

The observed backend was **WebGL2 through ANGLE / Vulkan SwiftShader**. The actual setup probe reports GL error 0 and its expected clear/readback pixel; it does not validate physical graphics hardware. The original renderer diagnostics retain each venue's real resolution, graphics configuration, completed preparation stages, scanned-ground resources, and presentation state in [environment.json](./environment.json). This is functional software-renderer evidence, not a hardware FPS or load-time benchmark.

## What the automation established

Visible controls select outdoor Valley Ridge with MX450 and stadium Arena Nord with MX250. Each session completes normal preparation and initializes eight correctly indexed machines at held tick 0, with manual control and no safety-car phase. The test clicks GO TO THE GATE, applies real player throttle with W, then explicitly enables the built-in AI demonstration with G. Diagnostic observations remain read-only.

| Observation checkpoint | Machine | Manual W-input speed | Signed progress after AI enable | Persisted qualifying airtime | Recorded landing speed |
| ---------------------- | ------- | -------------------: | ------------------------------: | ---------------------------: | ---------------------: |
| valley-ridge-mx        | mx450   |         4.955341 m/s |                       271.398 m |                   0.479167 s |           2.597949 m/s |
| arena-nord-sx          | mx250   |         8.417834 m/s |                       144.426 m |                   0.454167 s |           4.292489 m/s |

The checks require at least 20 simulated seconds after AI enable, at least 100 m of signed wrap-aware progress, persisted qualifying airtime with a grounded touchdown and nonzero landing telemetry, at least 10 seconds of presentation-time advancement, and finite frame values. Separate manual-input records preserve the actual throttle and AI-disabled state. Both complete venue records retain every observation and their maximum observed safety-car phase.

For each venue, the test captures the actual menu and chase view, presses C and verifies the onboard mode, presses Escape and verifies the acknowledged worker pause with unchanged tick, then returns to the paddock and verifies reset presentation clocks. The final collected page/console error assertion passes. The extended traversal is explicitly AI-assisted. Landing observations and later screenshots have different times; full-race classification and broader performance claims are separate validations.

## Memory: execution windows only

The shared cgroup limit was **8,589,934,592 bytes (8 GiB)**. Within the complete reporter window, the highest sampled `memory.current` was **7,287,103,488 bytes (6.786643982 GiB)** at **2026-10-17T00:52:51.853189+00:00**. This is an approximately five-second sampled maximum, not an instantaneous high-watermark or Chromium-only memory. The shared cgroup includes process memory, filesystem cache and kernel memory.

The nearest pre-reporter baseline was **3,533,373,440 bytes** at **2026-10-17T00:44:11.562297+00:00**. The nearest samples bracketing the reporter window recorded `max` 295191 → 295191 (delta 0); `oom` 4 → 4 (delta 0); `oom_kill` 3 → 3 (delta 0). There were **no new OOM or OOM-kill events** across these bracketing samples. Existing nonzero historical counter totals are not treated as new events.

| Window            | Exact duration | Included samples | Before-window samples | Later samples excluded | Highest sampled current |
| ----------------- | -------------: | ---------------: | --------------------: | ---------------------: | ----------------------: |
| Test execution    |   661.875000 s |              132 |                     2 |                     11 |     7,287,103,488 bytes |
| Complete reporter |   685.546460 s |              137 |                     2 |                      6 |     7,287,103,488 bytes |

The raw sampler contains **145 samples**, from **2026-10-17T00:44:06.559224+00:00** through **2026-10-17T00:56:06.997214+00:00**. All **6 samples later than the reporter end** remain in the raw JSONL and are excluded from its memory maximum. Before-window samples and the nearest bracketing samples are preserved separately. [memory-summary.json](./memory-summary.json) records both execution windows and every boundary; [memory.jsonl](./memory.jsonl) retains the unmodified source data. This run does not prove the absence of all resource leaks.

## Retained evidence

- The eight `*-actual-menu.png`, `*-actual-chase.png`, `*-actual-onboard.png` and `*-actual-pause.png` files are unmodified Playwright attachments from this final source.
- `valley-ridge-mx-journey.json`, `arena-nord-sx-journey.json` and `motocross-production-journey.json` retain the complete original telemetry attachments.
- [test-run.json](./test-run.json) records all 12 original attachment hashes, the command, exact source/result identity, visible actions, diagnostic limits and a hash of the independent root visual review.
- [browser-backend.json](./browser-backend.json) retains the actual setup probe from this reporter window; [environment.json](./environment.json) extracts selected preparation, asset and presentation diagnostics.
- [main45.log](./main45.log) preserves the original run output, and [journey-actions.log](./journey-actions.log) preserves the original stdout attachment.
- [pre-camera-clearance](./pre-camera-clearance/README.md) preserves the earlier passing automation with the subsequently identified camera-support placement defect. Its recorded data and two relevant original stadium images remain historical evidence.

The complete HTML/decoded report, all 12 original attachments and validated source record remain at `motocross-release-validation/main45-camera-clearance`. The passing test used `trace: retain-on-failure`, so it did not retain a `trace.zip`.
