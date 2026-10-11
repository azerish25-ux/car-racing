import * as T from 'three';
import { chainShaderHook, injectAfter, injectDeclarations } from './shader-hooks.ts';

/**
 * Driver look (D16 characters-driver): per-team helmets, an iridescent visor,
 * team suits and gloves, all procedural (no image assets, no real marks).
 *
 * Helmet (r 0.25, coat 1 / 0.03) in the helmet shell's local frame
 * (x across, y up, +z forward): team primary crown, a secondary side flash
 * that sweeps back from the visor, an accent centre stripe, a secondary chin
 * bar and an exposed-carbon panel at the nape.
 * Visor: #0b1014 at r 0.04 with thin-film iridescence (IOR 1.8, 280-620 nm),
 * a 1 / 0.015 clear coat and a strong environment response.
 * Suits: MeshPhysical with sheen (roughness 0.58, colour 0.6× the suit).
 */
export interface DriverDesign {
  primary: T.ColorRepresentation;
  secondary: T.ColorRepresentation;
  accent: T.ColorRepresentation;
}

export const HELMET = Object.freeze({ roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.03 });
export const VISOR = Object.freeze({
  color: 0x0b1014,
  roughness: 0.04,
  iridescence: 1,
  iridescenceIOR: 1.8,
  thickness: Object.freeze([280, 620] as const),
  clearcoat: 1,
  clearcoatRoughness: 0.015,
  envMapIntensity: 2.5,
});
export const SUIT_SHEEN = Object.freeze({ sheen: 1, roughness: 0.58, colour: 0.6 });
export const GLOVE_SHEEN = Object.freeze({ sheen: 0.3, palmRoughness: 0.85 });

const HELMET_GLSL = /* glsl */ `{
	// D16 team helmet: primary shell, a secondary crown ring and side sweep with
	// accent pinstripes, an accent centre stripe, a dark brow (sponsor) strip
	// above the eye port, a secondary chin bar with intake slots, carbon nape.
	vec3 h = vHelmetLocal;
	float aa = max( fwidth( h.y ), 1e-4 ) * 1.5;
	float ax = abs( h.x );
	vec3 paint = helmetPrimary;
	// Crown ring: a band around the upper shell, open at the front.
	float ringY = h.y - 0.012 * smoothstep( 0.0, -0.12, h.z );
	float ring = smoothstep( 0.074 - aa, 0.074 + aa, ringY ) * ( 1.0 - smoothstep( 0.098 - aa, 0.098 + aa, ringY ) );
	// Side sweep: from the chin bar, rising toward the rear spoiler.
	float flashLine = h.y + 0.32 * h.z;
	float flash = smoothstep( -0.068 - aa, -0.068 + aa, flashLine ) * ( 1.0 - smoothstep( -0.024 - aa, -0.024 + aa, flashLine ) );
	paint = mix( paint, helmetSecondary, max( ring, flash ) );
	float pin = max(
		max( 1.0 - smoothstep( 0.0018, 0.0018 + aa, abs( flashLine + 0.068 ) ), 1.0 - smoothstep( 0.0018, 0.0018 + aa, abs( flashLine + 0.024 ) ) ),
		max( 1.0 - smoothstep( 0.0018, 0.0018 + aa, abs( ringY - 0.074 ) ), 1.0 - smoothstep( 0.0018, 0.0018 + aa, abs( ringY - 0.098 ) ) ) * step( 0.01, h.y ) );
	paint = mix( paint, helmetAccent, pin );
	// Accent centre stripe over the crown, outlined in the secondary colour.
	float crownOn = smoothstep( 0.0, 0.02, h.y + 0.25 * max( - h.z, 0.0 ) );
	float stripe = ( 1.0 - smoothstep( 0.016 - aa, 0.016 + aa, ax ) ) * crownOn;
	float outline = ( 1.0 - smoothstep( 0.021 - aa, 0.021 + aa, ax ) ) * crownOn;
	paint = mix( paint, helmetSecondary, outline );
	paint = mix( paint, helmetAccent, stripe );
	// Dark brow strip above the eye port with a light wordmark-like bar.
	float brow = smoothstep( 0.045 - aa, 0.045 + aa, h.y ) * ( 1.0 - smoothstep( 0.062 - aa, 0.062 + aa, h.y ) ) * smoothstep( 0.05, 0.08, h.z ) * ( 1.0 - smoothstep( 0.075, 0.095, ax ) );
	paint = mix( paint, vec3( 0.018, 0.02, 0.024 ), brow );
	float word = brow * ( 1.0 - smoothstep( 0.0025, 0.0025 + aa, abs( h.y - 0.0535 ) ) ) * ( 1.0 - smoothstep( 0.03, 0.032, ax ) ) * step( 0.5, fract( h.x * 180.0 ) + 0.3 );
	paint = mix( paint, vec3( 0.86 ), word );
	float chin = ( 1.0 - smoothstep( -0.07 - aa, -0.07 + aa, h.y ) ) * smoothstep( 0.02, 0.05, h.z );
	paint = mix( paint, helmetSecondary, chin );
	// Chin-bar intake slots.
	float slots = chin * smoothstep( 0.1, 0.12, h.z ) * ( 1.0 - smoothstep( 0.03, 0.034, ax ) )
		* ( 1.0 - smoothstep( 0.006, 0.006 + aa, abs( h.y + 0.094 ) ) ) * step( 0.45, fract( h.x * 110.0 ) );
	paint = mix( paint, vec3( 0.008, 0.009, 0.01 ), slots );
	float nape = ( 1.0 - smoothstep( -0.045 - aa, -0.045 + aa, h.y ) ) * ( 1.0 - smoothstep( -0.07, -0.05, h.z ) );
	vec2 twill = floor( ( h.xy + h.z * vec2( 0.3, 0.0 ) ) * 260.0 );
	float weave = mod( twill.x + twill.y, 2.0 );
	paint = mix( paint, vec3( 0.012, 0.013, 0.015 ) * ( 0.8 + 0.4 * weave ), nape );
	diffuseColor.rgb = paint;
}`;

