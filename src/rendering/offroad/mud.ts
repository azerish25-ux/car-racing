import * as T from 'three';
import { chainShaderHook, injectAfter, injectDeclarations } from '../studio/shader-hooks.ts';

/** Mud and dust carried by a machine and its rider (WP41 presentation): a
 * per-entrant coat amount (snapshot O.MUD, 0..1) and wetness (O.MOISTURE)
 * drive a splatter mask in each part's own frame, heavier low down, that
 * turns paint, plastics and kit to matte earth. Presentation only. */
export interface MudUniforms {
  offroadMud: T.IUniform<number>;
  offroadMudWet: T.IUniform<number>;
}
export function mudUniforms(): MudUniforms {
  return { offroadMud: { value: 0 }, offroadMudWet: { value: 0 } };
}
const DECLARATIONS = /* glsl */ `
varying vec3 vOffroadMudPos;
uniform float offroadMud;
uniform float offroadMudWet;
float offroadMudHash( vec3 p ) {
	p = fract( p * 0.3183099 + 0.1 );
	p *= 17.0;
	return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
}
float offroadMudNoise( vec3 x ) {
	vec3 i = floor( x ), f = fract( x );
	f = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( mix( offroadMudHash( i ), offroadMudHash( i + vec3( 1, 0, 0 ) ), f.x ),
			mix( offroadMudHash( i + vec3( 0, 1, 0 ) ), offroadMudHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
		mix( mix( offroadMudHash( i + vec3( 0, 0, 1 ) ), offroadMudHash( i + vec3( 1, 0, 1 ) ), f.x ),
			mix( offroadMudHash( i + vec3( 0, 1, 1 ) ), offroadMudHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
}`;
const COLOR = /* glsl */ `
float offroadMudMask = 0.0;
if ( offroadMud > 0.002 ) {
	float n = 0.65 * offroadMudNoise( vOffroadMudPos * 9.0 ) + 0.35 * offroadMudNoise( vOffroadMudPos * 31.0 );
	// Lower parts (fenders, legs, sills) catch the roost first.
	float low = clamp( 0.6 - vOffroadMudPos.y, 0.0, 1.0 );
	offroadMudMask = smoothstep( 1.0 - offroadMud, 1.18 - offroadMud, n + 0.35 * low * offroadMud );
	// Dry dust is pale and fine; wet mud dark and clumped.
	vec3 dust = vec3( 0.33, 0.27, 0.2 ), mud = vec3( 0.085, 0.06, 0.04 );
	diffuseColor.rgb = mix( diffuseColor.rgb, mix( dust, mud, offroadMudWet ), offroadMudMask * 0.92 );
}`;
const ROUGHNESS = /* glsl */ `
roughnessFactor = mix( roughnessFactor, mix( 0.96, 0.62, offroadMudWet ), offroadMudMask );`;
const COAT = /* glsl */ `
#ifdef USE_CLEARCOAT
material.clearcoat *= 1.0 - offroadMudMask;
#endif`;
const METAL = /* glsl */ `
metalnessFactor *= 1.0 - offroadMudMask;`;
/** Install the coat on one material (idempotent per material). Materials
 * shared between entrants share the first installer's amount. */
export function installMud(material: T.Material, uniforms: MudUniforms) {
  if (!(material instanceof T.MeshStandardMaterial)) return false;
  const installed = chainShaderHook(material, 'offroad-mud-v1', (shader) => {
    Object.assign(shader.uniforms, uniforms);
    injectDeclarations(shader, 'common', 'varying vec3 vOffroadMudPos;', 'vertex');
    injectAfter(shader, 'begin_vertex', 'vOffroadMudPos = position;', 'vertex');
    injectDeclarations(shader, 'common', DECLARATIONS, 'fragment');
    injectAfter(shader, 'color_fragment', COLOR, 'fragment');
    injectAfter(shader, 'roughnessmap_fragment', ROUGHNESS, 'fragment');
    injectAfter(shader, 'metalnessmap_fragment', METAL, 'fragment');
    injectAfter(shader, 'lights_physical_fragment', COAT, 'fragment');
  });
  if (installed) material.needsUpdate = true;
  return installed;
}
/** Install on every mesh material under `root`. */
export function installMudOn(root: T.Object3D, uniforms: MudUniforms) {
  root.traverse((o) => {
    if (!(o instanceof T.Mesh)) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) installMud(m, uniforms);
  });
}
