import type * as T from 'three';
import { trackPoint, type Track } from '../simulation/track.ts';
import { chainShaderHook, injectAfter } from './studio/shader-hooks.ts';

/**
 * Trackside weathering (A01-A04 authored barrier kits).
 *
 * The authored modules repeat one texture set every 3.8 m and arrive factory
 * clean. Real circuit furniture is read by its history: rubber smeared onto
 * the track face by cars that touched it, dirt and grass splash on the foot,
 * rain-washed streaks below every top edge, module-to-module tone differences,
 * and on galvanised steel the zinc spangle, dull oxidised patches and rust
 * bleeding from bolted joints. All of it is procedural in barrier space:
 *
 *   `weathering` = (station metres along the lap, height metres above the
 *   module's foot, track-facing 1 / away -1, rubber wear 0..1)
 *
 * written per vertex by the conform step, so marks run continuously along a
 * run, never tile with the texture, and stay put across LOD switches. Fine
 * features fade to their mean once a pixel spans them (no shimmer at speed).
 * Same draws and textures; a handful of value-noise taps per fragment.
 */
export const WEATHERING_ATTRIBUTE = 'weathering';
export type WeatheringKind = 'concrete' | 'galvanised' | 'plastic';
export const TRACKSIDE_WEATHERING = Object.freeze({
  /** Rubber marks: cell length (m), share of cells marked, band height (m). */
  rubber: Object.freeze({
    cell: 5.3,
    share: Object.freeze([0.1, 0.85] as const),
    low: 0.12,
    high: 0.62,
  }),
  /** Foot dirt height (m) and darkening. */
  dirt: Object.freeze({ height: 0.3, strength: 0.62 }),
  /** Module length for per-module tone (m). */
  module: 3.8,
});

/** How often cars touch the wall here, 0..1: the sharpest bend in the
 * preceding 90 m (walls on corner exits collect rubber, straights stay clean). */
export function rubberWear(track: Track, station: number) {
  const p = trackPoint();
  let curvature = 0;
  for (let back = 0; back <= 90; back += 15) {
    const s = (((station - back) % track.length) + track.length) % track.length;
    curvature = Math.max(curvature, Math.abs(track.at(s, p).curvature));
  }
  const t = Math.min(1, Math.max(0, (curvature - 0.003) / 0.012));
  return t * t * (3 - 2 * t);
}

/** Per-vertex barrier-space coordinates for a conformed module. `facing` is
 * the template-space normal x that points AWAY from the track (+1 for the
 * mirrored shared conform, the module side for unmirrored concrete). */
export function weatheringStream(
  position: { count: number; getY(i: number): number; getZ(i: number): number },
  normal: { getX(i: number): number } | undefined,
  start: number,
  end: number,
  span: number,
  away: number,
  reverse = false,
  wear = 0.5,
) {
  const out = new Float32Array(position.count * 4);
  for (let i = 0; i < position.count; i++) {
    const z = Math.min(1, Math.max(0, position.getZ(i) / span)),
      t = reverse ? 1 - z : z;
    out[i * 4] = start + (end - start) * t;
    out[i * 4 + 1] = position.getY(i);
    out[i * 4 + 2] = normal ? Math.max(-1, Math.min(1, -away * normal.getX(i))) : 0;
    out[i * 4 + 3] = wear;
  }
  return out;
}

/** Hash, value noise and footprint-filtered noise shared by the weathering
 * shaders (and the sponsor vinyl's rubber marks). */
export const TRACKSIDE_NOISE_GLSL = /* glsl */ `
float twHash( vec2 p ) { p = fract( p * vec2( 123.34, 456.21 ) ); p += dot( p, p + 45.32 ); return fract( p.x * p.y ); }
float twNoise( vec2 p ) {
	vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( twHash( i ), twHash( i + vec2( 1, 0 ) ), f.x ), mix( twHash( i + vec2( 0, 1 ) ), twHash( i + vec2( 1, 1 ) ), f.x ), f.y );
}
// Converges to 0.5 once one pixel spans a noise cell.
float twFiltered( vec2 p ) {
	float footprint = max( length( dFdx( p ) ), length( dFdy( p ) ) );
	return mix( 0.5, twNoise( p ), 1.0 - smoothstep( 0.4, 1.2, footprint ) );
}
// Sparse round dots (pores, chips): one candidate per cell, jittered.
float twDots( vec2 p, float density, float radius ) {
	vec2 cell = floor( p ), f = fract( p ) - 0.5;
	float h = twHash( cell + 0.37 );
	vec2 offset = vec2( twHash( cell + 1.7 ), twHash( cell + 4.1 ) ) - 0.5;
	float d = length( f - offset * ( 1.0 - 2.0 * radius ) );
	return step( 1.0 - density, h ) * ( 1.0 - smoothstep( radius * 0.6, radius, d ) );
}
float twDetail( vec2 p ) {
	float footprint = max( length( dFdx( p ) ), length( dFdy( p ) ) );
	return 1.0 - smoothstep( 0.4, 1.2, footprint );
}
`;

