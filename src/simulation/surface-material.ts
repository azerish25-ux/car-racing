import { clamp, smooth } from '../core/math.ts';

/** Ground material table shared by the four-wheel tyre model, the motorcycle
 * prototype and future terrain tiles (docs/production/PHYSICS_MODEL.md §5).
 *
 * Ids 0-5 are the circuit ids carried in snapshots (`SURFACE` in track.ts,
 * protocol W.SURFACE); 6-10 are additional materials for venues, terrain and
 * bikes. Original engineering calibration, not measured tribology data: the
 * circuit values reproduce the former hard-coded track grip/resistance.
 *
 * Units: friction and coefficients dimensionless, depths in metres unless
 * named Mm, soil modulus in Pa/m^n, bulldozing in N/m² and N s²/m⁴. */
export const MATERIAL = Object.freeze({
  ASPHALT: 0,
  PAINT: 1,
  KERB: 2,
  GRASS: 3,
  GRAVEL: 4,
  PIT: 5,
  DIRT: 6,
  MUD: 7,
  SAND: 8,
  SNOW: 9,
  ICE: 10,
} as const);
export type MaterialId = (typeof MATERIAL)[keyof typeof MATERIAL];

export interface SurfaceMaterial {
  readonly id: number;
  readonly name: string;
  /** Peak tyre friction relative to dry racing asphalt (multiplies compound μ). */
  readonly grip: number;
  /** Extra friction factor of a fully wetted material (paint and grass lose far
   * more than asphalt); reached as water depth passes `wetDepthMm`. The tyre's
   * own film/aquaplaning model applies on top on every material. */
  readonly wetGrip: number;
  readonly wetDepthMm: number;
  /** Slip-stiffness scale: loose and deformable ground needs more slip. */
  readonly stiffness: number;
  /** Scales the tyre's post-peak fall-off (shape factor C-1): 0 = loose ground
   * that keeps ploughing force at large slip, 1 = the tyre's own fall-off. */
  readonly falloff: number;
  /** Rolling-resistance coefficient of a rigid tyre on this ground. */
  readonly rolling: number;
  /** Macrotexture depth (mm): drains water from under the tread. */
  readonly textureMm: number;
  /** Bekker-style sinkage: pressure = modulus · z^exponent, capped. 0 = rigid. */
  readonly sinkModulus: number;
  readonly sinkExponent: number;
  readonly maxSinkage: number;
  /** Bulldozing resistance per m² of (sinkage × width): static and per v². */
  readonly bulldoze: number;
  readonly bulldozeDynamic: number;
  /** Loose material collects on the tread instead of taking rubber. */
  readonly loose: boolean;
  /** Sealed racing surface: takes laid rubber and marbles. */
  readonly sealed: boolean;
  /** Ice/snow friction collapses toward 0 °C (meltwater film). */
  readonly meltSensitive: boolean;
}
function material(m: SurfaceMaterial): SurfaceMaterial {
  return Object.freeze(m);
}
const RIGID = { sinkModulus: 0, sinkExponent: 1, maxSinkage: 0, bulldoze: 0, bulldozeDynamic: 0 };
/** Indexed by material id. Circuit entries keep the former track numbers:
 * asphalt 1/0.015, paint 0.94, kerb 0.91, grass 0.53/0.08, gravel 0.4/0.16
 * (the rolling totals include the nominal-load compaction term). */
