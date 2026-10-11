import * as T from 'three';
import { chainShaderHook, injectAfter, injectDeclarations } from './shader-hooks.ts';

/**
 * Grass and gravel (D19 ground-cover).
 *
 * Grass (in the circuit's 'grass' finish): the shared 89/101/53 texels are
 * tinted to an olive #6c7438 albedo (sunlit render #7f8444-#8e8a4c instead of
 * the saturated #4e6e2d), mown in 4 m bands at ±6 %, with ±12 % regional
 * variation at 25 m and 90 m and sparse dry patches.
 *
 * Gravel (#b9a98a): Voronoi pebbles at 50 cells per metre with dark cavities
 * between them and raked furrows every 0.3 m along the lap, all filtered to
 * their mean before a pixel spans a pebble. World-space and lap-space, so
 * stable in motion; 0 draw calls.
 */
// KPI 9 iteration: the rendered turf read #6d7937 at saturation 0.54 (target
// #7f8444-#8e8a4c, 0.33-0.47). A lighter, greyer olive albedo #808054 renders
// about #868553 in the day sun (shots/kpi-iteration-v1/v2).
export const GRASS_TINT = Object.freeze([2.17, 1.66, 2.46] as const);
export const GRASS_MOW_METRES = 4;
export const GRASS_MOW_CONTRAST = 0.06;
export const GRASS_DETAIL_GLSL = /* glsl */ `
    // D19 regional turf variation (25 m, 90 m) and dry patches.
    float turf25=finishFilteredNoise(vFinishWorld.xz/25.0+vec2(4.1,2.7));
    float turf90=finishFilteredNoise(vFinishWorld.xz/90.0+vec2(9.3,5.2));
    diffuseColor.rgb *= 1.0+.12*(turf25-.5)*2.0*.5+.12*(turf90-.5)*2.0*.5;
    float dryPatch=smoothstep(.66,.8,finishFilteredNoise(vFinishWorld.xz/14.0+vec2(1.7,8.3)));
    diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(1.16,1.06,.78),dryPatch*.6);
`;

/**
 * Turf micro-structure (real cut grass instead of a tinted plane):
 *  - leaf colour clumps 0.1-0.3 m across, yellower and bluer leaves;
 *  - tufts 1.5-3 cm with dark shaded gaps between lit leaf tips;
 *  - sparse clover/weed patches, darker and bluer;
 *  - mowing stripes that depend on the view: a band whose blades lean away
 *    from the camera shows their lit, waxy upper faces (light), a band that
 *    leans toward it shows the shaded undersides (dark). The lean follows the
 *    lap direction recovered from screen derivatives, alternating per band;
 *  - grazing-angle leaf sheen (more blade sides, less soil, toward the horizon).
 * Every layer converges to its mean before one pixel covers a feature, and is
 * world-space, so it is stable in motion. Zero textures and draw calls.
 */
export const TURF = Object.freeze({
  /** Albedo range of the colour clumps (cool, warm). */
  clumpCool: Object.freeze([0.9, 0.97, 1.08] as const),
  clumpWarm: Object.freeze([1.09, 1.03, 0.9] as const),
  /** Tuft contrast (albedo 1 +- tuft/2). */
  tuft: 0.42,
  /** Clover share and its tint. */
  clover: 0.72,
  cloverTint: Object.freeze([0.8, 0.93, 0.86] as const),
  /** View-dependent mowing-stripe lean contrast. */
  lean: 0.09,
  sheen: 0.16,
});
const t3 = (v: readonly number[]) => `vec3(${v.map((x) => x.toFixed(3)).join(',')})`;
/** Helpers for the finish's common section (hash precise at lap coordinates). */
export const TURF_COMMON_GLSL = /* glsl */ `
float turfHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float turfNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
  return mix(mix(turfHash(i), turfHash(i + vec2(1., 0.)), u.x),
    mix(turfHash(i + vec2(0., 1.)), turfHash(i + vec2(1., 1.)), u.x), u.y);
}
float turfFiltered(vec2 p) {
  float footprint = max(length(dFdx(p)), length(dFdy(p)));
  return mix(.5, turfNoise(p), 1. - smoothstep(.3, 1.1, footprint));
}
`;
/** Leaf colour, tufts and clover (apron and terrain alike, so they meet seamlessly). */
export const TURF_GLSL = /* glsl */ `{
    vec2 tw = vFinishWorld.xz;
    float tClump = turfFiltered(tw * 3.1 + vec2(13.1, 7.3)) * .6 + turfFiltered(tw * 9.7 + vec2(3.7, 21.1)) * .4;
    diffuseColor.rgb *= mix(${t3(TURF.clumpCool)}, ${t3(TURF.clumpWarm)}, tClump);
    float tTuft = turfFiltered(tw * 31.0) * .55 + turfFiltered(tw * 67.0 + vec2(5.1, 2.3)) * .45;
    diffuseColor.rgb *= 1. + ${TURF.tuft.toFixed(3)} * (tTuft - .5) * 2.;
    float tClover = smoothstep(${TURF.clover.toFixed(3)}, ${(TURF.clover + 0.08).toFixed(3)}, turfFiltered(tw * 2.3 + vec2(41., 9.)));
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * ${t3(TURF.cloverTint)}, tClover * .7);
    // Grazing sheen: blade sides and the sky in their cuticle wax.
    vec3 tView = normalize(cameraPosition - vFinishWorld);
    float tGraze = pow(1. - clamp(tView.y, 0., 1.), 4.);
    float tLuma = dot(diffuseColor.rgb, vec3(.2126, .7152, .0722));
    diffuseColor.rgb = mix(diffuseColor.rgb, tLuma * vec3(1., 1.05, 1.08), tGraze * ${TURF.sheen.toFixed(3)});
}`;

