p='src/rendering/ultra/light-shafts.ts'
s=open(p).read()
old=""" *  3. Additive composite scaled by the scattering strength of the lighting and
 *     air (haze from cloud and rain, much stronger low sun at sunset). Off at
 *     night, in studio backdrops, and when the sun is behind the camera; it
 *     fades as the sun leaves the frame.
 */
export const LIGHT_SHAFTS = Object.freeze({
  taps: 24,
  /** Fraction of the distance to the sun covered by the first gather. */
  density: 0.9,
  decay: 0.965,
  /** HG asymmetry of the mask lobe (Mie forward scattering). */
  g: 0.76,
  /** Radiance ceiling of masked sky (linear HDR). */
  limit: 40,
  strength: Object.freeze({ day: 0.05, sunset: 0.16 }),"""
new=""" *  3. Additive composite scaled by the scattering strength of the lighting and
 *     air (haze from cloud and rain, much stronger low sun at sunset). Off at
 *     night, in studio backdrops, and when the sun is behind the camera; it
 *     fades as the sun leaves the frame. Near occluders (a canopy, a stand)
 *     keep their dark core between the beams: the in-scatter in front of
 *     them is a short path of air, so the composite keeps `occluded` of the
 *     beam on geometry nearer than `clearDistance` m (full beyond it).
 *
 * Photoreal pass (sunset into the sun read milky): a narrow mask (g 0.9, the
 * beams start at the disc and its aureole, about 8 degrees), a shorter gather
 * (decay 0.94) and a third of the sunset strength.
 */
export const LIGHT_SHAFTS = Object.freeze({
  taps: 24,
  /** Fraction of the distance to the sun covered by the first gather. */
  density: 0.9,
  decay: 0.94,
  /** HG asymmetry of the mask lobe (Mie forward scattering). */
  g: 0.9,
  /** Radiance ceiling of masked sky (linear HDR). */
  limit: 40,
  strength: Object.freeze({ day: 0.04, sunset: 0.06 }),
  /** Share of the beam composited over near geometry, and the view distance
   * (m) where geometry counts as open air again. */
  occluded: 0.15,
  clearDistance: Object.freeze([150, 1500] as const),"""
assert old in s; s=s.replace(old,new)
old="""const compositeShader = /* glsl */ `
uniform sampler2D tSource;
uniform float strength;
varying vec2 vUv;
void main() { gl_FragColor = vec4( texture2D( tSource, vUv ).rgb * strength, 1.0 ); }`;"""
new="""const compositeShader = /* glsl */ `
#include <packing>
uniform sampler2D tSource;
uniform sampler2D tDepth;
uniform vec2 sourceTexel;
uniform float strength;
uniform float cameraNear;
uniform float cameraFar;
varying vec2 vUv;
float openAir( vec2 uv ) {
	float depth = texture2D( tDepth, uv ).x;
	if ( depth >= 0.99999 ) return 1.0;
	float distance = - perspectiveDepthToViewZ( depth, cameraNear, cameraFar );
	return smoothstep( ${LIGHT_SHAFTS.clearDistance[0].toFixed(1)}, ${LIGHT_SHAFTS.clearDistance[1].toFixed(1)}, distance );
}
void main() {
	// Occluder share over a 4-tap footprint, so beam edges stay soft.
	float open = 0.25 * ( openAir( vUv + vec2( -1.5, -1.5 ) * sourceTexel ) + openAir( vUv + vec2( 1.5, -1.5 ) * sourceTexel )
		+ openAir( vUv + vec2( -1.5, 1.5 ) * sourceTexel ) + openAir( vUv + vec2( 1.5, 1.5 ) * sourceTexel ) );
	float keep = mix( ${LIGHT_SHAFTS.occluded.toFixed(3)}, 1.0, open );
	gl_FragColor = vec4( texture2D( tSource, vUv ).rgb * strength * keep, 1.0 );
}`;"""
assert old in s; s=s.replace(old,new)
old="""    this.composite = shader(
      'APEX sun shaft composite',
      compositeShader,
      { tSource: { value: null }, strength: { value: 0 } },
      true,
    );"""
new="""    this.composite = shader(
      'APEX sun shaft composite',
      compositeShader,
      {
        tSource: { value: null },
        tDepth: { value: null },
        sourceTexel: { value: new T.Vector2() },
        strength: { value: 0 },
        cameraNear: { value: 0.1 },
        cameraFar: { value: 1000 },
      },
      true,
    );"""
assert old in s; s=s.replace(old,new)
old="""    this.mask.uniforms.sourceTexel.value.set(1 / Math.max(1, width), 1 / Math.max(1, height));"""
new="""    this.mask.uniforms.sourceTexel.value.set(1 / Math.max(1, width), 1 / Math.max(1, height));
    this.composite.uniforms.sourceTexel.value.set(1 / Math.max(1, width), 1 / Math.max(1, height));"""
assert old in s; s=s.replace(old,new)
old="""    this.composite.uniforms.tSource.value = a.texture;
    this.composite.uniforms.strength.value = this.strength;"""
new="""    const cu = this.composite.uniforms;
    cu.tSource.value = a.texture;
    cu.tDepth.value = depth;
    cu.cameraNear.value = this.camera.near;
    cu.cameraFar.value = this.camera.far;
    cu.strength.value = this.strength;"""
assert old in s; s=s.replace(old,new)
open(p,'w').write(s)

p='src/rendering/studio/aerial-perspective.ts'
s=open(p).read()
old="""  /** Exponent of the sun-side lobe. */
  sunPower: 8,"""
new="""  /** Exponent of the sun-side lobe: a tight Mie aureole (half width ~14
   * degrees), not a 23 degree veil over the into-the-sun view. */
  sunPower: 24,"""
assert old in s; s=s.replace(old,new)
s=s.replace("`mix(antiSun, sunSide, pow(max(dot(v, sun), 0), 8))`","`mix(antiSun, sunSide, pow(max(dot(v, sun), 0), 24))`")
open(p,'w').write(s)

p='src/rendering/studio/lens-effects.ts'
s=open(p).read()
old="""  /** Bloom gain on the dirtiest texels (1 + dirt · mask). */
  dirt: 0.9,"""
new="""  /** Bloom gain on the dirtiest texels (1 + dirt · mask). */
  dirt: 0.9,
  /** ULTRA (energy-conserving bloom): a clean broadcast lens. The dirt gain
   * multiplied the wide veil into the into-the-sun frames. */
  physicalDirt: 0.3,"""
assert old in s; s=s.replace(old,new)
old="""    sunDirection: T.Vector3,
    night: boolean,
  ) {"""
new="""    sunDirection: T.Vector3,
    night: boolean,
    physical = false,
  ) {"""
assert old in s; s=s.replace(old,new)
old="""    u.lensDirt.value = exterior ? LENS.dirt : LENS.dirt * 0.35;"""
new="""    const dirt = physical ? LENS.physicalDirt : LENS.dirt;
    u.lensDirt.value = exterior ? dirt : dirt * 0.35;"""
assert old in s; s=s.replace(old,new)
open(p,'w').write(s)
