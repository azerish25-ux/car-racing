/** Festival season (presentation): foliage, ground cover, snow and petals.
 * Driving surfaces and physics do not change with the season. A light module
 * (no renderer imports) shared by the save, the menu and the renderer. */
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export const SEASONS: readonly Season[] = Object.freeze(['spring', 'summer', 'autumn', 'winter']);
export const SEASON_LABEL: Readonly<Record<Season, string>> = Object.freeze({
  spring: 'Spring · blossom',
  summer: 'Summer',
  autumn: 'Autumn · maple',
  winter: 'Winter · snow',
});
export function isSeason(value: unknown): value is Season {
  return typeof value === 'string' && (SEASONS as readonly string[]).includes(value);
}
