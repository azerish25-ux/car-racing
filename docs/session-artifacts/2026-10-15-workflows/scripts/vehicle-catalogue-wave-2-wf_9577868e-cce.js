export const meta = {
  name: 'vehicle-catalogue-wave-2',
  description: 'Expand the vehicle catalogue toward the 48-model destination (cars, road cars, road bikes) with calibration, bodies and sound, then review and fix',
  phases: [
    { title: 'Implement', detail: 'worktree agent adds ~30 calibrated machines with bodies, sound and events' },
    { title: 'Review', detail: 'calibration honesty and catalogue/menu integration lenses' },
    { title: 'Fix', detail: 'apply confirmed findings' },
  ],
}

const COMMON = `Repo: TypeScript + Three.js 0.180 racing game (Vite, Vitest). Original checkout /home/user/Experiment-3; integration branch claude/peaceful-einstein-dedc7t. FIRST in your worktree run: git merge --no-edit claude/peaceful-einstein-dedc7t (after it, src/simulation/vehicle-catalogue/**, src/rendering/vehicle-bodies/**, src/simulation/bike-definitions.ts, src/audio/sound-profiles.ts, scripts/vehicle-calibration.ts, scripts/bike-calibration.ts must exist). If node_modules is missing run: ln -s /home/user/Experiment-3/node_modules node_modules (never npm install). Commit messages must end with exactly:
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RN7q935R3iepiRcM32D9uW
Do NOT push. No model identifiers in code/docs. Generic names only — no real manufacturers, models, series or trademarks. Concurrent engineers: an open-world festival (src/simulation/open-world/**) and an off-road discipline that adds dirt bikes MX-450, MX-250, SM-450 plus motocross/rally venues (src/simulation/offroad/**). Do NOT add dirt bikes or supermoto; do not edit their modules. Append to registries; keep APX-01, TC-1 and every existing catalogue machine and bike bit-identical (content hashes unchanged).`

const IMPL = await agent(`${COMMON}

You are a senior vehicle-dynamics + technical-art engineer. Read docs/production/CONTENT_PIPELINE.md §1 (definition of done, acceptance packet, destination catalogue table), PHYSICS_MODEL.md, GAME_DESIGN.md, and the existing catalogue code: src/simulation/vehicle-catalogue/** (definitions, briefs, bands), src/simulation/vehicle-classes.ts, src/simulation/tire-families.ts, src/simulation/differential.ts, src/rendering/vehicle-bodies/body-sheet.ts (BODY_SHEETS per id), src/audio/sound-profiles.ts (BY_VEHICLE family map — add every new id), src/simulation/bike-definitions.ts (road bikes GP-R1, SBK-1000), scripts/vehicle-calibration.ts + bike-calibration.ts (bands), src/simulation/catalogue-events.ts + events.ts, src/ui/machine-options.ts, src/career/** (prices by class, ladders driven by registry).

TASK: grow the catalogue to at least 48 total machines (cars + road bikes; the off-road team adds 3 dirt bikes separately), each meeting the machine-checkable parts of the definition of done: realistic VehicleDefinition (mass, torque curve, gearing, inertia, CoG, aero CL/CD/balance, tyre family, brakes, drivetrain/differentials, setup keys), AI capability envelope, calibration design bands (0–100, top speed, 100–0, lateral g) passing at both timesteps, a distinct procedural body sheet (silhouette must differ: proportions, cabin, wings, lights, intakes), an explicit sound family, class/event eligibility, a design brief entry. Suggested additions (generic names): top-tier Formula with DRS and hybrid (distinct from APX-01 in aero and power), two more junior/feeder formulas, a 1970s and a 1980s historic formula, a historic sports-prototype, a second hypercar and a second LMP2-like prototype, two more GT3 (different engine layouts), one more GT4, one more touring, a hot-hatch club racer and a vintage club racer, a second rally car (rear-drive classic), a group-B-style historic rally, a second rallycross, an off-road buggy, a second kart (direct-drive 100cc), four experimental machines (fan-assisted downforce prototype, electric time-attack prototype, hydrogen endurance prototype concept, track-only hypercar), road cars for the festival (hot hatch, sports sedan, muscle coupe, classic grand tourer, pickup truck, rally-bred road car, luxury GT, roadster), and road bikes: a 600 supersport, a naked roadster, a second GP prototype variant and a classic road racer. Add new classes/families to vehicle-classes.ts and rulesets/events where a class needs one (with honest raceRuleset or none for road-only classes), career prices for new classes, and menu groups (machineChoices stays data-driven).
Calibrate honestly: bands come from the design brief, measured values must land inside; never widen a band after measuring just to pass — adjust the definition. Document every brief and measured result in CONTENT_PIPELINE.md §1.3/§1.4 (catalogue table counts) and regenerate docs/vehicle-calibration.json.
Tests: definitions validate, hashes unique, every machine has a body sheet + sound family, new events resolve without incompatibilities, menu lists each once, calibration within bands.
Run before final commit: npm run lint, npm test, npm run build, npm run validate:content, npm run test:vehicles (all metrics in band), npm run test:bikes, npm run test:physics. Make them pass.

Final text: worktree absolute path (pwd), branch, commits, machine list with measured headline numbers, test results, known limits.`, { label: 'implement catalogue wave 2', phase: 'Implement', isolation: 'worktree' })

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
  { key: 'calibration', prompt: 'calibration honesty and physical plausibility: bands widened to fit, implausible specs (power/mass/aero), cars indistinguishable from existing ones, AI envelopes inconsistent with measured limits, existing machine hashes changed, sound families wrong for the powertrain' },
  { key: 'integration', prompt: 'integration: body sheets missing/identical silhouettes, menu duplicates or missing machines, events with incompatibilities, career prices/ladders broken for new classes, road-only classes offered circuit races, tests that pass vacuously' },
]
phase('Review')
const reviews = await parallel(lenses.map(l => () => agent(`${COMMON}

You are a skeptical reviewer. Catalogue wave 2 was implemented in a git worktree; implementer report:
---
${IMPL}
---
Go to that worktree path (read-only; do not edit or commit). Review the diff versus claude/peaceful-einstein-dedc7t through this lens: ${l.prompt}. Report only real defects with a traced failure scenario. Prefer fewer, verified findings.`, { label: `review:${l.key}`, phase: 'Review', schema: SCHEMA })))
const findings = reviews.filter(Boolean).flatMap(r => r.findings)
log(`${findings.length} findings`)
phase('Fix')
const FIX = findings.length === 0 ? 'no findings' : await agent(`${COMMON}

Continue as the implementer in the catalogue wave 2 worktree described here:
---
${IMPL}
---
cd into that worktree. First git merge --no-edit claude/peaceful-einstein-dedc7t again (it may have advanced). Findings (JSON):
${JSON.stringify(findings, null, 2)}
Verify each; fix real ones with regression tests; explain non-real ones. Run npm run lint, npm test, npm run build, npm run validate:content, npm run test:vehicles, npm run test:bikes; commit (do not push). Final text: worktree path, branch, new commits, per-finding outcome, test results.`, { label: 'fix catalogue findings', phase: 'Fix' })
return { implement: IMPL, findings, fix: FIX }
