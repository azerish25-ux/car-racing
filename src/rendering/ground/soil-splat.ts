import type * as T from 'three';
import type { SoilKind } from '../../simulation/offroad/course.ts';
import { chainShaderHook, injectAfter, injectDeclarations } from '../studio/shader-hooks.ts';
import { SCAN_COMMON_GLSL, SCAN_VERTEX_GLSL } from './ground-glsl.ts';
import {
  scanLayerCall,
  scanMacroCall,
  scannedGround,
  scanUniformDeclarations,
  type ScanLayer,
} from './scan-store.ts';

/**
 * Off-road course soil from photographed sets (Valley Ridge MX, Arena Nord
 * SX, Kestrel RX, Pinewood stage), on the library soil material of the
 * deformable TerrainView.
 *
 * Each soil kind maps to a set (`SOIL_SCAN`); a course uses at most
 * `MAX_SOIL_SLOTS` sets, carried per vertex as one-hot weights
 * (`apexSoilLayers`, slots 0-3; slot 4 is the remainder) that interpolate
 * across kind boundaries. The kind's calibrated albedo stays the vertex
 * colour; the sets give structure, relief and roughness:
 *
 *  - height-blended splat: at a boundary the higher grains of either set
 *    win (relief from each scan's luminance), not a linear cross-fade;
 *  - slope-aligned projection on berms and jump faces (u along the contour,
 *    v up the face) for the dominant set, so packed faces do not stretch;
 *  - compaction from the simulation (the racing line, landings, berm walls)
 *    smooths the relief and gloss of packed soil; ruts stay rough and dark
 *    (the soil hook's moisture and rut darkening still apply);
 *  - a macro tap of the loam set breaks up the course at range.
 */
export const SOIL_SCAN: Readonly<Record<SoilKind, ScanLayer>> = Object.freeze({
  hardpack: 'dryEarth',
  loam: 'forest',
  sand: 'gravel',
  mud: 'wetEarth',
  gravel: 'gravel',
  asphalt: 'asphalt',
  turf: 'meadow',
});
export const MAX_SOIL_SLOTS = 5;

/** The sets (slots) a course with `kinds` samples, most used first; extra
 * kinds beyond the slot budget fall back to the first slot. */
export function soilSlots(kinds: Iterable<SoilKind>) {
  const counts = new Map<ScanLayer, number>();
  for (const kind of kinds) counts.set(SOIL_SCAN[kind], (counts.get(SOIL_SCAN[kind]) ?? 0) + 1);
  const slots = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([layer]) => layer);
  return slots.slice(0, MAX_SOIL_SLOTS);
}
/** Slot index of a kind (0 when its set did not get a slot). */
export function soilSlotOf(kind: SoilKind, slots: readonly ScanLayer[]) {
  return Math.max(0, slots.indexOf(SOIL_SCAN[kind]));
}
/** Write the one-hot `apexSoilLayers` weights (4 per vertex) for `slot` of
 * `count` slots: the last slot is the remainder (all four zero). */
export function writeSoilSlot(out: Float32Array, vertex: number, slot: number, count: number) {
  for (let i = 0; i < 4; i++) out[vertex * 4 + i] = slot === i && slot < count - 1 ? 1 : 0;
}

const f = (v: number) => v.toFixed(4);
const LUMA = 'vec3( 0.2126, 0.7152, 0.0722 )';

/** Per-slot relief scale (metres of the set) and normal strength. */
const SLOT_RELIEF: Readonly<Record<ScanLayer, number>> = Object.freeze({
  lawn: 1,
  meadow: 1.1,
  forest: 1.25,
  dryEarth: 1.15,
  asphalt: 0.9,
  wetEarth: 1.05,
  concrete: 0.8,
  rock: 1.2,
  snow: 0.8,
  gravel: 1.2,
});

