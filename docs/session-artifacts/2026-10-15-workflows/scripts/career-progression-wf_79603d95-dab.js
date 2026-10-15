export const meta = {
  name: 'career-progression',
  description: 'Implement the cross-discipline career, licences, economy and garage from GAME_DESIGN.md, then review and fix',
  phases: [
    { title: 'Implement', detail: 'worktree agent builds career systems + UI + tests' },
    { title: 'Review', detail: 'game-design fidelity and save/economy correctness lenses' },
    { title: 'Fix', detail: 'apply confirmed findings' },
  ],
}

const COMMON = `Repo: TypeScript + Three.js racing game (Vite, Vitest, Playwright). Original checkout /home/user/Experiment-3; branch claude/peaceful-einstein-dedc7t is the integration branch. FIRST, in your worktree run: git merge --ff-only claude/peaceful-einstein-dedc7t || git merge --no-edit claude/peaceful-einstein-dedc7t (your worktree may start from an older base; docs/production must exist). If node_modules is missing run: ln -s /home/user/Experiment-3/node_modules node_modules (never npm install). Commit messages must end with exactly these two lines:
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RN7q935R3iepiRcM32D9uW
Do NOT push. No model identifiers in code or docs. No real brand names/trademarks. Other engineers are concurrently adding motorcycles (vehicles.ts, world.ts, protocol.ts, renderer), many cars (vehicles.ts catalogue, vehicle-bodies), ~20 circuits (circuits.ts catalogue), physics (tire.ts/vehicle.ts) and an online slice (src/net). Do not edit those areas beyond minimal hooks; career logic must read the vehicle registry (VEHICLES/VEHICLE_IDS, classId/family fields), circuit registry (CIRCUIT_IDS) and rulesets/events (src/simulation/events.ts) DATA-DRIVEN so newly added vehicles/tracks/bikes appear automatically.`

const IMPL = await agent(`${COMMON}

You are a senior game designer-engineer. Read docs/production/GAME_DESIGN.md (the design you implement), PROGRAMME_PLAN.md §4–§5, STATUS_REGISTER.md, and the existing systems: src/storage/team-career.ts (foundingBriefing, rewardIncome, paidSessions idempotence), src/storage/data.ts (SaveStore.writeWithBackup, readRecovered, recoverSave, versioned settings/migrations), src/core/championship.ts, src/simulation/events.ts (RULESETS, EVENTS, eventSession, sessionIncompatibilities), src/ui/event-cards.ts, src/ui/interface.ts (menu actions incl. EVENTS, CHAMPIONSHIP, TEAM HQ, DRIVING ACADEMY), src/main.ts (how menu actions start sessions and how results return), src/core/session-identity.ts (record categories), the academy code (grep academy).

TASK: implement the player journey and progression of GAME_DESIGN.md §3–§5 as real, persistent, tested systems with UI:
1. Career model (new module e.g. src/career/*.ts): disciplines (circuit-cars, road-bikes, off-road, festival) each with a ladder of tiers; licence tests (one skill each: braking-marker accuracy, cornering line deviation, wet control, lean/trail-braking for bikes, jump landing for off-road) scored from measured session telemetry/snapshot values with bronze/silver/gold thresholds; invitational events unlocked by licences + reputation; championships per tier using existing championship scoring. Disciplines whose machines/venues don't exist yet in the registry are shown locked with an honest 'coming' state derived from data (e.g. no vehicle of family 'bike' registered), never hard-coded.
2. Economy: credits earned by completion, self-improvement, clean racing (penalties, contact energy), objectives — itemised and shown on results (reuse/extend rewardIncome) and paid exactly once per session id; reputation per discipline (non-spendable); vehicle ownership with prices by class; a reduced-stakes recovery series always available; no pay-to-win. Upgrades: if implemented, must change the VehicleDefinition hash/record category (or omit upgrades and document).
3. Garage: owned vehicles list, choose active vehicle per discipline, setup presets per vehicle saved (setupFor keys only), plain-language effect hints.
4. Persistence: versioned career save with migration from existing saves (existing team career/championship data preserved), backup-before-overwrite via SaveStore.writeWithBackup, recovery path tested, corrupted save handled.
5. UI: a CAREER entry in the paddock menu (keep existing actions working; update e2e menu count tests/specs that assert the number of menu actions and Tab order — e2e/28-race-hud-layout.spec.ts loop count and e2e/30-menu-access.spec.ts toHaveCount, tests/frontend-menus.test.ts) with a discipline hub, licence screen, event list, garage and dealership; keyboard/controller accessible, reduced-motion respected, no cartoony styling (match existing menu style).
6. Session hook: starting a career event builds SessionOptions via eventSession; results flow back to award credits/reputation/licence medals once.
7. Tests: unit tests for scoring thresholds, payouts idempotence, migration, unlock logic driven by registry data, recovery series availability when broke; a DOM-only test for the menu entry.
8. Docs: update GAME_DESIGN.md with what is implemented vs designed, STATUS_REGISTER.md rows (WP25 academy per vehicle family if covered, career rows) honestly.
Run before final commit: npm run lint, npm test, npm run build, npm run validate:content — make them pass.

Final text: worktree absolute path (pwd), branch (git branch --show-current), commits, files, test results, known limits.`, { label: 'implement career', phase: 'Implement', isolation: 'worktree' })

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
  { key: 'design', prompt: 'fidelity to docs/production/GAME_DESIGN.md §3–§5 and honesty: hard-coded content instead of registry-driven unlocks, disciplines shown as available without machines, licence scoring not using measured values, missing recovery series, pay-to-win paths, UI dead ends (no way back / no next action), accessibility gaps (keyboard/controller)' },
  { key: 'state', prompt: 'save/economy correctness: double payouts (replay, restart, reload, two tabs), negative credits, migration losing existing championship/team data, backup/recovery not exercised, NaN propagation from telemetry, tests that pass vacuously, broken existing menu flows/e2e count assertions' },
]
phase('Review')
const reviews = await parallel(lenses.map(l => () => agent(`${COMMON}

You are a skeptical reviewer. The career system was implemented in a git worktree; implementer report:
---
${IMPL}
---
Go to that worktree path (read-only; do not edit or commit). Review the diff versus claude/peaceful-einstein-dedc7t through this lens: ${l.prompt}. Report only real defects with a traced failure scenario. Prefer fewer, verified findings.`, { label: `review:${l.key}`, phase: 'Review', schema: SCHEMA })))
const findings = reviews.filter(Boolean).flatMap(r => r.findings)
log(`${findings.length} findings`)
phase('Fix')
const FIX = findings.length === 0 ? 'no findings' : await agent(`${COMMON}

Continue as the implementer in the career worktree described here:
---
${IMPL}
---
cd into that worktree. Findings (JSON):
${JSON.stringify(findings, null, 2)}
Verify each; fix real ones with regression tests; explain non-real ones. Run npm run lint, npm test, npm run build; commit (do not push). Final text: worktree path, branch, new commits, per-finding outcome, test results.`, { label: 'fix career findings', phase: 'Fix' })
return { implement: IMPL, findings, fix: FIX }
