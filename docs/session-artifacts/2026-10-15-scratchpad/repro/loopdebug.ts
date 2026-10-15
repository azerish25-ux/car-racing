import { DEFAULT_OPTIONS, type SessionOptions } from '/home/user/Experiment-3/.claude/worktrees/wf_b0a03695-07e-1/src/simulation/config.ts';
import { DirtBikeVehicle } from '/home/user/Experiment-3/.claude/worktrees/wf_b0a03695-07e-1/src/simulation/offroad/dirt-bike-vehicle.ts';
import { PHASE } from '/home/user/Experiment-3/.claude/worktrees/wf_b0a03695-07e-1/src/simulation/race.ts';
import { Simulation } from '/home/user/Experiment-3/.claude/worktrees/wf_b0a03695-07e-1/src/simulation/world.ts';
const proto = DirtBikeVehicle.prototype as any;
const orig = proto.loopOut;
proto.loopOut = function () {
  const ll = this.lastLanding;
  console.log('LOOP car', this.id, 's', this.s.toFixed(1), 'v', this.dynamics.speed.toFixed(2), 'pitch', this.pitch.toFixed(3), 'road', this.roadPitch.toFixed(3), 'FF', this.forceFront.toFixed(0), 'FR', this.forceRear.toFixed(0), 'frontLight', this.frontLight.toFixed(2), 'air', this.airborne, 'free', this.freeSteps, 'thr', this.throttle.toFixed(2), 'brk', this.brake.toFixed(2), 'body', this.riderBody.toFixed(2), 'clock', this.clock.toFixed(2), 'lastLanding', ll && JSON.stringify({ t: +(this.clock - ll.time).toFixed(2), s: +ll.s.toFixed(1), out: ll.outcome, pe: +ll.pitchError.toFixed(2), sl: +ll.slope.toFixed(2), air: +ll.airTime.toFixed(2), tk: +ll.takeoffSpeed.toFixed(1) }));
  return orig.call(this);
};
const which = process.argv[2] ?? 'valley';
const options: SessionOptions = which === 'valley' ? { ...DEFAULT_OPTIONS, mode: 'race', weather: 'clear', circuit: 'valley-ridge-mx', ruleset: 'motocross-moto', laps: 3, opponents: 7, vehicles: Array.from({ length: 8 }, (_, i) => (i % 3 === 2 ? 'mx250' : 'mx450')), seed: +(process.argv[3] ?? 41001) }
  : { ...DEFAULT_OPTIONS, mode: 'race', weather: 'clear', circuit: 'arena-nord-sx', ruleset: 'motocross-moto', laps: 3, opponents: 7, vehicles: Array(8).fill('mx450'), seed: 41003 };
const sim = new Simulation(options);
sim.autoPlayer = true;
for (let t = 0; t < 600 && sim.race.phase !== PHASE.FINISHED; t += 1 / 120) sim.step(1 / 120);
console.log(JSON.stringify(sim.cars.map((c) => (c as DirtBikeVehicle).crashCauses.map((k) => k.cause + '@' + k.s.toFixed(0)))));
