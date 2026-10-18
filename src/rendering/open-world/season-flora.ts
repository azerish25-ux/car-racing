import type * as T from 'three';
import { chainShaderHook, injectAfter, injectBefore } from '../studio/shader-hooks.ts';
import { bindSeasonUniforms } from './season.ts';
import { FLORA_ROLE, FLORA_ZONE_GLSL, ROLE_STEP } from './flora-roles.ts';
import type { VegetationLibrary } from '../vegetation/library.ts';
import { SPECIES } from '../vegetation/species.ts';

/**
 * Season shading of the festival flora and ground cover, chained onto the
 * festival's own material instances (never the circuit's): foliage colour
 * per planting role and season, bare deciduous crowns and snow-laden tops in
 * winter, blossom petals, fallen leaves and snow banks on the roads.
 *
 * Target albedos (linear) are calibrated against the FH6 references in
 * docs/production/fh6-r4/vegetation-seasons.md: cherry blossom #e8c0cc..
 * #f0d4dd sunlit (050, 096), maple scarlet #bb3a1f..#d68867 (007, 027, 090),
 * autumn yellow/orange broadleaf #8e6420..#df7d29 (007, 027), sugi cedar
 * #43482c..#71794c (093), winter bare crowns #5c616e..#9da4a9 (064).
 */

/** Guarded declarations: several festival hooks may read the season. */
export const SEASON_DECL_GLSL = /* glsl */ `
#ifndef OW_SEASON_DECLARED
#define OW_SEASON_DECLARED
uniform vec4 owSeason;
uniform float owSnowCover;
#endif
`;

