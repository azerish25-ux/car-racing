import * as T from 'three';
import { carbonMaterial, CARBON_FINISHES } from '../materials.ts';
import { chainShaderHook, injectAfter, injectDeclarations } from '../studio/shader-hooks.ts';
import { studioUniforms, useStudioUniforms } from '../studio/studio-frame.ts';
import { installSsrMask } from '../ultra/ssr-mask.ts';
import { RIPPLE_GLSL } from './ripples.ts';
import { ALBEDO_SCALE, ProceduralTextures, type ProceduralRecipe } from './procedural.ts';

/**
 * Shared physically based material library (masterplan §17.5).
 *
 * One scale/roughness convention for every department: albedo is linear
 * reflectance, roughness is perceptual GGX roughness, detail maps tile per
 * metre of UV (`metresPerTile`). Detail normals come from GPU-baked recipes
 * (procedural.ts) - nothing is downloaded. Glossy opaque finishes opt into the
 * ULTRA screen-space reflection mask; on every other preset that mask writes
 * nothing. Factories return ordinary three.js materials: callers own and
 * dispose them like any other.
 *
 * Usage (procedural car bodies, bikes, venue kits):
 *   import { materials } from '../rendering/materials/index.ts';
 *   const body = materials.carPaint({ color: 0xc81e1e, flake: 0.6 });
 *   const floor = materials.carbon();
 *   const tyre = materials.rubber();
 *   const visor = materials.glass({ tint: 0x9fb4c8 });
 *   const road = materials.asphalt({ variant: 'worn' });
 * Geometry without UVs can take box-projected metre UVs: `boxProjectUv(geometry)`.
 */

export const textures = new ProceduralTextures();

/** Shared surface weather (written once per frame by the ULTRA pipeline, or by
 * `setSurfaceWeather` for a standalone scene). Bound by identity. */
export const surfaceWeather = Object.freeze({
  /** Surface water 0 (dry) .. 1 (standing water across the low spots). */
  apexSurfaceWetness: { value: 0 } as T.IUniform<number>,
  /** Rainfall 0 .. 1 (drives ripples). */
  apexSurfaceRain: { value: 0 } as T.IUniform<number>,
});
export function setSurfaceWeather(wetness: number, rain: number) {
  const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(Math.max(v, 0), 1) : 0);
  surfaceWeather.apexSurfaceWetness.value = clamp01(wetness);
  surfaceWeather.apexSurfaceRain.value = clamp01(rain);
}

/** Wet-surface response (Lagarde, "Water drop 2b - Dynamic rain and its
 * effects"): porous darkening, water-filled pores smoothing the base, and a
 * water-film coat that becomes a mirror in puddles. CPU reference of WET_GLSL. */
export function wetSurfaceResponse(wetness: number, puddleNoise: number, porosity = 1) {
  const w = Math.min(Math.max(wetness, 0), 1);
  const smooth = (a: number, b: number, x: number) => {
    const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
    return t * t * (3 - 2 * t);
  };
  // Puddles fill the low spots first: the threshold falls as water rises.
  const puddle = w > 0.25 ? smooth(1.05 - w * 0.75, 1.15 - w * 0.75, puddleNoise) : 0;
  const film = Math.max(smooth(0.05, 0.6, w), puddle);
  return {
    puddle,
    film,
    albedoScale: 1 - 0.5 * porosity * smooth(0, 0.5, w) * (1 - puddle * 0.3),
    roughnessTarget: 0.35,
    roughnessBlend: 0.7 * smooth(0.05, 0.5, w),
    coatRoughness: 0.2 + (0.025 - 0.2) * puddle,
  };
}