export const MATERIALS: readonly SurfaceMaterial[] = Object.freeze([
  material({
    id: 0,
    name: 'asphalt',
    grip: 1,
    wetGrip: 1,
    wetDepthMm: 1,
    stiffness: 1,
    falloff: 1,
    rolling: 0.015,
    textureMm: 0.8,
    ...RIGID,
    loose: false,
    sealed: true,
    meltSensitive: false,
  }),
  material({
    id: 1,
    name: 'paint',
    grip: 0.94,
    wetGrip: 0.82,
    wetDepthMm: 0.3,
    stiffness: 1,
    falloff: 1.1,
    rolling: 0.015,
    textureMm: 0.25,
    ...RIGID,
    loose: false,
    sealed: true,
    meltSensitive: false,
  }),
  material({
    id: 2,
    name: 'kerb',
    grip: 0.91,
    wetGrip: 0.86,
    wetDepthMm: 0.4,
    stiffness: 0.95,
    falloff: 1.05,
    rolling: 0.015,
    textureMm: 0.45,
    ...RIGID,
    loose: false,
    sealed: true,
    meltSensitive: false,
  }),
  material({
    id: 3,
    name: 'grass',
    grip: 0.53,
    wetGrip: 0.68,
    wetDepthMm: 0.6,
    stiffness: 0.7,
    falloff: 0.8,
    rolling: 0.06,
    textureMm: 1.5,
    sinkModulus: 6e6,
    sinkExponent: 1,
    maxSinkage: 0.02,
    bulldoze: 6000,
    bulldozeDynamic: 2,
    loose: true,
    sealed: false,
    meltSensitive: false,
  }),
  material({
    id: 4,
    name: 'gravel',
    grip: 0.4,
    wetGrip: 0.95,
    wetDepthMm: 2,
    stiffness: 0.45,
    falloff: 0,
    rolling: 0.115,
    textureMm: 6,
    sinkModulus: 1.5e6,
    sinkExponent: 1,
    maxSinkage: 0.08,
    bulldoze: 18000,
    bulldozeDynamic: 9,
    loose: true,
    sealed: false,
    meltSensitive: false,
  }),
  material({
    id: 5,
    name: 'pit asphalt',
    grip: 1,
    wetGrip: 0.97,
    wetDepthMm: 1,
    stiffness: 1,
    falloff: 1,
    rolling: 0.015,
    textureMm: 0.6,
    ...RIGID,
    loose: false,
    sealed: false,
    meltSensitive: false,
  }),
  material({
    id: 6,
    name: 'dirt',
    grip: 0.68,
    wetGrip: 0.7,
    wetDepthMm: 1.5,
    stiffness: 0.6,
    falloff: 0.4,
    rolling: 0.04,
    textureMm: 3,
    sinkModulus: 5e6,
    sinkExponent: 1,
    maxSinkage: 0.02,
    bulldoze: 8000,
    bulldozeDynamic: 3,
    loose: true,
    sealed: false,
    meltSensitive: false,
  }),
  material({
    id: 7,
    name: 'mud',
    grip: 0.42,
    wetGrip: 0.85,
    wetDepthMm: 3,
    stiffness: 0.4,
    falloff: 0.3,
    rolling: 0.08,
    textureMm: 2,
    sinkModulus: 6e5,
    sinkExponent: 1,
    maxSinkage: 0.12,
    bulldoze: 22000,
    bulldozeDynamic: 12,
    loose: true,
    sealed: false,
    meltSensitive: false,
  }),
  material({
    id: 8,
    name: 'sand',
    grip: 0.5,
    wetGrip: 1.1,
    wetDepthMm: 2,
    stiffness: 0.4,
    falloff: 0,
    rolling: 0.09,
    textureMm: 5,
    sinkModulus: 8e5,
    sinkExponent: 1.1,
    maxSinkage: 0.1,
    bulldoze: 24000,
    bulldozeDynamic: 11,
    loose: true,
    sealed: false,
    meltSensitive: false,
  }),
  material({
    id: 9,
    name: 'snow',
    grip: 0.3,
    wetGrip: 0.8,
    wetDepthMm: 1,
    stiffness: 0.5,
    falloff: 0.5,
    rolling: 0.03,
    textureMm: 2,
    sinkModulus: 4e5,
    sinkExponent: 1,
    maxSinkage: 0.06,
    bulldoze: 5000,
    bulldozeDynamic: 2,
    loose: true,
    sealed: false,
    meltSensitive: true,
  }),
  material({
    id: 10,
    name: 'ice',
    grip: 0.12,
    wetGrip: 0.6,
    wetDepthMm: 0.2,
    stiffness: 0.85,
    falloff: 1.2,
    rolling: 0.01,
    textureMm: 0.05,
    ...RIGID,
    loose: false,
    sealed: false,
    meltSensitive: true,
  }),
]);
/** Material for a surface id; unknown ids are asphalt (never undefined). */
export function surfaceMaterial(id: number): SurfaceMaterial {
  return MATERIALS[id] ?? MATERIALS[0];
}
/** Terrain-tile material names (terrain.ts) mapped onto this table. */
export const TERRAIN_MATERIAL = Object.freeze({
  hardpack: MATERIAL.DIRT,
  loam: MATERIAL.DIRT,
  sand: MATERIAL.SAND,
  mud: MATERIAL.MUD,
} as const);