function splatGlsl(slots: readonly ScanLayer[]) {
  const n = slots.length;
  const weight = (i: number) =>
    i < 4 && i < n - 1
      ? `vScanSoil.${'xyzw'[i]}`
      : `max( 0.0, 1.0 - vScanSoil.x - vScanSoil.y - vScanSoil.z - vScanSoil.w )`;
  const lines: string[] = [];
  lines.push('vec2 apexScanDx = dFdx( vScanWorld.xz ), apexScanDy = dFdy( vScanWorld.xz );');
  // Slope-aligned face coordinates (contour, up), gradients in uniform flow.
  lines.push(`vec3 apexWorldN = normalize( ( vec4( vNormal, 0.0 ) * viewMatrix ).xyz );
	vec3 apexContour = normalize( vec3( - apexWorldN.z, 0.0, apexWorldN.x ) + vec3( 1e-4, 0.0, 0.0 ) );
	vec2 apexFace = vec2( dot( vScanWorld, apexContour ), vScanWorld.y );
	vec2 apexFaceDx = dFdx( apexFace ), apexFaceDy = dFdy( apexFace );
	float apexSteep = 1.0 - smoothstep( 0.6, 0.86, apexWorldN.y );`);
  for (let i = 0; i < n; i++) {
    lines.push(`float apexW${i} = ${weight(i)};
	ApexScanSample apexS${i};
	apexS${i}.ratio = vec3( 1.0 ); apexS${i}.n = vec3( 0.0, 0.0, 1.0 ); apexS${i}.rough = 1.0; apexS${i}.ao = 1.0; apexS${i}.height = 1.0;
	if ( apexW${i} > 0.002 ) apexS${i} = ${scanLayerCall(slots[i], 'vScanWorld.xz', 'apexScanDx', 'apexScanDy', 1.5, false)};`);
  }
  // Height blend: each set's relief proxy lifts its weight; the top wins.
  const b = (i: number) =>
    `apexW${i} + ( apexS${i}.height - 1.0 ) * 0.5 * step( 0.002, apexW${i} )`;
  lines.push(`float apexTop = -1.0;`);
  for (let i = 0; i < n; i++)
    lines.push(`float apexB${i} = ${b(i)}; apexTop = max( apexTop, apexB${i} );`);
  lines.push('float apexSum = 0.0; int apexDom = 0; float apexDomW = -1.0;');
  for (let i = 0; i < n; i++)
    lines.push(`apexB${i} = max( apexB${i} - apexTop + 0.24, 0.0 ) * step( 0.002, apexW${i} ); apexSum += apexB${i};
	if ( apexB${i} > apexDomW ) { apexDomW = apexB${i}; apexDom = ${i}; }`);
  lines.push('apexSum = max( apexSum, 1e-4 );');
  lines.push(
    `vec3 apexRatio = ${slots.map((_, i) => `apexS${i}.ratio * apexB${i}`).join(' + ')};`,
    `vec3 apexNs = ${slots.map((_, i) => `apexS${i}.n * apexB${i}`).join(' + ')};`,
    `float apexRough = ${slots.map((_, i) => `apexS${i}.rough * apexB${i}`).join(' + ')};`,
    `float apexAo = ${slots.map((_, i) => `apexS${i}.ao * apexB${i}`).join(' + ')};`,
    `float apexRelief = ${slots.map((s, i) => `${f(SLOT_RELIEF[s])} * apexB${i}`).join(' + ')};`,
    'apexRatio /= apexSum; apexRough /= apexSum; apexAo /= apexSum; apexRelief /= apexSum;',
  );
  // Berms and jump faces: the dominant set in the face projection.
  const side = slots
    .map(
      (s, i) =>
        `${i ? 'else ' : ''}if ( apexDom == ${i} ) apexSide = ${scanLayerCall(s, 'apexFace', 'apexFaceDx', 'apexFaceDy', 1.5, false)};`,
    )
    .join('\n\t\t');
  lines.push(`if ( apexSteep > 0.01 ) {
		ApexScanSample apexSide;
		${side}
		apexRatio = mix( apexRatio, apexSide.ratio, apexSteep );
		apexNs = mix( apexNs, apexSide.n * apexSum, apexSteep );
		apexRough = mix( apexRough, apexSide.rough, apexSteep );
	}`);
  // Macro breakup from the first (most used) set.
  // Two scales (~25 m and ~90 m tiles): dry and damp, dusty and packed
  // regions, with a little of the set's own hue shift.
  lines.push(`vec3 apexMacro = ${scanMacroCall(slots[0], 'vScanWorld.xz', 0.09)};
	vec3 apexMacroFar = ${scanMacroCall(slots[0], 'vScanWorld.xz', 0.027)};
	vec3 apexMacroMix = mix( vec3( dot( apexMacro, ${LUMA} ) ), apexMacro, 0.6 );
	apexRatio *= mix( vec3( 1.0 ), apexMacroMix, 0.6 ) * ( 1.0 + 0.45 * ( dot( apexMacroFar, ${LUMA} ) - 1.0 ) );`);
  lines.push(`diffuseColor.rgb *= apexRatio * mix( 1.0, apexAo, 0.4 );
	// Packed by wheels: smoother relief, a little gloss; fresh ruts stay rough.
	float apexPacked = clamp( vApexSoil.y, 0.0, 1.0 ) * ( 1.0 - clamp( vApexSoil.z * 8.0, 0.0, 1.0 ) );
	apexScanN = normalize( apexNs );
	apexScanRough = apexRough * ( 1.0 - 0.12 * apexPacked );
	apexScanRelief = apexRelief * ( 1.0 - 0.45 * apexPacked );`);
  return lines.join('\n\t');
}

