import * as T from 'three';
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js';
import { LENS_BLOOM_GLSL, lensUniforms, type LensUniforms } from './studio/lens-effects.ts';

/** Lens bloom from the linear HDR scene, before exposure and tone mapping.
 *
 * A progressive mip pyramid (Jimenez, "Next Generation Post Processing in Call
 * of Duty: Advanced Warfare", SIGGRAPH 2014): a 13-tap downsample filter and a
 * 3x3 tent upsample. The result is a smooth, round falloff from any small bright
 * source. Three's UnrealBloomPass blurs each mip with a kernel truncated at one
 * sigma (its edge taps keep 73-80% of the centre weight), which is close to a
 * box filter. A single sub-pixel specular on wet metal under a floodlight (one
 * pixel near 9,000 linear in a measured wet night frame) became a stack of
 * hard-edged white squares.
 *
 * Fireflies are limited before the pyramid: each prefilter tap's luminance is
 * compressed above `limitKnee` towards `limit`, and non-finite values are
 * dropped. Lamps, the sun disc and floodlit spray, whose bright areas span
 * many pixels, keep their glow; one unresolved pixel can no longer dominate. */
export const LENS_BLOOM = Object.freeze({
  /** Linear luminance where bloom starts, above sunlit white paint and smoke. */
  threshold: 3.6,
  /** Soft-knee half-width around the threshold. */
  knee: 1.8,
  /** Prefilter taps keep luminance up to here unchanged... */
  limitKnee: 24,
  /** ...and are compressed smoothly towards this ceiling above it. */
  limit: 64,
  /** Share of each coarser level carried into the next finer level. */
  scatter: 0.7,
  /** Fraction of the above-threshold radiance of a large uniform area that is
   * added back. Point sources spread the same energy over the glow. */
  strength: 0.55,
  /** Mip levels below the half-resolution prefilter level. */
  levels: 6,
});

/** Jimenez 13-tap downsample: offsets in source texels, and their weights. The
 * inner 2x2 box carries 0.5; the four overlapping outer boxes 0.125 each. */
export const DOWNSAMPLE_TAPS: readonly (readonly [number, number, number])[] = [
  [-1, -1, 0.125],
  [1, -1, 0.125],
  [-1, 1, 0.125],
  [1, 1, 0.125],
  [-2, -2, 0.03125],
  [2, -2, 0.03125],
  [-2, 2, 0.03125],
  [2, 2, 0.03125],
  [0, -2, 0.0625],
  [-2, 0, 0.0625],
  [2, 0, 0.0625],
  [0, 2, 0.0625],
  [0, 0, 0.125],
];
/** 3x3 tent upsample: offsets in source texels, and their weights. */
export const TENT_TAPS: readonly (readonly [number, number, number])[] = [
  [-1, -1, 1 / 16],
  [0, -1, 2 / 16],
  [1, -1, 1 / 16],
  [-1, 0, 2 / 16],
  [0, 0, 4 / 16],
  [1, 0, 2 / 16],
  [-1, 1, 1 / 16],
  [0, 1, 2 / 16],
  [1, 1, 1 / 16],
];

/** CPU reference of the shader's firefly limiter, as a luminance scale factor. */
export function bloomLimitScale(lum: number, knee = LENS_BLOOM.limitKnee, limit = LENS_BLOOM.limit) {
  if (!(lum < 65000) || !(lum >= 0)) return 0;
  if (lum <= knee) return 1;
  const x = lum - knee;
  return (knee + x / (1 + x / (limit - knee))) / lum;
}
/** CPU reference of the soft-knee threshold, as a luminance scale factor. */
export function bloomThresholdScale(lum: number, threshold = LENS_BLOOM.threshold, knee = LENS_BLOOM.knee) {
  const soft = Math.min(Math.max(lum - threshold + knee, 0), 2 * knee);
  const curve = (soft * soft) / (4 * knee + 1e-5);
  return Math.max(curve, lum - threshold) / Math.max(lum, 1e-5);
}

