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
const exposure = new WeakMap<T.Material, number>();
/** Authored roost exposure: helmet/eye protection stays cleaner than boots.
 * This is a presentation response to the recorded coat, not extra dirt state. */
export function tagMudExposure(material: T.Material, amount: number) {
  if (!Number.isFinite(amount) || amount < 0 || amount > 1)
    throw new RangeError('Invalid motocross mud exposure');
  exposure.set(material, amount);
}
const DECLARATIONS = /* glsl */ `
varying vec3 vOffroadMudPos;
uniform float offroadMud;
uniform float offroadMudWet;
uniform float offroadMudExposure;
float offroadMudHeight;
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
offroadMudHeight = 0.0;
if ( offroadMud * offroadMudExposure > 0.002 ) {
	float n = 0.67 * offroadMudNoise( vOffroadMudPos * 9.0 ) +
		0.25 * offroadMudNoise( vOffroadMudPos * 31.0 ) +
		0.08 * offroadMudNoise( vOffroadMudPos * 103.0 );
	// Lower parts (fenders, legs, sills) catch the roost first.
	float low = clamp( 0.6 - vOffroadMudPos.y, 0.0, 1.0 );
	// Never a uniform coat: at most ~80 % of a part, splattered from below.
	float cover = 0.8 * offroadMud * offroadMudExposure;
	float aa = clamp( fwidth( n ), 0.009, 0.1 );
	offroadMudMask = smoothstep( 1.0 - cover - aa, 1.10 - cover + aa, n + 0.3 * low * cover );
	// A thin powder film bridges separated splats; prints remain legible until
	// actual wet deposits cover them. Fine grains fade at a subpixel footprint.
	float footprint = length( fwidth( vOffroadMudPos ) );
	float resolved = 1.0 - smoothstep( 0.002, 0.012, footprint );
	float grain = offroadMudNoise( vOffroadMudPos * 370.0 );
	float film = offroadMud * offroadMudExposure * ( 0.035 + low * 0.13 ) * ( 1.0 - offroadMudWet * 0.7 );
	vec3 dust = vec3( 0.215, 0.157, 0.094 ), mud = vec3( 0.057, 0.038, 0.022 );
	vec3 earth = mix( dust, mud, offroadMudWet ) * ( 1.0 + ( grain - 0.5 ) * 0.18 * resolved );
	diffuseColor.rgb = mix( diffuseColor.rgb, dust, film );
	diffuseColor.rgb = mix( diffuseColor.rgb, earth, offroadMudMask * mix( 0.62, 0.94, offroadMudWet ) );
	offroadMudHeight = offroadMudMask * ( 0.55 + grain * 0.45 ) *
		mix( 0.00013, 0.00048, offroadMudWet ) * resolved;
}`;
const ROUGHNESS = /* glsl */ `
roughnessFactor = mix( roughnessFactor, mix( 0.96, 0.5, offroadMudWet ), offroadMudMask );`;
const NORMAL = /* glsl */ `
{
	vec3 dx = dFdx( -vViewPosition ), dy = dFdy( -vViewPosition );
	vec3 r1 = cross( dy, normal ), r2 = cross( normal, dx );
	float det = dot( dx, r1 );
	vec3 gradient = sign( det ) * ( dFdx( offroadMudHeight ) * r1 + dFdy( offroadMudHeight ) * r2 );
	normal = normalize( max( abs( det ), 1.e-10 ) * normal - gradient );
}`;
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
  const installed = chainShaderHook(material, 'offroad-mud-v2', (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.uniforms.offroadMudExposure = { value: exposure.get(material) ?? 1 };
    injectDeclarations(shader, 'common', 'varying vec3 vOffroadMudPos;', 'vertex');
    injectAfter(shader, 'begin_vertex', 'vOffroadMudPos = position;', 'vertex');
    injectDeclarations(shader, 'common', DECLARATIONS, 'fragment');
    injectAfter(shader, 'color_fragment', COLOR, 'fragment');
    injectAfter(shader, 'roughnessmap_fragment', ROUGHNESS, 'fragment');
    injectAfter(shader, 'normal_fragment_maps', NORMAL, 'fragment');
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
