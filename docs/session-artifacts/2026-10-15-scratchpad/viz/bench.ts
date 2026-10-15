import { openWorld } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/open-world/world.ts';
import { regionStructures, StructureGrid, treesForTile, TREE_STRIDE } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/open-world/placement.ts';
const w = openWorld();
console.log('world build', w.buildMs.toFixed(0));
let t0 = performance.now();
let acc = 0;
for (let i = 0; i < 200000; i++) acc += w.field.height(-3000 + (i % 400) * 15, -2000 + Math.floor(i / 400) * 9);
console.log('height us', ((performance.now() - t0) * 1000) / 200000, acc > 0);
t0 = performance.now();
const s = regionStructures(w);
console.log('structures', s.length, 'ms', (performance.now() - t0).toFixed(0));
const grid = new StructureGrid(s);
t0 = performance.now();
let trees = 0;
for (const [ix, iz] of [[6, 12], [5, 11], [-10, 6], [0, 0], [3, -8], [-9, 9]]) {
  const t = treesForTile(w, ix, iz, grid);
  trees += t.length / TREE_STRIDE;
}
console.log('trees', trees, 'ms per tile', ((performance.now() - t0) / 6).toFixed(1));
t0 = performance.now();
const carve = w.carver.build(0, 0, 4, 64);
console.log('carve tile ms', (performance.now() - t0).toFixed(1), carve.heights[100]);
