import type * as T from 'three';
import { chainShaderHook, injectAfter } from './studio/shader-hooks.ts';

/**
 * Facade weathering for venue architecture (pit building, grandstands,
 * service buildings, districts).
 *
 * Buildings that have stood through a few seasons carry rain run-off streaks
 * down every wall, broad patches of grime and sun-bleach that break a repeated
 * material into individual panels, and (where the ground level is known) a
 * dark splash band at the foot. All of it is procedural in metres on the wall
 * plane, so it survives spatial batching and never tiles with a texture.
 *
 * `space`: 'object' reads the mesh's own coordinates (an authored building
 * whose origin sits on its floor, `ground` metres being floor level); 'world'
 * reads world coordinates for batched geometry, where the floor is unknown and
 * the foot band is omitted. Fine features converge to their mean once a pixel
 * spans them. No textures, no extra draws.
 */
export type FacadeKind = 'concrete' | 'stone' | 'cladding' | 'metal' | 'paint' | 'timber';
export const FACADE_WEATHERING = Object.freeze({
  /** Darkening of streaks, broad grime variation and the foot band per kind. */
  strength: Object.freeze({
    concrete: Object.freeze({ streak: 0.24, grime: 0.16, foot: 0.5 }),
    stone: Object.freeze({ streak: 0.18, grime: 0.14, foot: 0.45 }),
    cladding: Object.freeze({ streak: 0.12, grime: 0.08, foot: 0.32 }),
    metal: Object.freeze({ streak: 0.12, grime: 0.1, foot: 0.3 }),
    paint: Object.freeze({ streak: 0.12, grime: 0.1, foot: 0.32 }),
    timber: Object.freeze({ streak: 0.14, grime: 0.14, foot: 0.4 }),
  }),
  /** Foot splash band height, metres. */
  foot: 0.7,
});

const VERTEX_COMMON = /* glsl */ `
varying vec3 vFacadePos;
varying vec3 vFacadeNormal;`;
const vertex = (space: 'object' | 'world') => /* glsl */ `
{
	vec4 facadePosition = vec4( transformed, 1.0 );
	vec3 facadeNormal = objectNormal;
	#ifdef USE_INSTANCING
	facadePosition = instanceMatrix * facadePosition;
	facadeNormal = mat3( instanceMatrix ) * facadeNormal;
	#endif
	${space === 'world' ? 'facadePosition = modelMatrix * facadePosition;' : ''}
	vFacadePos = facadePosition.xyz;
	vFacadeNormal = mat3( modelMatrix ) * facadeNormal;
}`;
const FRAGMENT_COMMON = /* glsl */ `
varying vec3 vFacadePos;
varying vec3 vFacadeNormal;
float fwHash( vec2 p ) { p = fract( p * vec2( 233.34, 851.73 ) ); p += dot( p, p + 23.45 ); return fract( p.x * p.y ); }
float fwNoise( vec2 p ) {
	vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( fwHash( i ), fwHash( i + vec2( 1, 0 ) ), f.x ), mix( fwHash( i + vec2( 0, 1 ) ), fwHash( i + vec2( 1, 1 ) ), f.x ), f.y );
}
float fwResolved( vec2 p ) {
	return 1.0 - smoothstep( 0.4, 1.2, max( length( dFdx( p ) ), length( dFdy( p ) ) ) );
}
float fwFiltered( vec2 p ) { return mix( 0.5, fwNoise( p ), fwResolved( p ) ); }`;
const fragment = (kind: FacadeKind, foot: boolean, ground: number) => {
  const s = FACADE_WEATHERING.strength[kind];
  return /* glsl */ `
float fwStreak = 0.0, fwFoot = 0.0, fwGrime = 0.5;
{
	// The wall plane: horizontal metres along the wall, height up it.
	vec3 n = normalize( vFacadeNormal );
	float wall = 1.0 - smoothstep( 0.35, 0.75, abs( n.y ) );
	vec2 q = vec2( abs( n.x ) > abs( n.z ) ? vFacadePos.z : vFacadePos.x, vFacadePos.y );
	// Run-off: narrow columns of varying length and darkness down the wall.
	vec2 columnUv = vec2( q.x * 2.6, q.y * 0.21 + fwHash( vec2( floor( q.x * 2.6 ), 3.0 ) ) * 9.0 );
	fwStreak = smoothstep( 0.56, 0.86, fwFiltered( columnUv ) ) * fwResolved( vec2( q.x * 2.6, 0.0 ) ) * wall;
	fwStreak *= 0.45 + 0.55 * fwFiltered( vec2( q.x * 0.6, q.y * 0.35 ) );
	// Broad grime and bleach, panel to panel.
	fwGrime = fwFiltered( vFacadePos.xz * 0.11 + vec2( vFacadePos.y * 0.07 ) ) * 0.7 + fwFiltered( q * 0.9 ) * 0.3;
	${
    foot
      ? `float tide = ${FACADE_WEATHERING.foot.toFixed(3)} * ( 0.5 + 0.9 * fwFiltered( vec2( q.x * 0.8, 7.0 ) ) );
	fwFoot = ( 1.0 - smoothstep( tide * 0.25, tide, vFacadePos.y - ${ground.toFixed(3)} ) ) * wall;`
      : ''
  }
	diffuseColor.rgb *= ( 1.0 - ${s.streak.toFixed(3)} * fwStreak ) * ( 1.0 + ${s.grime.toFixed(3)} * ( fwGrime - 0.5 ) * 2.0 );
	diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.6, 0.55, 0.48 ), fwFoot * ${s.foot.toFixed(3)} );
}`;
};
const ROUGHNESS = /* glsl */ `
roughnessFactor = clamp( roughnessFactor + 0.06 * fwStreak + 0.12 * fwFoot + 0.05 * ( fwGrime - 0.5 ), 0.0, 1.0 );`;

export const FACADE_WEATHERING_HOOK = 'facade-weathering-v1';
export function installFacadeWeathering(
  material: T.Material,
  kind: FacadeKind,
  space: 'object' | 'world' = 'world',
  ground?: number,
) {
  const foot = space === 'object' && ground !== undefined && Number.isFinite(ground);
  return chainShaderHook(material, `${FACADE_WEATHERING_HOOK}-${kind}-${space}-v1`, (shader) => {
    injectAfter(shader, 'common', VERTEX_COMMON, 'vertex');
    injectAfter(shader, 'project_vertex', vertex(space), 'vertex');
    injectAfter(shader, 'common', FRAGMENT_COMMON, 'fragment');
    injectAfter(shader, 'color_fragment', fragment(kind, foot, ground ?? 0), 'fragment');
    injectAfter(shader, 'roughnessmap_fragment', ROUGHNESS, 'fragment');
  });
}
