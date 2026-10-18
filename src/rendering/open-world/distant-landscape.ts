import * as T from 'three';
import type { LightingMode } from '../daylight.ts';
import type { QualityPreset } from '../options.ts';
import { installSpecularIBLMaterial } from '../studio/ibl-energy.ts';
import { DistantRelief, DISTANT_RELIEF, DISTANT_SNOW } from './distant-relief.ts';
import { bindFestivalAir, FESTIVAL_AIR_GLSL } from './festival-atmosphere.ts';
import { bindSeasonUniforms, SEASON_GLSL } from './season.ts';
import { OW_NOISE_GLSL } from './terrain-material.ts';

/** Mesh resolution per quality tier: ranges (bearings x rings) and the cone
 * (bearings x rings): 30k / 60k / 99k triangles on Low / Medium / High,
 * always 2 draw calls. */
export const DISTANT_MESH = Object.freeze({
  low: { ranges: [320, 34], cone: [192, 44] },
  medium: { ranges: [480, 44], cone: [288, 60] },
  high: { ranges: [640, 52], cone: [384, 76] },
} as const);
export type DistantTier = keyof typeof DISTANT_MESH;
export { DISTANT_SNOW };

/**
 * Low cloud of the references: a cloud band at the cone's foot (036, 088),
 * mist lying in the valleys between ridge layers at golden hour (016, 029).
 * Per lighting: valley mist amount, band amount, band floor and top (m).
 */
export const DISTANT_MIST = Object.freeze({
  day: [0.32, 0.5, 1050, 1420],
  sunset: [0.85, 0.35, 950, 1250],
  night: [0.45, 0.25, 950, 1250],
} as const);

const VERTEX_PARS = /* glsl */ `
attribute vec3 distant;
varying vec3 vDistant;
varying vec3 vDlWorld;
`;
const FRAGMENT_PARS = /* glsl */ `
uniform vec3 dlVolcano;
uniform vec2 dlSnowLine;
uniform vec4 dlMist;
varying vec3 vDistant;
varying vec3 vDlWorld;
float dlMistAmount;
float dlRough;
${SEASON_GLSL}
${OW_NOISE_GLSL}
${FESTIVAL_AIR_GLSL}
`;
/** Ground cover of the distant landscape (linear albedo of real surfaces:
 * conifer/broadleaf canopy 0.03-0.05, scoria 0.06-0.09, rock 0.1, snow 0.8). */
