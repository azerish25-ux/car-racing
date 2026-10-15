import * as T from 'three';
import { chainShaderHook, injectAfter, injectDeclarations } from './shader-hooks.ts';

/**
 * Grass and gravel (D19 ground-cover).
 *
 * Grass (in the circuit's 'grass' finish): the shared 89/101/53 texels are
 * tinted to a mown summer-turf albedo #566a43 (linear ~0.094/0.143/0.056),
 * which the circuit finish's lush/dry soil mix brings to about 0.08/0.13/0.045
 * (luminance ~0.11, G/R ~1.6: real cut grass in the visible band), mown in
 * 4 m bands at ±6 %, with ±12 % regional variation at 25 m and 90 m and
 * sparse dry patches. It sits a little above the ~0.095 asphalt in value and
 * well apart from it in hue.
 *
 * Gravel (#8f8470, linear ~0.27 river gravel, not sand): Voronoi pebbles at 50 cells per metre of mixed mineral
 * tone, a sparser class of larger stones, dark cavities, dusty and damp
 * patches and faint wavering rake lines (0.3 m), all filtered to their mean
 * before a pixel spans a feature. World-space and lap-space, so
 * stable in motion; 0 draw calls.
 */
// Photoreal pass: the KPI 9 olive (#808054, linear 0.22/0.22/0.09) read as
// khaki felt as bright as the road. Mown turf is ~0.08-0.12 luminance with
// G/R 1.5-1.8; this keeps the saturation near 0.4 (no lawn-green).
export const GRASS_TINT = Object.freeze([0.94, 1.1, 1.56] as const);
export const GRASS_MOW_METRES = 4;
export const GRASS_MOW_CONTRAST = 0.06;
export const GRASS_DETAIL_GLSL = /* glsl */ `
    // D19 regional turf variation (25 m, 90 m) and dry patches.
    float turf25=finishFilteredNoise(vFinishWorld.xz/25.0+vec2(4.1,2.7));
    float turf90=finishFilteredNoise(vFinishWorld.xz/90.0+vec2(9.3,5.2));
    diffuseColor.rgb *= 1.0+.12*(turf25-.5)*2.0*.5+.12*(turf90-.5)*2.0*.5;
    float dryPatch=smoothstep(.66,.8,finishFilteredNoise(vFinishWorld.xz/14.0+vec2(1.7,8.3)));
    diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(1.08,1.03,.88),dryPatch*.6);
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
  color: 0x8f8470,
  cellsPerMetre: 50,
  furrowMetres: 0.3,
  cavity: 0.55,
});

const f = (v: number) => v.toFixed(4);
const GRAVEL_GLSL = /* glsl */ `{
	// D19 gravel: rounded river stones of mixed mineralogy in two size classes,
	// dark voids between them, decimetre-to-metre dusty/damp patches and
	// irregular, faint rake lines (the old regular furrows read as corrugated
	// card at race-camera angles). Every layer converges to its mean before a
	// pixel spans its feature.
	vec2 p = vGravelWorld.xz * ${f(GRAVEL.cellsPerMetre)};
	vec2 cell = floor( p ), local = fract( p );
	float nearest = 8.0, second = 8.0;
	vec2 pick = vec2( 0.5 );
	for ( int j = -1; j <= 1; j ++ )
		for ( int i = -1; i <= 1; i ++ ) {
			vec2 o = vec2( float( i ), float( j ) );
			vec2 h = fract( sin( vec2( dot( cell + o, vec2( 127.1, 311.7 ) ), dot( cell + o, vec2( 269.5, 183.3 ) ) ) ) * 43758.5453 );
			float d = length( o + h - local );
			if ( d < nearest ) { second = nearest; nearest = d; pick = h; }
			else if ( d < second ) second = d;
		}
	float edge = second - nearest;
	float footprint = max( length( dFdx( p ) ), length( dFdy( p ) ) );
	float resolve = 1.0 - smoothstep( 0.35, 1.2, footprint );
	// Larger stones (one class up) break the uniform pebble carpet.
	vec2 q = p * 0.37 + vec2( 17.3, 5.1 );
	vec2 qc = floor( q ), ql = fract( q );
	float qNear = 8.0; float qPick = 0.5;
	for ( int j = -1; j <= 1; j ++ )
		for ( int i = -1; i <= 1; i ++ ) {
			vec2 o = vec2( float( i ), float( j ) );
			vec2 h = fract( sin( vec2( dot( qc + o, vec2( 41.3, 289.1 ) ), dot( qc + o, vec2( 157.9, 73.7 ) ) ) ) * 43758.5453 );
			float d = length( o + h - ql );
			if ( d < qNear ) { qNear = d; qPick = h.x; }
		}
	float qResolve = 1.0 - smoothstep( 0.35, 1.2, footprint * 0.37 );
	float bigStone = ( 1.0 - smoothstep( 0.28, 0.36, qNear ) ) * step( 0.55, qPick ) * qResolve;
	float cavity = mix( 0.8, 1.0 - ${f(GRAVEL.cavity)} * ( 1.0 - smoothstep( 0.0, 0.2, edge ) ), resolve );
	// Mineral tone per stone: limestone, sandstone, darker basalt.
	vec3 mineral = pick.x < 0.18 ? vec3( 0.62, 0.62, 0.64 ) : pick.x < 0.32 ? vec3( 0.78, 0.66, 0.52 ) : vec3( 1.0 );
	vec3 stone = mix( vec3( 1.0 ), mineral * ( 0.84 + 0.32 * pick.y ), resolve );
	stone *= mix( 1.0, 0.9 + 0.25 * qPick, bigStone );
	// Patches: dust thrown up by cars (lighter), damp hollows (darker).
	float patchA = apexGravelNoise( vGravelWorld.xz * 0.55 + vec2( 3.1, 7.4 ) );
	float patchB = apexGravelNoise( vGravelWorld.xz * 2.3 + vec2( 9.2, 1.3 ) );
	float patches = 0.86 + 0.2 * patchA + 0.1 * patchB;
	// Faint rake lines, wavering and broken, not a regular corrugation.
	float furrowPhase = vGravelMetres.x / ${f(GRAVEL.furrowMetres)} + ( apexGravelNoise( vGravelWorld.xz * 0.9 ) - 0.5 ) * 1.6;
	float furrowAA = fwidth( furrowPhase );
	float furrowResolved = ( 1.0 - smoothstep( 0.15, 0.5, furrowAA ) ) * smoothstep( 0.35, 0.7, patchB );
	float furrow = 0.5 + 0.5 * cos( furrowPhase * 6.2831853 ) * furrowResolved;
	diffuseColor.rgb = gravelColour * cavity * stone * patches * ( 0.97 + 0.05 * furrow );
	// Relief: stone domes where resolved, a whisper of rake.
	gravelRelief = ( 1.0 - nearest * nearest ) * 0.003 * resolve * resolve + ( 1.0 - furrow ) * 0.002 * furrowResolved;
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
float apexGravelHash( vec2 p ) {
	vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
	p3 += dot( p3, p3.yzx + 33.33 );
	return fract( ( p3.x + p3.y ) * p3.z );
}
float apexGravelNoise( vec2 p ) {
	float footprint = max( length( dFdx( p ) ), length( dFdy( p ) ) );
	vec2 i = floor( p ), f = fract( p ), u = f * f * ( 3.0 - 2.0 * f );
	float n = mix( mix( apexGravelHash( i ), apexGravelHash( i + vec2( 1.0, 0.0 ) ), u.x ),
		mix( apexGravelHash( i + vec2( 0.0, 1.0 ) ), apexGravelHash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
	return mix( 0.5, n, 1.0 - smoothstep( 0.35, 1.25, footprint ) );
}
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
