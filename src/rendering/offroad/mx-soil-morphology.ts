import type * as T from 'three';
import { chainShaderHook, injectAfter, injectDeclarations } from '../studio/shader-hooks.ts';

/** Fractions of the existing, area-integrated course cells. Turf, asphalt
 * and gravel remain the remainder; no second soil classifier is invented. */
export const MX_SOIL_MORPHOLOGY_KINDS = ['hardpack', 'loam', 'sand', 'mud'] as const;
export const MX_SOIL_MORPHOLOGY_HOOK = 'mx-soil-morphology-v1';

const DECLARATIONS = /* glsl */ `
varying vec4 vMxSoilMix;
float mxMorphRelief = 0.0;
float mxMorphCavity = 0.0;
float mxMorphFilm = 0.0;
float mxMorphReservoir = 0.0;
// A compacted fragment has a broad angular top and a rounded crumbly edge.
// Jittered centres and unequal axes avoid a cobblestone/checkerboard grid.
// The support ends inside its cell; adjacent cells never make a height seam.
vec2 mxSoilFragment( vec2 p, float frequency ) {
  vec2 q = p * frequency;
  vec2 cell = floor( q );
  float seed = mxSoilHash( cell + 14.3 );
  vec2 centre = vec2( 0.5 ) + ( vec2( seed,
    mxSoilHash( cell + 37.1 ) ) - 0.5 ) * 0.32;
  vec2 local = fract( q ) - centre;
  float turn = seed * 6.2831853;
  local = mat2( cos( turn ), -sin( turn ), sin( turn ), cos( turn ) ) * local;
  local *= vec2( 1.05 + seed * 0.32, 0.95 + seed * 0.1 );
  float radius = 0.19 + seed * 0.095;
  float d = mix( length( local ),
    max( abs( local.x ) + abs( local.y ) * 0.28,
         abs( local.y ) + abs( local.x ) * 0.28 ), 0.7 );
  float footprint = max( length( fwidth( q ) ), 0.001 );
  float edge = 0.035 + footprint * 0.65;
  float top = 1.0 - smoothstep( radius * 0.38, radius + edge, d );
  float skirt = 1.0 - smoothstep( edge, edge + 0.045, abs( d - radius ) );
  float resolved = 1.0 - smoothstep( 0.22, 0.65, footprint );
  return vec2( top, skirt ) * resolved;
}
`;

const COLOUR = /* glsl */ `{
  vec4 soil = clamp( vMxSoilMix, 0.0, 1.0 );
  float onSoil = clamp( vMxCourse.z, 0.0, 1.0 );
  float gravel = max( 0.0, onSoil - dot( soil, vec4( 1.0 ) ) );
  vec2 p = vMxCourse.xy;
  float broad = mxSoilNoise( p * vec2( 0.7, 0.37 ) + 17.0 );
  float dry = 1.0 - smoothstep( 0.42, 0.85, mxPreparedWet );
  float loose = 1.0 - mxPreparedPacked * 0.8;
  // The same wheel pattern presses shallow marks in firm clay, deeper cuts
  // in loam and softer ridges in sand/mud. Only shading relief changes.
  mxPreparedRelief *= 1.0 - onSoil +
    dot( soil, vec4( 0.48, 1.0, 0.74, 0.8 ) ) + gravel * 0.52;
  vec2 clod = mxSoilFragment( p, 6.2 );
  vec2 chips = mxSoilFragment( p + vec2( 0.19, 0.73 ), 14.0 );

  // 044/054/058: worked loam breaks into angular crumbs; the swept hardpack
  // between passages exposes smaller chips. Sand has granular softness,
  // while wet mud carries rounded clod shoulders, not dry rake ridges.
  float clodAmount = soil.y * ( 0.48 + broad * 0.52 ) + soil.w * 0.72;
  float chipAmount = soil.x * dry * 0.75 + gravel * 0.9;
  float crumb = clod.x * clodAmount * loose;
  float chip = chips.x * chipAmount * ( 0.3 + loose * 0.7 );
  float pore = clod.y * clodAmount * loose + chips.y * chipAmount * 0.45;
  float grainFade = 1.0 - smoothstep( 0.018, 0.075, length( fwidth( p ) ) );
  float sandGrain = ( mxSoilNoise( p * 32.0 + 4.8 ) - 0.5 ) * grainFade * soil.z;
  mxMorphRelief = crumb * 0.011 + chip * 0.0035 + sandGrain * 0.002
    - pore * 0.0018;
  mxMorphCavity = clamp( pore * 0.7 + crumb * 0.18, 0.0, 1.0 );
  diffuseColor.rgb *= 1.0 + crumb * 0.055 + chip * 0.07 + sandGrain * 0.08;

  // 043/059: water collects between fragments and in compacted ruts on
  // flatter earth. A steep launch face drains instead of becoming a mirror.
  // This normal comes from the actual, possibly deformed receiver triangle.
  vec3 face = cross( dFdx( vApexWorld ), dFdy( vApexWorld ) );
  float up = abs( face.y ) / max( length( face ), 1e-8 );
  float retention = smoothstep( 0.82, 0.985, up );
  float holding = dot( soil, vec4( 0.55, 0.82, 0.12, 1.0 ) ) + gravel * 0.16;
  float hollows = clamp( mxPreparedGroove * 0.72 +
    smoothstep( 0.022, 0.095, vApexSoil.z ) * 0.45 +
    smoothstep( 0.54, 0.77, broad ) * loose * 0.38, 0.0, 1.0 );
  mxMorphReservoir = holding * ( 0.06 + retention * hollows * 0.94 );
  float water = max( mxPreparedWet, clamp( apexSurfaceWetness * apexWetAmount, 0.0, 1.0 ) );
  mxMorphFilm = smoothstep( 0.58, 0.96, water ) * mxMorphReservoir;
  mxMorphRelief *= 1.0 - mxMorphFilm * 0.78;
}`;