const WET_VERTEX = /* glsl */ `
{
	vec4 apexWorld = vec4( transformed, 1.0 );
	#ifdef USE_INSTANCING
	apexWorld = instanceMatrix * apexWorld;
	#endif
	vApexWorld = ( modelMatrix * apexWorld ).xyz;
}`;
const WET_GLSL = /* glsl */ `
float apexWetMask;
float apexPuddle;
{
	float wet = apexSurfaceWetness * apexWetAmount;
	float noise = apexNoise( vApexWorld.xz * 0.35 ) * 0.65 + apexNoise( vApexWorld.xz * 1.3 ) * 0.35;
	apexPuddle = wet > 0.25 ? smoothstep( 1.05 - wet * 0.75, 1.15 - wet * 0.75, noise ) * apexPuddleAmount : 0.0;
	apexWetMask = max( smoothstep( 0.05, 0.6, wet ), apexPuddle );
	diffuseColor.rgb *= 1.0 - 0.5 * apexPorosity * smoothstep( 0.0, 0.5, wet ) * ( 1.0 - apexPuddle * 0.3 );
}`;
const WET_ROUGHNESS = /* glsl */ `
roughnessFactor = mix( roughnessFactor, min( roughnessFactor, 0.35 ), 0.7 * smoothstep( 0.05, 0.5, apexSurfaceWetness * apexWetAmount ) );`;
const WET_COAT_NORMAL = /* glsl */ `
#ifdef USE_CLEARCOAT
if ( apexSurfaceRain > 0.001 && apexWetMask > 0.0 ) {
	vec2 slope = apexRippleSlope( vApexWorld.xz / 0.35, studioTime ) * apexSurfaceRain * 0.22 * apexWetMask;
	vec3 slopeView = ( viewMatrix * vec4( slope.x, 0.0, slope.y, 0.0 ) ).xyz;
	clearcoatNormal = normalize( clearcoatNormal - slopeView );
}
#endif`;
const WET_COAT = /* glsl */ `
#ifdef USE_CLEARCOAT
material.clearcoat = apexWetMask;
// three's own floor (0.0525) plus the geometric term keeps the lobe finite.
material.clearcoatRoughness = min( max( mix( 0.2, 0.025, apexPuddle ) + 0.04 * apexSurfaceRain * apexPuddle, 0.0525 ) + geometryRoughness, 1.0 );
// Water (IOR 1.333) rather than a 1.5 varnish.
material.clearcoatF0 = vec3( 0.0204 );
#endif`;

interface WetOptions {
  /** How strongly surface water collects (0 for vertical faces). */
  wetAmount: number;
  puddles: number;
  porosity: number;
}
function installWetSurface(material: T.MeshPhysicalMaterial, options: WetOptions) {
  const local = {
    apexWetAmount: { value: options.wetAmount },
    apexPuddleAmount: { value: options.puddles },
    apexPorosity: { value: options.porosity },
  };
  material.userData.wetSurface = local;
  chainShaderHook(material, 'library-wet-surface-v1', (shader) => {
    Object.assign(shader.uniforms, surfaceWeather, local);
    useStudioUniforms(shader, ['studioTime'], 'fragment');
    injectDeclarations(shader, 'common', 'varying vec3 vApexWorld;', 'vertex');
    injectAfter(shader, 'begin_vertex', WET_VERTEX, 'vertex');
    injectDeclarations(
      shader,
      'common',
      `varying vec3 vApexWorld;
uniform float apexSurfaceWetness;
uniform float apexSurfaceRain;
uniform float apexWetAmount;
uniform float apexPuddleAmount;
uniform float apexPorosity;
${RIPPLE_GLSL}`,
      'fragment',
    );
    injectAfter(shader, 'color_fragment', WET_GLSL, 'fragment');
    injectAfter(shader, 'roughnessmap_fragment', WET_ROUGHNESS, 'fragment');
    injectAfter(shader, 'clearcoat_normal_fragment_begin', WET_COAT_NORMAL, 'fragment');
    injectAfter(shader, 'lights_physical_fragment', WET_COAT, 'fragment');
  });
  // The film coat is driven per pixel; a non-zero base enables USE_CLEARCOAT.
  material.clearcoat = 1;
  material.clearcoatRoughness = 0.2;
}

// --- Car paint -------------------------------------------------------------
export interface CarPaintOptions {
  color?: T.ColorRepresentation;
  /** Metallic flake amount 0 (solid) .. 1 (strong metallic). */
  flake?: number;
  /** Flake sparkle tile size in metres (128 flakes per tile side). */
  flakeTile?: number;
  /** Base coat roughness under the clear coat. */
  roughness?: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  /** Pearlescent interference 0..1 (thin-film iridescence of the coat). */
  pearl?: number;
}
/** Multi-layer car paint: pigmented base, metallic flake normals in the base
 * lobe, smooth clear coat (base + flake normal + clearcoat). */
