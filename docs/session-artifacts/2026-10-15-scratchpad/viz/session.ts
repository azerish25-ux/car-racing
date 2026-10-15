import { OpenWorldSimulation } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/open-world/session.ts';
const t0 = performance.now();
const sim = new OpenWorldSimulation({ vehicle: process.argv[3] ?? 'tc1' });
console.log('session build ms', (performance.now() - t0).toFixed(0), 'structures', sim.structures.length, 'events', sim.events.length);
const id = process.argv[2] ?? 'valley-sprint';
sim.command({ type: 'autopilot', value: true });
sim.command({ type: 'start', event: id });
const t1 = performance.now();
for (let tick = 0; tick < 120 * 1200; tick++) {
  sim.step(1 / 120);
  if (tick % (120 * 10) === 0) {
    const s = sim.status();
    console.log(
      sim.time.toFixed(0),
      s.mode,
      'v',
      s.speedKmh.toFixed(0),
      s.event ? `pos ${s.event.position}/${s.event.entrants} prog ${(s.event.progress * 100).toFixed(1)}% lap ${s.event.lap}/${s.event.laps} off ${s.event.offRoute}` : '',
      s.road.name,
      s.road.surface,
      s.message ?? '',
    );
  }
  const r = sim.takeResult();
  if (r) {
    console.log('RESULT', JSON.stringify({ ...r, driftLines: r.driftLines.length }));
    break;
  }
}
console.log('wall', (performance.now() - t1).toFixed(0), 'ms', JSON.stringify(sim.track.tiles.stats));
