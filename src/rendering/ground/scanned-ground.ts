import * as T from 'three';
import {
  chainShaderHook,
  injectAfter,
  injectBefore,
  injectDeclarations,
} from '../studio/shader-hooks.ts';
import type { StudioShader } from '../studio/shader-hooks.ts';
import { SCAN_COMMON_GLSL, SCAN_VERTEX_GLSL } from './ground-glsl.ts';
import {
  scanLayerCall,
  scanMacroCall,
  scannedGround,
  scanUniformDeclarations,
  scanUniformNames,
  type ScanLayer,
} from './scan-store.ts';

/**
 * Photographed ground on the track, run-off, verge, terrain and off-road
 * materials (docs/production/RENDERING_PIPELINE.md, "Scanned ground").
 *
 * Each installer chains one studio hook whose code compiles only under
 * `APEX_SCAN` (scan-store.ts): the surfaces keep their calibrated albedo,
 * finishes, weather and simulation-driven layers (racing line, rubber,
 * puddles, ruts) and take the photographed structure on top:
 *
 *  - asphalt: the scan replaces the procedural chip tile (colour, chip
 *    normal, roughness) under the same micro fade; meso tone, racing line,
 *    launch rubber, repairs, wet film and glints are untouched;
 *  - turf (verges, aprons, skirts): mown lawn near the circuit, rough meadow
 *    beyond it, plus a meadow macro tap that breaks up the ground at range;
 *  - terrain: the same turf blend, and weathered rock on steep faces in a
 *    slope-aligned projection (no stretching on cuttings);
 *  - gravel: the gravel trap scan under the D19 river-gravel colour;
 *  - kerbs: paint over cast concrete; the concrete's high points wear
 *    through where tyres strike, its relief reads through the paint;
 *  - concrete grounds; off-road soil splat (soil-splat.ts).
 *
 * Material maps that the scan supersedes are swapped out while it is active
 * and restored on Low.
 */

const linear = (hex: number) => {
  const c = new T.Color(hex);
  return [c.r, c.g, c.b] as const;
};
const srgbBytes = (rgb: readonly [number, number, number]) =>
  rgb.map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
const v3 = (v: readonly number[]) => `vec3( ${v.map((x) => x.toFixed(5)).join(', ')} )`;
const f = (v: number) => v.toFixed(4);

/** Tuning of the scanned layers (shader constants; tests read them). */
export const SCANNED_GROUND = Object.freeze({
  /** Procedural texel means the scan's ratio replaces (surface-detail.ts palette). */
  turfMean: srgbBytes([89, 101, 53]),
  concreteMean: srgbBytes([172, 172, 162]),
  /** Lawn (mown) within this many metres of the track centre, meadow beyond. */
  lawnReach: Object.freeze([24, 52] as const),
  /** Meadow macro tap: frequency relative to its tile and strength. */
  macroScale: 0.11,
  macroStrength: 0.6,
  /** Share of the mown verge given to rough meadow patches. */
  patchShare: 0.55,
  /** Hex lattice cells per tile (higher: more breakup, softer detail). */
  density: 1.6,
  /** Normal strength per surface. */
  turfRelief: 1.1,
  asphaltRelief: 1.0,
  gravelRelief: 1.15,
  kerbRelief: 1.4,
  rockRelief: 1.2,
  /** Share of the scan's chroma kept on asphalt (neutral binder). */
  asphaltChroma: 0.55,
  /** Broad asphalt stain contrast (concrete macro tap). */
  asphaltStains: 0.45,
  /** Kerb: share of the concrete tone through the paint; wear threshold. */
  kerbThrough: 0.6,
  /** Terrain rock: the terrain finish's slope band. */
  rockSlope: Object.freeze([0.47, 0.62] as const),
});

const LUMA = 'vec3( 0.2126, 0.7152, 0.0722 )';