const COLOR_GLSL = /* glsl */ `
{
  vec3 wN = normalize((vec4(vNormal, 0.0) * viewMatrix).xyz);
  float slope = 1.0 - clamp(wN.y, 0.0, 1.0);
  vec2 p = vDlWorld.xz;
  float y = vDlWorld.y;
  float dist = length(vDlWorld - cameraPosition);
  float n1 = owFbm(p * 0.0011, 1.0);
  float n2 = owFbm(p * 0.0046, 1.0 - smoothstep(9000.0, 32000.0, dist));
  vec2 dv = p - dlVolcano.xy;
  float rv = length(dv);
  float cone = vDistant.z;
  float phi = atan(dv.x, dv.y);
  // Snow streaks elongated down the fall line (radial on the cone).
  float streak = owNoise(vec2(phi * 64.0, rv * 0.0019));
  float n3 = owFbm(p * 0.013, 1.0 - smoothstep(3000.0, 14000.0, dist));
  vec4 s = owSeason;
  // Mixed forest: dark conifer stands and lighter broadleaf patches (orange
  // and rust in autumn, bare grey-brown under winter snow).
  vec3 conifer = vec3(0.020, 0.033, 0.019);
  vec3 broadleaf = vec3(0.040, 0.060, 0.026) * (s.x + s.y) + vec3(0.095, 0.048, 0.018) * s.z
    + vec3(0.045, 0.038, 0.032) * s.w;
  vec3 canopy = mix(conifer, broadleaf, smoothstep(0.3, 0.7, 0.55 * n2 + 0.45 * n3));
  // Valleys and gullies read darker (denser stands, less sky).
  canopy *= (0.82 + 0.3 * n1) * (1.0 - 0.25 * vDistant.y);
  vec3 scrub = mix(vec3(0.062, 0.064, 0.038), vec3(0.085, 0.062, 0.034), s.z);
  vec3 scoria = mix(vec3(0.074, 0.064, 0.058), vec3(0.095, 0.09, 0.085), n1);
  vec3 rock = vec3(0.11, 0.104, 0.097) * (0.85 + 0.3 * n2);
  // The cone: forest, then scrub, then bare scoria above the tree line.
  float treeline = 2350.0 + 360.0 * (n1 - 0.5);
  float bare = smoothstep(treeline - 120.0, treeline + 120.0, y) * cone;
  float shrub = smoothstep(treeline - 700.0, treeline - 150.0, y) * cone;
  vec3 col = mix(canopy, scrub, shrub * 0.7);
  col = mix(col, scoria, bare);
  // Ranges: rock on steep faces and the highest crests.
  float rocky = smoothstep(0.42, 0.66, slope + 0.25 * (n2 - 0.5) + 0.2 * smoothstep(1500.0, 2200.0, y))
    * (1.0 - cone);
  col = mix(col, rock, rocky * 0.85);
  // Snow: the season's line, ragged by noise; the gullies carry tongues
  // further down, the ridges between them shed it.
  float line = mix(dlSnowLine.y, dlSnowLine.x, cone) + 300.0 * (n1 - 0.5) + 140.0 * (n2 - 0.5);
  float tongue = cone * (vDistant.x * 460.0 + (streak - 0.5) * 300.0);
  float snow = smoothstep(line - 70.0, line + 70.0, y + tongue);
  snow *= 1.0 - 0.7 * smoothstep(0.62, 0.85, slope) * (1.0 - cone);
  // Aged snow and firn (albedo ~0.65): the references' sunlit cap reads
  // #d3d6e6-#dbdae2 (lum 0.68-0.71), cool, never warmer than the sky.
  vec3 snowC = vec3(0.62, 0.67, 0.76) * (0.95 + 0.1 * n2);
  // Snow on a forest shows through the canopy (grey-white, 064).
  float open = max(bare, rocky);
  vec3 snowCover = mix(mix(canopy, snowC, 0.5), snowC, open);
  col = mix(col, snowCover, snow);
  // Low cloud: valley mist and the band at the cone's foot.
  float valley = dlMist.x * smoothstep(0.22, 0.62, vDistant.y + 0.4 * (n1 - 0.5));
  // The band breaks into banks and wisps (two scales around the cone).
  float band = dlMist.y * cone * smoothstep(dlMist.z - 160.0, dlMist.z + 80.0, y)
    * (1.0 - smoothstep(dlMist.w - 220.0, dlMist.w + 40.0, y))
    * smoothstep(0.4, 0.66, owFbm(vec2(phi * 2.6, rv * 0.00035), 1.0))
    * smoothstep(0.25, 0.7, owFbm(vec2(phi * 11.0, rv * 0.0014), 1.0));
  dlMistAmount = clamp(max(valley, band), 0.0, 1.0);
  col = mix(col, vec3(0.80, 0.81, 0.83), dlMistAmount);
  diffuseColor.rgb = col;
  dlRough = mix(0.95, 0.7, snow);
}
`;

/** The distant landscape's material: lit like the region (sun, sky light,
 * IBL), with its own ground cover and the festival air instead of fog. */
