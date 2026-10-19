import type * as T from 'three';
import type { SoilKind } from '../../simulation/offroad/course.ts';
import { chainShaderHook, injectAfter, injectDeclarations } from '../studio/shader-hooks.ts';

/** Prepared motocross soil: warm clay, mineral sand and cooler damp loam.
 * The existing scanned maps supply grain/roughness. These sRGB base colours
 * are decoded once by Three, preserving readable mineral tones in shade. */
export const MX_SOIL_COLOURS: Readonly<Record<SoilKind, number>> = Object.freeze({
  hardpack: 0x9b7652,
  loam: 0x826247,
  sand: 0xb29a70,
  mud: 0x594432,
  gravel: 0x8d857a,
  asphalt: 0x4b4c4d,
  turf: 0x627044,
});

export const MX_SOIL_DETAIL_HOOK = 'mx-groomed-soil-v2';

const DECLARATIONS = /* glsl */ `
varying vec4 vMxCourse;
float mxPreparedGroove = 0.0;
float mxPreparedRelief = 0.0;
float mxPreparedWet = 0.0;
float mxPreparedPacked = 0.0;
float mxPreparedAggregate = 0.0;
float mxSoilHash( vec2 p ) {
  vec3 q = fract( vec3( p.xyx ) * 0.1031 );
  q += dot( q, q.yzx + 33.33 );
  return fract( ( q.x + q.y ) * q.z );
}
float mxSoilNoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( mxSoilHash( i ), mxSoilHash( i + vec2( 1.0, 0.0 ) ), f.x ),
              mix( mxSoilHash( i + vec2( 0.0, 1.0 ) ), mxSoilHash( i + 1.0 ), f.x ), f.y );
}
// Each wheel passage has a separate wandering centre, interrupted pressure
// and raised loose lips. Widths are in metres, never screen-sized stripes.
vec3 mxWheelPass( vec2 p, float offset, float seed, float corner, float pixel ) {
  float drift = ( mxSoilNoise( vec2( p.y * 0.047, seed ) ) - 0.5 ) * 0.72;
  float centre = offset + drift + 0.09 * sin( p.y * 0.17 + seed )
    + corner * ( 0.38 + offset * 0.09 );
  float d = abs( p.x - centre );
  float width = 0.105 + 0.045 * mxSoilNoise( vec2( p.y * 0.24, seed + 8.0 ) );
  float pressure = 0.28 + 0.72 * smoothstep( 0.18, 0.72,
    mxSoilNoise( vec2( p.y * 0.31, seed + 3.0 ) ) );
  float core = 1.0 - smoothstep( width * 0.25, width + pixel, d );
  float lip = 1.0 - smoothstep( width * 0.24, width * 0.78 + pixel,
    abs( d - width * 1.65 ) );
  float pass = 1.0 - smoothstep( 0.22, 0.62 + pixel, d );
  return vec3( core, lip, pass ) * pressure;
}
`;

