import { TREE_SPECIES } from '../../simulation/open-world/placement.ts';
import { hash01 } from '../../simulation/open-world/noise.ts';

/**
 * Japanese planting roles of the festival trees (presentation only: the
 * placement, trunk colliders and counts of `placement.ts` are unchanged; a
 * role picks the crown geometry, its proportions and its seasonal colour).
 *
 * Measured from the FH6 references: Somei-yoshino cherries line roads and
 * parks (015, 033, 050, 096: wide low crowns, dark trunks), Japanese maples
 * gather in groves (007, 027, 090), sugi cedar stands rise along roads and on
 * hills (093, 003: tall narrow dark crowns on bare straight trunks), Japanese
 * black pines stand in towns, temple grounds and on the coast (026, 027:
 * flat layered pads on leaning trunks), azaleas flower on open slopes (029).
 */
export const FLORA_ROLE = Object.freeze({
  BROADLEAF: 0,
  CHERRY: 1,
  MAPLE: 2,
  CEDAR: 3,
  PINE: 4,
  SHRUB: 5,
  AZALEA: 6,
  BAMBOO: 7,
  /** Street zelkova / ginkgo (street-trees.ts): golden in autumn. */
  GINKGO: 8,
});
export type FloraRole = (typeof FLORA_ROLE)[keyof typeof FLORA_ROLE];

/** A role travels to the shaders in the instance colour's green channel
 * (green + ROLE_STEP · role; tints stay below ROLE_STEP). */
export const ROLE_STEP = 4;
export function encodeRole(green: number, role: number) {
  return Math.min(ROLE_STEP - 0.01, Math.max(0, green)) + ROLE_STEP * role;
}
export function decodeRole(green: number) {
  const role = Math.floor(green / ROLE_STEP + 0.001);
  return { role, green: green - ROLE_STEP * role };
}

/** Smooth planting zones (0..1) of a few hundred metres: sums of sines,
 * identical in GLSL (FLORA_ZONE_GLSL) within float precision. */
export function floraZone(x: number, z: number, seed: number) {
  return (
    0.5 +
    0.5 *
      Math.sin(x * 0.0061 + 1.7 * Math.sin(z * 0.0043 + seed)) *
      Math.sin(z * 0.0057 + 1.3 * Math.sin(x * 0.0037 - seed * 0.7))
  );
}
export const CHERRY_SEED = 1.3;
export const MAPLE_SEED = 4.1;
export const CEDAR_SEED = 2.6;
/** Ground flora zones (flora.ts; the terrain tints susuki fields to match). */
export const SUSUKI_SEED = 5.2;
export const FLOWER_SEED = 6.4;
export const BAMBOO_SEED = 7.7;
export const FLORA_ZONE_GLSL = /* glsl */ `
float owFloraZone(vec2 p, float seed) {
  return 0.5 + 0.5 * sin(p.x * 0.0061 + 1.7 * sin(p.y * 0.0043 + seed)) *
    sin(p.y * 0.0057 + 1.3 * sin(p.x * 0.0037 - seed * 0.7));
}
float owCherryZone(vec2 p) { return smoothstep(0.56, 0.7, owFloraZone(p, ${CHERRY_SEED.toFixed(2)})); }
float owMapleZone(vec2 p) { return smoothstep(0.5, 0.66, owFloraZone(p, ${MAPLE_SEED.toFixed(2)})); }
`;

/** Where a tree stands, as the tile data describes it. */
export interface TreeSite {
  x: number;
  z: number;
  /** Ground height (m). */
  y: number;
  /** Placement species (TREE_SPECIES) and height (m). */
  species: number;
  height: number;
  /** Road carve weight at the tree (0 away from roads). */
  road: number;
  /** Town / airfield ground weight. */
  town: number;
}

/** Role of a placed tree (deterministic from its site). */
export function floraRole(site: TreeSite): FloraRole {
  const { x, z, y } = site,
    pick = hash01(Math.round(x * 4), Math.round(z * 4), 0x51a7);
  // Planted street trees keep their street's species.
  if (site.species === TREE_SPECIES.STREET_CHERRY) return FLORA_ROLE.CHERRY;
  if (site.species === TREE_SPECIES.STREET_ZELKOVA) return FLORA_ROLE.GINKGO;
  if (site.species === TREE_SPECIES.STREET_MAPLE) return FLORA_ROLE.MAPLE;
  if (site.species === TREE_SPECIES.SHRUB)
    return y < 520 && pick < 0.22 + 0.3 * floraZone(x, z, CHERRY_SEED + 2)
      ? FLORA_ROLE.AZALEA
      : FLORA_ROLE.SHRUB;
  const roadside = site.road > 0.01,
    town = site.town > 0.05;
  // Black pines: towns, temple grounds and the coast.
  if (y < 220 && pick < (town ? 0.45 : y < 45 ? 0.5 : 0.06)) return FLORA_ROLE.PINE;
  const cherry = floraZone(x, z, CHERRY_SEED),
    maple = floraZone(x, z, MAPLE_SEED),
    cedar = floraZone(x, z, CEDAR_SEED);
  const second = hash01(Math.round(z * 4), Math.round(x * 4), 0x9c3);
  if (y < 420) {
    const cherryChance =
      cherry > 0.56 ? (roadside ? 0.88 : town ? 0.7 : 0.3) : roadside ? 0.1 : 0.03;
    if (second < cherryChance) return FLORA_ROLE.CHERRY;
    const mapleChance = maple > 0.5 ? (roadside ? 0.7 : 0.5) : 0.12;
    if (
      site.species === TREE_SPECIES.BROADLEAF &&
      second < cherryChance + mapleChance * (1 - cherryChance)
    )
      return FLORA_ROLE.MAPLE;
  }
  if (site.species === TREE_SPECIES.CONIFER)
    return y < 160 && pick < 0.3 ? FLORA_ROLE.PINE : FLORA_ROLE.CEDAR;
  // Sugi plantations: whole stands of cedar on the hills; scattered sugi
  // in the mixed woods elsewhere (052, 090: evergreens among the maples).
  if (y > 60 && (cedar > 0.5 ? second > 0.2 : second > 0.62)) return FLORA_ROLE.CEDAR;
  return FLORA_ROLE.BROADLEAF;
}
