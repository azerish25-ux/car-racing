import * as T from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import type { LightingMode } from './daylight.ts';
import { gradeLut } from './studio/grade-lut.ts';
import { LENS_RAIN_GLSL, lensUniforms, type LensUniforms } from './studio/lens-effects.ts';

/** Authored display-referred grade per circuit lighting profile. These are
 * look-development values, not a calibrated camera or broadcast LUT. */
export interface GradeProfile {
  contrast: number;
  saturation: number;
  vibrance: number;
  shadowTint: readonly [number, number, number];
  highlightTint: readonly [number, number, number];
  vignette: number;
  fringe: number;
  grain: number;
  sharpen: number;
}
export const GRADE_PROFILES: Readonly<Record<LightingMode | 'studio', Readonly<GradeProfile>>> =
  Object.freeze({
    // Grading only shapes tone and colour. Grain, lens fringe and unsharp
    // masking are zero in every gameplay profile: they must never be used to
    // hide aliasing or weak texture detail. The fields stay for explicit,
    // user-chosen photo looks and are validated by the same shader.
    day: {
      contrast: 0.16,
      saturation: 1.06,
      vibrance: 0.16,
      shadowTint: [0.98, 1.0, 1.03],
      highlightTint: [1.025, 1.005, 0.975],
      vignette: 0.12,
      fringe: 0,
      grain: 0,
      sharpen: 0,
    },
    sunset: {
      contrast: 0.16,
      saturation: 1.08,
      vibrance: 0.14,
      shadowTint: [0.96, 0.985, 1.05],
      highlightTint: [1.05, 1.0, 0.93],
      vignette: 0.15,
      fringe: 0,
      grain: 0,
      sharpen: 0,
    },
    night: {
      contrast: 0.12,
      saturation: 1.03,
      vibrance: 0.1,
      shadowTint: [0.96, 0.99, 1.06],
      highlightTint: [1.025, 1.0, 0.96],
      vignette: 0.16,
      fringe: 0,
      grain: 0,
      sharpen: 0,
    },
    studio: {
      contrast: 0.12,
      saturation: 1.02,
      vibrance: 0.08,
      shadowTint: [1, 1, 1.02],
      highlightTint: [1.01, 1, 0.99],
      vignette: 0.1,
      fringe: 0,
      grain: 0,
      sharpen: 0,
    },
  });

/** Grade over a filmic display transform (AgX or Khronos Neutral; ULTRA's
 * default). The broadcast profiles above were tuned over ACES, which already
 * adds contrast and saturation; on top of a neutral transform they read as a
 * 'game-punchy' second curve that pushes exactly the muted natural materials
 * (grass, sky, asphalt, foliage). Here the S-curve is light, saturation is
 * neutral and vibrance a hint; tints, vignette and the hue-selective LUT stay. */
export const FILMIC_GRADE_PROFILES: Readonly<
  Record<LightingMode | 'studio', Readonly<GradeProfile>>
> = Object.freeze({
  day: { ...GRADE_PROFILES.day, contrast: 0.08, saturation: 1.0, vibrance: 0.04 },
  sunset: { ...GRADE_PROFILES.sunset, contrast: 0.08, saturation: 1.02, vibrance: 0.04 },
  night: { ...GRADE_PROFILES.night, contrast: 0.07, saturation: 1.0, vibrance: 0.04 },
  studio: { ...GRADE_PROFILES.studio, contrast: 0.07, saturation: 1.0, vibrance: 0.04 },
});

/** CPU reference of the shader's tone curve; used by tests and documentation. */
export function gradeCurve(value: number, contrast: number) {
  if (!Number.isFinite(value) || !Number.isFinite(contrast)) throw new Error('Invalid grade input');
  const x = T.MathUtils.clamp(value, 0, 1);
  const s = x * x * (3 - 2 * x);
  return x + (s - x) * T.MathUtils.clamp(contrast, 0, 1);
}

