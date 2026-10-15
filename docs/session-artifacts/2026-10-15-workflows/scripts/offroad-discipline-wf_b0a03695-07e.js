export const meta = {
  name: 'offroad-discipline',
  description: 'Build the off-road discipline (motocross/supercross dirt bikes on deformable terrain, rallycross and rally stages), then review and fix',
  phases: [
    { title: 'Implement', detail: 'worktree agent builds dirt bikes, terrain sessions, venues, rules, AI, rendering' },
    { title: 'Review', detail: 'physics/determinism and player-experience lenses' },
    { title: 'Fix', detail: 'apply confirmed findings' },
  ],
}

const COMMON = `Repo: TypeScript + Three.js 0.180 (WebGL) racing game (Vite, Vitest, Playwright). Original checkout /home/user/Experiment-3; integration branch claude/peaceful-einstein-dedc7t. FIRST in your worktree run: git merge --no-edit claude/peaceful-einstein-dedc7t (your worktree may start from an older base; after the merge src/simulation/bike-vehicle.ts, src/simulation/surface-material.ts, src/simulation/vehicle-catalogue, src/simulation/circuit-catalogue, src/career and src/rendering/ultra must exist). If node_modules is missing run: ln -s /home/user/Experiment-3/node_modules node_modules (never npm install). Commit messages must end with exactly:
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RN7q935R3iepiRcM32D9uW
Do NOT push. No model identifiers in code/docs. No real brands/trademarks (no real series or manufacturer names). A concurrent engineer builds an open-world festival (src/simulation/open-world/**, src/rendering/open-world/**, a FESTIVAL entry, main.ts hooks); keep your edits to shared hotspots (main.ts, interface.ts, renderer.ts, world.ts, protocol.ts, vehicles.ts, events.ts) minimal and localized; put bulk in new modules (e.g. src/simulation/offroad/**, src/rendering/offroad/**). Existing circuit cars, road bikes and their deterministic tests/calibration must not change.`

