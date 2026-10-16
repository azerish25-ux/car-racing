/** Reproducible route checks for the Horizon-inspired festival changes.
 * These are scripted physics runs, not human driving or rendering evidence.
 * Run from the repository root:
 * node --experimental-transform-types scripts/horizon-gameplay-validation.ts
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { FestivalResult } from '../src/simulation/open-world/festival-result.ts';
import { RouteDriver } from '../src/simulation/open-world/route-driver.ts';
import { OpenWorldSimulation } from '../src/simulation/open-world/session.ts';

const output = 'docs/production/horizon-gameplay-validation.json';
const command = 'node --experimental-transform-types scripts/horizon-gameplay-validation.ts';
const dt = 1 / 120;
const settings = {
  weather: 'clear',
  assist: 'sport',
  seed: 73021,
  tileBudget: 12,
  traffic: false,
} as const;
type Controller = 'session-autopilot' | 'scripted-steering-full-throttle';

// Read optional revision metadata without spawning a process. Content hashes
// below identify the tested gameplay files even in an exported checkout.
function baseGitCommit(): string | null {
  try {
    const head = readFileSync('.git/HEAD', 'utf8').trim();
    if (/^[a-f0-9]{40}$/.test(head)) return head;
    if (!head.startsWith('ref: refs/')) return null;
    const ref = head.slice(5);
    if (existsSync(`.git/${ref}`)) return readFileSync(`.git/${ref}`, 'utf8').trim();
    return (
      readFileSync('.git/packed-refs', 'utf8')
        .split('\n')
        .find((line) => line.endsWith(` ${ref}`))
        ?.split(' ')[0] ?? null
    );
  } catch {
    return null;
  }
}

function drive(eventId: string, vehicle: string, controller: Controller, maxSeconds: number) {
  const wallStart = performance.now();
  const sim = new OpenWorldSimulation({
    ...settings,
    vehicle,
    session: `horizon-validation-${eventId}-${vehicle}`,
  });
  const autopilot = controller === 'session-autopilot';
  if (autopilot) sim.command({ type: 'autopilot', value: true });
  sim.command({ type: 'start', event: eventId });
  const event = sim.events.find((candidate) => candidate.spec.id === eventId)!;
  const startedAt = sim.time;
  let player = sim.player;
  let driver = autopilot ? null : new RouteDriver(player, event.path, 0.9);
  let result: FestivalResult | null = null;
  let ticks = 0;
  let maximumSpeedKmh = 0;
  let playerReplacementsAfterStart = 0;
  while (ticks < Math.ceil(maxSeconds / dt) && !result) {
    if (driver) {
      // Use the route driver's steering through the ordinary input API.
      // Its speed envelope normally brakes near the end of the runway;
      // this acceleration check explicitly replaces only its pedals.
      driver.update(dt, sim.cars);
      sim.setInput({ ...player.input, throttle: 1, brake: 0 });
    }
    sim.step(dt);
    ticks++;
    maximumSpeedKmh = Math.max(maximumSpeedKmh, sim.player.speed * 3.6);
    if (sim.player !== player) {
      playerReplacementsAfterStart++;
      player = sim.player;
      if (driver) driver = new RouteDriver(player, event.path, 0.9);
    }
    result = sim.takeResult();
  }
  const threeStarSpeed = event.spec.stars?.[2] ?? null;
  return {
    eventId,
    vehicleId: vehicle,
    controller,
    method: {
      humanDriven: false,
      inSessionAutopilotEnabled: autopilot,
      externalRouteDriverSteering: !autopilot,
      steeringDriverSkill: 0.9,
      throttle: autopilot ? 'session RouteDriver speed envelope' : 'constant 1.0 through setInput',
      brake: autopilot ? 'session RouteDriver speed envelope' : 'constant 0.0 through setInput',
      forcedPoseOrVelocityAfterStart: false,
      explicitResetCommands: 0,
      careerPersistenceUsed: false,
      resultAssistanceInterpretation: autopilot
        ? 'The in-session autopilot marks its game result assisted.'
        : 'External scripted steering is assistance even though the game result assisted flag is false; this is not a human or unassisted record.',
    },
    eventGeometry: {
      resolvedDistanceMeters: event.distance,
      authoredPathLengthMeters: event.path.length,
      starTargets: event.spec.stars ?? null,
      marker: event.marker,
    },
    timing: {
      maximumAllowedSimulationSeconds: maxSeconds,
      ticks,
      tickSeconds: dt,
      physicsSubstepsPerTick: 2,
      elapsedSimulationSeconds: sim.time - startedAt,
      elapsedEventSeconds: result?.time ?? null,
      wallRuntimeMilliseconds: performance.now() - wallStart,
      wallRuntimePurpose:
        'Execution duration only; concurrent test/render work makes this unsuitable as a performance benchmark.',
    },
    maximumSpeedKmh,
    playerReplacementsAfterStart,
    result,
    checks: {
      producedResult: result !== null,
      completed: result?.completed === true && !result.abandoned,
      zeroOffRouteSeconds: result?.offRouteSeconds === 0,
      noPlayerRecoveryReplacement: playerReplacementsAfterStart === 0,
      threeStarTargetReached:
        !autopilot && event.spec.kind === 'speed-trap'
          ? result?.stars === 3 &&
            result.trapKmh !== null &&
            threeStarSpeed !== null &&
            result.trapKmh >= threeStarSpeed
          : null,
    },
  };
}

const runStartedAt = new Date().toISOString();
const routes = [
  drive('harbour-welcome', 'tc1', 'session-autopilot', 180),
  drive('runway-launch', 'tc1', 'session-autopilot', 120),
  drive('runway-launch', 'tc1', 'scripted-steering-full-throttle', 90),
  drive('runway-launch', 'eh3', 'scripted-steering-full-throttle', 90),
];
const geometrySim = new OpenWorldSimulation({ ...settings, vehicle: 'tc1' });
const drift = geometrySim.events.find((event) => event.spec.id === 'kestrel-drift')!;
const sourceFiles = [
  'src/simulation/open-world/session.ts',
  'src/simulation/open-world/festival-events.ts',
  'src/simulation/open-world/region-data.ts',
  'src/simulation/open-world/route-driver.ts',
  'src/simulation/open-world/skill-chain.ts',
  'src/simulation/vehicle.ts',
  'src/simulation/vehicles.ts',
];
const report = {
  schemaVersion: 1,
  kind: 'scripted-festival-physics-validation',
  generatedAt: new Date().toISOString(),
  runStartedAt,
  command,
  workingDirectory: 'repository root',
  outputFile: output,
  runtime: { node: process.version, platform: process.platform, architecture: process.arch },
  source: {
    baseGitCommit: baseGitCommit(),
    validatesWorkingTree: true,
    fileSha256: Object.fromEntries(
      sourceFiles.map((path) => [
        path,
        createHash('sha256').update(readFileSync(path)).digest('hex'),
      ]),
    ),
  },
  simulationSettings: settings,
  evidenceScope: {
    actualSimulationPhysics: true,
    normalEventStartCommand: true,
    humanPlaytest: false,
    browserExecuted: false,
    rendererExecuted: false,
    visualQualityEvidence: false,
    hardwareFrameRateEvidence: false,
    explanation:
      'These checks exercise gameplay route completion and attainable targets only. Scripted input does not establish human usability or visual quality. No career records are stored.',
  },
  routes,
  driftPlayground: {
    eventId: drift.spec.id,
    resolvedDistanceMeters: drift.distance,
    authoredPathLengthMeters: drift.path.length,
    minimumHalfWidthMeters: Math.min(...drift.path.halfWidth),
    maximumHalfWidthMeters: drift.path.maxHalfWidth(),
    starTargets: drift.spec.stars,
    routeGraphValidation: 'Passed during resolveEvents in OpenWorldSimulation construction.',
    humanDriftRun: false,
    scriptedDriftRun: false,
    limitation:
      'Route geometry and existing drift scoring regressions were checked; this document does not claim a completed drift playground driving trial.',
  },
  interpretation: {
    distances:
      'Measured event distances exclude the final 60 m of braking runout included in each of these three authored paths.',
    harbour:
      'A legal completed autopilot run supports route continuity and opponent integration. It does not establish human race difficulty.',
    runway:
      'The two full-throttle runs check mechanical reachability of the authored speed targets. The ordinary autopilot run demonstrates its conservative end-of-route braking and is not a test of maximum vehicle speed.',
  },
  passed: routes.every((route) =>
    Object.values(route.checks).every((value) => value === null || value),
  ),
};
mkdirSync('docs/production', { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(
  JSON.stringify(
    {
      output,
      passed: report.passed,
      runs: routes.map((route) => ({
        event: route.eventId,
        vehicle: route.vehicleId,
        controller: route.controller,
        checks: route.checks,
        trapKmh: route.result?.trapKmh,
        eventSeconds: route.result?.time,
      })),
    },
    null,
    2,
  ),
);
if (!report.passed) process.exitCode = 1;
