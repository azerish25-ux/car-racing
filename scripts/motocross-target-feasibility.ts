/** Optional, bounded Sport landing-target feasibility probe.
 *
 * Run: node --experimental-transform-types scripts/motocross-target-feasibility.ts
 * Add --out report.json to save the JSON report instead of printing it.
 *
 * Each case starts 12 m before the authored face at a fixed approach speed.
 * After that fixture setup, only public player inputs drive a fresh production
 * Simulation. AI control is disabled before the first approach snapshot.
 * Actual Float32 snapshots feed the live landing assessment and target tracker.
 *
 * This establishes scripted input and tracker feasibility. It does not measure
 * human ease, prove a complete route from the start gate, or tune the physics.
 */
import { writeFileSync } from 'node:fs';
import { clamp, mod } from '../src/core/math.ts';
import { DEFAULT_OPTIONS, controls } from '../src/simulation/config.ts';
import { Simulation } from '../src/simulation/world.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { rideLine } from '../src/simulation/offroad/jump-rig.ts';
import { OFFROAD_CIRCUITS, offroadCourse } from '../src/simulation/offroad/venues.ts';
import {
  LANDING_RULES,
  assessMotocrossLanding,
  motocrossAlignment,
  type MotocrossLandingFeedback,
} from '../src/simulation/offroad/riding-feedback.ts';
import {
  isMotocrossLandingTarget,
  MotocrossLandingChallenge,
} from '../src/simulation/offroad/landing-challenge.ts';
import {
  carBase,
  H,
  F,
  O,
  B,
  R,
  OFFROAD_BASE,
  BIKE_BASE,
  RACE_BASE,
} from '../src/simulation/protocol.ts';
import { FLAG } from '../src/simulation/marshal.ts';
import { trackPoint } from '../src/simulation/track.ts';
import { vehicleAt } from '../src/simulation/vehicles.ts';

const VENUES = ['valley-ridge-mx', 'arena-nord-sx'] as const;
const MACHINES = ['mx250', 'mx450'] as const;
type Venue = (typeof VENUES)[number];
type Machine = (typeof MACHINES)[number];
interface Approach {
  venue: Venue;
  name: string;
  /** Centreline approach speeds in m/s, in MX250 / MX450 order. */
  speeds: readonly [number, number];
}

/** Fixed inputs from the bounded 2026-10-19 jump survey check. These are game
 * approach speeds, not measurements from reference photographs. They were
 * selected around jumpHoldSpeed and then verified with manually eligible
 * takeoffs in the full simulation. No speed search runs in this script.
 * Creek Kicker has no surveyed downslope and is not a landing target. */
const APPROACHES: readonly Approach[] = [
  { venue: 'valley-ridge-mx', name: 'RIDGE TABLE', speeds: [11.77010999927624, 11.77010999927624] },
  {
    venue: 'valley-ridge-mx',
    name: 'BARN DOUBLE',
    speeds: [13.914366993645539, 13.814366993645539],
  },
  {
    venue: 'valley-ridge-mx',
    name: 'SKY TRIPLE',
    speeds: [14.278589940140192, 13.878589940140191],
  },
  {
    venue: 'valley-ridge-mx',
    name: 'SUMMIT TABLE',
    speeds: [12.764305261357515, 12.664305261357516],
  },
  {
    venue: 'valley-ridge-mx',
    name: 'VALLEY DOUBLE',
    speeds: [14.12871040127835, 13.528710401278351],
  },
  { venue: 'arena-nord-sx', name: 'TRIPLE', speeds: [13.785179725737494, 13.485179725737494] },
  { venue: 'arena-nord-sx', name: 'LANE DOUBLE', speeds: [11.733430927878059, 11.733430927878059] },
  { venue: 'arena-nord-sx', name: 'TABLETOP', speeds: [10.588741265344332, 9.988741265344332] },
  {
    venue: 'arena-nord-sx',
    name: 'FINISH TRIPLE',
    speeds: [13.425018894942802, 13.325018894942803],
  },
];
const DT = 1 / 120;
const MAX_SECONDS = 6;
const EXPECTED_RUNS = 18;