/** Vertex declarations (role, plant hash and speckle lattice varyings). */
const LEAF_VERTEX_GLSL = /* glsl */ `
${SEASON_DECL_GLSL}
varying vec3 vOwTree;
varying vec3 vOwSpeck;
float owLeafHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`;
const LEAF_GLSL = /* glsl */ `
${LEAF_VERTEX_GLSL}
vec3 owTexel = vec3(0.0, 1.0, 0.0);
float owLeafNoise(float salt) {
  vec3 c = floor(vOwSpeck);
  return owLeafHash(c.xy + c.z * vec2(7.13, 3.31) + salt);
}
/** Leaves are green-dominant; bark and twig strokes are not. */
float owLeafMask(vec3 c) {
  return clamp((c.g - c.r) / max(c.g, 1e-4) * 8.0 + 0.2, 0.0, 1.0);
}
bool owDeciduous(float role) {
  return role < ${FLORA_ROLE.MAPLE}.5 || abs(role - ${FLORA_ROLE.AZALEA}.0) < 0.5;
}
/** Coverage multiplier: winter deciduous crowns keep their twigs and a few
 * dry leaves; cherries in bloom are fuller clouds than their summer leaves
 * (015, 050: no sky through the blossom). */
float owLeafKeep(vec3 texel) {
  float leaf = owLeafMask(texel);
  if (owSeason.x > 0.5 && abs(vOwTree.x - ${FLORA_ROLE.CHERRY}.0) < 0.5) return 1.0 + 0.7 * leaf;
  if (owSeason.w < 0.5 || !owDeciduous(vOwTree.x)) return 1.0;
  // Each painted leaf has one flat colour: its luminance picks the leaves
  // that stay (leaf-shaped, identical in the colour and shadow passes).
  // (High gain: the dark, low-contrast photographic atlases need it too.)
  float pick = fract(dot(texel, vec3(613.0, 1361.0, 307.0)) + vOwTree.y);
  return max(1.0 - leaf, step(0.74, pick));
}
/** Seasonal colour of a leaf texel (\`base\`: map x colour x tint). */
vec3 owLeafSeason(vec3 base, float lumRef) {
  float role = vOwTree.x, h = vOwTree.y;
  float lum = dot(base, vec3(0.2126, 0.7152, 0.0722));
  float leaf = owLeafMask(base);
  float b = clamp(lum / lumRef, 0.1, 1.3);
  float n = owLeafNoise(0.0), n2 = owLeafNoise(11.0);
  vec3 fresh = vec3(0.12, 0.2, 0.03) * b;
  vec3 spring, summer = base * vec3(0.94, 1.0, 0.94), autumn, winter;
  if (role < 0.5) {
    spring = mix(base, fresh, 0.6);
    vec3 yellow = vec3(0.4, 0.25, 0.02), orange = vec3(0.44, 0.13, 0.015);
    vec3 russet = vec3(0.22, 0.075, 0.025), olive = vec3(0.17, 0.16, 0.03);
    vec3 c = h < 0.35 ? yellow : (h < 0.65 ? orange : (h < 0.85 ? russet : olive));
    vec3 c2 = h < 0.35 ? orange : (h < 0.65 ? yellow : (h < 0.85 ? orange : yellow));
    autumn = mix(c, c2, n * 0.45) * b;
  } else if (role < 1.5) {
    // Somei-yoshino: blossom before the leaves, pale pink to near white.
    spring = mix(vec3(0.58, 0.35, 0.43), vec3(0.72, 0.58, 0.63), n) * (0.45 + 0.55 * b);
    // Autumn cherries turn orange-red to crimson, a few stay amber.
    vec3 c = mix(vec3(0.5, 0.06, 0.03), vec3(0.5, 0.2, 0.03), h);
    autumn = mix(c, vec3(0.45, 0.28, 0.03), n * 0.35) * b;
  } else if (role < 2.5) {
    spring = mix(fresh * vec3(1.1, 1.05, 1.0), vec3(0.26, 0.07, 0.03) * b, step(0.72, h));
    autumn = mix(vec3(0.5, 0.035, 0.02), vec3(0.52, 0.12, 0.012), n * n + 0.35 * step(0.8, h)) * (0.85 + 0.3 * h) * b;
  } else if (role < 3.5) {
    spring = base * vec3(1.0, 1.05, 0.95);
    summer = base;
    autumn = mix(base, vec3(0.085, 0.065, 0.03) * b, 0.2);
  } else if (role < 4.5) {
    spring = summer = autumn = base;
  } else if (role < 5.5) {
    spring = mix(base, fresh, 0.35);
    autumn = mix(base, mix(vec3(0.34, 0.08, 0.03), vec3(0.3, 0.2, 0.03), h) * b, 0.55);
  } else {
    // Azaleas: magenta/pink/white flowers in spring, red-orange in early
    // summer (029), russet leaves in autumn.
    vec3 bloom = h < 0.4 ? vec3(0.62, 0.1, 0.3) : (h < 0.75 ? vec3(0.7, 0.28, 0.4) : vec3(0.75, 0.72, 0.7));
    float flower = step(n2, 0.55) * leaf;
    spring = mix(mix(base, fresh, 0.4), bloom * (0.5 + 0.5 * b), flower);
    summer = mix(summer, vec3(0.5, 0.05, 0.012) * (0.5 + 0.5 * b), step(n2, 0.42) * leaf);
    autumn = vec3(0.38, 0.07, 0.03) * b;
  }
  if (owDeciduous(role)) winter = vec3(0.075, 0.064, 0.055) * (0.6 + 0.4 * b);
  else if (role < 3.5) winter = mix(base, vec3(0.09, 0.06, 0.03) * b, 0.35);
  else winter = base * 0.9;
  vec3 c = owSeason.x * spring + owSeason.y * summer + owSeason.z * autumn + owSeason.w * winter;
  // Wood strokes keep their colour (darker cherry bark, grey twigs).
  return mix(base, c, leaf);
}
/** Snow lying on upward-facing foliage (\`up\`: normal . world up): caps
 * and ledges, the crown underneath stays dark (003, 064). */
vec3 owLeafSnow(vec3 c, float up, vec2 band) {
  float hold = owDeciduous(vOwTree.x) ? 0.25 : 0.7;
  // Per painted leaf / needle spray (its flat texel colour), not per UV cell.
  float n = fract(dot(owTexel, vec3(613.0, 1361.0, 307.0)) * 0.618 + vOwTree.y);
  float snow = owSnowCover * hold * smoothstep(band.x, band.y, up + 0.7 * (n - 0.5));
  return mix(c, vec3(0.8, 0.82, 0.86), snow);
}
`;

