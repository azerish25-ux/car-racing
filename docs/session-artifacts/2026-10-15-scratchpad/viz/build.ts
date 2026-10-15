import { OpenWorld } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/open-world/world.ts';
for (let i = 0; i < 3; i++) {
  const t0 = performance.now();
  const w = new OpenWorld();
  console.log('build', (performance.now() - t0).toFixed(0), w.network.x.length);
}