/** Tyre rubber at wheel height: sparse smears of varying length, striated
 * along the direction of travel, denser where wear (corner exits) is high,
 * over a faint continuous scuff haze. 0..1. Uniform control flow throughout
 * (the filtered noise takes screen derivatives). */
export const TRACKSIDE_RUBBER_GLSL = /* glsl */ `
float twRubberMarks( float along0, float height, float wear ) {
	float rubber = 0.0;
	for ( int layer = 0; layer < 2; layer ++ ) {
		float cellLength = ${TRACKSIDE_WEATHERING.rubber.cell.toFixed(2)} * ( layer == 0 ? 1.0 : 1.73 );
		float along = along0 + float( layer ) * 2.31;
		float cell = floor( along / cellLength );
		float h0 = twHash( vec2( cell, 17.0 + float( layer ) ) ), h1 = twHash( vec2( cell, 41.0 ) ), h2 = twHash( vec2( cell, 73.0 + float( layer ) ) );
		float share = mix( ${TRACKSIDE_WEATHERING.rubber.share[0].toFixed(3)}, ${TRACKSIDE_WEATHERING.rubber.share[1].toFixed(3)}, wear );
		float present = step( h0, share );
		float local = along - cell * cellLength;
		float len = cellLength * ( 0.18 + 0.7 * h1 );
		float begin = ( cellLength - len ) * h2;
		float ends = smoothstep( begin, begin + len * 0.25, local ) * ( 1.0 - smoothstep( begin + len * 0.55, begin + len, local ) );
		float centre = mix( ${TRACKSIDE_WEATHERING.rubber.low.toFixed(3)} + 0.1, ${TRACKSIDE_WEATHERING.rubber.high.toFixed(3)} - 0.1, h1 * 0.6 + h2 * 0.4 );
		float halfHeight = 0.07 + 0.13 * min( 1.0, h0 / max( share, 1e-3 ) );
		float band = 1.0 - smoothstep( halfHeight * 0.4, halfHeight, abs( height - centre + ( local - begin ) * 0.012 * ( h2 - 0.5 ) ) );
		float striae = mix( 0.3, 1.0, twFiltered( vec2( along * 0.7, height * 46.0 ) ) ) * smoothstep( 0.2, 0.55, twFiltered( vec2( along * 2.3, height * 9.0 ) + h1 * 13.0 ) );
		rubber = max( rubber, present * ends * band * striae * ( 0.55 + 0.45 * h1 ) );
	}
	float haze = wear * 0.22 * smoothstep( 0.35, 0.75, twFiltered( vec2( along0 * 0.35, 2.0 ) ) ) * ( 1.0 - smoothstep( 0.0, 0.2, abs( height - 0.34 ) ) );
	rubber = max( rubber, haze * mix( 0.6, 1.0, twFiltered( vec2( along0 * 1.3, height * 30.0 ) ) ) );
	return smoothstep( 0.0, 0.55, rubber );
}`;
const COMMON = /* glsl */ `
varying vec4 vTwMarks;
varying vec3 vTwWorld;
${TRACKSIDE_NOISE_GLSL}
${TRACKSIDE_RUBBER_GLSL}`;
const VERTEX_COMMON = /* glsl */ `
attribute vec4 weathering;
varying vec4 vTwMarks;
varying vec3 vTwWorld;`;
const VERTEX = /* glsl */ `
vTwMarks = weathering;
vTwWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;`;

/** Shared marks: foot dirt and splash, tyre rubber on the track face, and
 * rain streaks below the top. Declares tw* terms read by the later blocks. */