const fragmentShader = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform vec2 resolution;
  uniform float seed;
  uniform float contrast;
  uniform float saturation;
  uniform float vibrance;
  uniform vec3 shadowTint;
  uniform vec3 highlightTint;
  uniform float vignette;
  uniform float fringe;
  uniform float grain;
  uniform float sharpen;
  // D09: hue-selective profile LUT (32^3, display RGB), blended toward the wet LUT.
  uniform sampler3D gradeLut;
  uniform sampler3D gradeLutWet;
  uniform float lutWet;
  uniform float lutAmount;
  varying vec2 vUv;
  ${LENS_RAIN_GLSL}
  vec3 applyGradeLut(vec3 c) {
    vec3 p = clamp(c, 0.0, 1.0) * (31.0 / 32.0) + 0.5 / 32.0;
    vec3 graded = texture(gradeLut, p).rgb;
    if (lutWet > 0.0) graded = mix(graded, texture(gradeLutWet, p).rgb, lutWet);
    return mix(c, graded, lutAmount);
  }
  float grainHash(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }
  void main() {
    vec2 centre = vUv - 0.5;
    float radius2 = dot(centre, centre);
    // Lateral lens fringe grows with the square of the field radius.
    vec2 shift = centre * radius2 * fringe * 4.0;
    // Optional effects are skipped entirely at zero (uniform, coherent branches).
    vec3 color;
    if (lensRain > 0.0) {
      // Rain on the lens (D09): refracting drops replace the plain fetch.
      color = lensRainSample(vUv);
    } else if (fringe > 0.0) {
      // Lateral lens fringe grows with the square of the field radius.
      vec2 shift = centre * radius2 * fringe * 4.0;
      color = vec3(
        texture2D(tDiffuse, vUv + shift).r,
        texture2D(tDiffuse, vUv).g,
        texture2D(tDiffuse, vUv - shift).b);
    } else {
      color = texture2D(tDiffuse, vUv).rgb;
    }
    const vec3 lumaWeights = vec3(0.2126, 0.7152, 0.0722);
    if (sharpen > 0.0) {
      vec2 texel = 1.0 / resolution;
      vec3 blur = texture2D(tDiffuse, vUv + vec2(texel.x, 0.0)).rgb +
        texture2D(tDiffuse, vUv - vec2(texel.x, 0.0)).rgb +
        texture2D(tDiffuse, vUv + vec2(0.0, texel.y)).rgb +
        texture2D(tDiffuse, vUv - vec2(0.0, texel.y)).rgb;
      float detail = dot(color - blur * 0.25, lumaWeights);
      color += clamp(detail * sharpen, -0.06, 0.06);
    }
    color = clamp(color, 0.0, 1.0);
    // Filmic S-curve around display mid-grey.
    vec3 s = color * color * (3.0 - 2.0 * color);
    color = mix(color, s, contrast);
    float luma = dot(color, lumaWeights);
    // Split tone: cool shade, warm key light.
    color *= mix(shadowTint, highlightTint, smoothstep(0.08, 0.75, luma));
    // Vibrance lifts muted colours without clipping already-saturated liveries.
    float maxC = max(color.r, max(color.g, color.b)), minC = min(color.r, min(color.g, color.b));
    float chroma = maxC - minC;
    float satBoost = saturation * (1.0 + vibrance * (1.0 - smoothstep(0.0, 0.55, chroma)));
    color = mix(vec3(luma), color, satBoost);
    if (lutAmount > 0.0) color = applyGradeLut(color);
    // Optical vignette.
    float falloff = smoothstep(0.85, 0.18, radius2 * (1.0 + 0.35 * resolution.x / resolution.y));
    color *= mix(1.0 - vignette, 1.0, falloff);
    // Optional luminance-weighted grain, seeded by presented simulation time only.
    if (grain > 0.0) {
      float n = grainHash(vUv * resolution + seed * 91.7) - 0.5;
      color += n * grain * (1.0 - luma * 0.7);
    }
    gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
  }