export const GRAVEL = Object.freeze({
  color: 0xb9a98a,
  cellsPerMetre: 50,
  furrowMetres: 0.3,
  cavity: 0.55,
});

const f = (v: number) => v.toFixed(4);
const GRAVEL_GLSL = /* glsl */ `{
	// D19 gravel: Voronoi pebbles, dark cavities, raked furrows along the lap.
	vec2 p = vGravelWorld.xz * ${f(GRAVEL.cellsPerMetre)};
	vec2 cell = floor( p ), local = fract( p );
	float nearest = 8.0, second = 8.0, shade = 0.5;
	for ( int j = -1; j <= 1; j ++ )
		for ( int i = -1; i <= 1; i ++ ) {
			vec2 o = vec2( float( i ), float( j ) );
			vec2 h = fract( sin( vec2( dot( cell + o, vec2( 127.1, 311.7 ) ), dot( cell + o, vec2( 269.5, 183.3 ) ) ) ) * 43758.5453 );
			float d = length( o + h - local );
			if ( d < nearest ) { second = nearest; nearest = d; shade = h.x; }
			else if ( d < second ) second = d;
		}
	float edge = second - nearest;
	float footprint = max( length( dFdx( p ) ), length( dFdy( p ) ) );
	float resolve = 1.0 - smoothstep( 0.35, 1.2, footprint );
	float cavity = mix( 0.82, 1.0 - ${f(GRAVEL.cavity)} * ( 1.0 - smoothstep( 0.0, 0.18, edge ) ), resolve );
	float stone = mix( 1.0, 0.82 + 0.36 * shade, resolve );
	float furrowPhase = vGravelMetres.x / ${f(GRAVEL.furrowMetres)};
	float furrowAA = fwidth( furrowPhase );
	float furrow = mix( 0.5, 0.5 + 0.5 * cos( furrowPhase * 6.2831853 ), 1.0 - smoothstep( 0.3, 1.0, furrowAA ) );
	diffuseColor.rgb = gravelColour * cavity * stone * ( 0.9 + 0.12 * furrow );
	gravelRelief = ( 1.0 - furrow ) * 0.012 * ( 1.0 - smoothstep( 0.3, 1.0, furrowAA ) );
}`;

export const GRAVEL_HOOK = 'gravel-finish-v1';
/** Install the gravel finish on the gravel ribbon material. */
export function installGravelFinish(material: T.MeshStandardMaterial) {
  material.color.setHex(0xffffff);
  const uniforms = { gravelColour: { value: new T.Color(GRAVEL.color) } };
  return chainShaderHook(material, GRAVEL_HOOK, (shader) => {
    Object.assign(shader.uniforms, uniforms);
    injectDeclarations(
      shader,
      'common',
      'varying vec3 vGravelWorld;\nvarying vec2 vGravelMetres;',
      'vertex',
    );
    injectAfter(
      shader,
      'project_vertex',
      'vGravelWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\nvGravelMetres = uv * 5.0;',
      'vertex',
    );
    injectDeclarations(
      shader,
      'common',
      `varying vec3 vGravelWorld;\nvarying vec2 vGravelMetres;\nuniform vec3 gravelColour;\nfloat gravelRelief = 0.0;
vec3 apexGravelRelief( vec3 n, float h ) {
	vec3 sx = dFdx( - vViewPosition ), sy = dFdy( - vViewPosition );
	vec3 r1 = cross( sy, n ), r2 = cross( n, sx );
	float det = dot( sx, r1 );
	vec3 grad = sign( det ) * ( dFdx( h ) * r1 + dFdy( h ) * r2 );
	return normalize( max( abs( det ), 1e-10 ) * n - grad );
}`,
      'fragment',
    );
    injectAfter(shader, 'map_fragment', GRAVEL_GLSL, 'fragment');
    injectAfter(
      shader,
      'normal_fragment_maps',
      'normal = apexGravelRelief( normal, gravelRelief );',
      'fragment',
    );
  });
}