/** Vertex: decode the planting role from the instance colour (and remove
 * it from the tint), hash the plant's origin, pass speckle coordinates. */
function leafVertex(defaultRole: number, speckle: string, colour: boolean) {
  return /* glsl */ `{
  float owRole = ${defaultRole.toFixed(1)};
  #ifdef USE_INSTANCING_COLOR
    float owCode = floor(instanceColor.g / ${ROLE_STEP.toFixed(1)} + 0.001);
    if (owCode > 0.5) owRole = owCode;
    ${colour ? `vColor.g -= ${ROLE_STEP.toFixed(1)} * owCode;` : ''}
  #endif
  #ifdef USE_INSTANCING
    vec3 owO = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  #else
    vec3 owO = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  #endif
  vOwTree = vec3(owRole, owLeafHash(floor(owO.xz * 2.0)), 0.0);
  vOwSpeck = ${speckle};
}`;
}

export interface SeasonFoliageOptions {
  /** Role when the instance colour carries none (FLORA_ROLE). */
  role: number;
  /** Mean leaf luminance (linear) of the texture/colour: maps to the targets. */
  lumRef: number;
  /** Speckle lattice: GLSL vec3 expression of vertex attributes. */
  speckle: string;
  /** Depth / distance materials of the same plants (winter bare crowns). */
  shadows?: (T.MeshDepthMaterial | T.MeshDistanceMaterial | null)[];
  /** Up-facing range (normal . up, with noise) that gathers snow; crowns
   * whose normals lean up for soft lighting need a higher band. */
  snowBand?: readonly [number, number];
}

/** Leaf-card and crown materials of the festival plants. */
export function installSeasonFoliage(material: T.Material, options: SeasonFoliageOptions) {
  chainShaderHook(material, 'festival-season-foliage-v1', (shader) => {
    bindSeasonUniforms(shader);
    injectAfter(shader, 'common', LEAF_VERTEX_GLSL, 'vertex');
    injectAfter(shader, 'color_vertex', leafVertex(options.role, options.speckle, true), 'vertex');
    injectAfter(shader, 'common', LEAF_GLSL, 'fragment');
    // Coverage from the untinted texel, as in the shadow pass (impostors
    // replace map_fragment: their texel is taken after the tint).
    const mapped = shader.fragmentShader.includes('#include <map_fragment>');
    if (mapped) injectAfter(shader, 'map_fragment', 'owTexel = diffuseColor.rgb;', 'fragment');
    injectAfter(
      shader,
      'color_fragment',
      `${mapped ? '' : 'owTexel = diffuseColor.rgb;\n'}diffuseColor.rgb = owLeafSeason(diffuseColor.rgb, ${options.lumRef.toFixed(4)});`,
      'fragment',
    );
    injectBefore(
      shader,
      'alphatest_fragment',
      'diffuseColor.a *= owLeafKeep(owTexel);',
      'fragment',
    );
    injectAfter(
      shader,
      'normal_fragment_maps',
      `diffuseColor.rgb = owLeafSnow(diffuseColor.rgb, dot(normal, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz)), vec2(${(options.snowBand ?? [0.45, 0.95]).map((v) => v.toFixed(2)).join(', ')}));`,
      'fragment',
    );
  });
  for (const shadow of options.shadows ?? [])
    if (shadow)
      chainShaderHook(shadow, 'festival-season-foliage-v1', (shader) => {
        bindSeasonUniforms(shader);
        injectAfter(shader, 'common', LEAF_VERTEX_GLSL, 'vertex');
        injectAfter(
          shader,
          'begin_vertex',
          leafVertex(options.role, options.speckle, false),
          'vertex',
        );
        injectAfter(shader, 'common', LEAF_GLSL, 'fragment');
        injectBefore(
          shader,
          'alphatest_fragment',
          'diffuseColor.a *= owLeafKeep(diffuseColor.rgb);',
          'fragment',
        );
      });
}

