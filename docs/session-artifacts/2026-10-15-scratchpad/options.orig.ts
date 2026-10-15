import { clamp } from '../core/math.ts';

export type Quality = 'low' | 'medium' | 'high';
/** Seated-driver lens: vertical degrees (producer decision P6). */
export const COCKPIT_FOV = Object.freeze({ default: 54, min: 44, max: 70 });
export interface GraphicsOptions {
  resolutionScale: number;
  textureSize: 128 | 256 | 512 | 1024;
  shadowSize: 0 | 512 | 1024 | 2048;
  reflections: 'environment' | 'local';
  mirrorQuality: Quality;
  particleDensity: number;
  vegetationDensity: number;
  crowd: boolean;
  bloom: boolean;
  autoExposure: boolean;
  localFog: boolean;
  motionBlur: number;
  antialias: boolean;
  anisotropy: 1 | 2 | 4 | 8 | 16;
  /** Hardware multisampling of the linear scene target (0 disables). */
  msaa: 0 | 2 | 4;
  /** Depth-only screen-space ambient obscurance, composited with the scene pass. */
  ambientOcclusion: boolean;
  /** Display-referred broadcast grade: contrast, vignette, lens fringe and grain. */
  filmGrade: boolean;
  /** Temporal anti-aliasing (jittered history resolve). Opt-in on every preset. */
  temporalAA: boolean;
  /** Lens effects for exterior cameras: sun flare, lens dirt and rain on the lens. */
  lensEffects: boolean;
  /** Cockpit camera vertical field of view in degrees (COCKPIT_FOV range). */
  cockpitFov: number;
}
export function graphicsPreset(quality: Quality): GraphicsOptions {
  return {
    // Native resolution with 4x MSAA and specular AA is the 1080p/60 High
    // target. Supersampling beyond 1.0 remains a manual slider for faster GPUs.
    resolutionScale: quality === 'low' ? 0.75 : 1,
    textureSize: quality === 'low' ? 256 : quality === 'high' ? 1024 : 512,
    // 2048 on Medium too (3.7 cm texels, fill cost only, 0 draw calls; D08).
    shadowSize: quality === 'low' ? 0 : 2048,
    reflections: quality === 'high' ? 'local' : 'environment',
    mirrorQuality: quality,
    particleDensity: quality === 'low' ? 0 : quality === 'high' ? 1 : 0.65,
    vegetationDensity: quality === 'low' ? 0.5 : 1,
    crowd: quality !== 'low',
    bloom: quality !== 'low',
    autoExposure: quality !== 'low',
    localFog: quality !== 'low',
    // Shutter as a fraction of a 60 Hz frame (P10); depth reprojection, no extra draw.
    motionBlur: quality === 'low' ? 0 : quality === 'high' ? 0.5 : 0.35,
    antialias: true,
    anisotropy: quality === 'low' ? 2 : quality === 'high' ? 16 : 8,
    msaa: quality === 'low' ? 0 : quality === 'high' ? 4 : 2,
    ambientOcclusion: quality !== 'low',
    filmGrade: true,
    temporalAA: false,
    lensEffects: quality !== 'low',
    cockpitFov: COCKPIT_FOV.default,
  };
}
export function validateGraphics(value: unknown, quality: Quality): GraphicsOptions {
  const fallback = graphicsPreset(quality);
  if (!value || typeof value !== 'object') return fallback;
  const p = value as Partial<GraphicsOptions>;
  const number = (v: unknown, f: number, lo: number, hi: number) =>
    typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : f;
  const choice = <T extends string | number>(v: unknown, options: readonly T[], f: T): T =>
    options.includes(v as T) ? (v as T) : f;
  return {
    resolutionScale: number(p.resolutionScale, fallback.resolutionScale, 0.5, 1.5),
    textureSize: choice(p.textureSize, [128, 256, 512, 1024], fallback.textureSize),
    shadowSize: choice(p.shadowSize, [0, 512, 1024, 2048], fallback.shadowSize),
    reflections: choice(p.reflections, ['environment', 'local'], fallback.reflections),
    mirrorQuality: choice(p.mirrorQuality, ['low', 'medium', 'high'], fallback.mirrorQuality),
    particleDensity: number(p.particleDensity, fallback.particleDensity, 0, 1),
    vegetationDensity: number(p.vegetationDensity, fallback.vegetationDensity, 0, 1),
    crowd: typeof p.crowd === 'boolean' ? p.crowd : fallback.crowd,
    bloom: typeof p.bloom === 'boolean' ? p.bloom : fallback.bloom,
    autoExposure: typeof p.autoExposure === 'boolean' ? p.autoExposure : fallback.autoExposure,
    localFog: typeof p.localFog === 'boolean' ? p.localFog : fallback.localFog,
    motionBlur: number(p.motionBlur, fallback.motionBlur, 0, 0.6),
    antialias: typeof p.antialias === 'boolean' ? p.antialias : fallback.antialias,
    anisotropy: choice(p.anisotropy, [1, 2, 4, 8, 16], fallback.anisotropy),
    msaa: choice(p.msaa, [0, 2, 4], fallback.msaa),
    ambientOcclusion:
      typeof p.ambientOcclusion === 'boolean' ? p.ambientOcclusion : fallback.ambientOcclusion,
    filmGrade: typeof p.filmGrade === 'boolean' ? p.filmGrade : fallback.filmGrade,
    temporalAA: typeof p.temporalAA === 'boolean' ? p.temporalAA : fallback.temporalAA,
    lensEffects: typeof p.lensEffects === 'boolean' ? p.lensEffects : fallback.lensEffects,
    cockpitFov: number(p.cockpitFov, fallback.cockpitFov, COCKPIT_FOV.min, COCKPIT_FOV.max),
  };
}
/** Render and post-processing use the same physical-pixel budget. */
export function bufferSize(width: number, height: number, ratio: number, maximum: number) {
  if (![width, height, ratio, maximum].every(Number.isFinite) || maximum < 1)
    throw new Error('Invalid render dimensions');
  width = Math.max(1, width);
  height = Math.max(1, height);
  const scale = Math.min(Math.max(0.1, ratio), maximum / width, maximum / height);
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}
