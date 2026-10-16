import type { SkyPalette } from '../assets/sky-catalogue.ts';

/**
 * Which baked plant stands where (pure rules, unit-tested). Planting plans
 * keep describing trees by shape (height, crown width, conifer); a palette
 * (the venue's landscape, the same one that picks its photographed sky) and
 * a per-tree hash turn that into one of the shipped species, a scale and a
 * tint. Plans, colliders and counts are unchanged.
 */
export const SPECIES = Object.freeze({
  linden: 'tree-linden',
  chestnut: 'tree-chestnut',
  birch: 'tree-birch',
  rowan: 'tree-rowan',
  fir: 'tree-fir',
  firB: 'tree-fir-b',
  shrub: 'shrub-flowering',
  grass: 'grass-meadow',
} as const);
export type SpeciesId = (typeof SPECIES)[keyof typeof SPECIES];
export const TREE_SPECIES: readonly SpeciesId[] = Object.freeze([
  SPECIES.linden,
  SPECIES.chestnut,
  SPECIES.birch,
  SPECIES.rowan,
  SPECIES.fir,
  SPECIES.firB,
]);

/** Crown shape of a planned tree. */
export type TreeRole = 'broadleaf' | 'spreading' | 'upright' | 'conifer' | 'small';

/** Species per role and palette: weighted choices [id, weight]. */
const CHOICES: Readonly<
  Record<SkyPalette, Readonly<Record<TreeRole, readonly [SpeciesId, number][]>>>
> = Object.freeze({
  green: {
    broadleaf: [
      [SPECIES.linden, 3],
      [SPECIES.chestnut, 2],
      [SPECIES.birch, 1],
    ],
    spreading: [
      [SPECIES.chestnut, 3],
      [SPECIES.linden, 2],
    ],
    upright: [
      [SPECIES.birch, 3],
      [SPECIES.fir, 1],
    ],
    conifer: [
      [SPECIES.fir, 3],
      [SPECIES.firB, 2],
    ],
    small: [
      [SPECIES.rowan, 3],
      [SPECIES.linden, 1],
    ],
  },
  alpine: {
    broadleaf: [
      [SPECIES.birch, 3],
      [SPECIES.rowan, 2],
    ],
    spreading: [
      [SPECIES.linden, 2],
      [SPECIES.birch, 1],
    ],
    upright: [
      [SPECIES.fir, 2],
      [SPECIES.firB, 2],
    ],
    conifer: [
      [SPECIES.fir, 3],
      [SPECIES.firB, 3],
    ],
    small: [
      [SPECIES.rowan, 3],
      [SPECIES.birch, 1],
    ],
  },
  coast: {
    broadleaf: [
      [SPECIES.linden, 3],
      [SPECIES.rowan, 2],
    ],
    spreading: [
      [SPECIES.chestnut, 2],
      [SPECIES.linden, 1],
    ],
    upright: [
      [SPECIES.fir, 2],
      [SPECIES.birch, 1],
    ],
    conifer: [
      [SPECIES.fir, 2],
      [SPECIES.firB, 1],
    ],
    small: [[SPECIES.rowan, 1]],
  },
  city: {
    broadleaf: [
      [SPECIES.linden, 3],
      [SPECIES.chestnut, 1],
    ],
    spreading: [[SPECIES.chestnut, 1]],
    upright: [[SPECIES.birch, 1]],
    conifer: [[SPECIES.fir, 1]],
    small: [
      [SPECIES.rowan, 2],
      [SPECIES.linden, 1],
    ],
  },
  flat: {
    broadleaf: [
      [SPECIES.linden, 2],
      [SPECIES.chestnut, 2],
    ],
    spreading: [[SPECIES.chestnut, 1]],
    upright: [
      [SPECIES.birch, 2],
      [SPECIES.fir, 1],
    ],
    conifer: [[SPECIES.fir, 1]],
    small: [[SPECIES.rowan, 1]],
  },
  arid: {
    broadleaf: [
      [SPECIES.rowan, 2],
      [SPECIES.chestnut, 1],
    ],
    spreading: [[SPECIES.chestnut, 1]],
    upright: [[SPECIES.fir, 1]],
    conifer: [[SPECIES.fir, 1]],
    small: [[SPECIES.rowan, 1]],
  },
  desert: {
    broadleaf: [[SPECIES.rowan, 1]],
    spreading: [[SPECIES.chestnut, 1]],
    upright: [[SPECIES.fir, 1]],
    conifer: [[SPECIES.fir, 1]],
    small: [[SPECIES.rowan, 1]],
  },
});

