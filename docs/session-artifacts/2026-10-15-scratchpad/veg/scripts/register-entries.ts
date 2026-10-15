/**
 * Emit source-register entries for the vegetation species (sha256 + bytes of
 * every landscape file each one needs, from the local download).
 *   node --experimental-transform-types register-entries.ts <landscape root> <out.json>
 */
import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { plantParts } from '/home/user/Experiment-3/.claude/worktrees/wf_1ec31848-637-3/scripts/assets/vegetation/pbrt.ts';

const [root, out] = process.argv.slice(2);
const BASE =
  'https://raw.githubusercontent.com/mmp/pbrt-v4-scenes/30cf4a0346ae5a80a2d7a530a3ef7d0fa4f70572/landscape';
const HOME = 'https://github.com/mmp/pbrt-v4-scenes/tree/30cf4a0346ae5a80a2d7a530a3ef7d0fa4f70572/landscape';
const AUTHOR = 'Jan-Walter Schliep, Burak Kahraman and Timm Dapper (Laubwerk)';
const scene = readFileSync(join(root, 'geometry/geometry.pbrt'), 'utf8');

const common = {
  cardOrientation: 'fit',
  outwardBias: 0.6,
  cardAtlas: [2048, 2048],
  views: 8,
  impostorCell: [512, 512],
  trunkTriangles: 4000,
  barkSize: [512, 1024],
  crownNormal: 0.45,
  supersample: 3,
};
interface Spec {
  id: string;
  title: string;
  latin: string;
  notes: string;
  objects: string[];
  exclude?: string[];
  recipe: Record<string, unknown>;
}
const SPECS: Spec[] = [
  {
    id: 'tree-linden',
    title: 'Silver linden',
    latin: 'Tilia tomentosa',
    notes: 'broadleaf, 11.6 m, round crown',
    objects: ['xref_Tilia_tomentosa_02medium.c4d Instance'],
    recipe: { form: 'tree', object: 'xref_Tilia_tomentosa_02medium.c4d Instance', up: 'y', trunk: ['geometry/mesh_00090.ply'], cards: 300, seed: 101, ...{} },
  },
  {
    id: 'tree-chestnut',
    title: 'Horse chestnut',
    latin: 'Aesculus hippocastanum',
    notes: 'broadleaf, 18.7 m, wide domed crown',
    objects: ['xref_Aesculus_02adult.c4d Instance'],
    recipe: {
      form: 'tree',
      object: 'xref_Aesculus_02adult.c4d Instance',
      up: 'y',
      trunk: ['geometry/mesh_00126.ply', 'geometry/mesh_00127.ply', 'geometry/mesh_00128.ply'],
      cards: 480,
      trunkTriangles: 6000,
      seed: 102,
    },
  },
  {
    id: 'tree-birch',
    title: 'Silver birch',
    latin: 'Betula pendula',
    notes: 'broadleaf, 15.9 m, weeping crown, white bark',
    objects: ['xref_Betula_pendula_03mediumb.c4d'],
    recipe: {
      form: 'tree',
      object: 'xref_Betula_pendula_03mediumb.c4d',
      up: 'y',
      trunk: ['geometry/mesh_00064.ply', 'geometry/mesh_00065.ply', 'geometry/mesh_00066.ply', 'geometry/mesh_00067.ply', 'geometry/mesh_00068.ply'],
      cards: 300,
      barkSize: [512, 2048],
      seed: 103,
    },
  },
  {
    id: 'tree-rowan',
    title: 'Rowan',
    latin: 'Sorbus aucuparia',
    notes: 'small broadleaf, 8.4 m, with berries',
    objects: ['mountain_ash'],
    recipe: { form: 'tree', object: 'mountain_ash', up: 'y', trunk: ['geometry/mesh_00073.ply'], cards: 220, seed: 104 },
  },
  {
    id: 'tree-fir',
    title: 'White fir',
    latin: 'Abies concolor',
    notes: 'conifer, 7.9 m, dense tiers',
    objects: ['Abies_concolor_02medium'],
    recipe: {
      form: 'tree',
      object: 'Abies_concolor_02medium',
      up: 'y',
      trunk: ['geometry/mesh_00147.ply', 'geometry/mesh_00148.ply', 'geometry/mesh_00152.ply'],
      cardOrientation: 'outward',
      cards: 240,
      impostorCell: [384, 768],
      seed: 105,
    },
  },
  {
    id: 'tree-fir-b',
    title: 'White fir, second form',
    latin: 'Abies concolor',
    notes: 'conifer, open tiers',
    objects: ['Abies_concolor_01medium'],
    recipe: {
      form: 'tree',
      object: 'Abies_concolor_01medium',
      up: 'y',
      trunk: ['geometry/mesh_00001.ply', 'geometry/mesh_00002.ply', 'geometry/mesh_00006.ply'],
      cardOrientation: 'outward',
      cards: 240,
      impostorCell: [384, 768],
      seed: 106,
    },
  },
  {
    id: 'shrub-flowering',
    title: 'Flowering shrub',
    latin: '',
    notes: 'shrub, 1.1 m, white-pink flowers',
    objects: ['xref_WPR.c4d'],
    recipe: {
      form: 'shrub',
      object: 'xref_WPR.c4d',
      up: 'y',
      trunk: ['geometry/mesh_00166.ply', 'geometry/mesh_00167.ply'],
      cards: 80,
      cardAtlas: [1024, 1024],
      impostorCell: [256, 256],
      trunkTriangles: 1200,
      barkSize: [256, 512],
      seed: 107,
    },
  },
  {
    id: 'grass-meadow',
    title: 'Meadow grass',
    latin: '',
    notes: 'meadow and late-summer meadow patches as clump cards',
    objects: ['meadow_v3', 'meadow_v3dry'],
    exclude: ['geometry/mesh_00255.ply', 'geometry/mesh_00184.ply'],
    recipe: {
      form: 'grass',
      patches: [
        { object: 'meadow_v3', up: 'z', exclude: ['geometry/mesh_00255.ply'] },
        { object: 'meadow_v3dry', up: 'z', exclude: ['geometry/mesh_00184.ply'] },
      ],
      views: 4,
      slab: 0.45,
      tile: [512, 256],
      tileMetres: [1.4, 0.7],
      crownNormal: 0.3,
      supersample: 3,
    },
  },
];

