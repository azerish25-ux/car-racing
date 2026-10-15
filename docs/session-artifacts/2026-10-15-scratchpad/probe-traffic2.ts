import { OpenWorldSimulation } from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-3/src/simulation/open-world/session.ts';

const sim = new OpenWorldSimulation({ traffic: true, tileBudget: 24 });
sim.command({ type: 'autopilot', value: true });
for (let i = 0; i < 40 * 120; i++) {
  const before = sim.traffic.collisions;
  sim.step(1 / 120);
  const p = sim.player.body.position;
  if (sim.traffic.collisions !== before || (i % 240 === 0 && i > 1000)) {
    const near = sim.traffic.cars
      .map((c) => ({ id: c.id, d: Math.hypot(c.position.x - p.x, c.position.z - p.z), v: c.speed.toFixed(1), stun: c.stunned.toFixed(1), wait: c.waiting, edge: c.edge, dir: c.dir, s: c.s.toFixed(1), lat: c.lateral.toFixed(2), yaw: c.yaw.toFixed(2) }))
      .filter((c) => c.d < 30);
    const ap = (sim as unknown as { autopilotDriver: { decision: string; d: number; lateral: number } | null }).autopilotDriver;
    console.log(
      `t=${(i / 120).toFixed(2)} col=${sim.traffic.collisions} v=${sim.player.speed.toFixed(1)} heading=${Math.atan2(sim.player.forward.x, sim.player.forward.z).toFixed(2)} ap=${sim.autopilot} dec=${ap?.decision} lat=${ap?.lateral.toFixed(2)} msg=${sim.status().message}`,
      JSON.stringify(near),
    );
  }
}
