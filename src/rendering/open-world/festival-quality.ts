import { graphicsPreset, type GraphicsOptions, type QualityPreset } from '../options.ts';

/**
 * The festival's image pipeline per preset, over the shared presets (which
 * stay as they are for the circuits). The open world is seen at 50-800 m
 * through foliage, wires, guardrails and facades, where the circuit presets'
 * choices (no temporal AA below ULTRA, two shadow ranges) shimmer and go flat.
 * Each upgrade replaces only a control still at its preset value, so a
 * player's own override of that control is kept.
 *
 * Hardware assumption (not measured; no reference-hardware capture exists):
 * MEDIUM is a mid-range discrete GPU (GTX 1660 / RX 6600 class) at 1080p,
 * HIGH an RTX 3070 class, ULTRA an RTX 4080 class. The costs are listed in
 * docs/production/fh6-r4/render-pipeline.md.
 */
export const FESTIVAL_PIPELINE: Readonly<
  Record<QualityPreset, Readonly<Partial<GraphicsOptions>>>
> = Object.freeze({
  low: Object.freeze({}),
  // Temporal AA over 2x MSAA (one resolve quad + CAS): steadies foliage
  // cards, wires and rails that MSAA alone leaves crawling.
  medium: Object.freeze({ temporalAA: true, taaSharpen: 0.3 }),
  // + SSR (wet roads, sea, car paint), the mid shadow cascade, temporal
  // GTAO and sun shafts.
  high: Object.freeze({
    temporalAA: true,
    taaSharpen: 0.3,
    ssr: true,
    shadowCascades: 3,
    aoTemporal: true,
    lightShafts: true,
  }),
  ultra: Object.freeze({}),
});

/** Presets whose screen-space reflections run only while the roads are wet
 * (rain): the frames where they matter most, at no cost when dry. */
export const FESTIVAL_WET_SSR: Readonly<Record<QualityPreset, boolean>> = Object.freeze({
  low: false,
  medium: true,
  high: false,
  ultra: false,
});
/** Road wetness (0..1) above which MEDIUM traces reflections. */
export const FESTIVAL_WET_SSR_FROM = 0.15;

/** The festival's graphics for `preset` from the player's validated options. */
export function festivalGraphics(preset: QualityPreset, options: GraphicsOptions): GraphicsOptions {
  const base = graphicsPreset(preset),
    out = { ...options } as Record<string, unknown>;
  for (const [key, value] of Object.entries(FESTIVAL_PIPELINE[preset]))
    if (options[key as keyof GraphicsOptions] === base[key as keyof GraphicsOptions])
      out[key] = value;
  return out as unknown as GraphicsOptions;
}

/** Street-scale ambient obscurance for the festival (SceneAmbientPass
 * `setObscurance`): the circuit's 0.9 m GTAO radius grounds tyres and kerbs;
 * the towns also need wall-to-pavement corners, eaves, alleys and tree
 * crowns (refs 013, 026, 030 read occlusion at 1-2 m scale out to ~300 m). */
export const FESTIVAL_AO = Object.freeze({
  radius: 1.6,
  intensity: 1.25,
  maxPixels: 96,
  fadeStart: 160,
  fadeEnd: 380,
});
