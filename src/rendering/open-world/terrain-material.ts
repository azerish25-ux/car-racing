import * as T from 'three';
import { SCAN_COMMON_GLSL } from '../ground/ground-glsl.ts';
import {
  scanLayerCall,
  scanMacroCall,
  scannedGround,
  scanUniformDeclarations,
  type ScanLayer,
} from '../ground/scan-store.ts';
import { bindSeasonUniforms } from './season.ts';
import { FLORA_ZONE_GLSL, SUSUKI_SEED } from './flora-roles.ts';

/** Photographed sets of the festival terrain (Medium and above): meadow
 * grass, rock (slope-aligned), forest-floor soil, sandy gravel, snow. */
export const FESTIVAL_SCAN_LAYERS: readonly ScanLayer[] = Object.freeze([
  'meadow',
  'rock',
  'forest',
  'gravel',
  'snow',
]);
const SCAN_LUMA = 'vec3(0.2126, 0.7152, 0.0722)';
/** Festival scan block: per-layer colour ratios (and a blended detail normal)
 * from the photographed sets, applied to the calibrated layer colours. */
const FESTIVAL_SCAN_GLSL = /* glsl */ `
#ifdef APEX_SCAN
  vec2 scanDx = dFdx(vOwWorld.xz), scanDy = dFdy(vOwWorld.xz);
  vec3 scanWorldN = normalize((vec4(vNormal, 0.0) * viewMatrix).xyz);
  vec3 scanContour = normalize(vec3(-scanWorldN.z, 0.0, scanWorldN.x) + vec3(1e-4, 0.0, 0.0));
  vec2 scanFace = vec2(dot(vOwWorld, scanContour), vOwWorld.y);
  vec2 scanFaceDx = dFdx(scanFace), scanFaceDy = dFdy(scanFace);
  ApexScanSample sGrass = ${scanLayerCall('meadow', 'p', 'scanDx', 'scanDy', 1.5)};
  vec3 scanGrass = mix(vec3(dot(sGrass.ratio, ${SCAN_LUMA})), sGrass.ratio, 0.55);
  vec3 scanMacro = ${scanMacroCall('meadow', 'p', 0.08)};
  scanGrass *= 1.0 + 0.45 * (dot(scanMacro, ${SCAN_LUMA}) - 1.0);
  grass *= scanGrass * mix(1.0, sGrass.ao, 0.35);
  owScanN = sGrass.n;
  owScanRough = sGrass.rough;
  ApexScanSample sLayer;
  if (rock > 0.004) {
    sLayer = ${scanLayerCall('rock', 'scanFace', 'scanFaceDx', 'scanFaceDy', 1.5, false)};
    rockC *= sLayer.ratio;
    owScanN = apexScanMixNormal(owScanN, sLayer.n, rock);
  }
  if (soil > 0.004) {
    sLayer = ${scanLayerCall('forest', 'p', 'scanDx', 'scanDy', 1.5, false)};
    soilC *= sLayer.ratio;
    owScanN = apexScanMixNormal(owScanN, sLayer.n, soil * (1.0 - rock));
  }
  if (sand > 0.004) {
    sLayer = ${scanLayerCall('gravel', 'p', 'scanDx', 'scanDy', 1.5, false)};
    sandC *= mix(vec3(dot(sLayer.ratio, ${SCAN_LUMA})), sLayer.ratio, 0.5);
    owScanN = apexScanMixNormal(owScanN, sLayer.n, sand * (1.0 - rock));
  }
  if (snow > 0.004) {
    sLayer = ${scanLayerCall('snow', 'p', 'scanDx', 'scanDy', 1.5, false)};
    snowC *= sLayer.ratio;
    owScanN = apexScanMixNormal(owScanN, sLayer.n, snow);
  }
#endif
`;
/** Shared GLSL value noise for the festival materials (world-space, no
 * textures, filtered by distance so it never aliases). */
export const OW_NOISE_GLSL = /* glsl */ `
float owHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float owNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(owHash(i), owHash(i + vec2(1.0, 0.0)), u.x),
             mix(owHash(i + vec2(0.0, 1.0)), owHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float owFbm(vec2 p, float detail) {
  float s = owNoise(p) * 0.5;
  s += owNoise(p * 2.07 + 17.1) * 0.25 * detail;
  s += owNoise(p * 4.13 - 9.7) * 0.125 * detail;
  return s / (0.5 + 0.375 * detail);
}
`;

