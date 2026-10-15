export const meta = {
  name: 'art-direction-pass-1',
  description: 'Capture the fixed evaluation framings at ULTRA, critique them through three lenses, implement the highest-value realism fixes, re-capture and verify',
  phases: [
    { title: 'Capture', detail: 'render the capture-suite framings (before)' },
    { title: 'Critique', detail: 'lighting, materials, geometry/composition lenses' },
    { title: 'Improve', detail: 'worktree implementer applies the top fixes and re-captures' },
    { title: 'Verify', detail: 'before/after judgement' },
  ],
}
const COMMON = `Repo: TypeScript + Three.js 0.180 (WebGL2) racing game (Vite, Playwright). Original checkout /home/user/Experiment-3; integration branch claude/peaceful-einstein-dedc7t (has ULTRA preset src/rendering/ultra/**, material library src/rendering/materials/**, venue kit src/rendering/venue-kit/**, open world src/rendering/open-world/**, capture script scripts/ultra-capture.ts, capture-suite doc docs/production/CONTENT_PIPELINE.md §3 and RENDERING_PIPELINE.md). If node_modules is missing: ln -s /home/user/Experiment-3/node_modules node_modules (never npm install). Browser: CHROMIUM_PATH=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome | head -1); software GL here is slow (seconds per frame) and 4 CPUs are shared — keep captures small (e.g. 960x540) and few. Use the production build (npm run build && npx vite preview --port <free port>) for captures. Commit messages end with exactly:
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RN7q935R3iepiRcM32D9uW
Do NOT push. No model identifiers. Goal: photoreal, non-cartoon look (physically plausible exposure, materials, scale, atmosphere). Do NOT edit src/rendering/vehicle-bodies/** or src/rendering/offroad/** or bike models (other engineers own them); low/medium/high presets must not get slower; ULTRA may.`

const SHOTS = 'Aurel: (1) cockpit low speed pit exit, (2) chase high speed main straight, (3) side-by-side two cars, (4) wet braking into turn 1 in rain, (5) sunset into the sun, (6) night traffic, (7) pit entry/service, (8) wide replay/broadcast, (9) close photo of a car; plus (10) a catalogue venue (e.g. Neon City at night or Alpine Pass) and (11) the open-world festival (town or coast road, golden hour).'

const CAPTURE_SCHEMA = { type: 'object', properties: { scratchDir: { type: 'string' }, images: { type: 'array', items: { type: 'object', properties: { shot: { type: 'string' }, path: { type: 'string' }, preset: { type: 'string' } }, required: ['shot', 'path'] } }, method: { type: 'string' } }, required: ['scratchDir', 'images', 'method'] }

phase('Capture')
const before = await agent(`${COMMON}

Write (or extend scripts/ultra-capture.ts into) a deterministic capture script that drives the real app (menu -> session -> paused frames / photo mode / replay cameras, using window.apexDiagnostics and existing photo/camera controls; no state injection beyond what dev diagnostics already allow) and renders these framings at the ULTRA preset: ${SHOTS}. Save PNGs into a NEW directory under /tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/art/before/ (create it). Work in /home/user/Experiment-3 read-only for source (do not commit there); put any script you write under that scratch dir too so it can be reused by another engineer (document how to run it). If a framing is impossible, capture the closest equivalent and say so. Return the list of image paths.`, { label: 'capture before', phase: 'Capture', schema: CAPTURE_SCHEMA })

const LENSES = [
  { key: 'lighting', prompt: 'lighting, exposure and atmosphere: sun/sky energy balance, tonemapping, bloom, shadow softness and contact shadows, ambient occlusion, IBL/reflections, fog/aerial perspective, night lighting, wet reflections' },
  { key: 'materials', prompt: 'materials and surfaces: asphalt micro-detail and wear, kerbs, paint, rubber, glass, metal, carbon, vegetation, concrete, barriers, water/puddles, texture scale/tiling repetition, specular aliasing' },
  { key: 'geometry', prompt: 'geometry, scale and composition: silhouettes, polygon facets, LOD pops, vegetation density and variety, trackside clutter, crowd, buildings, horizon and terrain, camera framing/FOV/motion cues, anything that reads as toy-like or cartoonish' },
]
const CRIT_SCHEMA = { type: 'object', properties: { issues: { type: 'array', items: { type: 'object', properties: { shot: { type: 'string' }, problem: { type: 'string' }, cause: { type: 'string' }, fix: { type: 'string' }, files: { type: 'string' }, value: { type: 'number' }, cost: { type: 'number' } }, required: ['problem', 'fix', 'files', 'value', 'cost'] } } }, required: ['issues'] }

phase('Critique')
const critiques = await parallel(LENSES.map(l => () => agent(`${COMMON}

You are a senior art director for a photoreal console racing game. Look at each captured image (Read the PNG files) listed here:
${JSON.stringify(before.images, null, 2)}
Critique through this lens only: ${l.prompt}. For each issue: which shot, the visible problem, the likely cause in this codebase (inspect src/rendering/** to point at the responsible module and parameter), a concrete fix, the files, value (1-10 impact on realism) and cost (1-10 effort). Prioritise issues visible in several shots. Max 12 issues. Read-only: do not edit.`, { label: `critique:${l.key}`, phase: 'Critique', schema: CRIT_SCHEMA })))
const issues = critiques.filter(Boolean).flatMap(c => c.issues).sort((a, b) => (b.value / Math.max(1, b.cost)) - (a.value / Math.max(1, a.cost)))
log(`${issues.length} issues; implementing top 15 by value/cost`)
const top = issues.slice(0, 15)

phase('Improve')
const improved = await agent(`${COMMON}

FIRST: git merge --no-edit claude/peaceful-einstein-dedc7t in your worktree. You are a senior rendering/technical-art engineer. The capture method and before images: ${JSON.stringify(before)}. Implement these art-direction fixes (highest value/cost first; skip any that would violate the constraints, and say why):
${JSON.stringify(top, null, 2)}
Then re-capture the same framings with the same method into /tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/art/after/ (same file names). Keep default/low/medium/high performance unchanged (prefer ULTRA-gated or zero-cost fixes for lower presets). Run npm run lint, npm test (affected + full if feasible), npm run build. Commit in your worktree (do not push). Final text: worktree path, branch, commits, per-issue outcome, after image paths, test results.`, { label: 'implement art fixes', phase: 'Improve', isolation: 'worktree' })

phase('Verify')
const VERDICT = { type: 'object', properties: { perShot: { type: 'array', items: { type: 'object', properties: { shot: { type: 'string' }, better: { type: 'boolean' }, notes: { type: 'string' } }, required: ['shot', 'better', 'notes'] } }, regressions: { type: 'array', items: { type: 'string' } }, nextPriorities: { type: 'array', items: { type: 'string' } } }, required: ['perShot', 'regressions', 'nextPriorities'] }
const verdict = await agent(`${COMMON}

You are an independent art director. Compare before images ${JSON.stringify(before.images)} with the after images in /tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/art/after/ (same names). Read both PNGs per shot. Judge each shot: is it more photoreal? List regressions and the next 10 priorities toward a photoreal console-quality look. Implementer report for context:
${improved}`, { label: 'verify art', phase: 'Verify', schema: VERDICT })
return { before, issues: top, improved, verdict }
