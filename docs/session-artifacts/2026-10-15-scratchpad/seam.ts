const W = '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/open-world/';
const { OpenWorld } = await import(W + 'world.ts');
const { TILE_SIZE, TILE_STEP, TILE_RES } = await import(W + 'terrain-tiles.ts');
const world = new OpenWorld();
const half = world.region.half;
const n = Math.ceil(half / TILE_SIZE);
console.log('half', half, 'tiles per side', 2 * n, 'stats', JSON.stringify(world.network.stats()));
const side = TILE_RES + 1;
const cache = new Map<string, Float32Array>();
const get = (ix: number, iz: number) => {
  const k = ix + ',' + iz;
  let t = cache.get(k);
  if (!t) { t = world.carver.build(ix * TILE_SIZE, iz * TILE_SIZE, TILE_STEP, TILE_RES).heights.slice(); cache.set(k, t); }
  return t;
};
let worst = 0, worstAt = '', count = 0, over5 = 0;
const t0 = performance.now();
for (let ix = -n; ix < n; ix++)
  for (let iz = -n; iz < n; iz++) {
    const a = get(ix, iz);
    if (ix + 1 < n) {
      const b = get(ix + 1, iz);
      for (let j = 0; j < side; j++) {
        const d = Math.abs(a[j * side + TILE_RES] - b[j * side]);
        if (d > 1e-4) count++;
        if (d > 0.05) over5++;
        if (d > worst) { worst = d; worstAt = `x-seam tile ${ix},${iz} j ${j} world (${(ix + 1) * TILE_SIZE}, ${iz * TILE_SIZE + j * TILE_STEP})`; }
      }
    }
    if (iz + 1 < n) {
      const b = get(ix, iz + 1);
      for (let i = 0; i < side; i++) {
        const d = Math.abs(a[TILE_RES * side + i] - b[i]);
        if (d > 1e-4) count++;
        if (d > 0.05) over5++;
        if (d > worst) { worst = d; worstAt = `z-seam tile ${ix},${iz} i ${i} world (${ix * TILE_SIZE + i * TILE_STEP}, ${(iz + 1) * TILE_SIZE})`; }
      }
    }
  }
console.log('ms', Math.round(performance.now() - t0), 'mismatched vertices', count, '>5cm', over5, 'worst', worst, worstAt);
