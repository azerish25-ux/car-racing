# Delivery failure investigation

**Repository:** MOTOBOUND / Experiment-3  
**Audit window:** 15 October 2026, Atlantic time (16 October UTC).  
**Audited application source:** `e434afed07c763fa76b37c4354ce90b4c16287d3`.

## Finding

There is not one interchangeable failure called "push failed". This incident contains a blocked terminal transport, successfully accepted Git commits with failing browser validation, and concurrent writers advancing `main`. Repeating the same push cannot repair a browser stall. A successful source update also does not prove a new release or live deployment.

This repair removes a reproducible blocking GPU fallback, stops preparation from falsely succeeding on timeout, and removes synchronous per-draw instrumentation from a cold-scene performance fixture. Hosted full-scene confirmation is still required. It does not claim that every past or future CI failure has the same cause.

## Evidence, not just status badges

| Evidence | Observation | Meaning |
| --- | --- | --- |
| Terminal in the development runtime | `Could not resolve host` for GitHub; no existing checkout on entry | Transport failed before repository permissions or branch updates could be tested. |
| Connected GitHub reads | Branches, commits, jobs, traces and artifacts readable | A working authorized delivery route exists without changing runtime network policy. |
| Settings run `38835848255`, job `116764681554`, commit `e434afe` | Checkout, dependency installation and production build succeeded; one DOM fixture passed, three real-application interactions failed | Source reached GitHub. These are browser failures, not rejected pushes. |
| Settings traces | Visible controls stalled in Playwright's click actionability/stability checks; 15-second click limits expired | Inspect main-thread responsiveness and rendering ownership, not just element selectors. |
| Scenery shadow run `38835848340`, sunset artifact `12019631984` | Evaluation timed out after 300 seconds | The first complete cold-scene workload did not finish within its unchanged test deadline. |
| Full pipeline run `38835848249` | Validate, unit tests, scenarios and wet-presentation jobs succeeded when inspected; browser shards were still running | A green build alone is not a completed release gate. |
| Branch reads during the audit | `main` advanced from `a1af885` to `7802477`, then `fb81335` | Another writer was active. Never overwrite or force-push over unseen work. |

The inspected latest settings and sunset traces did not contain the earlier mass invalid-program/context-loss console cascade. Earlier context-loss reports must not be substituted for evidence from this exact run. The latest trace symptoms and the code-level regression support the repair, but are not a complete hosted performance profile.

## Reproducible defects and repairs

### 1. An elapsed timer guarded an unbounded synchronous GPU wait

`GpuFrameGate.ready()` called `gl.finish()` after an unfinished fence exceeded its polling allowance. The allowance bounded when the blocking operation started, not how long that operation blocked. It therefore defeated the frame gate's main purpose: keeping input tasks responsive while one frame was in flight.

A deterministic regression modeled a driver with 30 seconds of remaining work. Before the repair, one readiness call advanced the modeled clock by 30,000 ms, called `finish`, and reported completion. After the repair, the call returns immediately with the fence still pending and no completed frame claimed.

The repaired gate flushes submitted commands, polls `clientWaitSync(fence, 0, 0)` across browser tasks and admits another normal frame only after a real completion status. Periodic flushes retain the same ownership. A continuously polled, persistently stalled driver fails closed with an explicit error; hidden-tab inactivity does not count as active waiting. Allocation failures, wait failures and disposal remain explicit. No extra frames are queued to make a fence appear complete.

A real-WebGL browser regression also tests timer-based and animation-frame polling. Each variant completes twelve actual submissions with no further draw needed to release a held frame. It makes any `gl.finish()` call fail the test, checks actual completion counters and zero GL errors, and performs a real pointer click. This is a narrow GPU contract test, not a substitute for the full scene tests.

### 2. Preparation timeout incorrectly meant success

`RacingRenderer.waitForPreparedFrame()` returned successfully after 45 seconds even when its fence was unfinished. The caller could then replace graphics resources without proven completion. The same existing deadline now throws a specific preparation error. Regression tests prove that a failed preparation does not apply new graphics settings. The deadline has not been extended.

### 3. A performance fixture serialized every draw

The scenery-shadow fixture wrapped `renderBufferDirect` and called synchronous `gl.getError()` after each draw. This adds a driver round-trip inside the hottest measured loop. It is especially intrusive for software rendering and cold shader workloads.

The fixture now drains all pending error codes at construction, complete-frame, image-capture, shadow-render and shadow-readback boundaries. A clean phase costs one error query. Context loss remains explicit, and a broken infinite error stream is bounded and fails the test. `drawErrors` is reported as `null`, not an invented empty successful result, because per-draw attribution is deliberately not collected.

