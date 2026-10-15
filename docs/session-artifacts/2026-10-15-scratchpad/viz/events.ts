import { openWorld } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/open-world/world.ts';
import { planRoute, RoutePath } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/open-world/route-path.ts';
import { SOLVANE } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/open-world/region-data.ts';
import { validateRoute } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/route-graph.ts';
const world = openWorld();
for (const ev of SOLVANE.events) {
  const closed = ev.kind === 'circuit';
  const t0 = performance.now();
  const legs = planRoute(world.network, ev.waypoints, closed);
  const path = new RoutePath(world.network, legs, closed);
  const spec = path.routeSpec(ev.id);
  console.log(
    ev.id.padEnd(18),
    ev.kind.padEnd(11),
    'len',
    path.length.toFixed(0).padStart(6),
    'legs',
    path.legs.length,
    'gates',
    spec.checkpoints.length,
    'errors',
    validateRoute(spec).join('|') || 'none',
    (performance.now() - t0).toFixed(0) + 'ms',
    path.legs.map((l) => world.network.edges[l.edge].id + (l.dir > 0 ? '+' : '-')).join(' '),
  );
}
