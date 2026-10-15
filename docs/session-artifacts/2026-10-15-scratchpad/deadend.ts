const W = '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/';
const { OpenWorldSimulation } = await import(W + 'open-world/session.ts');
const { trackPoint } = await import(W + 'track.ts');
for (const [label, ex, ez] of [['lighthouse', 3900, -2400], ['h1 west', -4000, -1880]] as const) {
  const sim = new OpenWorldSimulation({ tileBudget: 256 });
  const net = sim.world.network;
  const p = trackPoint();
  net.nearest(ex, ez, p);
  const e = net.edges[net.edgeOf[net.lastSegment]];
  // find which end is the dead end
  const nodeFrom = net.nodes[e.from], nodeTo = net.nodes[e.to];
  const deadAtEnd = nodeTo.edges.length === 1;
  const s0 = deadAtEnd ? e.offset + e.length - 150 : e.offset + 150;
  net.at(s0, p);
  const dir = deadAtEnd ? 1 : -1;
  sim.placeAt(sim.player, p.x, p.z, Math.atan2(p.tx * dir, p.tz * dir), p.y + 0.5);
  const dt = 1 / 120;
  let log: string[] = [];
  for (let k = 0; k < 120 * 14; k++) {
    sim.setInput({ throttle: 0.45, brake: 0, steer: 0, shift: 0, ers: 1, reverse: false, manualClutch: false, clutch: 0 } as any);
    sim.step(dt);
    if (k % 60 === 0) {
      const b = sim.player.body.position;
      const terrain = sim.track.tiles.height(b.x, b.z);
      const st = sim.status();
      log.push(`t=${(k * dt).toFixed(1)} x=${b.x.toFixed(0)} z=${b.z.toFixed(0)} y=${b.y.toFixed(2)} terrain=${terrain.toFixed(2)} y-terrain=${(b.y - terrain).toFixed(2)} v=${(sim.player.speed * 3.6).toFixed(0)} onRoad=${st.road.onRoad} surf=${st.road.surface} msg=${st.message}`);
    }
  }
  console.log(label, 'dead end at', deadAtEnd ? 'to' : 'from', 'node', JSON.stringify(deadAtEnd ? nodeTo : nodeFrom).slice(0, 80));
  console.log(log.join('\n'));
}
