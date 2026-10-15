import { OpenWorldSimulation } from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-3/src/simulation/open-world/session.ts';
import { BikeVehicle } from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-3/src/simulation/bike-vehicle.ts';

const vehicle = process.argv[2] ?? 'sbk1000';
const seconds = Number(process.argv[3] ?? 120);
const sim = new OpenWorldSimulation({ vehicle, tileBudget: 24 });
sim.command({ type: 'autopilot', value: true });
let wasRiding = true;
const hist: string[] = [];
for (let i = 0; i < seconds * 120; i++) {
  if (!sim.autopilot && i % 1200 === 0) sim.command({ type: 'autopilot', value: true });
  sim.step(1 / 120);
  const b = sim.player as BikeVehicle;
  const d = b.dynamics;
  const ap = (sim as unknown as { autopilotDriver: { decision: string; d: number; lateral: number; path: { at(d: number, o: unknown): { curvature: number; halfWidth: number } } } | null }).autopilotDriver;
  if (i % 12 === 0) {
    hist.push(
      `t=${(i / 120).toFixed(1)} v=${d.speed.toFixed(1)} lean=${d.lean.toFixed(2)} steer=${d.steer.toFixed(3)} in=${b.input.steer.toFixed(2)} thr=${b.input.throttle.toFixed(2)} brk=${b.input.brake.toFixed(2)} state=${d.state} lat=${ap?.lateral.toFixed(2)} dec=${ap?.decision} tgt=${b.aiTarget.toFixed(1)} surf=${sim.status().road.surface}`,
    );
    if (hist.length > 60) hist.shift();
  }
  if (wasRiding && !b.riding) {
    console.log('FALL', d.state, 'at', b.body.position.x.toFixed(0), b.body.position.z.toFixed(0));
    console.log(hist.join('\n'));
    hist.length = 0;
  }
  wasRiding = b.riding;
}