/** Team helmet paint for a procedural helmet shell (`vHelmetLocal` in the shell frame). */
export function teamHelmetMaterial(design: DriverDesign, shellOrigin = new T.Vector3()) {
  const material = new T.MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: 0,
    ...HELMET,
  });
  material.name = 'Team helmet paint';
  const uniforms = {
    helmetPrimary: { value: new T.Color(design.primary) },
    helmetSecondary: { value: new T.Color(design.secondary) },
    helmetAccent: { value: new T.Color(design.accent) },
    // Where the shell's own origin sits in the (merged) geometry's frame.
    helmetOrigin: { value: shellOrigin.clone() },
  };
  chainShaderHook(material, 'team-helmet-v2', (shader) => {
    Object.assign(shader.uniforms, uniforms);
    injectDeclarations(
      shader,
      'common',
      'varying vec3 vHelmetLocal;\nuniform vec3 helmetOrigin;',
      'vertex',
    );
    injectAfter(shader, 'begin_vertex', 'vHelmetLocal = position - helmetOrigin;', 'vertex');
    injectDeclarations(
      shader,
      'common',
      'varying vec3 vHelmetLocal;\nuniform vec3 helmetPrimary;\nuniform vec3 helmetSecondary;\nuniform vec3 helmetAccent;',
      'fragment',
    );
    injectAfter(shader, 'color_fragment', HELMET_GLSL, 'fragment');
  });
  return { material, uniforms };
}

/** Apply the visor look to a physical material, keeping its blending flags. */
export function applyVisorLook(material: T.MeshPhysicalMaterial) {
  material.color.setHex(VISOR.color);
  material.roughness = VISOR.roughness;
  material.metalness = 0;
  material.iridescence = VISOR.iridescence;
  material.iridescenceIOR = VISOR.iridescenceIOR;
  material.iridescenceThicknessRange = [...VISOR.thickness];
  material.clearcoat = VISOR.clearcoat;
  material.clearcoatRoughness = VISOR.clearcoatRoughness;
  material.envMapIntensity = VISOR.envMapIntensity;
  material.needsUpdate = true;
  return material;
}
export function visorMaterial() {
  const material = new T.MeshPhysicalMaterial({ name: 'Iridescent team visor' });
  return applyVisorLook(material);
}

/** Procedural (rival) team visor: a dark smoked shield whose look comes from
 * the sky it reflects (strong clear coat, a faint iridium tint), with the
 * stacked tear-off films' edges and pull tabs at the left end. Uses the visor
 * patch UV (u across the shield, v up). The supplied driver keeps VISOR. */