const taps = (list: readonly (readonly [number, number, number])[], read: string) =>
  list
    .map(([x, y, w]) => `sum += ${read}(vec2(${x.toFixed(1)}, ${y.toFixed(1)})) * ${w.toFixed(5)};`)
    .join('\n    ');

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const prefilterShader = /* glsl */ `
#include <common>
uniform sampler2D tSource;
uniform vec2 texel;
uniform vec4 shape; // threshold, knee, limitKnee, limit
varying vec2 vUv;
vec3 limited(vec2 offset) {
  vec3 c = texture2D(tSource, vUv + offset * texel).rgb;
  float l = luminance(c);
  // NaN and Inf fail both comparisons: they contribute nothing.
  if (!(l < 65000.0) || !(l >= 0.0)) return vec3(0.0);
  if (l <= shape.z) return c;
  float x = l - shape.z;
  return c * ((shape.z + x / (1.0 + x / (shape.w - shape.z))) / l);
}
void main() {
  vec3 sum = vec3(0.0);
  ${taps(DOWNSAMPLE_TAPS, 'limited')}
  float l = luminance(sum);
  float soft = clamp(l - shape.x + shape.y, 0.0, 2.0 * shape.y);
  soft = soft * soft / (4.0 * shape.y + 1e-5);
  sum *= max(soft, l - shape.x) / max(l, 1e-5);
  gl_FragColor = vec4(sum, 1.0);
}`;

/** Energy-conserving mode (ULTRA `physicalBloom`): no threshold; the frame
 * becomes (1 - mix) · scene + mix · blurred scene, so the pyramid redistributes
 * a fixed share of every pixel's energy (veiling glare of a real lens) instead
 * of adding light above a threshold. Total radiance is preserved.
 *
 * The point-spread function is a real lens's: tight, bright glare around point
 * sources and almost no wide veil. With `scatter` 0.45 about 90 % of the
 * redistributed share stays in the three finest levels (radii up to ~8 px)
 * and the coarsest level carries under 0.5 %. Emitters are authored in
 * physical radiance, and only isolated sub-pixel outliers are limited (see
 * the energy prefilter), so lamps glow through this path. */
export const PHYSICAL_BLOOM = Object.freeze({
  mix: 0.03,
  /** The golden hour's long low-sun views carry less veil. */
  sunsetMix: 0.02,
  /** Wet air scatters more (multiplied by the post-lens wetness gain). */
  wetMix: 0.045,
  /** Share of each coarser level carried into the next finer level. */
  scatter: 0.45,
  /** Half-float-safe limiter ceilings for non-isolated bright taps. */
  limitKnee: 2000,
  limit: 8000,
  /** Taps above this multiple of the robust neighbourhood level are outliers. */
  outlierRatio: 16,
});
/** Mix of the energy-conserving bloom for a lighting and wetness (0..1). */
export function physicalBloomMix(mode: 'day' | 'sunset' | 'night', wetness: number) {
  const base = mode === 'sunset' ? PHYSICAL_BLOOM.sunsetMix : PHYSICAL_BLOOM.mix;
  const wet = Number.isFinite(wetness) ? Math.min(1, Math.max(0, wetness)) : 0;
  return base + (PHYSICAL_BLOOM.wetMix - base) * wet;
}

/** Energy-conserving prefilter (ULTRA): no threshold, and the firefly
 * limiter only touches isolated sub-pixel outliers. The robust neighbourhood
 * level is the median of the centre and the four inner diagonal taps (they
 * tile the 4x4 source block; one bright pixel reaches at most two of them).
 * Taps are limited above `PHYSICAL_BLOOM.outlierRatio` x that level, never
 * below 24, and never above the half-float-safe `limitKnee`/`limit`, so lamp
 * heads, windows and the sun keep their physical radiance into the glare. */
