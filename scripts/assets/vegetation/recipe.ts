/**
 * Source-register recipe of a baked vegetation asset (assets/third-party/
 * sources.json, `"type": "vegetation"`). Trees and shrubs name one pbrt
 * `ObjectBegin` block of the landscape scene; grass names meadow patches.
 */
export interface VegetationTreeRecipe {
  type: 'vegetation';
  form: 'tree' | 'shrub';
  /** pbrt `ObjectBegin` name of the plant. */
  object: string;
  up: 'y' | 'z';
  /** Mesh files (geometry/mesh_NNNNN.ply) kept as the decimated trunk. */
  trunk: string[];
  /** Mesh files left out (ground litter, helpers). */
  exclude?: string[];
  cards: number;
  cardOrientation: 'outward' | 'fit';
  outwardBias: number;
  cardAtlas: [number, number];
  views: number;
  impostorCell: [number, number];
  trunkTriangles: number;
  barkSize: [number, number];
  crownNormal: number;
  supersample: number;
  /** k-means and phase seed. */
  seed: number;
}
export interface VegetationGrassRecipe {
  type: 'vegetation';
  form: 'grass';
  patches: { object: string; up: 'y' | 'z'; exclude?: string[] }[];
  views: number;
  slab: number;
  tile: [number, number];
  tileMetres: [number, number];
  crownNormal: number;
  supersample: number;
}
export type VegetationRecipe = VegetationTreeRecipe | VegetationGrassRecipe;

/** Recipe rules beyond the JSON shape. */
export function validateVegetationRecipe(recipe: VegetationRecipe): string[] {
  const errors: string[] = [];
  const pow2 = (n: number) => Number.isInteger(n) && n >= 64 && n <= 4096 && (n & (n - 1)) === 0;
  if (recipe.form === 'grass') {
    if (!recipe.patches.length) errors.push('grass needs at least one meadow patch');
    if (!recipe.tile.every(pow2)) errors.push('grass tiles must be power-of-two sized');
    if (!(recipe.slab > 0)) errors.push('grass slab must be positive');
  } else {
    if (!recipe.object) errors.push('a tree needs its pbrt object');
    if (!(recipe.cards >= 8 && recipe.cards <= 1024)) errors.push('cards must be 8-1024');
    if (!recipe.cardAtlas.every(pow2)) errors.push('card atlas must be power-of-two sized');
    if (!(recipe.views >= 4 && recipe.views <= 16)) errors.push('impostor views must be 4-16');
    if (!recipe.impostorCell.every((n) => Number.isInteger(n) && n >= 64 && n <= 1024))
      errors.push('impostor cells must be 64-1024 px');
    if (!(recipe.trunkTriangles > 0 && recipe.trunkTriangles <= 60000))
      errors.push('trunk budget must be 1-60000 triangles');
  }
  if (!(recipe.crownNormal >= 0 && recipe.crownNormal <= 1)) errors.push('crownNormal must be 0-1');
  if (!(recipe.supersample >= 1 && recipe.supersample <= 4)) errors.push('supersample must be 1-4');
  return errors;
}