export interface TerrainUniforms {
  owWet: { value: number };
  owSnowTint: { value: number };
}
/**
 * Festival terrain: one physically based material blending five layers per
 * pixel — meadow grass (with forest-floor and dry variants), rock, soil
 * (ploughed fields, verges, worn town ground), sand and snow — from the
 * tile's per-vertex layer weights (slope, height and biome), broken up by
 * world-space noise so the transitions read as ground, not as gradients.
 * Albedos are linear reflectances of real materials (grass ~0.1, rock ~0.2,
 * sand ~0.45, snow ~0.85); roughness and a noise-derived detail normal
 * follow each layer; standing water darkens and smooths the porous layers.
 */
export function terrainMaterial(): T.MeshStandardMaterial & { userData: { ow: TerrainUniforms } } {
  const material = new T.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.9,
    metalness: 0,
  }) as T.MeshStandardMaterial & {
    userData: { ow: TerrainUniforms };
  };
  material.name = 'Festival terrain (layered PBR)';
  material.polygonOffset = true;
  material.polygonOffsetFactor = 1;
  material.polygonOffsetUnits = 2;
  const uniforms: TerrainUniforms = { owWet: { value: 0 }, owSnowTint: { value: 1 } };
  material.userData.ow = uniforms;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, scannedGround.uniformsFor(FESTIVAL_SCAN_LAYERS));
    bindSeasonUniforms(shader);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec4 splat;
