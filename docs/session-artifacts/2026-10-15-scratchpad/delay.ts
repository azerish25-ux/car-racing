import { DEFAULT_OPTIONS, validateOptions } from '/home/user/Experiment-3/.claude/worktrees/wf_f5fa9a5f-78d-1/src/simulation/config.ts';
import { Simulation } from '/home/user/Experiment-3/.claude/worktrees/wf_f5fa9a5f-78d-1/src/simulation/world.ts';

const delays = (process.argv[2] ?? '0,12,18,24').split(',').map(Number);
for (const delay of delays) {
  const sim = new Simulation(
    validateOptions({ ...DEFAULT_OPTIONS, mode: 'race', laps: 3, opponents: 7, seed: 909 }),
  );
  sim.autoPlayer = true;
  const rings = sim.cars.map(() => [] as { t: number; b: number; s: number; e: 0 | 1 | 2 }[]);
  sim.ai.forEach((ai, i) => {
    const original = ai.update.bind(ai);
    ai.update = (dt, track, cars, race) => {
      original(dt, track, cars, race);
      const c = cars[i];
      if (c.inPit || c.pitRequested) return;
      const q = (x: number) => Math.round(x * 255) / 255;
      rings[i].push({ t: q(c.input.throttle), b: q(c.input.brake), s: Math.round(c.input.steer * 32767) / 32767, e: c.input.ers });
      const d = rings[i].length > delay ? rings[i][rings[i].length - 1 - delay] : { t: 0, b: 1, s: 0, e: 1 as const };
      c.input.throttle = d.t;
      c.input.brake = d.b;
      c.input.steer = d.s;
      if (rings[i].length > 64) rings[i].shift();
    };
  });
  let offTrackTicks = 0,
    impacts = 0;
  const t0 = performance.now();
  for (let tick = 0; tick < 120 * 66; tick++) {
    sim.step(1 / 120);
    for (const c of sim.cars) {
      if (Math.abs(c.lateral) > 9) offTrackTicks++;
      if (c.impact > 0.3) impacts++;
    }
  }
  console.log(
    'delay',
    delay,
    'cpu',
    (performance.now() - t0).toFixed(0),
    'offTrackTicks',
    offTrackTicks,
    'impactTicks',
    impacts,
    'laps',
    sim.race.laps.map((l) => l.completed).join(','),
    'best',
    sim.race.laps.map((l) => l.last.toFixed(2)).join(','),
    'retired',
    sim.cars.filter((c) => c.retired).length,
    'speeds',
    sim.cars.map((c) => c.speed.toFixed(0)).join(','),
  );
}