const file = (rel: string) => {
  const path = join(root, rel);
  return {
    url: `${BASE}/${rel}`,
    sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
    bytes: statSync(path).size,
  };
};
const entries = SPECS.map((spec) => {
  const rels = new Set<string>(['geometry/geometry.pbrt']);
  for (const object of spec.objects)
    for (const part of plantParts(scene, object)) {
      if (spec.exclude?.includes(part.mesh)) continue;
      if ((spec.recipe.exclude as string[] | undefined)?.includes(part.mesh)) continue;
      rels.add(part.mesh);
      for (const t of [part.color, part.alpha, part.bump]) if (t) rels.add(t);
    }
  const name = spec.latin ? `${spec.title} (${spec.latin})` : spec.title;
  const isTree = spec.recipe.form !== 'grass';
  return {
    id: spec.id,
    kind: 'vegetation',
    title: name,
    author: AUTHOR,
    licence: 'CC-BY-4.0',
    attribution: `"${name}" from the pbrt-v4 Landscape scene by ${AUTHOR}, CC BY 4.0. Modified: simplified and baked into leaf cards, impostors and textures for real-time use.`,
    homepage: HOME,
    licenceEvidence:
      'pbrt-v4-scenes README.md (commit 30cf4a0) states the landscape scene by Jan-Walter Schliep, Burak Kahraman and Timm Dapper from Laubwerk is licensed under CC-BY (https://creativecommons.org/licenses/by/4.0/).',
    notes: spec.notes,
    files: [...rels].map(file),
    recipe: isTree ? { type: 'vegetation', ...common, ...spec.recipe } : { type: 'vegetation', ...spec.recipe },
  };
});
writeFileSync(out, JSON.stringify(entries, null, 1));
for (const e of entries)
  console.log(e.id, e.files.length, 'files', (e.files.reduce((s, f) => s + f.bytes, 0) / 1048576).toFixed(1), 'MB');