attribute vec4 shade;
varying vec4 vSplat;
varying vec4 vShade;
varying vec3 vOwWorld;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vSplat = splat;
vShade = shade;
vOwWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float owWet;
uniform float owSnowTint;
#ifndef OW_SEASON_DECLARED
#define OW_SEASON_DECLARED
uniform vec4 owSeason;
uniform float owSnowCover;
#endif
varying vec4 vSplat;
varying vec4 vShade;
varying vec3 vOwWorld;
${OW_NOISE_GLSL}
${FLORA_ZONE_GLSL}
float owRoughness;
vec2 owBump;
#ifdef APEX_SCAN
${scanUniformDeclarations(FESTIVAL_SCAN_LAYERS)}
vec3 owScanN = vec3(0.0, 0.0, 1.0);
float owScanRough = 1.0;
#endif
${SCAN_COMMON_GLSL}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  float dist = length(vViewPosition);
  float near = 1.0 - smoothstep(60.0, 420.0, dist);
  float mid = 1.0 - smoothstep(400.0, 2600.0, dist);
  vec2 p = vOwWorld.xz;
  vec3 owN = normalize((vec4(vNormal, 0.0) * viewMatrix).xyz);
  float macro = owFbm(p * 0.0021, 1.0);
  float meso = owFbm(p * 0.019, mid);
  float micro = owFbm(p * 0.21, near);
  // Layer weights broken up by noise (height-blend style transitions).
  float rock = clamp(vSplat.x * (0.75 + 0.6 * meso) - 0.08 + 0.25 * (micro - 0.5) * vSplat.x, 0.0, 1.0);
  float soil = clamp(vSplat.y * (0.7 + 0.6 * meso), 0.0, 1.0);
  float sand = clamp(vSplat.z * (0.85 + 0.3 * micro), 0.0, 1.0);
  float snow = clamp(vSplat.w * (0.8 + 0.5 * meso) - 0.05, 0.0, 1.0);
  // Winter: snow lies on all but steep ground (064, 073, 003).
  snow = max(snow, owSnowCover * smoothstep(0.6, 0.84, owN.y + 0.14 * (meso - 0.5)) * (0.86 + 0.14 * micro) * (1.0 - 0.7 * rock));
  float town = vShade.w;
  float forest = vShade.y;
  // Grass: lush to dry by macro noise, darker forest floor under woods.
  vec3 lush = vec3(0.075, 0.13, 0.035), dry = vec3(0.16, 0.17, 0.065);
  vec3 grass = mix(lush, dry, smoothstep(0.35, 0.75, macro));
  grass *= 0.82 + 0.36 * meso;
  grass = mix(grass, vec3(0.055, 0.07, 0.03) * (0.8 + 0.4 * micro), smoothstep(0.3, 0.8, forest) * 0.85);
  // Short airfield and park turf, worn paving in towns.
  grass = mix(grass, mix(vec3(0.17, 0.165, 0.15), vec3(0.11, 0.15, 0.06), smoothstep(0.4, 0.7, meso)), town * 0.8);
  // Season (references 021, 032, 036, 042, 052, 064): fresh spring green,
  // deep summer green, straw and russet in autumn with leaf litter under
  // the woods, dormant grey-brown under the winter snow.
  {
    float gl = max(dot(grass, vec3(0.2126, 0.7152, 0.0722)), 1e-4);
    vec3 springG = mix(grass, vec3(0.1, 0.17, 0.033) * (gl / 0.105), 0.55);
    vec3 autumnG = mix(vec3(0.24, 0.185, 0.075), vec3(0.17, 0.105, 0.05), smoothstep(0.35, 0.8, meso)) * clamp(gl / 0.1, 0.6, 1.3);
    // Susuki fields read silver-gold from afar (036); petals lie under the
    // cherry groves in spring (050).
    float susuki = smoothstep(0.5, 0.62, owFloraZone(p, ${SUSUKI_SEED.toFixed(2)})) * (1.0 - smoothstep(0.2, 0.5, forest)) * (1.0 - town);
    autumnG = mix(autumnG, vec3(0.44, 0.36, 0.22) * (0.85 + 0.3 * micro), susuki * 0.75);
    autumnG = mix(autumnG, vec3(0.15, 0.065, 0.028) * (0.75 + 0.5 * micro), smoothstep(0.3, 0.8, forest) * 0.85);
    float petals = owCherryZone(p) * smoothstep(0.5, 0.85, owFbm(p * 0.09, near)) * (1.0 - 0.6 * forest);
    springG = mix(springG, vec3(0.62, 0.45, 0.5), petals * 0.45);
    vec3 winterG = mix(vec3(0.15, 0.13, 0.095), vec3(0.1, 0.09, 0.07), micro);
    // Summer: deep olive green (016 #626931, 021 #63632d sunlit).
    vec3 summerG = grass * vec3(0.92, 1.0, 0.72);
    grass = owSeason.x * springG + owSeason.y * summerG + owSeason.z * autumnG + owSeason.w * winterG;
  }
  vec3 rockC = mix(vec3(0.17, 0.16, 0.145), vec3(0.29, 0.27, 0.24), owFbm(vec2(p.x * 0.05, vOwWorld.y * 0.6), mid));
  rockC *= 0.85 + 0.3 * micro;
  // Fields: crop strips from the farm pattern, else bare earth.
  float field = vShade.z;
  vec3 crop = mix(vec3(0.33, 0.27, 0.12), vec3(0.11, 0.17, 0.04), step(0.62, fract(field * 7.3)));
  vec3 earth = mix(vec3(0.16, 0.115, 0.075), vec3(0.24, 0.19, 0.13), micro);
  vec3 soilC = mix(earth, crop, field > 0.0 ? 0.75 : 0.0);
  vec3 sandC = mix(vec3(0.42, 0.37, 0.27), vec3(0.6, 0.54, 0.41), meso) * (0.9 + 0.2 * micro);
  vec3 snowC = vec3(0.82, 0.84, 0.88) * (0.94 + 0.06 * micro) * owSnowTint;
  ${FESTIVAL_SCAN_GLSL}
  // Road verges: compacted and dusty only beside the shoulder; the carved
  // embankments beyond stay grassed (042, 050: grass to the guardrail).
  float verge = smoothstep(0.9, 1.0, vShade.x) * (1.0 - snow);
  vec3 col = grass;
  col = mix(col, soilC, soil);
  // Rice paddies and flower fields on the flat lowland farms: plots with
  // grass bunds (050, 028), flooded in spring, green in summer, gold in
  // autumn; some plots are flower strips in spring and summer (051).
  float owPaddyWet = 0.0;
  {
    float farmW = smoothstep(0.42, 0.5, field) * smoothstep(0.95, 0.985, owN.y) * (1.0 - rock) * (1.0 - sand);
    vec2 g = vec2(p.x / 34.0, p.y / 61.0);
    vec2 cell = floor(g), f = fract(g);
    float edgeM = min(min(f.x, 1.0 - f.x) * 34.0, min(f.y, 1.0 - f.y) * 61.0);
    float bund = 1.0 - smoothstep(0.3, 0.55, edgeM);
    float plot = owHash(cell + 17.0), plot2 = owHash(cell + 41.0);
    float rows = smoothstep(0.55, 0.9, abs(fract(p.x * 3.3) - 0.5) * 2.0) * near;
    vec3 water = vec3(0.03, 0.04, 0.042);
    vec3 rice = mix(vec3(0.075, 0.15, 0.03), vec3(0.11, 0.18, 0.04), plot2) * (0.85 + 0.25 * rows);
    vec3 gold = mix(vec3(0.36, 0.28, 0.09), vec3(0.24, 0.18, 0.1), step(0.65, plot2));
    vec3 springP = mix(water, vec3(0.08, 0.13, 0.03), rows * 0.35 + step(0.75, plot2) * 0.7);
    vec3 paddyC = owSeason.x * springP + owSeason.y * rice + owSeason.z * gold + owSeason.w * vec3(0.14, 0.11, 0.08);
    float stripe = fract(p.x / 7.5 + plot * 3.0);
    vec3 bloom = stripe < 0.2 ? vec3(0.5, 0.03, 0.03) : (stripe < 0.4 ? vec3(0.6, 0.42, 0.02) : (stripe < 0.6 ? vec3(0.2, 0.05, 0.33) : (stripe < 0.8 ? vec3(0.62, 0.62, 0.58) : vec3(0.62, 0.18, 0.32))));
    bloom = mix(bloom, vec3(0.06, 0.1, 0.03), smoothstep(0.42, 0.5, abs(fract(p.x / 1.5) - 0.5)) * 0.6);
    vec3 flowerC = (owSeason.x + owSeason.y) * bloom + owSeason.z * vec3(0.2, 0.15, 0.09) + owSeason.w * vec3(0.14, 0.11, 0.08);
    vec3 plotC = plot < 0.14 ? flowerC : paddyC;
    plotC = mix(plotC, vec3(0.085, 0.12, 0.04) * (0.8 + 0.4 * micro), bund);
    float use = farmW * step(plot, 0.82);
    col = mix(col, plotC, use);
    owPaddyWet = use * owSeason.x * (1.0 - bund) * step(0.14, plot) * (1.0 - step(0.75, plot2));
  }
  col = mix(col, sandC, sand);
  col = mix(col, rockC, rock);
  col = mix(col, vec3(0.19, 0.17, 0.14) * (0.85 + 0.3 * micro), verge * 0.6);
  col = mix(col, snowC, snow);
  owRoughness = mix(0.93, 0.78, rock);
  owRoughness = mix(owRoughness, 0.96, soil * 0.6);
  owRoughness = mix(owRoughness, 0.88, sand);
  owRoughness = mix(owRoughness, 0.42, snow);
  owRoughness = mix(owRoughness, 0.06, owPaddyWet * (1.0 - snow));