/** Trunks: remove the role from the tint and colour the bark per species
 * (cherry: dark purplish brown, cedar: red-brown fibrous, pine: grey). */
export function installSeasonBark(
  material: T.Material,
  defaultRole: number = FLORA_ROLE.BROADLEAF,
) {
  chainShaderHook(material, 'festival-season-bark-v1', (shader) => {
    bindSeasonUniforms(shader);
    injectAfter(shader, 'common', LEAF_VERTEX_GLSL, 'vertex');
    injectAfter(shader, 'color_vertex', leafVertex(defaultRole, 'position', true), 'vertex');
    injectAfter(shader, 'common', LEAF_GLSL, 'fragment');
    injectAfter(
      shader,
      'color_fragment',
      /* glsl */ `{
  float r = vOwTree.x;
  vec3 k = abs(r - 1.0) < 0.5 ? vec3(0.5, 0.41, 0.45) : (abs(r - 3.0) < 0.5 ? vec3(1.02, 0.8, 0.7) : (abs(r - 4.0) < 0.5 ? vec3(0.78, 0.76, 0.74) : vec3(1.0)));
  diffuseColor.rgb *= k;
}`,
      'fragment',
    );
    injectAfter(
      shader,
      'normal_fragment_maps',
      /* glsl */ `{
  float up = dot(normal, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.8, 0.82, 0.86), owSnowCover * smoothstep(0.35, 0.8, up));
}`,
      'fragment',
    );
  });
}

/**
 * Grass blades and clumps: fresh in spring, deep green in summer, straw and
 * russet in autumn (042, 036), grey-brown and pressed under snow in winter.
 * `lumRef` maps the blade colour's luminance to the seasonal targets.
 */
export function installSeasonGrass(material: T.Material, lumRef: number) {
  chainShaderHook(material, 'festival-season-grass-v1', (shader) => {
    bindSeasonUniforms(shader);
    injectAfter(shader, 'common', SEASON_DECL_GLSL, 'vertex');
    // Winter: blades pressed down under the snow.
    injectAfter(shader, 'begin_vertex', 'transformed.y *= 1.0 - 0.6 * owSnowCover;', 'vertex');
    injectAfter(shader, 'common', SEASON_DECL_GLSL, 'fragment');
    injectAfter(
      shader,
      'color_fragment',
      /* glsl */ `{
  vec3 base = diffuseColor.rgb;
  float b = clamp(dot(base, vec3(0.2126, 0.7152, 0.0722)) / ${lumRef.toFixed(4)}, 0.15, 1.8);
  vec3 spring = mix(base, vec3(0.11, 0.2, 0.035) * b, 0.55);
  vec3 autumn = vec3(0.36, 0.27, 0.12) * b;
  vec3 winter = mix(vec3(0.2, 0.18, 0.15) * b, vec3(0.78, 0.8, 0.84), 0.55);
  diffuseColor.rgb = owSeason.x * spring + owSeason.y * base + owSeason.z * autumn + owSeason.w * winter;
}`,
      'fragment',
    );
  });
}

export type RoadSurface = 'asphalt' | 'verge' | 'dirt' | 'paving';
const ROAD_GLSL = /* glsl */ `
${SEASON_DECL_GLSL}
${FLORA_ZONE_GLSL}
varying vec3 vOwRoadWorld;
varying vec2 vOwRoadUv;
float owRoadHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float owRoadNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(owRoadHash(i), owRoadHash(i + vec2(1.0, 0.0)), u.x),
             mix(owRoadHash(i + vec2(0.0, 1.0)), owRoadHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
/** Litter coverage at a cell lattice: individual pieces near the camera,
 * their mean coverage once a piece is smaller than a pixel. */
float owLitter(vec2 p, float scale, float cover, float salt) {
  vec2 q = p * scale;
  float px = length(fwidth(q));
  // One petal or leaf per occupied cell: a turned ellipse (2.2 : 1) filling
  // ~32 % of the cell, so the mean coverage stays \`cover\`.
  vec2 cell = floor(q);
  float a = owRoadHash(cell + salt + 31.0) * 6.2832;
  vec2 f = fract(q) - 0.5;
  f = mat2(cos(a), -sin(a), sin(a), cos(a)) * f;
  float inside = step(length(f * vec2(1.0, 2.2)), 0.47);
  float piece = step(1.0 - min(1.0, cover / 0.32), owRoadHash(cell + salt)) * inside;
  return mix(piece, cover, smoothstep(0.35, 1.2, px));
}
`;