const NORMAL = /* glsl */ `{
  vec3 dx = dFdx( -vViewPosition ), dy = dFdy( -vViewPosition );
  vec3 r1 = cross( dy, normal ), r2 = cross( normal, dx );
  float determinant = dot( dx, r1 );
  vec3 gradient = sign( determinant ) *
    ( dFdx( mxMorphRelief ) * r1 + dFdy( mxMorphRelief ) * r2 );
  normal = normalize( max( abs( determinant ), 1e-8 ) * normal - gradient );
  // Filling pores smooths the underlying scanned/groomed relief too.
  normal = normalize( mix( normal, nonPerturbedNormal, mxMorphFilm * 0.62 ) );
}`;

/** Material morphology follows the same source fractions as the terrain's
 * color, moisture and photographed layers. The already installed groomed
 * soil supplies wheel passages and hash/noise. No samplers, geometry, draws
 * or time state are added; centimetre relief is derivative-filtered shading. */
export function installMxSoilMorphology(material: T.MeshPhysicalMaterial) {
  return chainShaderHook(material, MX_SOIL_MORPHOLOGY_HOOK, (shader) => {
    injectDeclarations(
      shader,
      'common',
      'attribute vec4 mxSoilMix;\nvarying vec4 vMxSoilMix;',
      'vertex',
    );
    injectAfter(shader, 'begin_vertex', 'vMxSoilMix = mxSoilMix;', 'vertex');
    injectAfter(shader, 'common', DECLARATIONS, 'fragment');
    injectAfter(shader, 'color_fragment', COLOUR, 'fragment');
    injectAfter(shader, 'normal_fragment_maps', NORMAL, 'fragment');
    injectAfter(
      shader,
      'roughnessmap_fragment',
      `roughnessFactor = mix( roughnessFactor, max( 0.88, roughnessFactor ),
        vMxSoilMix.z * ( 1.0 - mxMorphFilm ) * 0.65 );
      roughnessFactor = mix( roughnessFactor, max( 0.23, roughnessFactor * 0.6 ), mxMorphFilm );`,
      'fragment',
    );
    injectAfter(
      shader,
      'lights_physical_fragment',
      `#ifdef USE_CLEARCOAT
      material.clearcoat = mix( material.clearcoat,
        max( material.clearcoat * mxMorphReservoir, mxMorphFilm ), clamp( vMxCourse.z, 0.0, 1.0 ) );
      material.clearcoatRoughness = mix( material.clearcoatRoughness,
        min( 1.0, 0.09 + geometryRoughness ), mxMorphFilm );
      #endif`,
      'fragment',
    );
    injectAfter(
      shader,
      'aomap_fragment',
      `reflectedLight.indirectDiffuse *= 1.0 - mxMorphCavity * 0.22;
      reflectedLight.indirectSpecular *= 1.0 - mxMorphCavity * 0.16;`,
      'fragment',
    );
  });
}
