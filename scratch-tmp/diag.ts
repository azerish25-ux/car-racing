import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { EVENTS, eventSession } from '../src/simulation/events.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { PHASE } from '../src/simulation/race.ts';
import { Simulation } from '../src/simulation/world.ts';
import { CollisionSolver } from '../src/simulation/collision.ts';
const contacts: string[] = [];
let simRef: any = null;
const orig = CollisionSolver.prototype.impulse;
CollisionSolver.prototype.impulse = function (a: any, b: any, contact: any, normal: any, pen: number) {
  const A = a.body, B = b?.body;
  const vA = { x: 0, y: 0, z: 0 } as any;
  const va = A.velocity, vb = B ? B.velocity : { x: 0, y: 0, z: 0 };
  const vn = (va.x - vb.x) * normal.x + (va.y - vb.y) * normal.y + (va.z - vb.z) * normal.z;
  const ridingA = a.riding, ridingB = b?.riding;
  orig.call(this, a, b, contact, normal, pen);
  const crashedA = ridingA && a.contactCrash, crashedB = b && ridingB && b.contactCrash;
  if ((crashedA || crashedB) && simRef) {
    contacts.push(`${simRef.race.raceTime.toFixed(1)} a${a.id}${a.airborne ? '^' : ''} s${a.s.toFixed(0)} l${a.lateral.toFixed(1)} v${a.speed.toFixed(1)} y${A.position.y.toFixed(2)} vy${va.y.toFixed(1)} | ${b ? `b${b.id}${b.airborne ? '^' : ''} s${b.s.toFixed(0)} l${b.lateral.toFixed(1)} v${b.speed.toFixed(1)} y${B.position.y.toFixed(2)} vy${vb.y.toFixed(1)}` : 'WALL'} n(${normal.x.toFixed(2)},${normal.y.toFixed(2)},${normal.z.toFixed(2)}) vn${vn.toFixed(1)} pen${pen.toFixed(2)}`);
  }
};
const DT = 1 / 120;
const id = process.argv[2] ?? 'valley-ridge-mx-moto-1';
const ev = EVENTS.find((e) => e.id === id)!;
const opts = eventSession(ev, DEFAULT_OPTIONS);
const sim = new Simulation(opts);
sim.autoPlayer = true;
simRef = sim;
const n = sim.cars.length;
const stopped = new Float64Array(n);
const reported = new Set<string>();
let t = 0;
const t0 = performance.now();
for (; t < 1200 && sim.race.phase !== PHASE.FINISHED; t += DT) {
  sim.step(DT);
  if (sim.race.phase !== PHASE.RACING) continue;
  sim.cars.forEach((c, i) => {
    stopped[i] = c.speed < 1 && !c.finishTime && !c.inPit ? stopped[i] + DT : 0;
    const key = `${i}:${Math.floor(stopped[i] / 5)}`;
    if (stopped[i] > 5 && !reported.has(key) && Math.floor(stopped[i] / 5) <= 6) {
      reported.add(key);
      const b = c as DirtBikeVehicle;
      const ai = sim.ai[i] as any;
      console.log(JSON.stringify({
        t: +sim.race.raceTime.toFixed(1), id: i, stop: +stopped[i].toFixed(1), s: +c.s.toFixed(1), lat: +c.lateral.toFixed(2),
        speed: +c.speed.toFixed(2), dspeed: +b.dynamics.speed.toFixed(2), state: b.dynamics.state, sc: +b.dynamics.stateClock.toFixed(1),
        air: b.airborne, inp: { th: +c.input.throttle.toFixed(2), br: +c.input.brake.toFixed(2), st: +c.input.steer.toFixed(2), cl: c.input.clutch, rev: c.input.reverse },
        thr: +(b as any).throttle.toFixed(2), aiTarget: +c.aiTarget.toFixed(2), aiOffset: +c.aiOffset.toFixed(2), decision: ai?.decision, aiStuck: ai?.stuck,
        lean: +b.dynamics.lean.toFixed(2), heading: +b.dynamics.heading.toFixed(2), pitch: +b.pitch.toFixed(2), roadPitch: +b.roadPitch.toFixed(2),
        cF: +b.compressionFront.toFixed(3), cR: +b.compressionRear.toFixed(3), fF: +b.forceFront.toFixed(0), fR: +b.forceRear.toFixed(0),
        surf: [b.contacts[0].surface, b.contacts[2].surface], res: [b.contacts[0].resistance, b.contacts[2].resistance].map(x=>+x.toFixed(2)),
        h: [b.contacts[0].height, b.contacts[2].height].map(x=>+x.toFixed(2)), cgY: +b.cgY.toFixed(2), gear: (b as any).gear, rpm: +(b as any).rpm.toFixed(0),
        drive: +b.dynamics.driveForce.toFixed(0), rb: +b.dynamics.rearBrakeForce.toFixed(0), fb: +b.dynamics.frontBrakeForce.toFixed(0),
        lap: sim.race.laps[i].completed, retired: c.retired, stuckClock: (b as any).stuckClock, dec: ai?.decisions,
      }));
    }
  });
}
console.log('done', sim.race.phase === PHASE.FINISHED, sim.race.raceTime.toFixed(1), 'wall', ((performance.now() - t0) / 1000).toFixed(0));
console.log('finish', sim.cars.map((c) => c.finishTime.toFixed(1)).join(' '));
console.log('crashes', sim.cars.map((c) => (c as DirtBikeVehicle).dynamics.crashes).join(' '));
console.log('causes', JSON.stringify(sim.cars.map((c) => (c as DirtBikeVehicle).crashCauses.map((x) => `${x.cause}@${x.s.toFixed(0)}`))));
console.log(contacts.join('\n'));
console.log('laps', sim.race.laps.map((l) => l.completed).join(' '));