export const RIVAL_VISOR = Object.freeze({
  color: 0x06080a,
  roughness: 0.03,
  iridescence: 0.35,
  clearcoat: 1,
  clearcoatRoughness: 0.01,
  envMapIntensity: 2.2,
});
export function rivalVisorMaterial() {
  const material = new T.MeshPhysicalMaterial({
    name: 'Smoked team visor with tear-offs',
    color: RIVAL_VISOR.color,
    roughness: RIVAL_VISOR.roughness,
    metalness: 0,
    iridescence: RIVAL_VISOR.iridescence,
    iridescenceIOR: 1.6,
    iridescenceThicknessRange: [300, 520],
    clearcoat: RIVAL_VISOR.clearcoat,
    clearcoatRoughness: RIVAL_VISOR.clearcoatRoughness,
    envMapIntensity: RIVAL_VISOR.envMapIntensity,
  });
  chainShaderHook(material, 'rival-visor-v1', (shader) => {
    injectDeclarations(shader, 'common', 'varying vec2 vVisorUv;', 'vertex');
    injectAfter(shader, 'begin_vertex', 'vVisorUv = uv;', 'vertex');
    injectDeclarations(shader, 'common', 'varying vec2 vVisorUv;', 'fragment');
    injectAfter(
      shader,
      'color_fragment',
      `{
	// Smoked shield, a touch darker toward the top (gradient tint).
	vec2 q = vVisorUv;
	diffuseColor.rgb *= mix( 1.0, 0.65, smoothstep( 0.4, 1.0, q.y ) );
	// Tear-off film edges: three faint stepped lines inset from each end.
	float px = max( fwidth( q.x ), 1e-4 );
	float films = 0.0;
	for ( int i = 0; i < 3; i ++ ) {
		float e = 0.035 + 0.012 * float( i );
		films = max( films, 1.0 - smoothstep( 0.0, px * 1.5, min( abs( q.x - e ), abs( q.x - ( 1.0 - e ) ) ) ) );
	}
	films *= smoothstep( 0.04, 0.12, q.y ) * ( 1.0 - smoothstep( 0.88, 0.96, q.y ) );
	diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.12, 0.13, 0.14 ), films * 0.6 );
	// Pull tabs at the left end of the stack (opaque, matte).
	float tabs = 0.0;
	for ( int i = 0; i < 3; i ++ ) {
		float c = 0.32 + 0.16 * float( i );
		tabs = max( tabs, ( 1.0 - smoothstep( 0.012, 0.012 + px, abs( q.x - 0.022 ) ) ) * ( 1.0 - smoothstep( 0.05, 0.06, abs( q.y - c ) ) ) );
	}
	diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.75, 0.76, 0.74 ), tabs );
	visorTab = tabs;
}`,
      'fragment',
    );
    injectDeclarations(shader, 'common', 'float visorTab;', 'fragment');
    injectAfter(
      shader,
      'roughnessmap_fragment',
      'roughnessFactor = mix( roughnessFactor, 0.6, visorTab );',
      'fragment',
    );
  });
  return material;
}

/** A team suit or glove fabric: MeshPhysical with sheen, sharing the woven maps. */
export function sheenFabric(
  source: T.MeshStandardMaterial,
  colour: T.ColorRepresentation,
  sheen: number = SUIT_SHEEN.sheen,
) {
  const material = new T.MeshPhysicalMaterial({
    name: source.name,
    color: colour,
    normalMap: source.normalMap,
    normalScale: source.normalScale.clone(),
    roughnessMap: source.roughnessMap,
    roughness: source.roughness,
    metalness: 0,
    sheen,
    sheenRoughness: SUIT_SHEEN.roughness,
    vertexColors: source.vertexColors,
  });
  material.sheenColor.set(colour).multiplyScalar(SUIT_SHEEN.colour);
  Object.assign(material.userData, source.userData);
  return material;
}

/**
 * Recolour the authored suit's vertex colours (a teal body, lighter teal
 * panels, near-black trim and off-white details) to a team kit: teal tones map
 * to the team primary scaled by their brightness, the darkest tones to the
 * team secondary; neutral details keep their colour.
 */
export function installSuitRecolour(material: T.Material, design: DriverDesign) {
  const uniforms = {
    suitPrimary: { value: new T.Color(design.primary) },
    suitSecondary: { value: new T.Color(design.secondary) },
  };
  chainShaderHook(material, 'team-suit-v1', (shader) => {
    Object.assign(shader.uniforms, uniforms);
    injectDeclarations(
      shader,
      'common',
      'uniform vec3 suitPrimary;\nuniform vec3 suitSecondary;',
      'fragment',
    );
    injectAfter(
      shader,
      'color_fragment',
      `#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
{
	// D16: authored teal suit panels become the team kit.
	float l = dot( vColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
	float teal = clamp( ( vColor.g - vColor.r ) * 9.0, 0.0, 1.0 );
	vec3 kit = mix( suitSecondary, suitPrimary * clamp( l / 0.18, 0.75, 1.35 ), smoothstep( 0.06, 0.14, l ) );
	diffuseColor.rgb = mix( diffuseColor.rgb, kit, teal );
}
#endif`,
      'fragment',
    );
  });
  return uniforms;
}

/** Hue (degrees) of a colour, for the glove-match acceptance check. */
export function hueDegrees(colour: T.ColorRepresentation) {
  const hsl = { h: 0, s: 0, l: 0 };
  new T.Color(colour).getHSL(hsl);
  return hsl.h * 360;
}