export function carPaint(options: CarPaintOptions = {}) {
  const flake = clamp(options.flake ?? 0.5, 0, 1);
  const material = new T.MeshPhysicalMaterial({
    name: 'APEX library car paint',
    color: options.color ?? 0xb01a1a,
    // Flakes are aluminium in a pigmented binder: partial metalness.
    metalness: 0.08 + 0.62 * flake,
    roughness: clamp(options.roughness ?? 0.32 + 0.16 * flake, 0.05, 1),
    clearcoat: clamp(options.clearcoat ?? 1, 0, 1),
    clearcoatRoughness: clamp(options.clearcoatRoughness ?? 0.03, 0, 1),
    specularIntensity: 1,
    ior: 1.5,
  });
  if (flake > 0) {
    material.normalMap = textures.get(
      'flake',
      'normal',
      1 / clamp(options.flakeTile ?? 0.25, 0.01, 10),
    );
    material.normalScale.set(0.35 + 0.5 * flake, 0.35 + 0.5 * flake);
  }
  const pearl = clamp(options.pearl ?? 0, 0, 1);
  if (pearl > 0) {
    material.iridescence = pearl;
    material.iridescenceIOR = 1.45;
    material.iridescenceThicknessRange = [250, 650];
  }
  return tag(material, 'carPaint', true);
}

// --- Carbon fibre ----------------------------------------------------------
export interface CarbonOptions {
  finish?: keyof typeof CARBON_FINISHES;
}
/** Twill carbon (the retained band-limited weave with anisotropic tow sheen). */
export function carbon(options: CarbonOptions = {}) {
  return tag(carbonMaterial(options.finish ?? 'lacquered'), 'carbon', true);
}

// --- Rubber ----------------------------------------------------------------
export interface RubberOptions {
  color?: T.ColorRepresentation;
  /** Scrubbed tread/sidewall 0 (new, matte) .. 1 (worn, slightly glossy). */
  wear?: number;
  /** Micro-relief tile in metres. */
  tile?: number;
}
/** Tyre and seal rubber: ~3 % albedo, rough, lettering-free moulded micro-relief. */
export function rubber(options: RubberOptions = {}) {
  const wear = clamp(options.wear ?? 0, 0, 1);
  const material = new T.MeshStandardMaterial({
    name: 'APEX library rubber',
    color: options.color ?? 0x0b0b0c,
    roughness: 0.9 - 0.18 * wear,
    metalness: 0,
    normalMap: textures.get('micro', 'normal', 1 / clamp(options.tile ?? 0.05, 0.005, 5)),
  });
  material.normalScale.set(0.45, 0.45);
  return tag(material, 'rubber', false);
}

// --- Metals ----------------------------------------------------------------
/** Linear F0 of common engineering metals. */
export const METAL_F0 = Object.freeze({
  aluminium: 0xe8eaeb,
  steel: 0xb4b6b9,
  titanium: 0xc2b9b0,
  chrome: 0xd6d8da,
  copper: 0xf5c5a8,
  gold: 0xffd98a,
});
export interface MetalOptions {
  kind?: 'brushed' | 'bare' | 'polished' | 'cast';
  metal?: keyof typeof METAL_F0;
  color?: T.ColorRepresentation;
  roughness?: number;
  /** Detail tile in metres. */
  tile?: number;
}
export function metal(options: MetalOptions = {}) {
  const kind = options.kind ?? 'bare';
  const base = { brushed: 0.32, bare: 0.38, polished: 0.07, cast: 0.6 }[kind];
  const material = new T.MeshPhysicalMaterial({
    name: `APEX library ${kind} metal`,
    color: options.color ?? METAL_F0[options.metal ?? 'aluminium'],
    metalness: 1,
    roughness: clamp(options.roughness ?? base, 0.02, 1),
  });
  const repeat = 1 / clamp(options.tile ?? (kind === 'brushed' ? 0.3 : 0.12), 0.005, 10);
  if (kind === 'brushed') {
    // Scratches along U stretch the highlight across them (anisotropic GGX).
    material.anisotropy = 0.75;
    material.normalMap = textures.get('brushed', 'normal', repeat);
    material.normalScale.set(0.25, 0.25);
  } else if (kind !== 'polished') {
    material.normalMap = textures.get('micro', 'normal', repeat);
    const s = kind === 'cast' ? 0.6 : 0.15;
    material.normalScale.set(s, s);
    material.roughnessMap = textures.get('micro', 'orm', repeat);
  }
  return tag(material, 'metal', kind !== 'cast');
}

