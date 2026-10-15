export const meta = {
  name: 'venue-catalogue-wave-2',
  description: 'Add a second wave of driveable layouts (bike GP circuits, endurance mega-circuits, more real-world-faithful and street layouts) with bike-safety flags, then review and fix',
  phases: [
    { title: 'Implement', detail: 'worktree agent adds layouts through the circuit catalogue' },
    { title: 'Review', detail: 'geometry fidelity/validation and racing/AI lenses' },
    { title: 'Fix', detail: 'apply confirmed findings' },
  ],
}
const COMMON = `Repo: TypeScript + Three.js racing game (Vite, Vitest). Original checkout /home/user/Experiment-3; integration branch claude/peaceful-einstein-dedc7t. FIRST in your worktree: git merge --no-edit claude/peaceful-einstein-dedc7t (after it src/simulation/circuit-catalogue/**, src/rendering/venue-kit/**, scripts/catalogue-races.ts, src/career/**, bikes and 54 vehicles must exist). If node_modules is missing: ln -s /home/user/Experiment-3/node_modules node_modules (never npm install). Commit messages end with exactly:
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RN7q935R3iepiRcM32D9uW
Do NOT push. No model identifiers. Neutral names only — no official circuit names, logos or trademarks; record approximations and licence status in docs/ASSET_PROVENANCE.md / docs/CIRCUIT_CATALOGUE.md. A concurrent off-road engineer adds motocross/supercross/rallycross/rally venues (src/simulation/offroad/**) — do not edit those; append to registries. Existing layouts' geometry and seeded race evidence must not change.`

const IMPL = await agent(`${COMMON}

You are a senior circuit/level designer-engineer. Read docs/CIRCUIT_CATALOGUE.md, CONTENT_PIPELINE.md §2, GAME_DESIGN.md §8, the circuit-catalogue builder/DSL/geometry-checks/real-world/unconventional modules and venue-kit, career/registry.ts (bike career uses circuits flagged bike-safe; currently none are flagged, so it falls back to all paved circuits), events/catalogue-events.
TASK: add at least 14 new layouts (aim 20 incl. variants), each passing validate:content geometry checks, with pit, grid, sectors, run-off/barriers, DRS zones where appropriate, venue-kit dressing, events, and a seeded AI race in scripts/catalogue-races.ts (all finish, no stuck cars):
- Motorcycle GP-style circuits (flag bikeSafe with gravel/run-off and kerb profiles suitable for bikes, and flag existing suitable layouts too): a Tuscan-hills-style flowing circuit with a long front straight and fast uphill sweepers, an island cliff-top seaside circuit with very fast left-handers, a Dutch-cathedral-style flat flowing circuit, a Spanish-style tight technical circuit.
- Endurance mega-circuits: a 20+ km forest ring with extreme elevation and blind crests (Nordschleife-style), a 13 km endurance circuit mixing public-road straights with chicanes (Le Mans-style), each with day-night suitability.
- More real-world-faithful layouts approximated from public geometry: a Brazilian-style anticlockwise bowl circuit, a mountain circuit with a steep climb and a descent (Bathurst-style), a California-style circuit with a corkscrew-like drop, an Italian old-school circuit with chicanes and a lake (Imola-style), a Dutch dunes circuit with banked corners (Zandvoort-style), a Middle-East night circuit under floodlights, a Caspian-style street circuit with a 2 km straight and a narrow castle section, a Southeast-Asian night street circuit, a Chinese-harbour-style street circuit with a hillside section.
- At least two original unconventional venues: e.g. a container-port night circuit with crane gantries and a figure-of-eight crossing (layer-aware), a salt-flat/airbase high-speed course.
Add a bikeSafe (or equivalent) circuit attribute consumed by career/registry and bike rulesets (events for bikes on bike-safe circuits). Record lengths, corner counts and AI best laps in docs/CIRCUIT_CATALOGUE.md and update CONTENT_PIPELINE.md §2.3 and STATUS_REGISTER honestly.
Run before final commit: npm run lint, npm test, npm run build, npm run validate:content, npm run test:catalogue-races, npm run test:bikes, npm run test:physics. Make them pass.
Final text: worktree absolute path (pwd), branch, commits, layout list with lengths, test results, known limits.`, { label: 'implement venues wave 2', phase: 'Implement', isolation: 'worktree' })

const SCHEMA = { type: 'object', properties: { findings: { type: 'array', items: { type: 'object', properties: { file: { type: 'string' }, severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, problem: { type: 'string' }, failure_scenario: { type: 'string' }, fix: { type: 'string' } }, required: ['file', 'severity', 'problem', 'failure_scenario', 'fix'] } } }, required: ['findings'] }
const lenses = [
  { key: 'geometry', prompt: 'geometry fidelity and validation: layouts not matching their stated length/corner sequence (beyond ~3%), self-intersections not handled by layers, pit lanes crossing the track, impossible elevation/banking, existing layouts changed, validation vacuous' },
  { key: 'racing', prompt: 'racing and integration: AI stuck or crashing at specific corners, bike-safe flags on unsuitable layouts (walls close to apexes), events with incompatibilities, career/bike career not using the new flags, menu grouping broken, mega-circuit performance (track sampling/racing line cost) blowing budgets' },
]
phase('Review')
const reviews = await parallel(lenses.map(l => () => agent(`${COMMON}

You are a skeptical reviewer. Venue wave 2 was implemented in a git worktree; implementer report:
---
${IMPL}
---
Go to that worktree path (read-only; do not edit or commit). Review the diff versus claude/peaceful-einstein-dedc7t through this lens: ${l.prompt}. Report only real defects with a traced failure scenario. Prefer fewer, verified findings.`, { label: `review:${l.key}`, phase: 'Review', schema: SCHEMA })))
const findings = reviews.filter(Boolean).flatMap(r => r.findings)
log(`${findings.length} findings`)
phase('Fix')
const FIX = findings.length === 0 ? 'no findings' : await agent(`${COMMON}

Continue as the implementer in the venue wave 2 worktree described here:
---
${IMPL}
---
cd into that worktree. First git merge --no-edit claude/peaceful-einstein-dedc7t again. Findings (JSON):
${JSON.stringify(findings, null, 2)}
Verify each; fix real ones with regression tests; explain non-real ones. Run npm run lint, npm test, npm run build, npm run validate:content, npm run test:catalogue-races; commit (do not push). Final text: worktree path, branch, new commits, per-finding outcome, test results.`, { label: 'fix venue findings', phase: 'Fix' })
return { implement: IMPL, findings, fix: FIX }
