// Scratch: AI smoke test per machine — four identical AI cars in practice on
// a circuit; reports laps, best lap, stuck time, impacts, retirements.
import { DEFAULT_OPTIONS } from '/home/user/Experiment-3/.claude/worktrees/wf_9577868e-cce-1/src/simulation/config.ts';
import { Simulation } from '/home/user/Experiment-3/.claude/worktrees/wf_9577868e-cce-1/src/simulation/world.ts';

const ids = process.argv[2].split(',');
const circuit = (process.argv[3] ?? 'aurel') as 'aurel';
const seconds = Number(process.argv[4] ?? 240);
for (const id of ids) {
  const t0 = performance.now();
  const sim = new Simulation({
    ...DEFAULT_OPTIONS,
    circuit,
    mode: 'practice',
    opponents: 3,
    vehicles: [id, id, id, id],
    seed: 1234,
  });
  sim.autoPlayer = true;
  const stuck = new Float64Array(4);
  let worst = 0,
    impact = 0,
    maxSpeed = 0;
  const DT = 1 / 120;
  for (let t = 0; t < seconds; t += DT) {
    sim.step(DT);
    sim.cars.forEach((c, i) => {
      impact = Math.max(impact, c.impact);
      maxSpeed = Math.max(maxSpeed, c.speed);
      stuck[i] = c.speed < 1 && !c.inPit && t > 10 ? stuck[i] + DT : 0;
      worst = Math.max(worst, stuck[i]);
    });
  }
  const laps = sim.race.laps.map((l) => l.completed);
  const bests = sim.race.laps.map((l) => l.best).filter((b) => b > 0);
  const warnings = sim.race.laps.map((l) => l.warnings);
  const incidents = sim.race.control.events.filter((e) => e.kind === 'incident').length;
  console.log(
    `${id.padEnd(7)} laps ${laps.join(',')} best ${bests.length ? Math.min(...bests).toFixed(2) : '—'} ` +
      `vmax ${(maxSpeed * 3.6).toFixed(0)} stuck ${worst.toFixed(1)} impact ${impact.toFixed(2)} ` +
      `incidents ${incidents} warn ${warnings.join(',')} retired ${sim.cars.filter((c) => c.retired).length} ` +
      `(${((performance.now() - t0) / 1000).toFixed(0)} s)`,
  );
}