interface ScanHookOptions {
  key: string;
  layers: readonly ScanLayer[];
  /** Fragment edits (after the common declarations are in place). */
  edit: (shader: StudioShader) => void;
  swap?: (scanned: boolean) => void;
}
/** One scanned hook: uniforms, declarations, world position, then `edit`. */
function scanHook(material: T.Material, options: ScanHookOptions) {
  const installed = chainShaderHook(material, options.key, (shader) => {
    Object.assign(shader.uniforms, scannedGround.uniformsFor(options.layers));
    injectDeclarations(
      shader,
      'common',
      '#ifdef APEX_SCAN\nvarying vec3 vScanWorld;\n#endif',
      'vertex',
    );
    injectAfter(shader, 'project_vertex', SCAN_VERTEX_GLSL, 'vertex');
    injectDeclarations(
      shader,
      'common',
      `#ifdef APEX_SCAN
varying vec3 vScanWorld;
${scanUniformDeclarations(options.layers)}
vec3 apexScanN = vec3( 0.0, 0.0, 1.0 );
float apexScanRough = 1.0;
float apexScanRelief = 0.0;
#endif
${SCAN_COMMON_GLSL}`,
      'fragment',
    );
    options.edit(shader);
  });
  if (installed) scannedGround.register(material, options.layers, options.swap);
  return installed;
}

type MapKey = 'map' | 'bumpMap' | 'roughnessMap' | 'normalMap' | 'aoMap';
/** Swap procedural maps out while scanned (restored when leaving). */
function mapSwap(
  material: T.MeshStandardMaterial,
  keys: readonly MapKey[],
  extra?: (on: boolean) => void,
) {
  const kept = new Map<MapKey, T.Texture | null>();
  return (scanned: boolean) => {
    for (const key of keys) {
      if (scanned) {
        kept.set(key, material[key]);
        material[key] = null;
      } else if (kept.has(key)) material[key] = kept.get(key) ?? null;
    }
    extra?.(scanned);
  };
}

const PLANAR_DERIVATIVES = /* glsl */ `
vec2 apexScanDx = dFdx( vScanWorld.xz ), apexScanDy = dFdy( vScanWorld.xz );`;
/** Normal stage: the scanned detail on the current view normal. */
const PERTURB = /* glsl */ `
#ifdef APEX_SCAN
normal = apexScanPerturb( normal, apexScanN, apexScanRelief );
#endif`;
/** Roughness stage: the scan's relative roughness on the surface's own level. */
const ROUGHNESS = /* glsl */ `
#ifdef APEX_SCAN
roughnessFactor = clamp( roughnessFactor * apexScanRough, 0.04, 1.0 );
#endif`;

/** Turf colour ratio: lawn near the circuit, meadow beyond, meadow macro. */
function turfGlsl(distance: string, relief: number) {
  const S = SCANNED_GROUND;
  return `
#ifdef APEX_SCAN
{
	${PLANAR_DERIVATIVES}
	ApexScanSample apexLawn = ${scanLayerCall('lawn', 'vScanWorld.xz', 'apexScanDx', 'apexScanDy', S.density)};
	ApexScanSample apexMeadow = ${scanLayerCall('meadow', 'vScanWorld.xz', 'apexScanDx', 'apexScanDy', S.density)};
	float apexLawnW = 1.0 - smoothstep( ${f(S.lawnReach[0])}, ${f(S.lawnReach[1])}, ${distance} );
	// Rougher, drier patches through the mown verge (metre scale), from the
	// meadow's own large-scale tone so they are photographic, not noise.
	vec3 apexPatchTap = ${scanMacroCall('meadow', 'vScanWorld.xz', 0.31)};
	apexLawnW *= 1.0 - ${f(S.patchShare)} * smoothstep( 0.85, 1.25, dot( apexPatchTap, ${LUMA} ) );
	// The meadow's own hue (dry stalks, soil, stones) toned to the turf.
	vec3 apexMeadowRatio = mix( vec3( dot( apexMeadow.ratio, ${LUMA} ) ), apexMeadow.ratio, 0.55 );
	vec3 apexRatio = mix( apexMeadowRatio, apexLawn.ratio, apexLawnW );
	vec3 apexMacro = ${scanMacroCall('meadow', 'vScanWorld.xz', S.macroScale)};
	apexMacro = mix( vec3( dot( apexMacro, ${LUMA} ) ), apexMacro, 0.8 );
	apexRatio *= mix( vec3( 1.0 ), apexMacro, ${f(S.macroStrength)} );
	diffuseColor.rgb *= ${v3(S.turfMean)} * apexRatio * mix( 1.0, mix( apexMeadow.ao, apexLawn.ao, apexLawnW ), 0.35 );
	apexScanN = apexScanMixNormal( apexMeadow.n, apexLawn.n, apexLawnW );
	apexScanRough = mix( apexMeadow.rough, apexLawn.rough, apexLawnW );
	apexScanRelief = ${f(relief)};
}
#endif`;
}