// --- Glass -----------------------------------------------------------------
export interface GlassOptions {
  tint?: T.ColorRepresentation;
  /** Transmitted share at normal incidence (before Fresnel). */
  transmission?: number;
  roughness?: number;
}
const GLASS_GLSL = /* glsl */ `
{
	// Fresnel-weighted glass, premultiplied: reflection is never dimmed by the
	// transmitted share, and grazing angles reflect more and transmit less.
	float apexNoV = saturate( dot( normal, normalize( vViewPosition ) ) );
	float apexF = 0.04 + 0.96 * pow( 1.0 - apexNoV, 5.0 );
	float apexAlpha = mix( diffuseColor.a, 1.0, apexF );
	gl_FragColor = vec4( totalDiffuse * diffuseColor.a * ( 1.0 - apexF ) + totalSpecular + totalEmissiveRadiance, apexAlpha );
}`;
export function glass(options: GlassOptions = {}) {
  const transmission = clamp(options.transmission ?? 0.88, 0, 1);
  const material = new T.MeshPhysicalMaterial({
    name: 'APEX library glass',
    color: options.tint ?? 0xdfe8ee,
    metalness: 0,
    roughness: clamp(options.roughness ?? 0.03, 0, 1),
    ior: 1.5,
    transparent: true,
    opacity: 1 - transmission,
    depthWrite: false,
    // Premultiplied output: src + dst * (1 - alpha).
    blending: T.CustomBlending,
    blendSrc: T.OneFactor,
    blendDst: T.OneMinusSrcAlphaFactor,
  });
  chainShaderHook(material, 'library-glass-fresnel-v1', (shader) => {
    injectAfter(shader, 'opaque_fragment', GLASS_GLSL, 'fragment');
  });
  return tag(material, 'glass', false);
}

// --- Road surfaces ---------------------------------------------------------
export interface AsphaltOptions {
  variant?: 'fresh' | 'worn' | 'patched';
  color?: T.ColorRepresentation;
  /** Detail tile in metres. */
  tile?: number;
  /** Puddle tendency 0..1 (camber and drainage). */
  puddles?: number;
}
/** Asphalt with GPU-generated aggregate (normal, cavity/roughness, tone),
 * coupled to the shared surface weather: porous darkening, smoother base,
 * a water-film coat, puddles in the low spots and rain ripples. */
export function asphalt(options: AsphaltOptions = {}) {
  const variant = options.variant ?? 'worn';
  const recipe = `asphalt-${variant}` as ProceduralRecipe;
  const repeat = 1 / clamp(options.tile ?? 0.64, 0.05, 20);
  const material = new T.MeshPhysicalMaterial({
    name: `APEX library ${variant} asphalt`,
    color: options.color ?? 0x4a4b4c,
    roughness: 0.92,
    metalness: 0,
    map: textures.get(recipe, 'albedo', repeat),
    normalMap: textures.get(recipe, 'normal', repeat),
    roughnessMap: textures.get(recipe, 'orm', repeat),
    aoMap: textures.get(recipe, 'orm', repeat),
    aoMapIntensity: 0.6,
  });
  material.normalScale.set(0.7, 0.7);
  // The baked tone map stores half its multiplier (see ALBEDO_SCALE).
  material.color.multiplyScalar(ALBEDO_SCALE);
  installWetSurface(material, {
    wetAmount: 1,
    puddles: clamp(options.puddles ?? 0.6, 0, 1),
    porosity: 1,
  });
  return tag(material, 'asphalt', true);
}
/** Asphalt that is wet regardless of the session weather (`wetness` 0..1 is
 * added to the shared value), e.g. a hosed pit box or a drainage channel. */
export function wetRoad(options: AsphaltOptions & { wetness?: number } = {}) {
  const material = asphalt(options);
  const local = material.userData.wetSurface as { apexWetAmount: T.IUniform<number> };
  // Saturates the shared water: wetAmount scales the session wetness.
  local.apexWetAmount.value = 1 + 4 * clamp(options.wetness ?? 0.8, 0, 1);
  material.name = 'APEX library wet road';
  material.userData.library = 'wetRoad';
  return material;
}
export interface ConcreteOptions {
  variant?: 'smooth' | 'rough';
  color?: T.ColorRepresentation;
  tile?: number;
  /** 0 for walls (no standing water), 1 for slabs. */
  horizontal?: number;
}
export function concrete(options: ConcreteOptions = {}) {
  const variant = options.variant ?? 'smooth';
  const recipe = `concrete-${variant}` as ProceduralRecipe;
  const repeat = 1 / clamp(options.tile ?? 1.2, 0.05, 20);
  const material = new T.MeshPhysicalMaterial({
    name: `APEX library ${variant} concrete`,
    color: options.color ?? 0x8f8c86,
    roughness: 0.88,
    metalness: 0,
    map: textures.get(recipe, 'albedo', repeat),
    normalMap: textures.get(recipe, 'normal', repeat),
    roughnessMap: textures.get(recipe, 'orm', repeat),
    aoMap: textures.get(recipe, 'orm', repeat),
    aoMapIntensity: 0.5,
  });
  material.color.multiplyScalar(ALBEDO_SCALE);
  const horizontal = clamp(options.horizontal ?? 1, 0, 1);
  installWetSurface(material, {
    wetAmount: 0.4 + 0.6 * horizontal,
    puddles: 0.3 * horizontal,
    porosity: 0.7,
  });
  return tag(material, 'concrete', false);
}