/**
 * Seasonal ground cover on the festival road surfaces: cherry petals in the
 * cherry zones drifting to the edges (015, 050, 096), maple and broadleaf
 * leaves in autumn (007, 052, 090), snow banks on verges and a dusting on
 * the asphalt edges with darker wet tarmac in winter (003, 010, 064).
 * Driving surfaces and physics are unchanged (colour only).
 */
export function installSeasonRoad(material: T.Material, surface: RoadSurface) {
  // Litter drifts to the road edges (uv.x: metres from the centre line);
  // dirt tracks keep a cleaner wheel path, verges are all edge.
  // Pale gravel tracks show petals less than dark tarmac (033).
  const litter = surface === 'dirt' ? 0.4 : surface === 'paving' ? 0.55 : 0.75;
  const edgeBias =
    surface === 'asphalt'
      ? 'smoothstep(1.2, 4.6, abs(vOwRoadUv.x))'
      : surface === 'dirt'
        ? 'smoothstep(0.6, 2.6, abs(vOwRoadUv.x))'
        : '1.0';
  chainShaderHook(material, `festival-season-road-${surface}-v1`, (shader) => {
    bindSeasonUniforms(shader);
    injectAfter(
      shader,
      'common',
      `${SEASON_DECL_GLSL}\nvarying vec3 vOwRoadWorld;\nvarying vec2 vOwRoadUv;`,
      'vertex',
    );
    injectAfter(
      shader,
      'begin_vertex',
      'vOwRoadWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvOwRoadUv = uv;',
      'vertex',
    );
    injectAfter(shader, 'common', ROAD_GLSL, 'fragment');
    // After the surface's own colour stage: the festival verge, dirt and
    // paving materials assign their colour in raw edits after color_fragment.
    injectAfter(
      shader,
      'normal_fragment_maps',
      /* glsl */ `{
  vec2 p = vOwRoadWorld.xz;
  float edge = ${edgeBias};
  float drift = owRoadNoise(p * 0.31) * 0.6 + owRoadNoise(p * 0.07 + 3.1) * 0.4;
  // Spring: petals under the cherry groves.
  float petals = owCherryZone(p) * smoothstep(0.3, 0.8, drift) * (0.2 + 0.8 * edge);
  float petal = owLitter(p, 26.0, clamp(petals * ${litter.toFixed(2)}, 0.0, 0.75), 0.0);
  vec3 petalC = mix(vec3(0.72, 0.5, 0.57), vec3(0.8, 0.66, 0.7), owRoadHash(floor(p * 26.0) + 7.0));
  diffuseColor.rgb = mix(diffuseColor.rgb, petalC, petal * owSeason.x);
  // Autumn: maple and broadleaf leaves, more in the maple groves.
  float leaves = (0.25 + 0.75 * owMapleZone(p)) * smoothstep(0.3, 0.8, drift) * (0.2 + 0.8 * edge);
  float leafPiece = owLitter(p, 11.0, clamp(leaves * 0.75, 0.0, 0.75), 3.0);
  float pick = owRoadHash(floor(p * 11.0) + 13.0);
  vec3 leafC = pick < 0.3 ? vec3(0.42, 0.05, 0.02) : (pick < 0.55 ? vec3(0.45, 0.15, 0.02) : (pick < 0.8 ? vec3(0.4, 0.26, 0.03) : vec3(0.17, 0.09, 0.035)));
  diffuseColor.rgb = mix(diffuseColor.rgb, leafC, leafPiece * owSeason.z);
  // Winter: snow banks on verges, dusting on asphalt edges, wet tarmac.
  float snow = ${surface === 'asphalt' ? 'smoothstep(0.55, 0.95, drift + 0.5 * edge - 0.35) * 0.85' : surface === 'dirt' ? '0.55 + 0.4 * smoothstep(0.3, 0.7, drift)' : surface === 'paving' ? 'smoothstep(0.35, 0.75, drift)' : '0.8 + 0.2 * drift'};
  vec3 snowC = vec3(0.78, 0.8, 0.85) * (0.92 + 0.08 * owRoadNoise(p * 3.0));
  diffuseColor.rgb = mix(diffuseColor.rgb * (1.0 - 0.18 * owSnowCover), snowC, clamp(snow, 0.0, 1.0) * owSnowCover);
}`,
      'fragment',
    );
  });
}