/** Circuit verges, aprons, skirts and the venue kit's grass ground (after
 * `installCircuitFinish(m, 'grass')`): mown lawn within ~40 m of the track
 * centre (the ribbon's lateral metres), meadow beyond. */
export function installScannedTurf(material: T.MeshStandardMaterial) {
  return scanHook(material, {
    key: 'scanned-turf-v1',
    layers: ['lawn', 'meadow'],
    swap: mapSwap(material, ['map', 'bumpMap', 'roughnessMap'], (on) => {
      material.roughness = on ? 0.86 : 1;
    }),
    edit: (shader) => {
      injectAfter(
        shader,
        'map_fragment',
        turfGlsl('abs( vScanLateral )', SCANNED_GROUND.turfRelief),
        'fragment',
      );
      injectDeclarations(shader, 'common', 'varying float vScanLateral;', 'vertex');
      injectAfter(shader, 'begin_vertex', 'vScanLateral = uv.x * 5.0;', 'vertex');
      injectDeclarations(shader, 'common', 'varying float vScanLateral;', 'fragment');
      injectAfter(shader, 'roughnessmap_fragment', ROUGHNESS, 'fragment');
      injectAfter(shader, 'normal_fragment_maps', PERTURB, 'fragment');
    },
  });
}

/** The far terrain (after the circuit's 'terrain' finish and the D17 terrain
 * finish, which provides `vTrackDistance`, `apexCanopy`): turf by distance
 * from the circuit, rock on steep faces in a slope-aligned projection. */
export function installScannedTerrain(material: T.MeshStandardMaterial) {
  const S = SCANNED_GROUND;
  return scanHook(material, {
    key: 'scanned-terrain-v1',
    layers: ['lawn', 'meadow', 'rock'],
    swap: mapSwap(material, ['map', 'bumpMap', 'roughnessMap'], (on) => {
      material.roughness = on ? 0.9 : 1;
    }),
    edit: (shader) => {
      if (!shader.fragmentShader.includes('varying float vTrackDistance'))
        throw new Error('Scanned terrain needs the terrain finish (vTrackDistance)');
      injectAfter(shader, 'map_fragment', turfGlsl('vTrackDistance', S.turfRelief), 'fragment');
      // After the terrain finish's canopy and strata: photographed rock on
      // steep faces. u runs along the contour, v up the face.
      injectAfter(
        shader,
        'color_fragment',
        `#ifdef APEX_SCAN
{
	vec3 apexWorldN = normalize( ( vec4( vNormal, 0.0 ) * viewMatrix ).xyz );
	float apexSlope = 1.0 - clamp( apexWorldN.y, 0.0, 1.0 );
	float apexRock = smoothstep( ${f(S.rockSlope[0])}, ${f(S.rockSlope[1])}, apexSlope ) * ( 1.0 - apexCanopy );
	vec3 apexContour = normalize( vec3( - apexWorldN.z, 0.0, apexWorldN.x ) + vec3( 1e-4, 0.0, 0.0 ) );
	// (contour, up) through the layer's v flip is a right-handed frame.
	vec2 apexFace = vec2( dot( vScanWorld, apexContour ), vScanWorld.y );
	vec2 apexFaceDx = dFdx( apexFace ), apexFaceDy = dFdy( apexFace );
	if ( apexRock > 0.004 ) {
		ApexScanSample apexR = ${scanLayerCall('rock', 'apexFace', 'apexFaceDx', 'apexFaceDy', S.density, false)};
		diffuseColor.rgb *= mix( vec3( 1.0 ), apexR.ratio, apexRock );
		apexScanRough = mix( apexScanRough, apexR.rough, apexRock );
		apexScanRelief = mix( apexScanRelief, ${f(S.rockRelief)}, apexRock );
		apexScanN = apexScanMixNormal( apexScanN, apexR.n, apexRock );
	}
	// The canopy carpet keeps its own crowns.
	apexScanRelief *= 1.0 - apexCanopy;
}
#endif`,
        'fragment',
      );
      injectAfter(shader, 'roughnessmap_fragment', ROUGHNESS, 'fragment');
      injectAfter(shader, 'normal_fragment_maps', PERTURB, 'fragment');
    },
  });
}

/** Gravel traps (after `installGravelFinish`): the scan under the trap's
 * calibrated colour, with the finish's dust and damp patches. */