`;

/** Final display-space grade after tone mapping (and FXAA when MSAA is off).
 * The HTML HUD is not part of the canvas and never receives any grading. */
export class BroadcastGradePass extends Pass {
  private material: T.ShaderMaterial;
  private quad: FullScreenQuad;
  profile: LightingMode | 'studio' = 'day';
  constructor(lens: LensUniforms = lensUniforms) {
    super();
    this.material = new T.ShaderMaterial({
      name: 'APEX broadcast colour grade',
      vertexShader:
        'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader,
      uniforms: {
        tDiffuse: { value: null },
        resolution: { value: new T.Vector2(1, 1) },
        seed: { value: 0 },
        contrast: { value: 0 },
        saturation: { value: 1 },
        vibrance: { value: 0 },
        shadowTint: { value: new T.Vector3(1, 1, 1) },
        highlightTint: { value: new T.Vector3(1, 1, 1) },
        vignette: { value: 0 },
        fringe: { value: 0 },
        grain: { value: 0 },
        sharpen: { value: 0 },
        gradeLut: { value: null },
        gradeLutWet: { value: null },
        lutWet: { value: 0 },
        lutAmount: { value: 1 },
        lensRain: lens.lensRain,
        lensTime: lens.lensTime,
        lensStreak: lens.lensStreak,
      },
      depthTest: false,
      depthWrite: false,
      blending: T.NoBlending,
      toneMapped: false,
    });
    this.quad = new FullScreenQuad(this.material);
    this.apply('day');
  }
  /** Photo mode's look (photo-camera.ts photoGrade), or null for the gameplay
   * profile. Set by the renderer only while the photo studio is open. */
  photoOverride: Readonly<GradeProfile> | null = null;
  /** ULTRA restrained lateral chromatic aberration, added to the profile's
   * fringe (0 on every other preset; never applied over a photo look). */
  lensFringe = 0;
  /** True over a filmic display transform (AgX/Neutral): FILMIC_GRADE_PROFILES. */
  filmic = false;
  /** Seed must come from presented state so pause, photo and replay hold grain.
   * `wet` (0..1, standing water) blends the profile LUT toward the wet LUT. */
  apply(profile: LightingMode | 'studio', seed = 0, wet = 0) {
    this.profile = profile;
    const p = this.photoOverride ?? (this.filmic ? FILMIC_GRADE_PROFILES : GRADE_PROFILES)[profile];
    const u = this.material.uniforms;
    u.contrast.value = p.contrast;
    u.saturation.value = p.saturation;
    u.vibrance.value = p.vibrance;
    (u.shadowTint.value as T.Vector3).set(...p.shadowTint);
    (u.highlightTint.value as T.Vector3).set(...p.highlightTint);
    u.vignette.value = p.vignette;
    u.fringe.value = p.fringe + (this.photoOverride ? 0 : Math.max(0, this.lensFringe));
    u.grain.value = p.grain;
    u.sharpen.value = p.sharpen;
    u.seed.value = Number.isFinite(seed) ? seed % 97 : 0;
    u.gradeLut.value = gradeLut(profile);
    const wetness =
      profile === 'studio' || !Number.isFinite(wet) ? 0 : Math.min(1, Math.max(0, wet));
    u.lutWet.value = wetness;
    u.gradeLutWet.value = gradeLut(wetness > 0 ? 'wet' : profile);
  }
  override setSize(width: number, height: number) {
    this.material.uniforms.resolution.value.set(Math.max(1, width), Math.max(1, height));
  }
  override render(
    renderer: T.WebGLRenderer,
    writeBuffer: T.WebGLRenderTarget,
    readBuffer: T.WebGLRenderTarget,
  ) {
    this.material.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
  override dispose() {
    this.material.dispose();
    this.quad.dispose();
  }
}
