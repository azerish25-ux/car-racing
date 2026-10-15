import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bakeGrass, type GrassRecipe } from '/home/user/Experiment-3/.claude/worktrees/wf_1ec31848-637-3/scripts/assets/vegetation/bake.ts';
import { writePng } from '/home/user/Experiment-3/.claude/worktrees/wf_1ec31848-637-3/scripts/assets/vegetation/image.ts';

const [root, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const recipe: GrassRecipe = {
  type: 'vegetation',
  form: 'grass',
  patches: [
    { object: 'meadow_v3', up: 'z' },
    { object: 'meadow_v3dry', up: 'z' },
  ],
  views: 4,
  slab: 0.45,
  tile: [512, 256],
  tileMetres: [1.4, 0.7],
  crownNormal: 0.3,
  supersample: 3,
};
const baked = await bakeGrass(root, recipe, (...a) => console.log(...a));
for (const [name, image] of Object.entries(baked.images))
  writePng(join(outDir, `grass_${name}.png`), image.width, image.height, image.data);
writeFileSync(join(outDir, 'grass.json'), JSON.stringify(baked.info, null, 2));