export function installScannedGravel(material: T.MeshStandardMaterial) {
  const S = SCANNED_GROUND;
  return scanHook(material, {
    key: 'scanned-gravel-v1',
    layers: ['gravel'],
    swap: mapSwap(material, ['map', 'bumpMap', 'roughnessMap'], (on) => {
      material.roughness = on ? 0.92 : 1;
    }),
    edit: (shader) => {
      if (!shader.fragmentShader.includes('uniform vec3 gravelColour'))
        throw new Error('Scanned gravel needs the gravel finish');
      injectAfter(
        shader,
        'map_fragment',
        `#ifdef APEX_SCAN
{
	${PLANAR_DERIVATIVES}
	ApexScanSample apexG = ${scanLayerCall('gravel', 'vScanWorld.xz', 'apexScanDx', 'apexScanDy', S.density)};
	float apexDust = apexGravelNoise( vScanWorld.xz * 0.55 + vec2( 3.1, 7.4 ) );
	float apexDamp = apexGravelNoise( vScanWorld.xz * 2.3 + vec2( 9.2, 1.3 ) );
	vec3 apexRatio = mix( vec3( dot( apexG.ratio, ${LUMA} ) ), apexG.ratio, 0.6 );
	diffuseColor.rgb = gravelColour * apexRatio * ( 0.86 + 0.2 * apexDust + 0.1 * apexDamp ) * mix( 1.0, apexG.ao, 0.45 );
	gravelRelief = 0.0;
	apexScanN = apexG.n;
	apexScanRough = apexG.rough;
	apexScanRelief = ${f(S.gravelRelief)};
}
#endif`,
        'fragment',
      );
      injectAfter(shader, 'roughnessmap_fragment', ROUGHNESS, 'fragment');
      injectAfter(shader, 'normal_fragment_maps', PERTURB, 'fragment');
    },
  });
}

/** Racing surface, pit lane and run-off asphalt (after `installAsphaltDetail`;
 * reads `apexMicro` and the procedural texel means it cancels). */
export function installScannedAsphalt(material: T.MeshStandardMaterial) {
  const means = material.userData.asphaltMeans as
    | { albedo: readonly [number, number, number]; roughness: number; contrast: number }
    | undefined;
  if (!means) throw new Error('Scanned asphalt needs surfaceMaterial asphalt means');
  const S = SCANNED_GROUND;
  return scanHook(material, {
    key: 'scanned-asphalt-v1',
    layers: ['asphalt', 'concrete'],
    edit: (shader) => {
      if (!shader.fragmentShader.includes('float apexMicro'))
        throw new Error('Scanned asphalt needs the asphalt detail');
      // Before color_fragment: after every map-stage term (the asphalt
      // detail's micro fade, which the wet road's untracked edit at
      // map_fragment would otherwise split from this block).
      injectBefore(
        shader,
        'color_fragment',
        `#ifdef APEX_SCAN
${PLANAR_DERIVATIVES}
ApexScanSample apexAsphalt = ${scanLayerCall('asphalt', 'vScanWorld.xz', 'apexScanDx', 'apexScanDy', S.density)};
{
	#ifdef USE_MAP
	// Cancel the procedural chip tile exactly as the micro fade applies it
	// (texel^(micro * contrast) about its mean), then lay the scan.
	diffuseColor.rgb *= pow( ${v3(means.albedo)} / max( sampledDiffuseColor.rgb, vec3( 0.003 ) ), vec3( apexMicro * ${f(means.contrast)} ) );
	#endif
	vec3 apexRatio = mix( vec3( dot( apexAsphalt.ratio, ${LUMA} ) ), apexAsphalt.ratio, ${f(S.asphaltChroma)} );
	// Broad stains and binder-rich patches (the weathered concrete scan's
	// blotches at ~13 m): mottling the chip tile cannot carry at range.
	vec3 apexBroad = ${scanMacroCall('concrete', 'vScanWorld.xz', 1 / 4.5)};
	apexRatio *= 1.0 + ${f(S.asphaltStains)} * ( dot( apexBroad, ${LUMA} ) - 1.0 );
	diffuseColor.rgb *= apexRatio;
	apexScanN = apexAsphalt.n;
	apexScanRough = clamp( apexAsphalt.rough, 0.7, 1.35 );
}
#endif`,
        'fragment',
      );
      injectAfter(
        shader,
        'roughnessmap_fragment',
        `#ifdef APEX_SCAN
#ifdef USE_ROUGHNESSMAP
roughnessFactor *= mix( 1.0, ${f(means.roughness)} / max( texelRoughness.g, 0.05 ), apexMicro );
#endif
roughnessFactor = clamp( roughnessFactor * apexScanRough, 0.04, 1.0 );
#endif`,
        'fragment',
      );
      injectAfter(
        shader,
        'normal_fragment_maps',
        `#if defined( APEX_SCAN ) && defined( USE_NORMALMAP_TANGENTSPACE )
// The chip relief, with the procedural frame's micro fade, rubber fill and
// meso tilt (tbn as the asphalt and road detail left it).
normal = apexScanPerturb( normalize( tbn[2] ), apexAsphalt.n, length( tbn[0] ) * normalScale.x * ${f(S.asphaltRelief)} );
#endif`,
        'fragment',
      );
    },
  });
}

