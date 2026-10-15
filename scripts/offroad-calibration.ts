// Off-road calibration laboratory (WP37). The production DirtBikeVehicle on
// the production terrain venues; only the rider's inputs are scripted (the
// jump rig: hold a speed along the centreline, never brake on a face).
// Bands:
//   1. 0-60 m from the gate on hard-packed dirt (seconds, per machine);
//   2. jump distance against the ballistic distance of the measured
//      take-off speed (the sprung chassis must fly a point-mass arc);
//   3. landing tolerance: every surveyed jump lands without a crash at the
//      AI's hold speed, and a gap jump taken far too fast or far too slow
//      ends on the ground (the window is real);
//   4. rolling a gap jump at walking pace (down into the gap, up the landing
//      and past the feature's end) is never a crash.
// Writes docs/offroad-calibration.json; exits 1 when a band fails.
import { writeFileSync } from 'node:fs';
import { jumpHoldSpeed, ROLL_SPEED, TAKEOFF_GAIN } from '../src/simulation/offroad/ai.ts';
import { DIRT_BIKES } from '../src/simulation/offroad/dirt-bikes.ts';
import {
  jumpRun,
  rollRun,
  standingStart,
  type JumpRunResult,
} from '../src/simulation/offroad/jump-rig.ts';
import { flightDistance } from '../src/simulation/offroad/profile.ts';
import { OFFROAD_CIRCUITS, offroadCourse } from '../src/simulation/offroad/venues.ts';

/** Seconds from the gate to 60 m (hard pack, standing start). */
const SIXTY: Readonly<Record<string, [number, number]>> = Object.freeze({
  mx450: [3.6, 5.0],
  mx250: [3.7, 5.2],
  sm450: [3.8, 5.6],
});
/** Flight distance over the ballistic distance of the take-off speed. */
const DISTANCE_RATIO: [number, number] = [0.85, 1.15];
const failures: string[] = [];
const sixty = Object.entries(SIXTY).map(([id, [lo, hi]]) => {
  const r = standingStart(DIRT_BIKES[id], 'valley-ridge-mx', 60);
  const ok = r.seconds !== null && r.seconds >= lo && r.seconds <= hi && r.crashes === 0;
  if (!ok)
    failures.push(
      `${id}: 0-60 m ${r.seconds?.toFixed(2) ?? 'not reached'} s outside [${lo}, ${hi}]`,
    );
  return { machine: id, seconds: r.seconds, band: [lo, hi], crashes: r.crashes };
});
const row = (r: JumpRunResult, ballistic: number) => ({
  takeoffSpeed: +r.takeoffSpeed.toFixed(3),
  distance: +r.distance.toFixed(2),
  ballistic: +ballistic.toFixed(2),
  airTime: +r.airTime.toFixed(3),
  pitchError: +r.pitchError.toFixed(3),
  normalSpeed: +r.normalSpeed.toFixed(2),
  bottomSpeed: +r.bottomSpeed.toFixed(2),
  outcome: r.outcome,
});
const jumps: unknown[] = [];
for (const venue of ['valley-ridge-mx', 'arena-nord-sx'] as const) {
  const course = offroadCourse(OFFROAD_CIRCUITS[venue])!;
  for (const machine of ['mx450', 'mx250'] as const) {
    const def = DIRT_BIKES[machine];
    for (const j of course.jumps) {
      const hold = jumpHoldSpeed(j),
        label = `${machine} ${venue} ${j.name}`;
      // Run-up: from the previous feature's end (a rider arrives at speed).
      const previous = course.jumps.filter((k) => k.end < j.start).at(-1),
        runUp = Math.max(4, Math.min(12, j.start - (previous ? previous.end + 2.5 : j.start - 12)));
      const at = jumpRun(def, venue, j, hold, 1 / 240, runUp);
      const ballistic = flightDistance(at.takeoffSpeed, j.lipHeight - j.landingHeight, j.lipAngle);
      const ratio = at.distance / ballistic;
      if (!at.flew) failures.push(`${label}: did not fly at the hold speed ${hold.toFixed(2)} m/s`);
      else if (at.outcome.startsWith('crash') || at.crashes)
        failures.push(`${label}: ${at.outcome} at the hold speed ${hold.toFixed(2)} m/s`);
      else if (
        Number.isFinite(ratio) &&
        j.kind !== 'kicker' &&
        (ratio < DISTANCE_RATIO[0] || ratio > DISTANCE_RATIO[1])
      )
        failures.push(
          `${label}: distance ${at.distance.toFixed(1)} m is ${ratio.toFixed(2)} of ballistic`,
        );
      // The window is real on gap jumps: far too slow or too fast crashes.
      let window: unknown = null;
      if (!j.forgiving) {
        const short = jumpRun(def, venue, j, hold - 2.5, 1 / 240, runUp),
          long = jumpRun(def, venue, j, hold + 3, 1 / 240, runUp);
        const shortOk = short.outcome.startsWith('crash') || short.outcome === 'bottomed';
        const longOk = long.outcome.startsWith('crash') || long.outcome === 'bottomed';
        if (!shortOk) failures.push(`${label}: ${short.outcome} 2.5 m/s short of the hold speed`);
        if (!longOk) failures.push(`${label}: ${long.outcome} 3 m/s over the hold speed`);
        window = { short: short.outcome, long: long.outcome };
      }
      // Rolling it at walking pace, all the way past its end, is never a crash.
      const roll = rollRun(def, venue, j, ROLL_SPEED, 1 / 240, runUp);
      if (roll.crashes) failures.push(`${label}: crashed rolling at ${ROLL_SPEED} m/s`);
      else if (!roll.passed)
        failures.push(
          `${label}: rolling at ${ROLL_SPEED} m/s stopped at ${roll.endS.toFixed(1)} (end ${j.end.toFixed(1)})`,
        );
      jumps.push({
        machine,
        venue,
        jump: j.name,
        kind: j.kind,
        hold: +hold.toFixed(3),
        gain: TAKEOFF_GAIN[j.kind],
        ratio: Number.isFinite(ratio) ? +ratio.toFixed(3) : null,
        atHold: row(at, ballistic),
        window,
        rolled: roll.crashes ? 'crash' : roll.passed ? 'ok' : 'stopped',
        rollSeconds: +roll.seconds.toFixed(2),
      });
    }
  }
}
const report = {
  generated: 'npm run test:offroad (scripts/offroad-calibration.ts)',
  bands: { sixty: SIXTY, distanceRatio: DISTANCE_RATIO },
  sixty,
  jumps,
  failures,
};
writeFileSync('docs/offroad-calibration.json', `${JSON.stringify(report, null, 2)}\n`);
for (const s of sixty) console.log(`0-60 m ${s.machine}: ${s.seconds?.toFixed(2)} s`);
console.log(`${jumps.length} jump runs; ${failures.length} band failure(s)`);
for (const f of failures) console.log(`FAIL ${f}`);
if (failures.length) process.exit(1);
