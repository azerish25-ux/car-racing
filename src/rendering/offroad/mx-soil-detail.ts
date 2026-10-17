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

export const MX_SOIL_DETAIL_HOOK = 'mx-groomed-soil-v1';

const DECLARATIONS = /* glsl */ `
varying vec4 vMxCourse;
float mxPreparedGroove = 0.0;
float mxPreparedRelief = 0.0;
float mxPreparedWet = 0.0;
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
`;

const COLOUR = /* glsl */ `{
  // Metres in the course frame: grading follows turns and jump faces. All
  // relief here is shading only (millimetres); the silhouette and collision
  // remain the same authoritative CourseTerrain, including live tyre ruts.
  vec2 p = vMxCourse.xy;
  float onSoil = vMxCourse.z;
  float wander = 0.08 * sin( p.y * 0.19 ) + 0.16 * sin( p.y * 0.045 );
  float furrowPhase = ( p.x + wander ) * 22.0;
  float rakeFade = 1.0 - smoothstep( 0.5, 2.2, fwidth( furrowPhase ) );
  float furrow = pow( 0.5 + 0.5 * cos( furrowPhase ), 8.0 ) * rakeFade;
  float lane = sin( p.y * 0.033 ) * 0.35 + vMxCourse.w * 0.55;
  float passA = exp( - pow( ( p.x - lane - 1.05 ) / 0.26, 2.0 ) );
  float passB = exp( - pow( ( p.x - lane + 0.7 ) / 0.30, 2.0 ) );
  float passC = exp( - pow( ( p.x - lane + 2.35 ) / 0.22, 2.0 ) );
  float tracks = max( passA, max( passB, passC ) );
  float broken = 0.5 + 0.5 * mxSoilNoise( vec2( p.x * 2.7, p.y * 0.9 ) );
  float treadPhase = p.y * 44.0 + sin( p.x * 30.0 ) * 0.7;
  float treadFade = 1.0 - smoothstep( 0.35, 1.8, fwidth( treadPhase ) );
  float tread = pow( 0.5 + 0.5 * cos( treadPhase ), 6.0 ) * tracks * treadFade;
  float broad = mxSoilNoise( p * vec2( 0.42, 0.065 ) );
  mxPreparedGroove = onSoil * ( furrow * 0.35 + tracks * broken * 0.6 );
  mxPreparedRelief = onSoil * ( 0.0036 * furrow - 0.0045 * tracks * broken + 0.0018 * tread );
  mxPreparedWet = clamp( vApexSoil.x + apexSoilWetness, 0.0, 1.0 );
  diffuseColor.rgb *= mix( 1.0, 0.93 + 0.12 * broad - 0.19 * mxPreparedGroove - 0.055 * tread, onSoil );
  // Small pale aggregates remain in exposed loam; water darkens grooves
  // rather than polishing the entire track into one broad mirror.
  diffuseColor.rgb *= 1.0 - mxPreparedGroove * smoothstep( 0.42, 0.88, mxPreparedWet ) * 0.13;
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
      `roughnessFactor = mix( roughnessFactor, max( 0.34, roughnessFactor * 0.62 ),
        mxPreparedGroove * smoothstep( 0.4, 0.92, mxPreparedWet ) );`,
      'fragment',
    );
  });
}