/** Kerbs (after `installKerbFinish`): paint over cast concrete. */
export function installScannedKerb(material: T.MeshStandardMaterial) {
  const S = SCANNED_GROUND;
  return scanHook(material, {
    key: 'scanned-kerb-v1',
    layers: ['concrete'],
    edit: (shader) => {
      if (!shader.fragmentShader.includes('vec3 kerbPaint'))
        throw new Error('Scanned kerb needs the kerb finish');
      injectAfter(
        shader,
        'color_fragment',
        `#ifdef APEX_SCAN
{
	${PLANAR_DERIVATIVES}
	ApexScanSample apexK = ${scanLayerCall('concrete', 'vScanWorld.xz', 'apexScanDx', 'apexScanDy', S.density)};
	// Thin rolled paint follows the concrete's tone and relief; its high
	// points are scrubbed to the substrate first, more where tyres strike.
	float apexHigh = ( apexK.height - 1.0 ) * 2.4 + apexK.n.x * 0.6;
	float apexBare = smoothstep( 0.55, 1.05, apexHigh + 0.9 * kerbWear ) * ( 0.35 + 0.65 * kerbWear );
	vec3 apexSubstrate = vec3( 0.29, 0.285, 0.27 ) * apexK.ratio;
	diffuseColor.rgb *= mix( vec3( 1.0 ), apexK.ratio, ${f(S.kerbThrough)} );
	diffuseColor.rgb = mix( diffuseColor.rgb, apexSubstrate, apexBare * 0.85 );
	apexScanN = apexK.n;
	apexScanRough = mix( 1.0, clamp( apexK.rough, 0.85, 1.15 ), 0.5 + 0.5 * apexBare );
	apexScanRelief = ${f(S.kerbRelief)};
}
#endif`,
        'fragment',
      );
      injectAfter(shader, 'roughnessmap_fragment', ROUGHNESS, 'fragment');
      injectAfter(shader, 'normal_fragment_maps', PERTURB, 'fragment');
    },
  });
}

/** A set's detail over a surface whose colour stage is already final (e.g.
 * the festival's dirt tracks and verges): ratio x `strength` on the colour
 * (chroma kept at `chroma`), its relief and relative roughness. */
export function installScannedDetail(
  material: T.MeshStandardMaterial,
  layer: ScanLayer,
  options: { strength?: number; chroma?: number; relief?: number } = {},
) {
  const strength = options.strength ?? 1,
    chroma = options.chroma ?? 0.6,
    relief = options.relief ?? 1;
  return scanHook(material, {
    key: 'scanned-detail-v1',
    layers: [layer],
    edit: (shader) => {
      injectAfter(
        shader,
        'color_fragment',
        `#ifdef APEX_SCAN
{
	${PLANAR_DERIVATIVES}
	ApexScanSample apexD = ${scanLayerCall(layer, 'vScanWorld.xz', 'apexScanDx', 'apexScanDy', SCANNED_GROUND.density)};
	vec3 apexRatio = mix( vec3( dot( apexD.ratio, ${LUMA} ) ), apexD.ratio, ${f(chroma)} );
	diffuseColor.rgb *= mix( vec3( 1.0 ), apexRatio * mix( 1.0, apexD.ao, 0.35 ), ${f(strength)} );
	apexScanN = apexD.n;
	apexScanRough = apexD.rough;
	apexScanRelief = ${f(relief)};
}
#endif`,
        'fragment',
      );
      injectAfter(shader, 'roughnessmap_fragment', ROUGHNESS, 'fragment');
      injectAfter(shader, 'normal_fragment_maps', PERTURB, 'fragment');
    },
  });
}