/** Species a venue of `palette` can show (what to load). */
export function speciesForPalette(palette: SkyPalette, shrubs = true, grass = true): SpeciesId[] {
  const ids = new Set<SpeciesId>();
  for (const list of Object.values(CHOICES[palette] ?? CHOICES.green))
    for (const [id] of list) ids.add(id);
  if (shrubs) ids.add(SPECIES.shrub);
  if (grass) ids.add(SPECIES.grass);
  return [...ids];
}

/** Role of a planned tree from its crown aspect (width / height). */
export function treeRole(height: number, width: number, conifer = false): TreeRole {
  if (conifer) return 'conifer';
  const ratio = width / Math.max(0.1, height);
  if (height < 7.5) return 'small';
  if (ratio < 0.73) return 'upright';
  if (ratio < 0.93) return 'broadleaf';
  return 'spreading';
}

/** A deterministic 0..1 hash of a plan position. */
export function plantHash(x: number, z: number, salt = 0) {
  let h =
    Math.imul(Math.round(x * 8) | 0, 0x27d4eb2d) ^
    Math.imul(Math.round(z * 8) | 0, 0x165667b1) ^
    Math.imul(salt | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** Species for a role in a palette, restricted to `available` (loaded) ids. */
export function pickSpecies(
  role: TreeRole,
  palette: SkyPalette,
  hash: number,
  available: ReadonlySet<string>,
): SpeciesId | null {
  const options = (CHOICES[palette] ?? CHOICES.green)[role].filter(([id]) => available.has(id));
  const fallback = TREE_SPECIES.filter((id) => available.has(id));
  if (!options.length) return fallback.length ? fallback[Math.floor(hash * fallback.length)] : null;
  const total = options.reduce((s, [, w]) => s + w, 0);
  let pick = hash * total;
  for (const [id, w] of options) {
    if (pick < w) return id;
    pick -= w;
  }
  return options.at(-1)![0];
}

/** Largest uniform scale per species: the baked firs are young (8-9 m), the
 * planned conifers of forest belts reach 28 m; needles stay below a pixel
 * where such firs stand (belts begin 30 m behind the barrier), broadleaf
 * leaves would not. */
export const MAX_SCALE: Readonly<Partial<Record<SpeciesId, number>>> = Object.freeze({
  [SPECIES.fir]: 2.6,
  [SPECIES.firB]: 2.6,
});

/** Uniform scale that brings a species of `natural` height to the planned
 * `height`, within limits that keep leaves and needles believable. */
export function plantScale(natural: number, height: number, max = 1.75) {
  return Math.min(max, Math.max(0.55, height / Math.max(0.1, natural)));
}

/** Per-tree albedo tint: brightness and a little hue spread; drier palettes
 * pull toward olive. Linear RGB multipliers around 1. */
export function plantTint(hash: number, palette: SkyPalette): [number, number, number] {
  const b = 0.88 + 0.22 * hash;
  const warm = (hash * 7.31) % 1;
  const dry = palette === 'arid' || palette === 'desert' ? 0.12 : palette === 'flat' ? 0.04 : 0;
  return [
    b * (0.96 + 0.08 * warm + dry),
    b * (1 - 0.03 * warm + dry * 0.4),
    b * (0.94 + 0.06 * (1 - warm) - dry),
  ];
}