/** Install the splat on the library soil material of a TerrainView whose
 * geometry carries `apexSoilLayers` for `slots` (soilSlots). */
export function installScannedSoil(material: T.MeshPhysicalMaterial, slots: readonly ScanLayer[]) {
  if (!slots.length || slots.length > MAX_SOIL_SLOTS) throw new Error('Invalid soil slots');
  const kept = new Map<string, unknown>();
  const installed = chainShaderHook(material, `scanned-soil-v1`, (shader) => {
    if (!shader.fragmentShader.includes('varying vec3 vApexSoil'))
      throw new Error('Scanned soil needs the library soil material');
    Object.assign(shader.uniforms, scannedGround.uniformsFor(slots));
    injectDeclarations(
      shader,
      'common',
      '#ifdef APEX_SCAN\nattribute vec4 apexSoilLayers;\nvarying vec4 vScanSoil;\nvarying vec3 vScanWorld;\n#endif',
      'vertex',
    );
    injectAfter(
      shader,
      'begin_vertex',
      '#ifdef APEX_SCAN\nvScanSoil = apexSoilLayers;\n#endif',
      'vertex',
    );
    injectAfter(shader, 'project_vertex', SCAN_VERTEX_GLSL, 'vertex');
    injectDeclarations(
      shader,
      'common',
      `#ifdef APEX_SCAN
varying vec4 vScanSoil;
varying vec3 vScanWorld;
${scanUniformDeclarations(slots)}
vec3 apexScanN = vec3( 0.0, 0.0, 1.0 );
float apexScanRough = 1.0;
float apexScanRelief = 0.0;
#endif
${SCAN_COMMON_GLSL}`,
      'fragment',
    );
    injectAfter(
      shader,
      'color_fragment',
      `#ifdef APEX_SCAN\n{\n\t${splatGlsl(slots)}\n}\n#endif`,
      'fragment',
    );
    injectAfter(
      shader,
      'roughnessmap_fragment',
      '#ifdef APEX_SCAN\nroughnessFactor = clamp( roughnessFactor * apexScanRough, 0.04, 1.0 );\n#endif',
      'fragment',
    );
    injectAfter(
      shader,
      'normal_fragment_maps',
      '#ifdef APEX_SCAN\nnormal = apexScanPerturb( normal, apexScanN, apexScanRelief );\n#endif',
      'fragment',
    );
  });
  if (!installed) return false;
  scannedGround.register(material, slots, (on) => {
    const m = material as unknown as Record<string, unknown>;
    if (on) {
      for (const key of ['map', 'normalMap', 'roughnessMap', 'aoMap']) {
        kept.set(key, m[key]);
        m[key] = null;
      }
      kept.set('color', material.color.clone());
      kept.set('roughness', material.roughness);
      // The procedural soil map stored half its multiplier (ALBEDO_SCALE).
      material.color.setScalar(1);
      material.roughness = 0.94;
    } else if (kept.size) {
      for (const key of ['map', 'normalMap', 'roughnessMap', 'aoMap'])
        m[key] = kept.get(key) ?? null;
      material.color.copy(kept.get('color') as T.Color);
      material.roughness = kept.get('roughness') as number;
    }
  });
  return true;
}
