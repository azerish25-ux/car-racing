import type { TreeRecipe } from '/home/user/Experiment-3/.claude/worktrees/wf_1ec31848-637-3/scripts/assets/vegetation/bake.ts';

const tree = (spec: Partial<TreeRecipe>): TreeRecipe =>
  ({
    type: 'vegetation',
    form: 'tree',
    up: 'y',
    cards: 260,
    cardOrientation: 'fit',
    outwardBias: 0.6,
    cardAtlas: [2048, 2048],
    views: 8,
    impostorCell: [512, 512],
    trunkTriangles: 4000,
    barkSize: [512, 1024],
    crownNormal: 0.45,
    supersample: 3,
    ...spec,
  }) as TreeRecipe;

export const SPECIES: Record<string, TreeRecipe> = {
  birch: tree({
    object: 'xref_Betula_pendula_03mediumb.c4d',
    trunk: [
      'geometry/mesh_00064.ply',
      'geometry/mesh_00065.ply',
      'geometry/mesh_00066.ply',
      'geometry/mesh_00067.ply',
      'geometry/mesh_00068.ply',
    ],
    barkSize: [512, 2048],
  }),
  linden: tree({
    object: 'xref_Tilia_tomentosa_02medium.c4d Instance',
    trunk: ['geometry/mesh_00090.ply'],
  }),
  chestnut: tree({
    object: 'xref_Aesculus_02adult.c4d Instance',
    trunk: ['geometry/mesh_00126.ply', 'geometry/mesh_00127.ply', 'geometry/mesh_00128.ply'],
    cards: 480,
  }),
  rowan: tree({
    object: 'mountain_ash',
    trunk: ['geometry/mesh_00073.ply'],
    cards: 200,
  }),
  spruce: tree({
    object: 'xref_Picea_20mt.c4d',
    trunk: ['geometry/mesh_00155.ply', 'geometry/mesh_00156.ply', 'geometry/mesh_00157.ply'],
    exclude: ['geometry/mesh_00159.ply'],
    cardOrientation: 'outward',
    cards: 300,
    impostorCell: [384, 768],
  }),
  firb: tree({
    object: 'Abies_concolor_01medium',
    trunk: ['geometry/mesh_00001.ply', 'geometry/mesh_00002.ply', 'geometry/mesh_00006.ply'],
    cardOrientation: 'outward',
    cards: 220,
    impostorCell: [384, 768],
  }),
  fir: tree({
    object: 'Abies_concolor_02medium',
    trunk: ['geometry/mesh_00147.ply', 'geometry/mesh_00148.ply', 'geometry/mesh_00152.ply'],
    cardOrientation: 'outward',
    cards: 220,
    impostorCell: [384, 768],
  }),
  rose: tree({
    object: 'xref_WPR.c4d',
    form: 'shrub',
    trunk: ['geometry/mesh_00166.ply', 'geometry/mesh_00167.ply'],
    cards: 70,
    cardAtlas: [1024, 1024],
    impostorCell: [256, 256],
    trunkTriangles: 1200,
  }),
};
