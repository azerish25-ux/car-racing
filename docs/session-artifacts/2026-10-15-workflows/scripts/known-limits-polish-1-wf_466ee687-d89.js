export const meta = {
  name: 'known-limits-polish-1',
  description: 'Close the known limits reported by the discipline workers (bike/off-road gameplay+audio, car cockpits/interiors/setup, festival career+traffic) with review and fixes',
  phases: [
    { title: 'Implement', detail: 'three worktree implementers, disjoint areas' },
    { title: 'Review', detail: 'one skeptical reviewer per group' },
    { title: 'Fix', detail: 'apply confirmed findings in the same worktree' },
  ],
}
const COMMON = `Repo: TypeScript + Three.js 0.180 racing game (Vite, Vitest, Playwright). Original checkout /home/user/Experiment-3; integration branch claude/peaceful-einstein-dedc7t (all four disciplines merged: circuit cars incl. 57-machine registry, road bikes, off-road src/simulation/offroad/**, festival src/simulation/open-world/**, career src/career/**, audio src/audio/sound-profiles.ts, ULTRA rendering). FIRST in your worktree: git merge --no-edit claude/peaceful-einstein-dedc7t. If node_modules is missing: ln -s /home/user/Experiment-3/node_modules node_modules (never npm install). Commit messages end with exactly:
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RN7q935R3iepiRcM32D9uW
Do NOT push. No model identifiers. No real brands. Concurrent engineers: a venue wave (src/simulation/circuit-catalogue/**) and an art-direction pass (lighting/materials/venue-kit/open-world rendering) — avoid those files. Keep existing deterministic results (test:physics, test:vehicles, test:bikes, test:offroad, test:open-world) unchanged unless your task is to change that behaviour, and say so. If you add a paddock menu button, update e2e menu-count/Tab-order specs (e2e/28-race-hud-layout.spec.ts, e2e/30-menu-access.spec.ts) and tests/frontend-menus.test.ts.`
const GROUPS = [
  { key: 'bikes-offroad', prompt: `Bikes and off-road loose ends (from the workers' known-limits lists; verify each in code first):
1. Pit service for motorcycles: the pit crew animates a four-wheel car service for bikes. Make bike pit stops use a bike-appropriate service (rear-stand, rear-wheel change crew, fewer actors), in simulation timing and in the crew presentation.
2. Time-trial ghost: the ghost is always a Formula car. Render the ghost with the recorded vehicle's representation (car body, bike) and key ghost records by vehicle (record categories already include vehicle).
3. Setup page: bike setup (preload, damping, steering damper, gearing, TC/wheelie/engine-brake maps) shown for bikes; only parameters the machine exposes (setupFor).
4. Off-road meeting screen: a two-moto meeting flow (qualifying -> gate pick in qualifying order -> moto 1 -> moto 2 -> combined points results) reachable from the off-road events/career.
5. Audio: airborne and landing audio for dirt bikes and cars (engine note unloads in the air, suspension/landing thump scaled by impact), and rolling/surface audio for dirt, mud, sand and snow (src/audio/surface-audio.ts currently only grass/gravel).
Tests for each; run lint, npm test (affected + full), build, validate:content, test:bikes, test:offroad.` },
  { key: 'cars', prompt: `Car loose ends:
1. Cockpit camera uses the Formula eye point for every car: derive a per-vehicle cockpit/driver eye point (and roof/bonnet camera) from the body sheets in src/rendering/vehicle-bodies/body-sheet.ts (seat position, roof height), with correct FOV defaults per class.
2. Interiors: catalogue bodies only have seat, driver and dash. Add procedural interiors per body family: dashboard with instruments (reuse the existing instrument/steering display rendering where possible), steering wheel that turns with the snapshot steering, roll cage for race cars, door cards/pillars, mirrors, seats with harness, visible from the cockpit camera; LOD so rivals do not pay for interiors.
3. Glass: make glass physically plausible (transmission/tint with correct blending for windscreens and side glass from the material library) without breaking the sort order of cockpit views.
4. Per-car setup screen: only setupKeys of the active machine, with plain-language hints (reuse career garage hint logic if present).
Tests (eye points inside cabins for all bodies, interiors only at LOD0, setup keys per car); run lint, npm test, build.` },
  { key: 'festival', prompt: `Festival and career loose ends:
1. Career festival discipline: career does not read festival results. Register the festival region as a career venue, consume the 'festival-result' events (typed result) into the career economy (pay once per run id, reputation), and list festival events/discoveries in the career hub festival tab; unlock rules registry-driven.
2. Ambient traffic in the open world: deterministic, cheap ambient traffic on highways/country roads/towns (kinematic followers of road-network routes with simple car-following and junction yielding; interact physically with the player via simplified collision; despawn/spawn with streaming; capped counts per tile; off during events or limited), with festival HUD toggle.
3. Road motorcycles in the festival (road bikes and supermoto allowed; karts still excluded), using the bike adapter on the open-world surface.
Tests (career payout once per festival run, traffic determinism and caps, bike free-roam drive); run lint, npm test, build, validate:content, test:open-world (traffic off in the acceptance drive or measured separately).` },
]
const SCHEMA = { type: 'object', properties: { findings: { type: 'array', items: { type: 'object', properties: { file: { type: 'string' }, severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, problem: { type: 'string' }, failure_scenario: { type: 'string' }, fix: { type: 'string' } }, required: ['file', 'severity', 'problem', 'failure_scenario', 'fix'] } } }, required: ['findings'] }
const results = await pipeline(
  GROUPS,
  g => agent(`${COMMON}\n\nTASK (${g.key}):\n${g.prompt}\nUpdate docs/production/STATUS_REGISTER.md and the relevant D-rows in DETAILS_D001_D100.md honestly. Final text: worktree absolute path (pwd), branch, commits, per-item outcome, tests run with results, known limits.`, { label: `impl:${g.key}`, phase: 'Implement', isolation: 'worktree' }),
  (report, g) => agent(`${COMMON}\n\nYou are a skeptical reviewer. Group ${g.key} was implemented in a git worktree; report:\n---\n${report}\n---\nGo to that worktree (read-only). Review the diff versus claude/peaceful-einstein-dedc7t: correctness, determinism, unchanged existing behaviour, tests that pass vacuously, performance on low/default presets, accessibility of any new UI. Report only real defects with a traced failure scenario.`, { label: `review:${g.key}`, phase: 'Review', schema: SCHEMA }).then(r => ({ report, findings: r ? r.findings : [] })),
  (rv, g) => rv.findings.length === 0 ? { key: g.key, report: rv.report, fix: 'no findings' } : agent(`${COMMON}\n\nContinue as the implementer for ${g.key} in the worktree described here:\n---\n${rv.report}\n---\ncd there; git merge --no-edit claude/peaceful-einstein-dedc7t again. Findings:\n${JSON.stringify(rv.findings, null, 2)}\nVerify each; fix real ones with regression tests; explain non-real ones. Run the group's checks; commit (do not push). Final text: worktree path, branch, new commits, per-finding outcome, test results.`, { label: `fix:${g.key}`, phase: 'Fix' }).then(f => ({ key: g.key, report: rv.report, findings: rv.findings, fix: f })),
)
return results
