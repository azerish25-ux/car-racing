const W = '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/open-world/';
const { OpenWorld } = await import(W + 'world.ts');
const { treesForTile, trunkRadius, regionStructures, StructureGrid, TREE_STRIDE } = await import(W + 'placement.ts');
const world = new OpenWorld();
const grid = new StructureGrid(regionStructures(world));
const key = (a: Float32Array, i: number) => `${a[i].toFixed(2)},${a[i + 1].toFixed(2)}`;
let phys = 0, med = 0, low = 0;
for (let ix = -16; ix < 16; ix += 3) for (let iz = -16; iz < 16; iz += 3) {
  const full = treesForTile(world, ix, iz, grid, 1);
  const m = new Set<string>(); const mt = treesForTile(world, ix, iz, grid, 0.7); for (let i = 0; i < mt.length; i += TREE_STRIDE) m.add(key(mt, i));
  const l = new Set<string>(); const lt = treesForTile(world, ix, iz, grid, 0.45); for (let i = 0; i < lt.length; i += TREE_STRIDE) l.add(key(lt, i));
  for (let i = 0; i < full.length; i += TREE_STRIDE) {
    if (trunkRadius(full[i + 3], full[i + 2]) <= 0) continue;
    phys++;
    if (!m.has(key(full, i))) med++;
    if (!l.has(key(full, i))) low++;
  }
}
console.log('trunk colliders sampled', phys, 'not drawn at medium', med, `(${(100 * med / phys).toFixed(0)}%)`, 'not drawn at low', low, `(${(100 * low / phys).toFixed(0)}%)`);