const COLOUR = /* glsl */ `{
  // References 042/046/047/050: overlapping tyre passages, interrupted rake
  // marks, pale loose lips and broad compacted patches. This centimetre-scale
  // relief is shading only; CourseTerrain still owns silhouette and collision.
  vec2 p = vMxCourse.xy;
  float onSoil = clamp( vMxCourse.z, 0.0, 1.0 );
  float pixel = max( fwidth( p.x ), 0.001 );
  vec3 passes = mxWheelPass( p, -2.55, 1.3, vMxCourse.w, pixel );
  passes = max( passes, mxWheelPass( p, -1.15, 5.7, vMxCourse.w, pixel ) );
  passes = max( passes, mxWheelPass( p, 0.24, 12.1, vMxCourse.w, pixel ) );
  passes = max( passes, mxWheelPass( p, 1.57, 18.6, vMxCourse.w, pixel ) );
  passes = max( passes, mxWheelPass( p, 2.83, 24.4, vMxCourse.w, pixel ) );
  float broad = mxSoilNoise( p * vec2( 0.3, 0.085 ) );
  float broken = mxSoilNoise( p * vec2( 2.1, 0.67 ) );
  float wander = 0.045 * sin( p.y * 0.24 ) + ( broad - 0.5 ) * 0.16;
  float rakePhase = ( p.x + wander ) * 5.6;
  float rakeWidth = fwidth( rakePhase );
  float rake = ( 1.0 - smoothstep( 0.045, 0.16 + rakeWidth,
    abs( fract( rakePhase ) - 0.5 ) ) )
    * ( 1.0 - smoothstep( 0.32, 0.9, rakeWidth ) );
  // Each tyre leaves discrete cleat presses, not an unbroken sinusoid.
  vec2 cleat = vec2( p.x * 13.0, p.y * 8.2 );
  float cleatWidth = fwidth( cleat.y );
  float stagger = step( 0.5, fract( cleat.x * 0.5 ) ) * 0.5;
  float tread = ( 1.0 - smoothstep( 0.1, 0.25 + cleatWidth,
    abs( fract( cleat.y + stagger ) - 0.5 ) ) ) * passes.x
    * ( 1.0 - smoothstep( 0.3, 0.85, cleatWidth ) );
  float aggregateFade = 1.0 - smoothstep( 0.035, 0.12, length( fwidth( p ) ) );
  float aggregate = smoothstep( 0.63, 0.84, mxSoilNoise( p * 19.0 ) ) * aggregateFade;
  mxPreparedPacked = onSoil * clamp( passes.z * ( 0.55 + broad * 0.45 )
    + vApexSoil.y * 0.45, 0.0, 1.0 );
  mxPreparedAggregate = onSoil * aggregate * ( 1.0 - mxPreparedPacked * 0.65 );
  mxPreparedGroove = onSoil * clamp( passes.x + vApexSoil.z * 5.0, 0.0, 1.0 );
  float rakeUnridden = rake * ( 1.0 - passes.z * 0.88 ) * ( 0.35 + broken * 0.65 );
  mxPreparedRelief = onSoil * ( 0.0045 * rakeUnridden
    - 0.019 * passes.x + 0.0075 * passes.y + 0.0025 * tread )
    + 0.003 * mxPreparedAggregate;
  mxPreparedWet = clamp( vApexSoil.x + apexSoilWetness, 0.0, 1.0 );
  float grainTone = 0.92 + 0.15 * broad + 0.045 * broken;
  diffuseColor.rgb *= mix( 1.0, grainTone, onSoil )
    * ( 1.0 - mxPreparedPacked * 0.10 - mxPreparedGroove * 0.20
      + onSoil * passes.y * 0.075 + mxPreparedAggregate * 0.13 - tread * 0.035 );
  // 043/059/092: wet loam reflects chiefly along its depressions. Dry raised
  // aggregate remains rough; the complete course never becomes one mirror.
  float dampPatch = smoothstep( 0.38, 0.86, mxPreparedWet )
    * ( 0.62 + 0.38 * smoothstep( 0.25, 0.8, broad ) );
  diffuseColor.rgb *= 1.0 - mxPreparedGroove * dampPatch * 0.18;
}`;

const NORMAL = /* glsl */ `{
  vec3 dpdx = dFdx( -vViewPosition );
  vec3 dpdy = dFdy( -vViewPosition );
  vec3 r1 = cross( dpdy, normal ), r2 = cross( normal, dpdx );
  float determinant = dot( dpdx, r1 );
  vec3 gradient = sign( determinant ) *
    ( dFdx( mxPreparedRelief ) * r1 + dFdy( mxPreparedRelief ) * r2 );
  normal = normalize( max( abs( determinant ), 1e-8 ) * normal - gradient );
}`;

/** Adds directional rake and tread marks without geometry displacement or
 * textures/draw calls. The course mesh supplies (lateral m, station m,
 * dirt mask, corner hand); scanned soil and replay deformation stay intact. */
export function installMxSoilDetail(material: T.MeshPhysicalMaterial) {
  return chainShaderHook(material, MX_SOIL_DETAIL_HOOK, (shader) => {
    injectDeclarations(
      shader,
      'common',
      'attribute vec4 mxCourse;\nvarying vec4 vMxCourse;',
      'vertex',
    );
    injectAfter(shader, 'begin_vertex', 'vMxCourse = mxCourse;', 'vertex');
    injectAfter(shader, 'common', DECLARATIONS, 'fragment');
    injectAfter(shader, 'color_fragment', COLOUR, 'fragment');
    injectAfter(shader, 'normal_fragment_maps', NORMAL, 'fragment');
    injectAfter(
      shader,
      'roughnessmap_fragment',
      `roughnessFactor = mix( roughnessFactor,
        clamp( roughnessFactor * 0.78, 0.58, 0.9 ), mxPreparedPacked * 0.45 );
      roughnessFactor = mix( roughnessFactor, max( 0.29, roughnessFactor * 0.52 ),
        mxPreparedGroove * smoothstep( 0.42, 0.94, mxPreparedWet ) );
      roughnessFactor = mix( roughnessFactor, max( 0.86, roughnessFactor ),
        mxPreparedAggregate * 0.45 );`,
      'fragment',
    );
  });
}
