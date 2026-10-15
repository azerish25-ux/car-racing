import { loadPlant } from '/home/user/Experiment-3/.claude/worktrees/wf_1ec31848-637-3/scripts/assets/vegetation/plant.ts';
import { RasterTarget, rasterize } from '/home/user/Experiment-3/.claude/worktrees/wf_1ec31848-637-3/scripts/assets/vegetation/raster.ts';
import { SPECIES } from './species.ts';

const [root, id] = process.argv.slice(2);
const plant = loadPlant(root, SPECIES[id], 256);
for (const p of plant.parts) {
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let v = 0; v < p.positions.length; v += 3)
    for (let c = 0; c < 3; c++) {
      b[c] = Math.min(b[c], p.positions[v + c]);
      b[c + 3] = Math.max(b[c + 3], p.positions[v + c]);
    }
  const target = new RasterTarget(128, 128, 1);
  rasterize(target, { origin: [0, plant.height / 2, 0], right: [1, 0, 0], up: [0, 1, 0], forward: [0, 0, -1], width: plant.height, height: plant.height, near: -1e3, far: 1e3 }, p);
  let covered = 0;
  for (const d of target.depth) if (d !== Infinity) covered++;
  let tmin = Infinity, tmax = -Infinity;
  if (p.texture) for (const v of p.texture.levels[0].rgba) { tmin = Math.min(tmin, v); tmax = Math.max(tmax, v); }
  console.log(p.part.mesh, p.role, p.foliage, p.cutoff, 'tris', p.indices.length / 3, 'bounds', b.map((v) => v.toFixed(2)).join(' '), 'covered', covered, 'tex', tmin.toFixed(2), tmax.toFixed(2), p.tint);
}
