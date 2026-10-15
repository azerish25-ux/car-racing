export const meta = {
  name: 'open-world-festival',
  description: 'Build the open-world festival discipline (large region, road network, free roam, discovered events), then review and fix',
  phases: [
    { title: 'Implement', detail: 'worktree agent builds region, roads, free roam, events' },
    { title: 'Review', detail: 'simulation/streaming correctness and player-experience lenses' },
    { title: 'Fix', detail: 'apply confirmed findings' },
  ],
}

const COMMON = `Repo: TypeScript + Three.js 0.180 (WebGL) racing game (Vite, Vitest, Playwright). Original checkout /home/user/Experiment-3; integration branch claude/peaceful-einstein-dedc7t. FIRST in your worktree run: git merge --no-edit claude/peaceful-einstein-dedc7t (your worktree may start from an older base; docs/production, src/simulation/circuit-catalogue, src/rendering/venue-kit and src/rendering/ultra must exist after the merge). If node_modules is missing run: ln -s /home/user/Experiment-3/node_modules node_modules (never npm install). Commit messages must end with exactly:
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RN7q935R3iepiRcM32D9uW
Do NOT push. No model identifiers in code/docs. No real brands/trademarks/real-world map data that is licensed. Concurrent engineers: motorcycles (vehicles.ts/world.ts/protocol.ts/renderer hooks), ~15 new cars incl. road supercars + AWD (vehicles.ts catalogue, src/rendering/vehicle-bodies), physics upgrades (tire.ts/vehicle.ts), online slice (src/net), career/progression (src/career, menu). Keep edits to those files minimal; put your work in new modules (e.g. src/simulation/open-world/**, src/rendering/open-world/**, src/session/free-roam*.ts). Read vehicles from the registry data-driven so road cars added by others appear automatically.`

const IMPL = await agent(`${COMMON}

You are a senior open-world/systems engineer. Read docs/production/GAME_DESIGN.md (§2 Festival row, §8 Festival region), ARCHITECTURE_SERVICES.md, STATUS_REGISTER.md, and the existing systems: src/simulation/track.ts (Track: centreline, nearest(x,z,out,y?) layer-aware, boundaries, surfaces), src/simulation/route-graph.ts (RouteGraph, RouteProgress, validateRoute), src/simulation/terrain.ts, src/simulation/circuit-catalogue/** (data-driven layouts + builder/DSL), src/rendering/venue-kit/** (procedural dressing from data), src/simulation/world.ts + race.ts (how sessions run; laps/progress), src/simulation/events.ts (rulesets/events), src/workers/physics.worker.ts, src/main.ts session start, src/rendering/renderer.ts and atmosphere/daylight.

TASK: implement a playable open-world festival discipline (in the spirit of an open-world festival racer, original content):
1. Region: a large procedural-but-authored region (≥ 8 km × 8 km) with a heightfield terrain (deterministic from a seed + authored control features: coast, mountain, valley, town, airfield, forest), streamed in tiles with LOD; a road network (RouteGraph) of highways, country roads, mountain switchbacks, town streets, dirt tracks (≥ 60 km total), junctions and bridges, with road surfaces/widths/camber and a speed classification. Physics must use the real surface at any position (road vs off-road grass/gravel/dirt) — implement a world-surface query the car physics can sample (extend the Track abstraction or provide an OpenWorldTrack adapter implementing what Vehicle/world.ts need: nearest, surfaces, boundaries become soft off-road, no lap logic).
2. Free roam session: drive anywhere at speed; streaming keeps the worker and renderer within budgets; respawn/reset to nearest road; time of day + weather from existing systems; ambient traffic is optional (if added, keep deterministic and cheap).
3. Events discovered in the world: markers at locations (road race point-to-point and circuit loops built from road-network routes via RouteProgress, sprint, speed trap, speed zone (average speed), drift zone (using src/core/scoring.ts drift scoring if suitable), showcase). Drive into a marker -> event card -> start the event in place with AI rivals following the route (AI must follow road-network routes; reuse AI with a route-based line). Results flow back (hook for the career system: emit a typed result object; career integration is optional/minimal).
4. Rendering: terrain with PBR material blending (grass, rock, soil, sand, snow by slope/height), procedural vegetation instancing with LOD/impostors, road meshes with markings and barriers on mountain roads, town buildings (procedural, PBR, emissive windows at night), water plane for coast, horizon/far terrain LOD, using the existing atmosphere/daylight and the ULTRA pipeline where available; no cartoon look; keep the default preset performant.
5. Menu: a FESTIVAL entry (keep all existing menu actions working; if you add a paddock menu action, update e2e/28-race-hud-layout.spec.ts Tab loop count, e2e/30-menu-access.spec.ts toHaveCount, tests/frontend-menus.test.ts — or add it as a SESSION mode option instead to avoid changing those counts).
6. Tests + scripts: unit tests for terrain determinism, road network validation (validateRoute), world-surface queries, streaming tile budget, event route progress (no shortcut credit), a headless script (npm run test:open-world) driving an AI car along a 10 km route asserting progress without getting stuck and writing docs/open-world.json.
7. Docs: docs/production/OPEN_WORLD.md; update STATUS_REGISTER.md and GAME_DESIGN.md (implemented vs designed) honestly; never 'accepted'.
Run before final commit: npm run lint, npm test, npm run build, npm run validate:content, npm run test:physics (cars on circuits must be unchanged), npm run test:open-world. Make them pass.

Final text: worktree absolute path (pwd), branch, commits, files, test results, known limits.`, { label: 'implement open world', phase: 'Implement', isolation: 'worktree' })

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
  { key: 'systems', prompt: 'simulation and streaming correctness: world-surface queries wrong at tile seams/bridges, car falls through terrain, nondeterminism, memory growth when driving across tiles, AI stuck on junctions, route progress shortcuts, existing circuit sessions behaviour changed' },
  { key: 'experience', prompt: 'player experience and fidelity to GAME_DESIGN.md festival: dead ends (cannot return to menu / respawn), events not discoverable or not startable, results not shown, unreadable roads, cartoonish materials, default preset frame budget blown, menu e2e count assertions broken' },
]
phase('Review')
const reviews = await parallel(lenses.map(l => () => agent(`${COMMON}

You are a skeptical reviewer. The open-world festival was implemented in a git worktree; implementer report:
---
${IMPL}
---
Go to that worktree path (read-only; do not edit or commit). Review the diff versus claude/peaceful-einstein-dedc7t through this lens: ${l.prompt}. Report only real defects with a traced failure scenario. Prefer fewer, verified findings.`, { label: `review:${l.key}`, phase: 'Review', schema: SCHEMA })))
const findings = reviews.filter(Boolean).flatMap(r => r.findings)
log(`${findings.length} findings`)
phase('Fix')
const FIX = findings.length === 0 ? 'no findings' : await agent(`${COMMON}

Continue as the implementer in the open-world worktree described here:
---
${IMPL}
---
cd into that worktree. Findings (JSON):
${JSON.stringify(findings, null, 2)}
Verify each; fix real ones with regression tests; explain non-real ones. Run npm run lint, npm test, npm run build, npm run test:open-world; commit (do not push). Final text: worktree path, branch, new commits, per-finding outcome, test results.`, { label: 'fix open-world findings', phase: 'Fix' })
return { implement: IMPL, findings, fix: FIX }