const IMPL = await agent(`${COMMON}

You are a senior off-road vehicle-dynamics + gameplay engineer. Read docs/production/GAME_DESIGN.md (§2 Off-road row), PHYSICS_MODEL.md, STATUS_REGISTER.md (WP37–WP41 rows), DETAILS_D001_D100.md §19.4–19.5 (D031–D050), and the code: src/simulation/terrain.ts (TerrainTile prototype: deformable soil, ruts, moisture, lineCost, reset), src/simulation/surface-material.ts, src/simulation/bike-definitions.ts / bike-vehicle.ts / bike-ai.ts (road-bike adapter in sessions), src/simulation/bike.ts, src/core/stage-rules.ts (joker/stage prototype), src/core/scoring.ts, src/simulation/route-graph.ts (RouteProgress), src/simulation/circuit-catalogue/** (builder/DSL), src/simulation/vehicle-catalogue/** (RL-2 rally, RCX-6 rallycross, DX-8 trophy truck), src/rendering/bike.ts + rider.ts, src/rendering/venue-kit/**, src/rendering/materials/**, src/career/registry.ts (off-road discipline unlocks from registry data).

TASK: make the off-road discipline real and playable in normal sessions:
1. Dirt bikes on the bike adapter: at least MX-450 (four-stroke motocross), MX-250 (two-stroke) and SM-450 (supermoto, mixed surface) with long-travel suspension (~300 mm), knobby tyre family on loose surfaces from surface-material, airborne dynamics (pitch from body position, throttle/rear-brake gyroscopic pitch control, scrub/whip optional), landing with suspension bottoming and crash thresholds (bad landing pitch/flat landing), rider standing pose on rough sections, foot dab in tight corners. Calibration bands (0–60 m on dirt, jump distance at given take-off speed, landing tolerance) in a script.
2. Deformable terrain in sessions: dirt venues use TerrainTile (or a session-scale extension) as the authoritative surface (height + softness + moisture + ruts); ruts deepen with passes and change grip/lines; deterministic and included in replay determinism (replays must reproduce terrain state — record deltas or re-derive deterministically); reset between sessions.
3. Venues (through the circuit catalogue builder or a terrain course format, passing validate:content): an outdoor motocross track (tabletops, doubles/triples, whoops, berms, rhythm section, start gate straight), an indoor supercross stadium (tight, night lighting, triple rhythm), a rallycross circuit (mixed asphalt/gravel with joker lap), and a gravel rally stage (point-to-point with RouteProgress and split times). Original names only.
4. Rules/formats: motos (two motos, combined points, gate pick by qualifying), synchronized start gate (D049) with jump-start detection, holeshot, rallycross heats with exactly one joker lap required (penalty otherwise), rally stage timing with staggered starts and splits; add rulesets/events; career off-road discipline unlocks from the registry with real events.
5. AI: dirt-bike AI choosing lines with ruts/berms (lineCost), jump speed control to land on the downslope, recovery after crash; rally/rallycross AI on gravel using the surface model.
6. Rendering (non-cartoon, PBR via src/rendering/materials): deformable terrain mesh updated from terrain state, dirt/mud materials with moisture darkening, roost particles from rear-wheel slip on loose surfaces (presentation only), mud accumulation on bike/rider/cars, start gate model, stadium lighting/crowd for supercross, dirt-bike models (high fenders, long forks, knobby tyres) extending the procedural bike, standing rider pose.
7. Tests + scripts: unit tests (jump ballistics + landing, terrain rut determinism and replay equality, joker enforcement, gate start jump-start detection, moto points), npm run test:offroad seeded AI motos and a rallycross heat completing with bounded crashes writing docs/offroad-races.json.
8. Docs: STATUS_REGISTER WP37–WP41 and D031–D050 honestly; CONTENT_PIPELINE catalogue (motocross 4, rally, rallycross counts); GAME_DESIGN implemented-vs-designed.
Run before final commit: npm run lint, npm test, npm run build, npm run validate:content, npm run test:physics, npm run test:vehicles, npm run test:bikes, npm run test:offroad. Make them pass.

Final text: worktree absolute path (pwd), branch, commits, files, test results, known limits.`, { label: 'implement off-road', phase: 'Implement', isolation: 'worktree' })

const SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
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
  { key: 'physics', prompt: 'physics and determinism: airborne integration blow-ups, landing detection wrong on slopes, terrain state not reproduced in replay/seek, rut field memory growth, nondeterminism, road bikes/cars behaviour changed, calibration bands vacuous' },
  { key: 'experience', prompt: 'player experience and rules: start gate/jump-start unfair or undetectable, joker lap skippable or double-counted, moto points wrong, AI stuck in ruts or on jumps, crash/remount dead ends, venues unreadable, cartoonish materials, career off-road still locked despite content, menu/e2e assertions broken' },
]
phase('Review')
const reviews = await parallel(lenses.map(l => () => agent(`${COMMON}

You are a skeptical reviewer. The off-road discipline was implemented in a git worktree; implementer report:
---
${IMPL}
---
Go to that worktree path (read-only; do not edit or commit). Review the diff versus claude/peaceful-einstein-dedc7t through this lens: ${l.prompt}. Report only real defects with a traced failure scenario. Prefer fewer, verified findings.`, { label: `review:${l.key}`, phase: 'Review', schema: SCHEMA })))
const findings = reviews.filter(Boolean).flatMap(r => r.findings)
log(`${findings.length} findings`)
phase('Fix')
const FIX = findings.length === 0 ? 'no findings' : await agent(`${COMMON}

Continue as the implementer in the off-road worktree described here:
---
${IMPL}
---
cd into that worktree. First git merge --no-edit claude/peaceful-einstein-dedc7t again (it may have advanced). Findings (JSON):
${JSON.stringify(findings, null, 2)}
Verify each; fix real ones with regression tests; explain non-real ones. Run npm run lint, npm test, npm run build, npm run validate:content, npm run test:offroad; commit (do not push). Final text: worktree path, branch, new commits, per-finding outcome, test results.`, { label: 'fix off-road findings', phase: 'Fix' })
return { implement: IMPL, findings, fix: FIX }