#ifdef APEX_SCAN
  owRoughness = clamp(owRoughness * mix(owScanRough, 1.0, max(rock, snow)), 0.05, 1.0);
#endif
  // Standing water: porous layers darken and smooth (not snow or rock faces).
  float wet = owWet * (1.0 - snow) * (1.0 - 0.6 * rock);
  col *= 1.0 - 0.38 * wet;
  owRoughness = mix(owRoughness, 0.32, wet * 0.75);
  diffuseColor.rgb = col;
  // Detail normal: gradient of the micro and meso relief (fades with distance).
  float e = 0.35;
  float h0 = owFbm(p * 0.21, near) * near * (0.35 + 0.65 * rock + 0.3 * soil) + meso * 0.6 * mid;
  float hx = owFbm((p + vec2(e, 0.0)) * 0.21, near) * near * (0.35 + 0.65 * rock + 0.3 * soil) + owFbm((p + vec2(e, 0.0)) * 0.019, mid) * 0.6 * mid;
  float hz = owFbm((p + vec2(0.0, e)) * 0.21, near) * near * (0.35 + 0.65 * rock + 0.3 * soil) + owFbm((p + vec2(0.0, e)) * 0.019, mid) * 0.6 * mid;
  owBump = vec2(hx - h0, hz - h0) / e * (0.55 * (1.0 - snow * 0.7));
}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = owRoughness;`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
normal = normalize(normal + (viewMatrix * vec4(-owBump.x, 0.0, -owBump.y, 0.0)).xyz);
#ifdef APEX_SCAN
normal = apexScanPerturb(normal, owScanN, 1.1);
#endif`,
      );
  };
  material.customProgramCacheKey = () => 'festival-terrain-seasons-v2';
  scannedGround.register(material, FESTIVAL_SCAN_LAYERS);
  return material;
}