interface ProbeCase {
  venue: Venue;
  bike: Machine;
  name: string;
  approachSpeed: number;
}
interface Observation {
  time: number;
  s: number;
  speed: number;
  airborne: boolean;
  airTime: number;
  lateral: number;
  halfWidth: number;
  eligible: boolean;
  onCourse: boolean;
  crashed: boolean;
  globalFlag: number;
  localFlag: number;
  pitchError: number;
  normalSpeed: number;
  bottom: number;
  lateralSpeed: number;
  grade: MotocrossLandingFeedback['kind'];
}

function run(entry: ProbeCase) {
  const sim = new Simulation({
    ...DEFAULT_OPTIONS,
    mode: 'practice',
    circuit: entry.venue,
    opponents: 0,
    laps: 1,
    vehicles: [entry.bike],
    assist: 'sport',
  });
  const bike = sim.cars[0];
  if (!(bike instanceof DirtBikeVehicle)) throw new Error('Expected production dirt bike');
  const track = sim.track;
  const course = offroadCourse(track.circuit)!;
  const jump = course.jumps.find((j) => j.name === entry.name);
  if (!jump || !isMotocrossLandingTarget(jump))
    throw new Error('Missing authored downslope target');
  const targetSpeed = entry.approachSpeed;
  const spec = bike.definition.spec;
  sim.autoPlayer = false;
  bike.aiControlled(0);
  bike.place(track, jump.start - 12, 0);
  bike.dynamics.speed = targetSpeed;
  for (let g = 1; g < spec.gearRatios.length - 1; g++) {
    bike.gear = g;
    const rpm =
      ((targetSpeed / spec.wheelRadius) * spec.gearRatios[g + 1] * spec.finalDrive * 30) / Math.PI;
    if (rpm < spec.shiftRPM * 0.85) break;
  }
  const initial = {
    s: bike.s,
    speed: targetSpeed,
    gear: bike.gear,
    aiControlledSteps: 0,
    autoPlayer: false,
  };
  const challenge = new MotocrossLandingChallenge();
  const point = trackPoint();
  const base = carBase(0),
    o = base + OFFROAD_BASE;
  const state = {
    wasAirborne: false,
    landingAt: -Infinity,
    landingSideways: 0,
    takeoff: null as Observation | null,
    touchdown: null as Observation | null,
    totalSamples: 0,
    ineligibleSamples: 0,
    offCourseSamples: 0,
    peakBottom: 0,
    rebound: false,
    allClean: true,
    grades: new Set<MotocrossLandingFeedback['kind']>(),
  };

  function observe(): Observation {
    // Mirror the OffroadHud assessment using unmodified production snapshots:
    // first-contact lateral velocity is retained through the settling window,
    // and actual caution, pit and retirement channels determine eligibility.
    const frame = sim.makeFrame();
    const time = frame[H.TIME],
      s = frame[base + F.S];
    const airborne = frame[o + O.AIRBORNE] > 0.5;
    const crashed = frame[base + BIKE_BASE + B.STATE] > 0.5;
    const x = frame[base + F.QX],
      y = frame[base + F.QY],
      z = frame[base + F.QZ],
      w = frame[base + F.QW];
    const lateralSpeed = Math.abs(
      motocrossAlignment(
        2 * (x * z + w * y),
        1 - 2 * (x * x + y * y),
        frame[base + F.VX],
        frame[base + F.VZ],
      ).lateralSpeed,
    );
    if (state.wasAirborne && !airborne && frame[o + O.AIR_TIME] > 0.2) {
      state.landingAt = time;
      state.landingSideways = lateralSpeed;
    }
    if (
      !airborne &&
      time >= state.landingAt &&
      time - state.landingAt <= LANDING_RULES.settleSeconds
    )
      state.landingSideways = Math.max(state.landingSideways, lateralSpeed);
    const feedback = assessMotocrossLanding(
      frame[o + O.LANDING_PITCH],
      frame[o + O.LANDING_SPEED],
      frame[o + O.BOTTOM],
      crashed,
      vehicleAt(Math.round(frame[base + RACE_BASE + R.VEHICLE])).bike?.offroad,
      course.isRough(mod(s, track.length)),
      Number.isFinite(state.landingAt) ? state.landingSideways : 0,
    );
    const cautioned = [frame[H.FLAG], frame[base + F.LOCAL_FLAG]].some(
      (flag) => flag === FLAG.YELLOW || flag === FLAG.DOUBLE_YELLOW,
    );
    track.at(s, point);
    const eligible =
      !sim.autoPlayer &&
      !cautioned &&
      frame[base + F.IN_PIT] < 0.5 &&
      frame[base + F.RETIRED] < 0.5;
    const onCourse = Math.abs(frame[base + F.LATERAL]) <= Math.max(0, point.width - 0.3);
    challenge.update({
      course: track,
      machine: `${frame[base + RACE_BASE + R.VEHICLE]}:${sim.options.assist}`,
      jumps: course.jumps,
      length: track.length,
      time,
      s,
      speed: frame[base + F.SPEED],
      lateral: frame[base + F.LATERAL],
      halfWidth: point.width,
      airborne,
      airTime: frame[o + O.AIR_TIME],
      crashed,
      eligible,
      landing: feedback,
    });
    state.totalSamples++;
    if (!eligible) state.ineligibleSamples++;
    if (!onCourse) state.offCourseSamples++;
    const record: Observation = {
      time,
      s,
      speed: frame[base + F.SPEED],
      airborne,
      airTime: frame[o + O.AIR_TIME],
      lateral: frame[base + F.LATERAL],
      halfWidth: point.width,
      eligible,
      onCourse,
      crashed,
      globalFlag: frame[H.FLAG],
      localFlag: frame[base + F.LOCAL_FLAG],
      pitchError: frame[o + O.LANDING_PITCH],
      normalSpeed: frame[o + O.LANDING_SPEED],
      bottom: frame[o + O.BOTTOM],
      lateralSpeed: state.landingSideways,
      grade: feedback.kind,
    };
    if (
      !state.wasAirborne &&
      airborne &&
      !state.takeoff &&
      s >= jump!.start - 1 &&
      s <= jump!.takeoff + 3
    )
      state.takeoff = record;
    if (state.takeoff && state.wasAirborne && !airborne && !state.touchdown)
      state.touchdown = record;
    if (state.touchdown) {
      state.grades.add(feedback.kind);
      state.allClean &&= feedback.kind === 'clean';
      state.peakBottom = Math.max(state.peakBottom, frame[o + O.BOTTOM]);
      state.rebound ||= airborne;
    }
    state.wasAirborne = airborne;
    return record;
  }

  let last = observe(); // Establish manual eligibility before the approach.
  for (let step = 0; step < Math.ceil(MAX_SECONDS / DT); step++) {
    if (bike.airborne) {
      const wanted =
        (bike.landingTarget + 0.1 - bike.pitch - bike.riderBody * 0.06) /
          Math.max(0.12, bike.landingIn) -
        bike.pitchRate;
      sim.setInput({
        ...controls(),
        throttle: clamp(wanted * 1.2, 0, 1),
        clutch: clamp(-wanted * 1.2, 0, 1),
      });
    } else {
      const onFace = bike.s >= jump.start - 1 && bike.s <= jump.takeoff + 1;
      rideLine(bike, track, onFace ? Math.max(targetSpeed, bike.dynamics.speed) : targetSpeed);
      sim.setInput({ ...bike.input });
    }
    sim.step(DT); // The production world runs two physics substeps per tick.
    last = observe();
    if (state.touchdown && last.time - state.touchdown.time >= LANDING_RULES.settleSeconds + DT * 2)
      break;
    if (!bike.riding) break;
  }

  const actualResult = challenge.last
    ? {
        jump: challenge.last.jump.name,
        takeoff: challenge.last.jump.takeoff,
        at: challenge.last.at,
        kind: challenge.last.kind,
        first: challenge.last.first,
      }
    : null;
  const earnedTarget =
    challenge.cleared.has(jump.takeoff) &&
    actualResult?.kind === 'target' &&
    actualResult.jump === jump.name;
  const settledSeconds = state.touchdown ? last.time - state.touchdown.time : 0;
  return {
    ...entry,
    assist: sim.options.assist,
    initial,
    target: [jump.landing - jump.landingLength / 2, jump.landing + jump.landingLength / 2],
    takeoff: state.takeoff,
    touchdown: state.touchdown,
    physicalLanding: bike.lastLanding ? { ...bike.lastLanding } : null,
    totalSamples: state.totalSamples,
    ineligibleSamples: state.ineligibleSamples,
    offCourseSamples: state.offCourseSamples,
    settledSeconds,
    grades: [...state.grades],
    allClean: state.allClean,
    peakBottom: state.peakBottom,
    rebound: state.rebound,
    crashes: bike.dynamics.crashes,
    actualResult,
    earnedTarget,
    clearedTakeoffs: [...challenge.cleared],
    passed:
      earnedTarget &&
      state.allClean &&
      !state.rebound &&
      settledSeconds >= LANDING_RULES.settleSeconds &&
      state.ineligibleSamples === 0 &&
      state.offCourseSamples === 0 &&
      bike.dynamics.crashes === 0,
  };
}