const MARKS = /* glsl */ `
float twAlong = vTwMarks.x, twHeight = vTwMarks.y, twFace = vTwMarks.z;
vec2 twSt = vec2( twAlong, twHeight );
// Foot dirt: a wavering tide line, grass and grit splash just above it.
float twWear = vTwMarks.w;
float twTide = ${TRACKSIDE_WEATHERING.dirt.height.toFixed(3)} * ( 0.55 + 0.9 * twFiltered( vec2( twAlong * 0.9, 3.7 ) ) );
float twDirt = 1.0 - smoothstep( twTide * 0.35, twTide, twHeight );
float twSplash = twDots( twSt * vec2( 34.0, 38.0 ), 0.22, 0.3 ) * twDetail( twSt * 34.0 ) * ( 1.0 - smoothstep( twTide, twTide * 2.4, twHeight ) );
twDirt = clamp( twDirt + twSplash * 0.6, 0.0, 1.0 );
// Tyre rubber, only on faces toward the track.
float twRubber = twRubberMarks( twAlong, twHeight, twWear ) * smoothstep( 0.2, 0.55, twFace );
// Rain: dark run-off streaks hanging from the top edge.
float twColumn = twFiltered( vec2( twAlong * 11.0, twHeight * 0.45 ) );
float twRun = twHash( vec2( floor( twAlong * 11.0 ), 5.0 ) );
// Each column runs down from the top for its own length.
float twStreak = smoothstep( 0.55, 0.8, twColumn ) * smoothstep( 0.3, 0.9, twRun ) * twDetail( vec2( twAlong * 11.0, 0.0 ) );
float twModule = twHash( vec2( floor( twAlong / ${TRACKSIDE_WEATHERING.module.toFixed(2)} ), sign( twFace ) + 3.0 ) );
float twMottle = twFiltered( twSt * vec2( 0.9, 1.6 ) + vTwWorld.xz * 0.05 ) * 0.65 + twFiltered( twSt * 6.1 ) * 0.35;
`;