const energyPrefilterShader = /* glsl */ `
#include <common>
uniform sampler2D tSource;
uniform vec2 texel;
uniform vec4 shape; // unused, unused, limitKnee, limit
varying vec2 vUv;
#define OUTLIER_RATIO ${PHYSICAL_BLOOM.outlierRatio.toFixed(1)}
vec3 fetchTap(vec2 offset) { return texture2D(tSource, vUv + offset * texel).rgb; }
float tapLuminance(vec3 c) {
  float l = luminance(c);
  // NaN and Inf fail both comparisons: they contribute nothing.
  return (l < 65000.0 && l >= 0.0) ? l : -1.0;
}
vec3 limitTap(vec3 c, float l, float knee, float ceiling) {
  if (l < 0.0) return vec3(0.0);
  if (l <= knee) return c;
  float x = l - knee;
  return c * ((knee + x / (1.0 + x / (ceiling - knee))) / l);
}
float median3(float a, float b, float c) { return max(min(a, b), min(max(a, b), c)); }
void main() {
  ${DOWNSAMPLE_TAPS.map(([x, y], i) => `vec3 c${i} = fetchTap(vec2(${x.toFixed(1)}, ${y.toFixed(1)}));\n  float l${i} = tapLuminance(c${i});`).join('\n  ')}
  // Median of five: the centre (12) and the inner diagonals (0-3).
  float m0 = max(l0, 0.0), m1 = max(l1, 0.0), m2 = max(l2, 0.0), m3 = max(l3, 0.0), m4 = max(l12, 0.0);
  float level = median3(max(min(m0, m1), min(m2, m3)), min(max(m0, m1), max(m2, m3)), m4);
  float knee = clamp(level * OUTLIER_RATIO, 24.0, shape.z);
  float ceiling = min(knee * 4.0, shape.w);
  vec3 sum = vec3(0.0);
  ${DOWNSAMPLE_TAPS.map(([, , w], i) => `sum += limitTap(c${i}, l${i}, knee, ceiling) * ${w.toFixed(5)};`).join('\n  ')}
  gl_FragColor = vec4(sum, 1.0);
}`;

const downsampleShader = /* glsl */ `
uniform sampler2D tSource;
uniform vec2 texel;
varying vec2 vUv;
vec3 tap(vec2 offset) { return texture2D(tSource, vUv + offset * texel).rgb; }
void main() {
  vec3 sum = vec3(0.0);
  ${taps(DOWNSAMPLE_TAPS, 'tap')}
  gl_FragColor = vec4(sum, 1.0);
}`;

const upsampleShader = /* glsl */ `
uniform sampler2D tSource;
uniform vec2 texel;
uniform float gain;
varying vec2 vUv;
vec3 tap(vec2 offset) { return texture2D(tSource, vUv + offset * texel).rgb; }
void main() {
  vec3 sum = vec3(0.0);
  ${taps(TENT_TAPS, 'tap')}
  gl_FragColor = vec4(sum * gain, 1.0);
}`;

/** The final upsample into the scene, with the lens terms (D09): lens dirt
 * scales the bloom where it lands, and flare ghosts of a coarse level are
 * mirrored through the frame centre. Both are 0 when lens effects are off. */
const compositeShader = /* glsl */ `
uniform sampler2D tSource;
uniform vec2 texel;
uniform float gain;
varying vec2 vUv;
${LENS_BLOOM_GLSL}
vec3 tap(vec2 offset) { return texture2D(tSource, vUv + offset * texel).rgb; }
void main() {
  vec3 sum = vec3(0.0);
  ${taps(TENT_TAPS, 'tap')}
  gl_FragColor = vec4(sum * gain * lensDirtGain(vUv) + lensGhosts(vUv), 1.0);
}`;
/** Bloom level the flare ghosts are drawn from (1/8 resolution, already
 * carrying every coarser level after the upsample chain). */
export const LENS_GHOST_LEVEL = 2;

function material(fragmentShader: string, uniforms: Record<string, T.IUniform>, additive = false) {
  return new T.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
    // Additive upsampling accumulates into the finer level (and the scene).
    blending: additive ? T.CustomBlending : T.NoBlending,
    blendEquation: T.AddEquation,
    blendSrc: T.OneFactor,
    blendDst: T.OneFactor,
    transparent: additive,
  });
}