function main() {
  const args = process.argv.slice(2);
  const usage =
    'Usage: node --experimental-transform-types scripts/motocross-target-feasibility.ts [--out report.json]';
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    console.log(usage);
    return;
  }
  if (args.length !== 0 && !(args.length === 2 && args[0] === '--out' && args[1])) {
    console.error(usage);
    process.exitCode = 2;
    return;
  }
  const cases: ProbeCase[] = APPROACHES.flatMap((approach) =>
    MACHINES.map((bike, i) => ({
      venue: approach.venue,
      name: approach.name,
      bike,
      approachSpeed: approach.speeds[i],
    })),
  );
  const key = (entry: Pick<ProbeCase, 'venue' | 'name' | 'bike'>) =>
    `${entry.venue}/${entry.bike}/${entry.name}`;
  const expected = new Set(
    VENUES.flatMap((venue) =>
      offroadCourse(OFFROAD_CIRCUITS[venue])!
        .jumps.filter(isMotocrossLandingTarget)
        .flatMap((jump) => MACHINES.map((bike) => key({ venue, name: jump.name, bike }))),
    ),
  );
  const failures: string[] = [];
  const actual = new Set(cases.map(key));
  if (
    cases.length !== EXPECTED_RUNS ||
    actual.size !== EXPECTED_RUNS ||
    expected.size !== EXPECTED_RUNS
  )
    failures.push(
      `Expected ${EXPECTED_RUNS} distinct machine/target cases; found table ${cases.length}, unique ${actual.size}, authored ${expected.size}`,
    );
  for (const id of expected) if (!actual.has(id)) failures.push(`Missing fixed approach: ${id}`);
  for (const id of actual) if (!expected.has(id)) failures.push(`Unexpected fixed approach: ${id}`);
  const rows: ReturnType<typeof run>[] = [];
  for (const entry of cases) {
    try {
      const row = run(entry);
      rows.push(row);
      if (!row.passed)
        failures.push(
          `${key(entry)}: outcome ${row.actualResult?.kind ?? 'none'}, grades ${row.grades.join('/')}, ineligible ${row.ineligibleSamples}, off-course ${row.offCourseSamples}, crashes ${row.crashes}, rebound ${row.rebound}`,
        );
    } catch (error) {
      failures.push(`${key(entry)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (rows.length !== EXPECTED_RUNS)
    failures.push(`Completed ${rows.length}/${EXPECTED_RUNS} runs`);
  const report = {
    generatedBy: 'node --experimental-transform-types scripts/motocross-target-feasibility.ts',
    method:
      'One run per fixed approach speed in solo Sport practice, on fresh live deformable terrain. Manual eligibility begins 12 m before the face with autoPlayer=false and aiControlled(0). After initial placement/speed/gear, only public ground/air controls are scripted. Actual production Float32 snapshots feed the live assessment and MotocrossLandingChallenge. No speed search or physical tuning. Scripted feasibility does not establish human ease or a full route from the start gate.',
    dt: DT,
    substepDt: DT / 2,
    boundedSecondsPerRun: MAX_SECONDS,
    expected: EXPECTED_RUNS,
    total: rows.length,
    earned: rows.filter((row) => row.earnedTarget).length,
    passed: failures.length === 0,
    failures,
    rows,
  };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (args[0] === '--out') {
    writeFileSync(args[1], json);
    console.log(
      `${report.earned}/${EXPECTED_RUNS} scripted landing targets earned; ${failures.length} failure(s). Report: ${args[1]}`,
    );
  } else process.stdout.write(json);
  if (failures.length) process.exitCode = 1;
}

main();