const ALBEDO: Record<WeatheringKind, string> = {
  concrete: /* glsl */ `{
	// Pour-to-pour tone and mottle: no two modules quite the same grey.
	diffuseColor.rgb *= 0.86 * ( 0.9 + 0.17 * twModule ) * ( 0.88 + 0.24 * twMottle );
	diffuseColor.rgb *= mix( vec3( 1.0 ), vec3( 1.03, 1.0, 0.95 ), twModule );
	// Pores and blowholes in the face.
	float pores = twDots( twSt * 75.0 + vTwWorld.xz * 7.0, 0.1, 0.26 ) * twDetail( twSt * 75.0 );
	diffuseColor.rgb *= 1.0 - 0.3 * pores;
	// Streaks fade toward the foot; lime bloom pale, grime dark.
	float run = twStreak * ( 0.45 + 0.55 * smoothstep( 0.0, 0.7, twHeight ) );
	diffuseColor.rgb *= 1.0 - 0.34 * run;
	diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.6, 0.55, 0.47 ), twDirt * ${TRACKSIDE_WEATHERING.dirt.strength.toFixed(3)} );
	diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.03, 0.03, 0.032 ), twRubber * 0.85 );
}`,
  galvanised: /* glsl */ `{
	// Zinc spangle: centimetre crystals, each its own brightness.
	vec2 spangleCell = floor( twSt * 38.0 + vTwWorld.xz * 11.0 );
	float spangle = ( twHash( spangleCell ) - 0.5 ) * twDetail( twSt * 38.0 );
	// Weathered zinc: dull grey-white oxide patches over the bright coat.
	float oxide = smoothstep( 0.42, 0.78, twMottle * 0.7 + twModule * 0.3 );
	diffuseColor.rgb *= ( 0.84 + 0.1 * twModule ) * ( 1.0 + 0.12 * spangle );
	diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.47, 0.48, 0.47 ), oxide * 0.55 );
	// Rust bleeding from bolted joints at the module ends, running downward.
	float joint = abs( fract( twAlong / ${TRACKSIDE_WEATHERING.module.toFixed(2)} + 0.5 ) - 0.5 ) * ${TRACKSIDE_WEATHERING.module.toFixed(2)};
	float bleedHost = step( 0.55, twHash( vec2( floor( twAlong / ${TRACKSIDE_WEATHERING.module.toFixed(2)} + 0.5 ), 9.0 ) ) );
	float rustWidth = 0.08 + 0.12 * twFiltered( vec2( twAlong * 3.0, 1.0 ) );
	// Vertical, blotchy runs from the splice bolts.
	float rust = bleedHost * ( 1.0 - smoothstep( rustWidth * 0.4, rustWidth, joint ) ) * smoothstep( 0.42, 0.72, twFiltered( vec2( twAlong * 26.0, twHeight * 5.0 ) ) );
	rust = max( rust, smoothstep( 0.82, 0.95, twFiltered( twSt * vec2( 9.0, 11.0 ) ) ) * twDirt );
	twRust = clamp( rust, 0.0, 1.0 );
	diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.29, 0.13, 0.055 ), twRust * 0.85 );
	diffuseColor.rgb *= 1.0 - 0.18 * twStreak;
	diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.2, 0.17, 0.13 ), twDirt * 0.6 );
	diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.03, 0.03, 0.032 ), twRubber * 0.8 );
	twOxide = oxide;
	twSpangle = spangle;
}`,
  plastic: /* glsl */ `{
	// Rotomoulded polyethylene: sun-faded tops, scuffed and dirty faces.
	diffuseColor.rgb *= 0.93 + 0.08 * twModule + 0.04 * ( twMottle - 0.5 );
	float scuff = smoothstep( 0.72, 0.9, twFiltered( vec2( twAlong * 3.0, twHeight * 70.0 ) ) ) * twDetail( vec2( 0.0, twHeight * 70.0 ) ) * smoothstep( 0.1, 0.5, twFace );
	diffuseColor.rgb = mix( diffuseColor.rgb, vec3( dot( diffuseColor.rgb, vec3( 0.3, 0.59, 0.11 ) ) * 1.2 ), scuff * 0.5 );
	diffuseColor.rgb *= 1.0 - 0.12 * twStreak;
	diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.6, 0.55, 0.46 ), twDirt * 0.55 );
	diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.03, 0.03, 0.032 ), twRubber * 0.85 );
	twScuff = scuff;
}`,
};
const ROUGHNESS: Record<WeatheringKind, string> = {
  concrete: /* glsl */ `
	roughnessFactor = clamp( mix( roughnessFactor, 0.97, twDirt * 0.6 ) - 0.04 * twStreak, 0.0, 1.0 );
	roughnessFactor = mix( roughnessFactor, 0.62, twRubber );`,
  galvanised: /* glsl */ `
	// Aged galvanising is a dull, satin metal, never a mirror.
	roughnessFactor = clamp( max( roughnessFactor, 0.5 ) + 0.1 * twSpangle + 0.25 * twOxide, 0.0, 1.0 );
	roughnessFactor = mix( roughnessFactor, 0.9, max( twRust, twDirt * 0.8 ) );
	roughnessFactor = mix( roughnessFactor, 0.6, twRubber );`,
  plastic: /* glsl */ `
	roughnessFactor = clamp( roughnessFactor + 0.12 * twScuff + 0.2 * twDirt, 0.0, 1.0 );
	roughnessFactor = mix( roughnessFactor, 0.6, twRubber );`,
};
const METALNESS: Record<WeatheringKind, string> = {
  concrete: '',
  galvanised: /* glsl */ `
	metalnessFactor *= ( 1.0 - 0.4 * twOxide ) * ( 1.0 - max( twRust, max( twDirt * 0.7, twRubber ) ) );`,
  plastic: '',
};

export const TRACKSIDE_WEATHERING_HOOK = 'trackside-weathering-v1';
/** Install the weathering for one kit material. Every geometry drawn with it
 * must carry the `weathering` stream (`weatheringStream`). */
export function installTracksideWeathering(material: T.Material, kind: WeatheringKind) {
  return chainShaderHook(material, `${TRACKSIDE_WEATHERING_HOOK}-${kind}-v1`, (shader) => {
    injectAfter(shader, 'common', VERTEX_COMMON, 'vertex');
    injectAfter(shader, 'project_vertex', VERTEX, 'vertex');
    injectAfter(
      shader,
      'common',
      `${COMMON}\nfloat twRust = 0.0, twOxide = 0.0, twSpangle = 0.0, twScuff = 0.0;`,
      'fragment',
    );
    injectAfter(shader, 'map_fragment', MARKS + ALBEDO[kind], 'fragment');
    injectAfter(shader, 'roughnessmap_fragment', ROUGHNESS[kind], 'fragment');
    if (METALNESS[kind]) injectAfter(shader, 'metalnessmap_fragment', METALNESS[kind], 'fragment');
  });
}