The original scenery-shadow assertions are unchanged: same cold first complete cockpit frame, twelve cars, seed 1887, eight seconds of simulated state, Medium quality, 1280 x 720 resolution, full draw/triangle accounting, image/geometry equivalence, zero errors and unchanged render budgets. No caster, effect, model or quality setting was removed.

## Validation boundaries

Development, source inspection, regression reproduction and local validation were performed in the current runtime. The source archive's reconstructed Git tree exactly matched `51eb6f95b4cb82e0f07b8307bda20c6d3afc73e7`. Offline dependencies came from the same CI source and matched the repository lockfile SHA-256 `d85b97d2e51497b62414087966db13b740b174fe4b96663d29447644948d2969`.

Local lint, content validation, TypeScript checking and the production build passed. The before/after regression, targeted tests and two real Mesa WebGL tests passed after repair. Full unit-suite results are recorded in the accompanying delivery report.

The original full-game browser test could not navigate to the local preview server because this runtime's browser returned `ERR_BLOCKED_BY_ADMINISTRATOR`. The policy was not removed or bypassed. The isolated WebGL tests use an in-memory document and do not claim to validate the complete game. Local Chromium/Mesa versions also differ from the pinned hosted browser. The original settings, shadow and full browser workflows must validate the published commit on GitHub.

Existing full-CI publication dependencies, browser timeouts, retry counts, geometry/visual budgets and graphics quality remain unchanged. The new GPU test is added to the focused settings workflow as additional coverage, not a replacement.

## Preserve new work before publishing

The current `main` README, the imported MotoGP reference ZIP at `reference/MotoGP26/MotoGP26_PS5_100_Reference_Images.zip`, and the new offline-workspace workflow are retained. The existing builder and workflow from `asset-pack/motogp26-reference-100` are incorporated by their audited blob identities. That branch's history is retained as a merge parent rather than silently discarded. The temporary transfer branch had already removed itself after importing its verified artifact; it is not recreated.

The reference builder is preserved as existing development, not asserted to reproduce the already imported ZIP. Its network/media collection is outside the GPU repair validation. No unseen work in other machines or chats is claimed recovered.

## Repeatable delivery protocol

1. Record the exact error and audited source SHA. Read `main` through a working authorized route before deciding whether a write failed. Do not infer rejection from a red Actions badge.
2. Inspect the current branch/commit graph and staged paths. Preserve dirty work and concurrent commits. Never fix divergence with a destructive reset or force push.
3. Investigate the failing job and first real error at that exact SHA. Download its logs/traces; distinguish queue time, checkout, compilation, tests and publication.
4. Reproduce the defect with a regression. Validate source stability, lint, types, unit tests and build. State browser/environment limitations explicitly.
5. Read the latest remote head again. Build one commit on that head, preserving all unrelated files. Use a non-forced ref update with an expected-head check. A changed head means inspect and reconcile; it is not permission to retry blindly.
6. Read back the remote SHA and intended file identities. Then inspect the exact commit's full workflow and release artifact. Do not substitute an unrelated green workflow or older green build.
7. Verify the deployed build's own source identity before calling it live. A source commit or downloadable release artifact is not CDN confirmation.

The read-only helper makes these states explicit:

```sh
node --experimental-transform-types scripts/delivery-status.ts <40-character-commit-sha>
```

It reports source inclusion, exact-commit full validation, release-artifact presence and an explicitly unverified live deployment. It never pushes, retries, discovers secrets or changes repository state. Exit 0 requires a validated release artifact; exit 1 means absent source or failed validation; exit 2 means pending/unverified/transport failure. An existing `GITHUB_TOKEN` is optional for authorized API reads and is never printed. The helper needs permitted API networking; a DNS-blocked runtime should use the connected read route instead.

## Primary references

- Playwright actionability: https://playwright.dev/docs/actionability
- WebGL best practices, including avoiding synchronous API round-trips: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices
- GitHub Git references API and non-forced updates: https://docs.github.com/en/rest/git/refs
- GitHub workflow triggering: https://docs.github.com/en/actions/how-tos/writing-workflows/choosing-when-your-workflow-runs/triggering-a-workflow

GitHub deliberately suppresses most workflow-triggering events produced with a workflow's own `GITHUB_TOKEN`. Therefore an accepted bot commit with no new push-triggered run is another distinct state, not evidence of a rejected Git update. Always inspect the actual runs before attributing the cause.
