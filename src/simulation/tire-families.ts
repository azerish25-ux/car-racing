/** Tyre construction families (WP17, masterplan §7.4). The compound table
 * (soft/medium/hard/intermediate/wet) stays shared; a family scales its peak
 * friction (`VehicleDefinition.tireGrip`, relative to the Formula slick) and
 * says how much of the grip a loose surface takes away it can keep. A family is
 * a construction class, not a product: every value is an original engineering
 * estimate, documented with its intent. */
export type TireFamilyId =
  | 'formula-slick'
  | 'slick'
  | 'semi-slick'
  | 'road'
  | 'gravel'
  | 'all-terrain'
  | 'kart'
  | 'historic'
  | 'knobby'
  | 'supermoto';
export interface TireFamily {
  id: TireFamilyId;
  name: string;
  /** Allowed tireGrip range for definitions on this family. */
  grip: readonly [number, number];
  /** Share (0-1) of the friction a loose surface (grass, gravel) removes that
   * this construction recovers through tread blocks and sidewall compliance. */
  looseGrip: number;
}
const family = (
  id: TireFamilyId,
  name: string,
  grip: readonly [number, number],
  looseGrip: number,
): TireFamily => Object.freeze({ id, name, grip: Object.freeze(grip), looseGrip });
export const TIRE_FAMILIES: Readonly<Record<TireFamilyId, TireFamily>> = Object.freeze({
  /** Wide, warm, high-downforce single-seater slick (the reference, 1.0). */
  'formula-slick': family('formula-slick', 'Formula slick', [0.9, 1.05], 0),
  /** Closed-wheel racing slick: narrower relative to mass than a Formula slick. */
  slick: family('slick', 'Racing slick', [0.74, 0.96], 0),
  /** Treaded track-day/club tyre: lower peak, a little loose-surface bite. */
  'semi-slick': family('semi-slick', 'Semi-slick', [0.66, 0.84], 0.08),
  /** High-performance road tyre: progressive, lower peak friction. */
  road: family('road', 'Performance road', [0.58, 0.8], 0.12),
  /** Rally gravel tyre: block tread for loose surfaces, softer on asphalt. */
  gravel: family('gravel', 'Gravel rally', [0.56, 0.74], 0.55),
  /** Large-volume off-road tyre: deep tread, heavy carcass. */
  'all-terrain': family('all-terrain', 'All-terrain', [0.5, 0.7], 0.6),
  /** Small soft kart slick: very low load per tyre, high friction. */
  kart: family('kart', 'Kart slick', [0.85, 1.1], 0),
  /** Narrow 1960s cross-ply racing tyre. */
  historic: family('historic', 'Historic cross-ply', [0.5, 0.7], 0.05),
  /** Off-road motorcycle knobby: tall square blocks that bite into loam,
   * sand and mud (bike definitions carry their own peak μ; tireGrip 1). */
  knobby: family('knobby', 'Motocross knobby', [0.6, 1.1], 0.8),
  /** Supermoto treaded slick: sticky on asphalt, a little bite on dirt. */
  supermoto: family('supermoto', 'Supermoto treaded slick', [0.6, 1.1], 0.25),
});
export const TIRE_FAMILY_IDS = Object.freeze(Object.keys(TIRE_FAMILIES) as TireFamilyId[]);