// --- Vegetation ------------------------------------------------------------
export interface VegetationOptions {
  color?: T.ColorRepresentation;
  /** Thin-leaf transmission 0..1 (subsurface-like back light). */
  translucency?: number;
  alphaMap?: T.Texture | null;
  alphaTest?: number;
}
const LEAF_GLSL = /* glsl */ `
uniform float apexTranslucency;
uniform vec3 apexTransmissionTint;
// Thin-leaf transmission: light through the leaf toward the eye (forward
// scattered) plus a wrapped back-face term. directLight.color is already
// shadowed, so leaves in another crown's shadow do not glow.
void RE_Direct_ApexLeaf( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	RE_Direct_Physical( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	float forward = pow( saturate( dot( geometryViewDir, - directLight.direction ) ), 3.0 );
	float through = saturate( - dot( geometryNormal, directLight.direction ) * 0.6 + 0.4 );
	reflectedLight.directDiffuse += apexTranslucency * ( 0.65 * forward + 0.35 * through ) * through
		* directLight.color * material.diffuseColor * apexTransmissionTint;
}
#undef RE_Direct
#define RE_Direct RE_Direct_ApexLeaf`;
export function vegetation(options: VegetationOptions = {}) {
  const material = new T.MeshStandardMaterial({
    name: 'APEX library vegetation',
    color: options.color ?? 0x3d5a2a,
    roughness: 0.7,
    metalness: 0,
    side: T.DoubleSide,
    alphaMap: options.alphaMap ?? null,
    alphaTest: options.alphaMap ? (options.alphaTest ?? 0.5) : 0,
  });
  const local = {
    apexTranslucency: { value: clamp(options.translucency ?? 0.35, 0, 1) },
    // Chlorophyll passes yellow-green more than it reflects it.
    apexTransmissionTint: { value: new T.Vector3(1.05, 1.12, 0.55) },
  };
  material.userData.leaf = local;
  chainShaderHook(material, 'library-leaf-transmission-v1', (shader) => {
    Object.assign(shader.uniforms, local);
    injectAfter(shader, 'lights_physical_pars_fragment', LEAF_GLSL, 'fragment');
  });
  return tag(material, 'vegetation', false);
}

// --- Helpers ---------------------------------------------------------------
function clamp(v: number, lo: number, hi: number) {
  return Number.isFinite(v) ? Math.min(Math.max(v, lo), hi) : lo;
}
function tag<M extends T.Material>(material: M, kind: string, glossy: boolean) {
  material.userData.library = kind;
  // Opaque glossy finishes take part in ULTRA screen-space reflections.
  if (glossy) installSsrMask(material);
  return material;
}

/** Box-projected UVs in metres for geometry without a usable layout: each
 * vertex takes the two coordinates across its dominant normal axis. Writes
 * `uv` (and `uv1` for aoMap) in place; returns the geometry. */
export function boxProjectUv(geometry: T.BufferGeometry, metresPerUnit = 1) {
  if (!(metresPerUnit > 0)) throw new Error('Invalid UV scale');
  const position = geometry.getAttribute('position');
  if (!position) throw new Error('Geometry has no positions');
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  const normal = geometry.getAttribute('normal');
  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    const ax = Math.abs(normal.getX(i)),
      ay = Math.abs(normal.getY(i)),
      az = Math.abs(normal.getZ(i));
    const x = position.getX(i) / metresPerUnit,
      y = position.getY(i) / metresPerUnit,
      z = position.getZ(i) / metresPerUnit;
    const [u, v] = ax >= ay && ax >= az ? [z, y] : ay >= az ? [x, z] : [x, y];
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }
  geometry.setAttribute('uv', new T.BufferAttribute(uv, 2));
  geometry.setAttribute('uv1', new T.BufferAttribute(uv.slice(), 2));
  return geometry;
}

/** Bake pending procedural maps (call with the live renderer; cheap when none). */
export function prepareMaterials(renderer: T.WebGLRenderer) {
  return textures.bake(renderer);
}
export function materialDiagnostics() {
  return {
    textures: textures.diagnostics(),
    weather: {
      wetness: surfaceWeather.apexSurfaceWetness.value,
      rain: surfaceWeather.apexSurfaceRain.value,
      time: studioUniforms.studioTime.value,
    },
  };
}
