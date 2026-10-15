import { openWorld } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/open-world/world.ts';
import { resolveEvents } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/open-world/festival-events.ts';
import { pathPoint } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/open-world/route-path.ts';
const w = openWorld();
const ev = resolveEvents(w).find((e) => e.spec.id === 'hairpin-drift')!;
const p = pathPoint(),
  q = pathPoint();
ev.path.at(300, q);
console.log('len', ev.path.length, 'start', q.x.toFixed(0), q.z.toFixed(0));
for (let d = 0; d < ev.path.length; d += 100) {
  ev.path.at(d, p);
  console.log(d, p.x.toFixed(0), p.z.toFixed(0), p.y.toFixed(0), Math.hypot(p.x - q.x, p.z - q.z).toFixed(0));
}