/** Season shading of the festival's photographic plants (HIGH/ULTRA): the
 * festival loads its own library instance, so the circuit's are untouched. */
export function installSeasonLibrary(library: VegetationLibrary) {
  // Mean linear luminance of each shipped leaf-card atlas (measured over its
  // opaque texels): maps every species' leaves to the same seasonal targets.
  const lumRef: Partial<Record<string, number>> = {
    [SPECIES.rowan]: 0.09,
    [SPECIES.chestnut]: 0.067,
    [SPECIES.linden]: 0.052,
    [SPECIES.birch]: 0.061,
    [SPECIES.fir]: 0.081,
    [SPECIES.firB]: 0.081,
    [SPECIES.shrub]: 0.048,
  };
  for (const s of library.species.values()) {
    if (s.grass) {
      installSeasonGrass(s.grass.material, 0.095);
      continue;
    }
    const role =
      s.id === SPECIES.fir || s.id === SPECIES.firB
        ? FLORA_ROLE.CEDAR
        : s.id === SPECIES.shrub
          ? FLORA_ROLE.SHRUB
          : FLORA_ROLE.BROADLEAF;
    if (s.cardMaterial)
      installSeasonFoliage(s.cardMaterial, {
        role,
        lumRef: lumRef[s.id] ?? 0.07,
        speckle: 'vec3(uv * 110.0, 0.0)',
        shadows: [s.cardDepth, s.cardDistance],
      });
    if (s.impostorMaterial)
      installSeasonFoliage(s.impostorMaterial, {
        role,
        lumRef: lumRef[s.id] ?? 0.07,
        speckle: 'vec3(uv * 60.0, 0.0)',
        shadows: [s.impostorDepth],
      });
    if (s.barkMaterial) installSeasonBark(s.barkMaterial, role);
  }
}

/** Road layers of the festival network and their season surfaces. */
export function installSeasonRoads(materials: Readonly<Record<string, T.Material>>) {
  const surfaces: Record<string, RoadSurface> = {
    asphaltMajor: 'asphalt',
    asphalt: 'asphalt',
    town: 'asphalt',
    verge: 'verge',
    dirt: 'dirt',
    paving: 'paving',
  };
  for (const [layer, surface] of Object.entries(surfaces))
    if (materials[layer]) installSeasonRoad(materials[layer], surface);
}

/** Procedural verge meadow blades of the dressing (found by mesh name, so
 * horizon-dressing.ts stays untouched). */
export function installSeasonMeadow(root: T.Object3D) {
  const seen = new Set<T.Material>();
  root.traverse((object) => {
    const mesh = object as T.Mesh;
    if (!mesh.isMesh || !object.name.startsWith('Solvane meadow')) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
      if (!seen.has(material)) {
        seen.add(material);
        // Blade vertex colours (horizon-dressing meadowGeometry) average ~0.45.
        installSeasonGrass(material, 0.45);
      }
  });
  return seen.size;
}