function distantMaterial(uniforms: Record<string, T.IUniform>) {
  const material = new T.MeshStandardMaterial({ roughness: 0.95, metalness: 0, fog: false });
  material.name = 'Festival distant landscape';
  material.userData.festivalAir = false;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    bindSeasonUniforms(shader);
    bindFestivalAir(shader);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vDistant = distant;
vDlWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${COLOR_GLSL}`)
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>\nroughnessFactor = dlRough;`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
// A mist top is a level, sunlit surface.
normal = normalize(mix(normal, (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz, dlMistAmount));`,
      )
      .replace(
        '#include <fog_fragment>',
        'gl_FragColor.rgb = fhAerial(gl_FragColor.rgb, vDlWorld - cameraPosition);',
      );
  };
  material.customProgramCacheKey = () => 'festival-distant-landscape-v1';
  installSpecularIBLMaterial(material);
  return material;
}

interface MeshBuffers {
  position: Float32Array;
  attribute: Float32Array;
  index: number[];
}
function buffers(count: number): MeshBuffers {
  return {
    position: new Float32Array(count * 3),
    attribute: new Float32Array(count * 3),
    index: [],
  };
}
function finish(name: string, data: MeshBuffers, material: T.Material) {
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.BufferAttribute(data.position, 3));
  geometry.setAttribute('distant', new T.BufferAttribute(data.attribute, 3));
  geometry.setIndex(data.index);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const mesh = new T.Mesh(geometry, material);
  mesh.name = name;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.matrixAutoUpdate = false;
  mesh.userData.excludeMotionBlur = true;
  return mesh;
}

/**
 * The landmark volcano and the ranges around the festival region, as two
 * static meshes (one material, no colliders): the ranges on a polar grid from
 * the edge of the streamed terrain to 42 km, and the cone on its own finer
 * polar grid (the cells of the ranges inside it are dropped). Heights come
 * from DistantRelief, which continues the terrain's own edge heights, so the
 * seam lies under the terrain. Cells wholly under the sea are dropped too.
 */
export class DistantLandscape {
  readonly root = new T.Group();
  readonly relief: DistantRelief;
  readonly material: T.MeshStandardMaterial;
  private ranges: T.Mesh | null = null;
  private cone: T.Mesh | null = null;
  private tier: DistantTier | null = null;
  readonly uniforms = {
    dlVolcano: {
      value: new T.Vector3(
        DISTANT_RELIEF.volcano.x,
        DISTANT_RELIEF.volcano.z,
        DISTANT_RELIEF.volcano.profile[2][1],
      ),
    },
    dlSnowLine: { value: new T.Vector2(DISTANT_SNOW.cone[1], DISTANT_SNOW.ranges[1]) },
    dlMist: { value: new T.Vector4(...DISTANT_MIST.day) },
  };
  stats = { triangles: 0, vertices: 0, buildMs: 0 };
  constructor(edge: (x: number, z: number, minWavelength: number) => number, seed: number) {
    this.root.name = 'Festival distant landscape';
    this.relief = new DistantRelief(edge, seed);
    this.material = distantMaterial(this.uniforms);
  }
  /** Build (or rebuild) the meshes for a quality preset. */
  setQuality(preset: QualityPreset) {
    const tier: DistantTier = preset === 'low' ? 'low' : preset === 'medium' ? 'medium' : 'high';
    if (tier === this.tier) return;
    this.tier = tier;
    const start = performance.now();
    this.disposeMeshes();
    const { ranges, cone } = DISTANT_MESH[tier];
    this.ranges = this.buildRanges(ranges[0], ranges[1]);
    this.cone = this.buildCone(cone[0], cone[1]);
    this.root.add(this.ranges, this.cone);
    this.stats.vertices = 0;
    this.stats.triangles = 0;
    for (const mesh of [this.ranges, this.cone]) {
      this.stats.vertices += mesh.geometry.getAttribute('position').count;
      this.stats.triangles += (mesh.geometry.index?.count ?? 0) / 3;
    }
    this.stats.buildMs = performance.now() - start;
  }
  private write(data: MeshBuffers, v: number, x: number, z: number, ox = 0, oz = 0) {
    const s = this.relief.sample(x, z);
    data.position[v * 3] = x - ox;
    data.position[v * 3 + 1] = s.height;
    data.position[v * 3 + 2] = z - oz;
    data.attribute[v * 3] = s.gully;
    data.attribute[v * 3 + 1] = s.valley;
    data.attribute[v * 3 + 2] = s.volcano;
    return s.height;
  }
  private buildRanges(bearings: number, rings: number) {
    const R = DISTANT_RELIEF,
      V = R.volcano,
      data = buffers(bearings * rings),
      heights = new Float32Array(bearings * rings),
      insideCone = new Uint8Array(bearings * rings),
      k = 3.1;
    for (let i = 0; i < bearings; i++) {
      const theta = (i / bearings) * Math.PI * 2,
        sx = Math.sin(theta),
        cz = Math.cos(theta),
        r0 = R.inner / Math.max(Math.abs(sx), Math.abs(cz));
      for (let j = 0; j < rings; j++) {
        const t = j / (rings - 1),
          r = r0 + (R.outer - r0) * (Math.expm1(k * t) / Math.expm1(k)),
          x = sx * r,
          z = cz * r,
          v = i * rings + j;
        heights[v] = this.write(data, v, x, z);
        insideCone[v] = Math.hypot(x - V.x, z - V.z) < V.radius - 200 ? 1 : 0;
      }
    }
    for (let i = 0; i < bearings; i++) {
      const i2 = (i + 1) % bearings;
      for (let j = 0; j < rings - 1; j++) {
        const a = i * rings + j,
          b = i2 * rings + j,
          c = a + 1,
          d = b + 1;
        // The cone's own mesh stands there; the sea hides the drowned cells.
        if (insideCone[a] && insideCone[b] && insideCone[c] && insideCone[d]) continue;
        if (Math.max(heights[a], heights[b], heights[c], heights[d]) < -12) continue;
        data.index.push(a, c, b, b, c, d);
      }
    }
    return finish('Distant ranges', data, this.material);
  }
  private buildCone(bearings: number, rings: number) {
    const V = DISTANT_RELIEF.volcano,
      data = buffers(bearings * (rings + 1));
    for (let i = 0; i < bearings; i++) {
      const phi = (i / bearings) * Math.PI * 2,
        sx = Math.sin(phi),
        cz = Math.cos(phi);
      for (let j = 0; j <= rings; j++) {
        // Rings crowd toward the summit, where the silhouette is read.
        const r = V.radius * (j / rings) ** 1.45;
        this.write(data, i * (rings + 1) + j, V.x + sx * r, V.z + cz * r, V.x, V.z);
      }
    }
    for (let i = 0; i < bearings; i++) {
      const i2 = (i + 1) % bearings;
      for (let j = 0; j < rings; j++) {
        const a = i * (rings + 1) + j,
          b = i2 * (rings + 1) + j,
          c = a + 1,
          d = b + 1;
        if (j > 0) data.index.push(a, c, b);
        data.index.push(b, c, d);
      }
    }
    const mesh = finish('Distant volcano', data, this.material);
    mesh.position.set(V.x, 0, V.z);
    mesh.updateMatrix();
    return mesh;
  }
  /** Season snow lines and the lighting's low cloud. */
  update(mode: LightingMode, seasonIndex: number) {
    const i = Math.min(3, Math.max(0, seasonIndex));
    this.uniforms.dlSnowLine.value.set(DISTANT_SNOW.cone[i], DISTANT_SNOW.ranges[i]);
    const mist = DISTANT_MIST[mode];
    // Winter keeps more low cloud in the valleys.
    this.uniforms.dlMist.value.set(
      Math.min(1, mist[0] * (i === 3 ? 1.35 : 1)),
      mist[1],
      mist[2],
      mist[3],
    );
  }
  private disposeMeshes() {
    for (const mesh of [this.ranges, this.cone]) {
      if (!mesh) continue;
      this.root.remove(mesh);
      mesh.geometry.dispose();
    }
    this.ranges = this.cone = null;
  }
  dispose() {
    this.disposeMeshes();
    this.material.dispose();
  }
}
