p='src/rendering/lens-bloom.ts'
s=open(p).read()

old="""const downsampleShader = /* glsl */ `"""
new="""/** Energy-conserving prefilter (ULTRA): no threshold, and the firefly
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
  float knee = clamp(level * ${'${PHYSICAL_OUTLIER}'}, 24.0, shape.z);
  float ceiling = min(knee * 4.0, shape.w);
  vec3 sum = vec3(0.0);
  ${DOWNSAMPLE_TAPS.map(([, , w], i) => `sum += limitTap(c${i}, l${i}, knee, ceiling) * ${w.toFixed(5)};`).join('\n  ')}
  gl_FragColor = vec4(sum, 1.0);
}`;

const downsampleShader = /* glsl */ `"""
assert old in s; s=s.replace(old,new,1)

old="""/** Energy-conserving mode (ULTRA `physicalBloom`): no threshold; the frame
 * becomes (1 - mix) · scene + mix · blurred scene, so the pyramid redistributes
 * a fixed share of every pixel's energy (veiling glare of a real lens) instead
 * of adding light above a threshold. Total radiance is preserved. */
export const PHYSICAL_BLOOM = Object.freeze({
  mix: 0.035,
  /** Wet air scatters more (multiplied by the post-lens wetness gain). */
  wetMix: 0.055,
});"""
new="""/** Energy-conserving mode (ULTRA `physicalBloom`): no threshold; the frame
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
}"""
assert old in s; s=s.replace(old,new)

# Move PHYSICAL_BLOOM above energy shader usage: the shader template references PHYSICAL_OUTLIER placeholder; replace with constant after definition.
s=s.replace("float knee = clamp(level * ${'${PHYSICAL_OUTLIER}'}, 24.0, shape.z);","float knee = clamp(level * OUTLIER_RATIO, 24.0, shape.z);")
s=s.replace("""vec3 fetchTap(vec2 offset) { return texture2D(tSource, vUv + offset * texel).rgb; }""","""#define OUTLIER_RATIO 16.0
vec3 fetchTap(vec2 offset) { return texture2D(tSource, vUv + offset * texel).rgb; }""")

old="""  private readonly prefilter = material(prefilterShader, {
    tSource: { value: null },
    texel: { value: new T.Vector2() },
    shape: {
      value: new T.Vector4(LENS_BLOOM.threshold, LENS_BLOOM.knee, LENS_BLOOM.limitKnee, LENS_BLOOM.limit),
    },
  });"""
new="""  private readonly prefilter = material(prefilterShader, {
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
  });"""
assert old in s; s=s.replace(old,new)

old="""  get normalization() {
    let sum = 0;
    for (let i = 0; i < this.levels.length; i++) sum += LENS_BLOOM.scatter ** i;
    return sum;
  }"""
new="""  get normalization() {
    let sum = 0;
    for (let i = 0; i < this.levels.length; i++) sum += this.scatter ** i;
    return sum;
  }
  /** Level-to-level carry of the current mode's point-spread function. */
  get scatter() {
    return this.energyConserving ? PHYSICAL_BLOOM.scatter : LENS_BLOOM.scatter;
  }"""
assert old in s; s=s.replace(old,new)

old="""    // Threshold 0 with a vanishing knee passes every pixel unchanged.
    shape.x = energy ? 0 : LENS_BLOOM.threshold;
    shape.y = energy ? 1e-3 : LENS_BLOOM.knee;
    draw(this.prefilter, readBuffer.texture, readBuffer, this.levels[0]);
    for (let i = 1; i < this.levels.length; i++)
      draw(this.downsample, this.levels[i - 1].texture, this.levels[i - 1], this.levels[i]);
    this.upsample.uniforms.gain.value = LENS_BLOOM.scatter;"""
new="""    // Threshold 0 with a vanishing knee passes every pixel unchanged.
    shape.x = energy ? 0 : LENS_BLOOM.threshold;
    shape.y = energy ? 1e-3 : LENS_BLOOM.knee;
    draw(energy ? this.energyPrefilter : this.prefilter, readBuffer.texture, readBuffer, this.levels[0]);
    for (let i = 1; i < this.levels.length; i++)
      draw(this.downsample, this.levels[i - 1].texture, this.levels[i - 1], this.levels[i]);
    this.upsample.uniforms.gain.value = this.scatter;"""
assert old in s; s=s.replace(old,new)
old="""    this.prefilter.dispose();
    this.downsample.dispose();"""
new="""    this.prefilter.dispose();
    this.energyPrefilter.dispose();
    this.downsample.dispose();"""
assert old in s; s=s.replace(old,new)
open(p,'w').write(s)

p='src/rendering/ultra/pipeline.ts'
s=open(p).read()
old="""    bloom.energyMix = PHYSICAL_BLOOM.mix + (PHYSICAL_BLOOM.wetMix - PHYSICAL_BLOOM.mix) * wet;"""
new="""    bloom.energyMix = physicalBloomMix(frame.studio ? 'day' : frame.lighting, wet);"""
assert old in s; s=s.replace(old,new)
s=s.replace("import { PHYSICAL_BLOOM } from '../lens-bloom.ts';","import { physicalBloomMix } from '../lens-bloom.ts';")
open(p,'w').write(s)