export class LensBloomPass extends Pass {
  /** levels[0] is half resolution; each later level halves again. */
  readonly levels: T.WebGLRenderTarget[];
  strength: number = LENS_BLOOM.strength;
  /** ULTRA energy-conserving mode (see PHYSICAL_BLOOM); off on every preset. */
  energyConserving = false;
  /** Scene share redistributed in energy-conserving mode. */
  energyMix: number = PHYSICAL_BLOOM.mix;
  private readonly quad = new FullScreenQuad();
  private readonly prefilter = material(prefilterShader, {
    tSource: { value: null },
    texel: { value: new T.Vector2() },
    shape: {
      value: new T.Vector4(LENS_BLOOM.threshold, LENS_BLOOM.knee, LENS_BLOOM.limitKnee, LENS_BLOOM.limit),
    },
  });
  /** ULTRA's energy-conserving prefilter, compiled only when it is used. */
  private readonly energyPrefilter = material(energyPrefilterShader, {
    tSource: { value: null },
    texel: { value: new T.Vector2() },
    shape: {
      value: new T.Vector4(0, 0, PHYSICAL_BLOOM.limitKnee, PHYSICAL_BLOOM.limit),
    },
  });
  private readonly downsample = material(downsampleShader, {
    tSource: { value: null },
    texel: { value: new T.Vector2() },
  });
  private readonly upsample = material(
    upsampleShader,
    { tSource: { value: null }, texel: { value: new T.Vector2() }, gain: { value: 1 } },
    true,
  );
  private readonly composite: T.ShaderMaterial;
  constructor(levels: number = LENS_BLOOM.levels, lens: LensUniforms = lensUniforms) {
    super();
    this.needsSwap = false;
    this.composite = material(
      compositeShader,
      {
        tSource: { value: null },
        texel: { value: new T.Vector2() },
        gain: { value: 1 },
        tGhost: { value: null },
        lensFlare: lens.lensFlare,
        lensDirt: lens.lensDirt,
        lensDirtMap: lens.lensDirtMap,
      },
      true,
    );
    this.levels = Array.from({ length: levels + 1 }, (_, i) => {
      const target = new T.WebGLRenderTarget(1, 1, {
        type: T.HalfFloatType,
        depthBuffer: false,
        stencilBuffer: false,
        minFilter: T.LinearFilter,
        magFilter: T.LinearFilter,
        generateMipmaps: false,
      });
      target.texture.name = `Lens bloom level ${i}`;
      return target;
    });
  }
  /** Weight that makes the accumulated pyramid return the input radiance of a
   * large uniform area: 1 + scatter + scatter^2 + ... over all levels. */
  get normalization() {
    let sum = 0;
    for (let i = 0; i < this.levels.length; i++) sum += this.scatter ** i;
    return sum;
  }
  /** Level-to-level carry of the current mode's point-spread function. */
  get scatter() {
    return this.energyConserving ? PHYSICAL_BLOOM.scatter : LENS_BLOOM.scatter;
  }
  override setSize(width: number, height: number) {
    let w = Math.max(1, Math.round(width / 2)),
      h = Math.max(1, Math.round(height / 2));
    for (const level of this.levels) {
      level.setSize(w, h);
      w = Math.max(1, Math.round(w / 2));
      h = Math.max(1, Math.round(h / 2));
    }
  }
  override render(
    renderer: T.WebGLRenderer,
    _writeBuffer: T.WebGLRenderTarget,
    readBuffer: T.WebGLRenderTarget,
  ) {
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    const draw = (shader: T.ShaderMaterial, source: T.Texture, texelOf: T.WebGLRenderTarget, target: T.WebGLRenderTarget | null) => {
      shader.uniforms.tSource.value = source;
      shader.uniforms.texel.value.set(1 / texelOf.width, 1 / texelOf.height);
      this.quad.material = shader;
      renderer.setRenderTarget(target);
      this.quad.render(renderer);
    };
    // Every pixel of every level is written by an opaque pass before any
    // additive pass reads or accumulates into it, so no clears are needed.
    const shape = this.prefilter.uniforms.shape.value as T.Vector4;
    const energy = this.energyConserving;
    const mix = Math.min(Math.max(this.energyMix, 0), 0.25);
    // Threshold 0 with a vanishing knee passes every pixel unchanged.
    shape.x = energy ? 0 : LENS_BLOOM.threshold;
    shape.y = energy ? 1e-3 : LENS_BLOOM.knee;
    draw(energy ? this.energyPrefilter : this.prefilter, readBuffer.texture, readBuffer, this.levels[0]);
    for (let i = 1; i < this.levels.length; i++)
      draw(this.downsample, this.levels[i - 1].texture, this.levels[i - 1], this.levels[i]);
    this.upsample.uniforms.gain.value = this.scatter;
    for (let i = this.levels.length - 1; i > 0; i--)
      draw(this.upsample, this.levels[i].texture, this.levels[i], this.levels[i - 1]);
    this.composite.uniforms.gain.value = (energy ? mix : this.strength) / this.normalization;
    this.composite.uniforms.tGhost.value =
      this.levels[Math.min(LENS_GHOST_LEVEL, this.levels.length - 1)].texture;
    // Energy-conserving: dst · (1 - mix) + mix · blur (constant-alpha blend).
    this.composite.blendDst = energy ? T.OneMinusConstantAlphaFactor : T.OneFactor;
    this.composite.blendAlpha = energy ? mix : 0;
    draw(this.composite, this.levels[0].texture, this.levels[0], this.renderToScreen ? null : readBuffer);
    renderer.autoClear = autoClear;
  }
  override dispose() {
    this.levels.forEach((level) => level.dispose());
    this.prefilter.dispose();
    this.energyPrefilter.dispose();
    this.downsample.dispose();
    this.upsample.dispose();
    this.composite.dispose();
    this.quad.dispose();
  }
}

