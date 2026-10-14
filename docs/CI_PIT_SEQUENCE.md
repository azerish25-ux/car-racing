# Pit-sequence CI: separate live simulation from presented-frame coverage

## Observed failure

Build and validation run `38419949876`, commit
`ffd8e46cab43d26c4ffa18ac44fe06c36b29dfd0`, failed in browser shard 5:
`27H.6 pit-service day: low-preset populated race and chase evidence`.
Shard 6, including the previous post-pit replay-EOF correction, passed.

The failed recording's presented-state observations went from phase 2 at
simulation time 88.923 / service clock 0.658 to phase 4 at 90.900 / clock 2.642.
No qualifying raised-wheel removal frame from phase 3 was presented. The live
review correctly refused to qualify the sequence; it eventually reported
`Session finished` when the race ended. A larger polling deadline or another
retry cannot recover a frame that the renderer never presented.

## Functional test contract

The pit case starts with the same Low graphics and 50% scale saved through the
normal settings schema. This avoids compiling an unrelated Medium-quality menu
before switching to the already-specified functional workload. The garage UI
still applies and verifies those settings. Its startup deadline is unchanged.

The pit case in `e2e/29-populated-race-review.spec.ts` uses two independent
observations of the same, unmodified race:

1. Arm the existing session observer in the paddock, drive the normal eight-car
   race with the existing AI driver, request a legal pit stop, and wait for the
   actual completed stop and moving pit exit. Export the accepted worker
   observations and require phases 1 through 6, one completed stop, the expected
   source fingerprint, and explicitly non-human evidence. Record an additional
   simulation second beyond exit so playback cannot hit EOF before the claim.
2. Freeze the worker and use the existing replay controls at their supported
   quarter-speed setting. Seek once to before pit entry, then observe one
   continuous playback through moving exit. Read only the renderer's presented
   state. Require every ordered phase, raised jacks, all four displaced wheels
   during removal and installation, all fifteen crew actors, the chase camera,
   eight cars, actual draw calls, and an unchanged paused worker tick. Duplicate
   held frames do not advance qualification. Backward time, gaps over one
   simulation second, reordered or missing phases, and premature EOF fail.

There are no injected simulation frames, synthetic browser observations,
clock overrides, changes to pit timings, extra retries, increased test budgets,
or reductions in opponent count or render scale. The remaining four live
populated-race review cases are unchanged. The existing default-quality live
pit/replay test in `e2e/28-race-pit-presentation.spec.ts` remains required, as do
physics, unit, rendering, and other browser gates. Production code and assets
are unchanged.

The bounded `PitSequence` validator has negative tests for the exact observed
phase-2-to-phase-4 jump, missing wheels/crew, insufficient jack height, moving
service, missing installation, held frames, backward playback, and time gaps.

## Evidence and limits

The test exports the real worker report and a bounded, source-labelled replay
observation sequence. It takes the approach screenshot before playback and
removal/installation stills only after continuous qualification, so screenshot
readback cannot starve the interval under observation. Post-qualification seeks
are illustrations, not continuity evidence. Playwright retains the full video.

The replay artifact identifies itself as
`recorded-replay-functional-pit-sequence` and sets `livePerformanceAccepted`,
`visualAccepted`, and `humanVerified` to false. Passing this functional test does
not establish real-time performance on a software GPU, human visual approval,
or full-lap artwork acceptance. The production live presentation recorder and
its stricter live qualification remain unchanged; poor live frame delivery can
still prevent that recorder from accepting a sequence.

## Reproduce

Use the repository's pinned dependencies and verified Mesa browser setup:

```sh
npm ci --no-audit --no-fund
npm run check:stable
npx playwright install --with-deps chromium
APEX_BROWSER_BACKEND=mesa LIBGL_ALWAYS_SOFTWARE=true GALLIUM_DRIVER=llvmpipe \
  xvfb-run -a -s '-screen 0 1920x1080x24' \
  npx playwright test e2e/29-populated-race-review.spec.ts --grep pit-service
```

For repeat validation, add `--repeat-each=3`; retries remain disabled. Inspect
`pit-live-worker.json`, `pit-continuous-replay-sequence.json`, and the video, not
only the test runner's exit code. A source commit or successful deployment is
not evidence that the separate GitHub Actions run has finished successfully.

The focused `Pit sequence regression` workflow runs this case on three independent
GitHub Ubuntu runners when its test files change. Each run has zero retries and
retains its own observations, screenshots, video, and build identity. It is an
additional early regression signal, not a substitute for `Build and validation`.
