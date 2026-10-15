export const meta = {
  name: 'ci-regressions-shard7-8',
  description: 'Root-cause and fix the two hosted browser regressions after the multi-discipline merges (wet-following review, Aurel grid stuck loading)',
  phases: [
    { title: 'Diagnose+fix', detail: 'one worktree agent per regression' },
    { title: 'Verify', detail: 'independent skeptic checks each fix is root-cause, not a relaxed assertion' },
  ],
}
const COMMON = `Repo: TypeScript + Three.js racing game (Vite, Vitest, Playwright). Original checkout /home/user/Experiment-3; integration branch claude/peaceful-einstein-dedc7t (head b509815 or later). FIRST in your worktree: git merge --no-edit claude/peaceful-einstein-dedc7t. If node_modules is missing: ln -s /home/user/Experiment-3/node_modules node_modules (never npm install). Commit messages end with exactly:
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RN7q935R3iepiRcM32D9uW
Do NOT push. No model identifiers in code/docs. Never weaken an assertion, raise a timeout or skip a test to get green unless you prove the old threshold measured host speed rather than behaviour — prefer fixing the product cause. Playwright locally: CHROMIUM_PATH=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome | head -1) npx playwright test <spec> -g "<title>"; the software GPU here is slow (minutes per spec) and other agents share 4 CPUs — prefer headless node reproductions (node --experimental-transform-types script.ts driving src/simulation/world.ts Simulation) where possible. Since the last green hosted run the integration branch merged: physics v2 (src/simulation/tyre-force.ts, tyre-thermal.ts, suspension.ts, powertrain.ts, surface-material.ts, vehicle.ts changes, AI start-offset change in ai.ts), car catalogue (vehicle-catalogue, vehicle-bodies, VehicleBodies in renderer.ts), motorcycles (protocol v12 CAR_STRIDE 277, bike shells), circuit catalogue + venue kit, ULTRA rendering modules, online slice, career (CAREER menu, main.ts session hooks).`

const CASES = [
  {
    key: 'wet-following',
    prompt: `Hosted run 38685156128 (head b509815): e2e/29-populated-race-review.spec.ts '27H.6 wet-following day' and '27H.6 wet-following night' (opponents 7, weather rain, low preset, autopilot player) fail with "Session finished": the race ended before the presentation review qualified. Qualification (src/rendering/race-review.ts RaceEvidence.observe/qualified) needs >= 3 s continuous of: racing phase, same leader (car ahead) both samples, rain>0, water>0, player contactWater > 0.04 and leaderWater > 0.04 both samples, sprayParticles > 0 both samples. These passed before the merges. Find which merged change broke it (likely physics v2 wet tyre/water contact semantics — e.g. the per-wheel water field written to snapshots, drainage under the contact patch — or the AI start-offset change spreading the field, or spray emitters), by reproducing headlessly: build the same session (circuit and options as the spec's drive config and race fixture; read e2e/29-populated-race-review.spec.ts and its fixtures), run the Simulation and compute contactWater/leaderWater/leader the same way the renderer derives them (find where RaceReviewFrame is built, e.g. src/main.ts or src/rendering/renderer.ts), and compare against the pre-merge commit 507adf8^ or 959e783^ behaviour if useful (git worktree add a scratch checkout under your scratch dir). Fix the root cause (e.g. the snapshot water field contract, or the review's reading of it, whichever is wrong per the documented semantics), add a unit/headless regression, and if feasible run the single wet-following day spec locally.`,
  },
  {
    key: 'aurel-loading',
    prompt: `Hosted run 38685156128 (head b509815): e2e/55-start-finish.spec.ts 'Aurel venue ships through ordinary menu, held grid, camera changes and start' fails: after selecting 11 opponents and clicking PREPARE GRID START PAUSED, diagnostics state stays 'loading' for > 60 s (it passed before the merges). Find what now makes session loading slow or stuck for a 12-car Aurel grid: e.g. new per-session work in the worker (physics v2 tables, tyre families, catalogue initialisation, venue-kit or circuit-catalogue geometry built for every circuit at load, content validation at runtime), new renderer warm-up/shader compilation (ULTRA material library or vehicle-bodies compiled even when unused), career hooks in main.ts, or a deadlock in the loading state machine. Measure load phases (add timing via existing diagnostics or a local instrumented run: npm run build && npx vite preview, then Playwright or a headless node measurement of worker init), identify the dominant cost/regression, fix it at the cause (lazy-build unused content, avoid compiling unused materials at default preset, etc.), add a regression check (e.g. a unit test that Aurel session setup does not build catalogue venue geometry, or a budget on worker init time measured in a node script), and if feasible run the spec locally.`,
  },
]
const VERDICT = {
  type: 'object',
  properties: {
    rootCause: { type: 'boolean' },
    weakenedAssertion: { type: 'boolean' },
    notes: { type: 'string' },
  },
  required: ['rootCause', 'weakenedAssertion', 'notes'],
}
const results = await pipeline(
  CASES,
  c => agent(`${COMMON}\n\nTASK (${c.key}): ${c.prompt}\nRun npm run lint and the affected unit tests (and npm run test:physics if you touch simulation) before committing. Final text: worktree absolute path (pwd), branch, commits, root cause (with evidence), fix, tests run with results.`, { label: `fix:${c.key}`, phase: 'Diagnose+fix', isolation: 'worktree' }),
  (report, c) => agent(`${COMMON}\n\nYou are a skeptical verifier. An engineer reported this fix for the ${c.key} regression:\n---\n${report}\n---\nGo to their worktree (read-only). Check: is the stated root cause actually what broke the hosted test (trace the code path and evidence)? Did they weaken an assertion, raise a timeout or skip anything instead? Would the fix plausibly make the hosted spec pass? Report.`, { label: `verify:${c.key}`, phase: 'Verify', schema: VERDICT }).then(v => ({ key: c.key, report, verdict: v })),
)
return results