/** Concrete grounds (venue kit paving, `surfaceMaterial('concrete')`). */
export function installScannedConcrete(material: T.MeshStandardMaterial, relief = 1) {
  const S = SCANNED_GROUND;
  return scanHook(material, {
    key: 'scanned-concrete-v1',
    layers: ['concrete'],
    swap: mapSwap(material, ['map', 'bumpMap', 'roughnessMap'], (on) => {
      material.roughness = on ? 0.86 : 1;
    }),
    edit: (shader) => {
      injectAfter(
        shader,
        'map_fragment',
        `#ifdef APEX_SCAN
{
	${PLANAR_DERIVATIVES}
	ApexScanSample apexC = ${scanLayerCall('concrete', 'vScanWorld.xz', 'apexScanDx', 'apexScanDy', S.density)};
	diffuseColor.rgb *= ${v3(S.concreteMean)} * apexC.ratio;
	apexScanN = apexC.n;
	apexScanRough = apexC.rough;
	apexScanRelief = ${f(relief)};
}
#endif`,
        'fragment',
      );
      injectAfter(shader, 'roughnessmap_fragment', ROUGHNESS, 'fragment');
      injectAfter(shader, 'normal_fragment_maps', PERTURB, 'fragment');
    },
  });
}

/** A plain map swap for library or kit materials with metre UVs (no shader
 * edit): `layer`'s maps at its photographed scale, its mean normalised to the
 * material's current albedo (`albedo`, linear, the colour x map mean the
 * procedural maps produced). */
export function installScannedMaps(
  material: T.MeshStandardMaterial,
  layer: ScanLayer,
  albedo: readonly [number, number, number],
  uvMetres = 1,
) {
  if (material.userData.scannedMaps) return false;
  material.userData.scannedMaps = layer;
  const u = scannedGround.uniforms[layer];
  const kept: Partial<Record<MapKey | 'color', unknown>> = {};
  const clone = (t: T.Texture | null) => {
    if (!t) return null;
    const c = t.clone();
    c.repeat.setScalar(uvMetres * u.info.value.x);
    c.needsUpdate = true;
    return c;
  };
  const owned: T.Texture[] = [];
  scannedGround.register(material, [layer], (on) => {
    if (on) {
      kept.map = material.map;
      kept.normalMap = material.normalMap;
      kept.roughnessMap = material.roughnessMap;
      kept.aoMap = material.aoMap;
      kept.bumpMap = material.bumpMap;
      kept.color = material.color.clone();
      const [map, normal, orm] = [u.color.value, u.normal.value, u.orm.value].map(clone);
      owned.push(...([map, normal, orm].filter(Boolean) as T.Texture[]));
      material.map = map;
      material.normalMap = normal;
      material.roughnessMap = orm;
      material.aoMap = null;
      material.bumpMap = null;
      const i = u.info.value;
      material.color.setRGB(albedo[0] * i.y, albedo[1] * i.z, albedo[2] * i.w);
      // The ORM's roughness is absolute: scale it back to the material's level.
      material.roughness = Math.min(1, material.roughness / Math.max(u.rough.value, 0.05));
    } else if (kept.color) {
      material.map = (kept.map as T.Texture) ?? null;
      material.normalMap = (kept.normalMap as T.Texture) ?? null;
      material.roughnessMap = (kept.roughnessMap as T.Texture) ?? null;
      material.aoMap = (kept.aoMap as T.Texture) ?? null;
      material.bumpMap = (kept.bumpMap as T.Texture) ?? null;
      material.color.copy(kept.color as T.Color);
      material.roughness = Math.min(1, material.roughness * Math.max(u.rough.value, 0.05));
      for (const t of owned) t.dispose();
      owned.length = 0;
    }
  });
  return true;
}

/** Effective linear albedo of a material-library surface (its colour carries
 * ALBEDO_SCALE over procedural maps that store half the multiplier). */
export function libraryAlbedo(material: T.MeshStandardMaterial) {
  const c = material.color;
  return [c.r / 2, c.g / 2, c.b / 2] as [number, number, number];
}
/** Linear albedo of a colour (sRGB hex), for `installScannedMaps`. */
export function albedoOf(hex: number) {
  return linear(hex);
}
export { scanUniformNames };
