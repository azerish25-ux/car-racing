export const meta = {
  name: 'online-slice-wp50-54',
  description: 'Build the online racing slice (prediction/reconciliation, lifecycle, record verification, lobbies, resilience) then adversarially review and fix',
  phases: [
    { title: 'Implement', detail: 'one worktree agent builds src/net + tests' },
    { title: 'Review', detail: 'determinism and abuse/security lenses' },
    { title: 'Fix', detail: 'apply confirmed findings in the same worktree' },
  ],
}

const COMMON = `Repo: TypeScript + Three.js racing game (Vite, Vitest). Original checkout /home/user/Experiment-3. If node_modules is missing in your directory run: ln -s /home/user/Experiment-3/node_modules node_modules (never npm install). Commit messages must end with exactly these two lines:
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RN7q935R3iepiRcM32D9uW
Do NOT push. No model identifiers in code or docs. Other engineers concurrently edit vehicles.ts, circuits.ts, renderer, physics (tire.ts/vehicle.ts) and bike integration (world.ts/protocol.ts): keep changes to those files at zero or minimal; put your work in new modules (src/net/**, scripts/**, tests/**, docs/production/**).`

const IMPL = await agent(`${COMMON}

You are a senior online/netcode engineer. Read README.md, docs/production/ARCHITECTURE_SERVICES.md, docs/production/PROGRAMME_PLAN.md §8, docs/production/STATUS_REGISTER.md (WP49–WP54 rows), scripts/server-prototype.ts (WP49 measurement: compact 20 Hz state ≈44 kbit/s/client for 8 cars), src/core/session-identity.ts (SIMULATION_VERSION, contentHash, sessionIdentity, recordCategory, recordIncompatibility), src/simulation/protocol.ts (snapshot layout, SNAPSHOT_SCHEMA), src/simulation/world.ts and how the Simulation is stepped with player inputs (src/workers/physics.worker.ts), src/simulation/route-graph.ts (RouteProgress for legal progress).

TASK: implement the authoritative online racing slice as tested, runnable modules (no real network deployment required; transport is an interface with an in-memory implementation plus a loss/latency/jitter/reorder simulator, and an optional Node WebSocket server script ONLY if a ws library is already resolvable — otherwise skip it):
- WP50 Prediction and reconciliation: input cadence separate from the 120 Hz physics tick and the 20 Hz network snapshot; client sends sequenced input commands with redundancy; server simulates authoritatively; client predicts its own car by re-simulating from the last acknowledged state + unacked inputs (or, if full re-simulation of the shared world is too costly, a documented local-car prediction with error smoothing), remote cars are interpolated with a jitter buffer; an explicit collision-authority policy (server decides contacts; client visual smoothing only). Measure correction magnitudes under 100 ms RTT / 2% loss in a test.
- WP51 Session lifecycle with content-version agreement: lobby -> join (clients present RecordedSessionIdentity/content hashes and SIMULATION_VERSION; mismatches rejected with a reason) -> grid -> race -> results -> teardown; host migration is out of scope but server crash/restart handling is documented.
- WP52 Verified records: a record = seed + options + input log + content hashes; the verifier re-simulates headlessly and accepts only if the final classification/lap time matches within exact determinism; tampered logs or mismatched content are rejected; tests prove a forged lap time is rejected.
- WP53 Lobbies: create/list/join/leave, capacity, ready checks, class/ruleset compatibility via src/simulation/events.ts sessionIncompatibilities, kick/ban hooks, rate limiting of messages.
- WP54 Resilience: disconnect -> AI takeover or ghosting policy, rejoin within a window restores control, packet loss/duplication/reordering tolerated, input sanity limits (non-finite or out-of-range inputs clamped/rejected), message size limits, server tick budget monitoring.
Also: a script scripts/online-slice.ts (npm script "test:online") that runs an in-memory 8-client race for 60 s simulated time under simulated 100 ms RTT, 2% loss, and writes docs/online-slice.json with bandwidth per client, correction stats, verification result. Add the npm script to package.json. Write docs/production/ONLINE_SLICE.md (protocol messages, cadences, authority, threat model) and update STATUS_REGISTER.md rows WP50–WP54 honestly (prototype/integrated as appropriate; never "accepted").
Run before final commit: npm run lint, npx vitest run tests/net*.test.ts (and any new tests), npm run build (tsc), npm run test:online. Make them pass.

Return JSON-ish final text containing: worktree absolute path (run pwd), branch name (git branch --show-current), commit hashes, files, test results, known limits.`, { label: 'implement online slice', phase: 'Implement', isolation: 'worktree' })

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'number' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          problem: { type: 'string' },
          failure_scenario: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['file', 'severity', 'problem', 'failure_scenario', 'fix'],
      },
    },
  },
  required: ['findings'],
}

const lenses = [
  { key: 'determinism', prompt: 'determinism, correctness and protocol logic: reconciliation math, sequence/ack handling, wraparound, jitter buffer, re-simulation exactness used by record verification, lifecycle state machine holes, tests that pass vacuously' },
  { key: 'abuse', prompt: 'abuse resistance and robustness: forged records accepted, unvalidated client messages, non-finite inputs, oversized/malformed messages, rate limits bypassable, rejoin hijacking (identity/token checks), lobby capacity races, resource leaks on disconnect' },
]

phase('Review')
const reviews = await parallel(lenses.map(l => () => agent(`${COMMON}

You are a skeptical reviewer. The online slice was implemented in a git worktree; its implementer reported:
---
${IMPL}
---
Go to that worktree path (read-only: do not edit or commit). Review the new code (git log/diff against the merge-base with branch claude/peaceful-einstein-dedc7t) through this lens: ${l.prompt}. Report only REAL defects with a concrete failure scenario you traced through the code (inputs -> wrong output/crash). Prefer fewer, verified findings. You may run tests or write throwaway scripts under /tmp to confirm.`, { label: `review:${l.key}`, phase: 'Review', schema: REVIEW_SCHEMA })))

const findings = reviews.filter(Boolean).flatMap(r => r.findings).filter(f => f.severity !== 'minor' || true)
log(`${findings.length} review findings`)

phase('Fix')
const FIX = findings.length === 0 ? 'no findings' : await agent(`${COMMON}

You are the implementer continuing work in the online-slice worktree described here:
---
${IMPL}
---
cd into that worktree path. Reviewers reported these findings (JSON):
${JSON.stringify(findings, null, 2)}
For each: verify it against the code; if real, fix it with a regression test; if not real, explain briefly why. Then run npm run lint, the net tests, npm run build, npm run test:online, and commit (do not push). Return: worktree path, branch, new commit hashes, per-finding outcome (fixed / not-real + reason), final test results.`, { label: 'fix findings', phase: 'Fix' })

return { implement: IMPL, findings, fix: FIX }