/** CPU emulation of the pass on a small single-channel image (bilinear
 * sampling, clamp-to-edge), for tests of shape and energy. Returns the bloom
 * that the final pass adds at full resolution. */
export function emulateLensBloom(
  image: Float32Array,
  width: number,
  height: number,
  levels: number = LENS_BLOOM.levels,
  strength: number = LENS_BLOOM.strength,
) {
  interface Img {
    data: Float32Array;
    w: number;
    h: number;
  }
  const sample = (img: Img, u: number, v: number) => {
    const x = u * img.w - 0.5,
      y = v * img.h - 0.5;
    const x0 = Math.floor(x),
      y0 = Math.floor(y),
      fx = x - x0,
      fy = y - y0;
    const at = (i: number, j: number) =>
      img.data[Math.min(img.h - 1, Math.max(0, j)) * img.w + Math.min(img.w - 1, Math.max(0, i))];
    return (
      (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) +
      (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy
    );
  };
  const pass = (
    source: Img,
    w: number,
    h: number,
    list: readonly (readonly [number, number, number])[],
    map: (value: number) => number = (v) => v,
    post: (value: number) => number = (v) => v,
  ): Img => {
    const data = new Float32Array(w * h);
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const u = (i + 0.5) / w,
          v = (j + 0.5) / h;
        let sum = 0;
        for (const [ox, oy, weight] of list)
          sum += map(sample(source, u + ox / source.w, v + oy / source.h)) * weight;
        data[j * w + i] = post(sum);
      }
    return { data, w, h };
  };
  const pyramid: Img[] = [];
  let w = Math.max(1, Math.round(width / 2)),
    h = Math.max(1, Math.round(height / 2));
  pyramid.push(
    pass(
      { data: image, w: width, h: height },
      w,
      h,
      DOWNSAMPLE_TAPS,
      (value) => value * bloomLimitScale(value),
      (value) => value * bloomThresholdScale(value),
    ),
  );
  for (let i = 1; i <= levels; i++) {
    w = Math.max(1, Math.round(w / 2));
    h = Math.max(1, Math.round(h / 2));
    pyramid.push(pass(pyramid[i - 1], w, h, DOWNSAMPLE_TAPS));
  }
  for (let i = pyramid.length - 1; i > 0; i--) {
    const up = pass(pyramid[i], pyramid[i - 1].w, pyramid[i - 1].h, TENT_TAPS);
    for (let k = 0; k < up.data.length; k++) pyramid[i - 1].data[k] += up.data[k] * LENS_BLOOM.scatter;
  }
  let normalization = 0;
  for (let i = 0; i < pyramid.length; i++) normalization += LENS_BLOOM.scatter ** i;
  const out = pass(pyramid[0], width, height, TENT_TAPS);
  for (let k = 0; k < out.data.length; k++) out.data[k] *= strength / normalization;
  return out.data;
}
