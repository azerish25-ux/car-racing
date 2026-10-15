import { clamp } from '../core/math.ts';

/** Detail tier read by every scenery, LOD, mirror and reflection consumer. */
export type Quality = 'low' | 'medium' | 'high';
/** Settings preset. ULTRA is an opt-in High-tier preset that also enables the
 * high-end rendering modules (src/rendering/ultra); every detail consumer still
 * sees `detailTier('ultra') === 'high'`, so Low/Medium/High are unchanged. */
export type QualityPreset = Quality | 'ultra';
export const QUALITY_PRESETS: readonly QualityPreset[] = Object.freeze([
  'low',
  'medium',
  'high',
  'ultra',
]);
export function isQualityPreset(value: unknown): value is QualityPreset {
  return QUALITY_PRESETS.includes(value as QualityPreset);
}
/** The scenery/LOD tier of a preset (ULTRA draws High-tier geometry). */
export function detailTier(preset: QualityPreset): Quality {
  return preset === 'ultra' ? 'high' : preset;
}
/** Display transform after exposure. ACES is the calibrated default on every
 * preset; AgX and Khronos Neutral are opt-in alternatives (three 0.180). */
export type ToneMapper = 'aces' | 'agx' | 'neutral';
export const TONE_MAPPERS: readonly ToneMapper[] = Object.freeze(['aces', 'agx', 'neutral']);
/** Seated-driver lens: vertical degrees (producer decision P6). */
export const COCKPIT_FOV = Object.freeze({ default: 54, min: 44, max: 70 });
export interface GraphicsOptions {
  resolutionScale: number;
  textureSize: 128 | 256 | 512 | 1024;
  /** Near (car-following) sun map; 4096 only where the device allows it. */
  shadowSize: 0 | 512 | 1024 | 2048 | 4096;
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
  // ---- High-end modules (src/rendering/ultra). Off on Low/Medium/High; a save
  // written before they existed validates to these preset values unchanged. ----
  /** Hierarchical-depth screen-space reflections on wet asphalt and car paint. */
  ssr: boolean;
  /** Contrast-adaptive sharpening after the temporal resolve (0 disables). */
  taaSharpen: number;
  /** Ground-truth AO with more slices and temporal accumulation. */
  aoTemporal: boolean;
  /** Display transform (tone mapping operator). */
  toneMapper: ToneMapper;
  /** Energy-conserving (threshold-free) bloom instead of the highlight bloom. */
  physicalBloom: boolean;
  /** Restrained lateral chromatic aberration at the frame edges. */
  chromaticAberration: boolean;
  /** Screen-space sun shafts (volumetric light scattering) through the scene. */
  lightShafts: boolean;
  /** Sun shadow cascades: near + far (2) or near + mid + far (3). */
  shadowCascades: 2 | 3;
  /** Thin-lens depth of field on broadcast replay cameras (bokeh gather). */
  replayDof: boolean;
}
export function graphicsPreset(preset: QualityPreset): GraphicsOptions {
  if (preset === 'ultra') return ultraPreset();
  const quality = preset;
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
    ssr: false,
    taaSharpen: 0,
    aoTemporal: false,
    toneMapper: 'aces',
    physicalBloom: false,
    chromaticAberration: false,
    lightShafts: false,
    shadowCascades: 2,
    replayDof: false,
  };
}
/** ULTRA: High plus temporal AA (complementing 4x MSAA) with sharpening, SSR,
 * temporal GTAO, a 4096 near sun map inside three cascades, energy-conserving
 * bloom, sun shafts, restrained lens fringe and replay depth of field. */
function ultraPreset(): GraphicsOptions {
  return {
    ...graphicsPreset('high'),
    shadowSize: 4096,
    temporalAA: true,
    ssr: true,
    taaSharpen: 0.35,
    aoTemporal: true,
    physicalBloom: true,
    chromaticAberration: true,
    lightShafts: true,
    shadowCascades: 3,
    replayDof: true,
  };
}
export function validateGraphics(value: unknown, quality: QualityPreset): GraphicsOptions {
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
    shadowSize: choice(p.shadowSize, [0, 512, 1024, 2048, 4096], fallback.shadowSize),
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
    ssr: typeof p.ssr === 'boolean' ? p.ssr : fallback.ssr,
    taaSharpen: number(p.taaSharpen, fallback.taaSharpen, 0, 1),
    aoTemporal: typeof p.aoTemporal === 'boolean' ? p.aoTemporal : fallback.aoTemporal,
    toneMapper: choice(p.toneMapper, TONE_MAPPERS, fallback.toneMapper),
    physicalBloom: typeof p.physicalBloom === 'boolean' ? p.physicalBloom : fallback.physicalBloom,
    chromaticAberration:
      typeof p.chromaticAberration === 'boolean'
        ? p.chromaticAberration
        : fallback.chromaticAberration,
    lightShafts: typeof p.lightShafts === 'boolean' ? p.lightShafts : fallback.lightShafts,
    shadowCascades: choice(p.shadowCascades, [2, 3], fallback.shadowCascades),
    replayDof: typeof p.replayDof === 'boolean' ? p.replayDof : fallback.replayDof,
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