/** Friction multiplier of the ground itself: dry value, wetting of the
 * material (water depth, mm) and the meltwater collapse of ice and snow near
 * 0 °C. The tyre's compound wet penalty and aquaplaning apply separately. */
export function materialGrip(m: SurfaceMaterial, waterMm: number, tempC: number) {
  const wet = Math.max(0, waterMm) / (Math.max(0, waterMm) + m.wetDepthMm);
  let grip = m.grip * (1 + (m.wetGrip - 1) * wet);
  if (m.meltSensitive) grip *= 1 - 0.45 * smooth(-8, 0.5, tempC);
  return grip;
}

/** Equilibrium sinkage (m) of a contact patch of `area` m² carrying `load` N.
 * Bekker's pressure-sinkage law p = k·zⁿ, capped at the material's depth. */
export function sinkageTarget(m: SurfaceMaterial, load: number, area: number) {
  if (m.sinkModulus <= 0 || load <= 0) return 0;
  const pressure = load / Math.max(1e-4, area);
  return Math.min(m.maxSinkage, (pressure / m.sinkModulus) ** (1 / m.sinkExponent));
}
/** Soil yields over a finite time (plastic flow under a rolling patch): the
 * sinkage state approaches its target with time constant `tau`, integrated
 * exactly so large steps cannot overshoot or feed back into the springs. */
export function advanceSinkage(current: number, target: number, speed: number, dt: number) {
  const tau = 0.06 + 0.25 / (1 + Math.abs(speed));
  return target + (current - target) * Math.exp(-dt / tau);
}
/** Rolling resistance coefficient including compaction work on deformable
 * ground: Bekker compaction resistance R = load·z/((n+1)·l) for a patch of
 * length l. */
export function rollingCoefficient(m: SurfaceMaterial, sinkage: number, patchLength: number) {
  if (sinkage <= 0) return m.rolling;
  return m.rolling + sinkage / ((m.sinkExponent + 1) * Math.max(0.05, patchLength));
}
/** ½·ρ_water·C_d with C_d 0.2 for a tyre front displacing a water film (kg/m³). */
export const WATER_DRAG = 100;
/** Ground drag (N) opposing travel from bulldozing the displaced material
 * ahead of a sunken tyre, and from displacing standing water (reduced as the
 * tyre rides up on the film when aquaplaning). */
export function groundDrag(
  m: SurfaceMaterial,
  sinkage: number,
  width: number,
  speed: number,
  waterMm: number,
  aquaplane: number,
) {
  const v2 = speed * speed;
  const bulldozing =
    sinkage > 0 ? sinkage * width * (m.bulldoze * clamp(Math.abs(speed), 0, 1) + m.bulldozeDynamic * v2) : 0;
  // Displacement drag: ½ρ_w·C_d·(width·depth)·v², C_d 0.2 (planing reduces it).
  const water =
    waterMm > 0 ? WATER_DRAG * width * (waterMm * 1e-3) * v2 * (1 - 0.7 * aquaplane) : 0;
  return bulldozing + water;
}
