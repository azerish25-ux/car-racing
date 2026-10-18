import * as T from 'three';
import type { StreetLightSocket } from './street-light-pools.ts';
import {
  installScannedDetail,
  installScannedMaps,
  libraryAlbedo,
} from '../ground/scanned-ground.ts';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  ROAD_FLAG,
  type RoadEdge,
  type RoadNetwork,
} from '../../simulation/open-world/road-network.ts';
import type { TrackPoint } from '../../simulation/track.ts';
import type { TerrainField } from '../../simulation/open-world/terrain-field.ts';
import { materials } from '../materials/index.ts';
import { OW_NOISE_GLSL } from './terrain-material.ts';
import {
  approachStation,
  bendZones,
  junctionApproaches,
  junctionClearance,
  noOvertaking,
  type Approach,
} from './road-layout.ts';
import { GLYPH, glyphRect, ROAD_PHRASES, roadGlyphAtlas } from './road-glyphs.ts';
import { retroReflective, type RetroUniforms } from './retro-reflect.ts';

/** Chunk edge (m) for culling road geometry. */
const CHUNK = 512;
type SurfaceHeight = (point: TrackPoint, lateral: number) => number;
type ChunkBuilder = (x: number, z: number, layer: Layer) => Builder;
/** Painted line: lateral centre, width, dash pattern (0: solid). */
interface Stripe {
  lateral: number;
  width: number;
  dash: number;
  gap: number;
  layer: Layer;
  /** Continues through junction mouths (runway centreline). */
  junction: boolean;
  /** Painted only where this holds (edge-local station). */
  when?: (s: number) => boolean;
}
const solid = (lateral: number, width: number, layer: Layer = 'paint'): Stripe => ({
  lateral,
  width,
  dash: 0,
  gap: 0,
  layer,
  junction: false,
});
const dashed = (lateral: number, width: number, dash: number, gap: number): Stripe => ({
  lateral,
  width,
  dash,
  gap,
  layer: 'paint',
  junction: false,
});
const roadPoint = (): TrackPoint => ({
  s: 0,
  x: 0,
  y: 0,
  z: 0,
  tx: 0,
  tz: 1,
  nx: 1,
  nz: 0,
  curvature: 0,
  width: 0,
  bank: 0,
  gradient: 0,
});

class Builder {
  positions: number[] = [];
  normals: number[] = [];
  uvs: number[] = [];
  indices: number[] = [];
  get count() {
    return this.positions.length / 3;
  }
  vertex(x: number, y: number, z: number, u: number, v: number, nx = 0, ny = 1, nz = 0) {
    this.positions.push(x, y, z);
    this.normals.push(nx, ny, nz);
    this.uvs.push(u, v);
    return this.count - 1;
  }
  quad(a: number, b: number, c: number, d: number) {
    this.indices.push(a, c, b, b, c, d);
  }
  /** Convex quad given in perimeter order, wound to face up (+y). */
  quadUp(a: number, b: number, c: number, d: number) {
    this.quadFacing(a, b, c, d, 0, 1, 0);
  }
  /** Convex quad in perimeter order, wound to face (fx, fy, fz). */
  quadFacing(a: number, b: number, c: number, d: number, fx: number, fy: number, fz: number) {
    const p = this.positions,
      ux = p[b * 3] - p[a * 3],
      uy = p[b * 3 + 1] - p[a * 3 + 1],
      uz = p[b * 3 + 2] - p[a * 3 + 2],
      vx = p[c * 3] - p[a * 3],
      vy = p[c * 3 + 1] - p[a * 3 + 1],
      vz = p[c * 3 + 2] - p[a * 3 + 2];
    const nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    if (nx * fx + ny * fy + nz * fz > 0) this.indices.push(a, b, c, a, c, d);
    else this.indices.push(a, c, b, a, d, c);
  }
  geometry() {
    if (!this.indices.length) return null;
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(this.positions, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(this.normals, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(this.uvs, 2));
    g.setAttribute('uv1', new T.Float32BufferAttribute(this.uvs, 2));
    g.setIndex(this.indices);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
type Layer =
  | 'asphaltMajor'
  | 'asphalt'
  | 'town'
  | 'dirt'
  | 'verge'
  | 'paving'
  | 'paint'
  | 'yellow'
  | 'antiskid'
  | 'glyph'
  | 'rail'
  | 'concrete'
  | 'sound'
  | 'post';

/** Flush stone shoulders retain the existing physical cross-fall. The narrow
 * dark drainage strip and staggered joints give town streets human scale
 * without introducing a raised, non-colliding kerb into the driving surface. */
function pavingMaterial(wet: { value: number }) {
  const material = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.87 });
  material.name = 'Port Ilse cut-stone footways';
  (material as unknown as { defines: Record<string, string> }).defines = { USE_UV: '' };
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -2;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.owPavingWet = wet;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nuniform float owPavingWet;\n${OW_NOISE_GLSL}\nfloat owPavingJoint;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec2 p = vec2(abs(vUv.x) - 4.6, vUv.y);
  float row = floor(p.y / 0.72);
  vec2 cell = vec2(p.x / 0.48 + mod(row, 2.0) * 0.5, p.y / 0.72);
  vec2 f = fract(cell), aa = max(fwidth(cell), vec2(0.001));
  vec2 seam = smoothstep(vec2(0.012), vec2(0.012) + aa, min(f, 1.0 - f));
  owPavingJoint = 1.0 - seam.x * seam.y;
  float stone = owHash(floor(cell));
  vec3 color = mix(vec3(0.23, 0.225, 0.205), vec3(0.36, 0.345, 0.31), stone);
  color *= 0.94 + 0.1 * owNoise(p * 18.0);
  color = mix(color, vec3(0.09, 0.095, 0.09), owPavingJoint * 0.67);
  float gutter = 1.0 - smoothstep(0.14, 0.24, p.x);
  color = mix(color, vec3(0.115, 0.125, 0.13), gutter * 0.7);
  diffuseColor.rgb = color * (1.0 - owPavingWet * 0.27);
}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>\nroughnessFactor = mix(0.87, 0.38, owPavingWet) + owPavingJoint * 0.08;`,
      );
  };
  material.customProgramCacheKey = () => 'solvane-paving-v1';
  return material;
}

/** Paint has scuffed edges and sparse worn aggregate, filtered by pixel
 * footprint. Markings remain solid enough to read at speed and at night. */
function wornPaint(material: T.MeshStandardMaterial) {
  (material as unknown as { defines: Record<string, string> }).defines = { USE_UV: '' };
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${OW_NOISE_GLSL}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  float detail = 1.0 - smoothstep(0.025, 0.15, length(fwidth(vUv)));
  float grain = owNoise(vUv * vec2(31.0, 24.0));
  float wear = smoothstep(0.66, 0.86, grain) * detail;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.075), wear * 0.65);
}`,
      );
  };
  material.customProgramCacheKey = () => 'solvane-road-paint-v1';
  return material;
}

/** Red resin anti-skid surfacing (樹脂系すべり止め舗装) laid across sharp
 * bends: calcined-bauxite aggregate in a red binder, measured on the touge
 * references at about 1.9x the red, 1.0x the green and 0.9x the blue of the
 * neighbouring asphalt (linear albedo ~0.20/0.075/0.06), worn greyer in the
 * wheel paths and darkened when wet. */
function antiSkidMaterial(wet: { value: number }) {
  const material = new T.MeshStandardMaterial({ color: 0x7c4d45, roughness: 0.9, metalness: 0 });
  material.name = 'Japanese red anti-skid surfacing';
  (material as unknown as { defines: Record<string, string> }).defines = { USE_UV: '' };
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1.5;
  material.polygonOffsetUnits = -5;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.owAntiSkidWet = wet;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nuniform float owAntiSkidWet;\n${OW_NOISE_GLSL}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  float lane = abs(vUv.x);
  // Two wheel paths per lane (lanes ~3.5 m, paths ~0.9 m from lane centre).
  float path = 1.0 - smoothstep(0.25, 0.6, min(abs(lane - 0.85), abs(lane - 2.65)));
  float grit = owNoise(vUv * vec2(9.0, 7.0));
  float patchy = owFbm(vUv * vec2(0.45, 0.12), 1.0);
  vec3 c = diffuseColor.rgb * (0.88 + 0.24 * grit);
  c = mix(c, vec3(0.105, 0.098, 0.094), path * (0.18 + 0.32 * patchy));
  diffuseColor.rgb = c * (1.0 - owAntiSkidWet * 0.3);
}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>\nroughnessFactor = mix(0.9, 0.42, owAntiSkidWet);`,
      );
  };
  material.customProgramCacheKey = () => 'festival-antiskid-v1';
  return material;
}

/** White-painted steel of Japanese guardrails (W-beam and posts): bright
 * paint (measured ~#f3efe9 in sun) with road grime rising from the bottom
 * edge and sparse rust bleed along the run. */
function paintedSteel(color: number, grimeAxis: 'u' | 'y') {
  const material = new T.MeshStandardMaterial({ color, roughness: 0.46, metalness: 0.05 });
  material.name = 'Japanese white guardrail paint';
  (material as unknown as { defines: Record<string, string> }).defines = { USE_UV: '' };
  material.onBeforeCompile = (shader) => {
    const height = grimeAxis === 'u' ? 'vUv.y / 0.35' : 'vUv.y';
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${OW_NOISE_GLSL}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  float h = clamp(${height}, 0.0, 1.0);
  float run = owFbm(vec2(vUv.x * 0.35, 3.1), 1.0);
  float grime = (1.0 - smoothstep(0.0, 0.75, h)) * (0.25 + 0.45 * run);
  float rust = smoothstep(0.78, 0.92, owNoise(vec2(vUv.x * 1.7, h * 6.0))) * 0.35;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.34, 0.31, 0.27), grime * 0.55);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.32, 0.17, 0.08), rust);
}`,
      );
  };
  material.customProgramCacheKey = () => `festival-painted-steel-${grimeAxis}`;
  return material;
}

/** Expressway noise barrier (遮音壁): ribbed aluminium panels 0.5 m high
 * between H-section posts every 2 m on the concrete barrier, light grey. */
function soundWallMaterial() {
  const material = new T.MeshStandardMaterial({
    color: 0xb9bcbc,
    roughness: 0.55,
    metalness: 0.35,
    side: T.DoubleSide,
  });
  material.name = 'Expressway noise barrier';
  (material as unknown as { defines: Record<string, string> }).defines = { USE_UV: '' };
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${OW_NOISE_GLSL}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec2 aa = max(fwidth(vUv), vec2(1e-3));
  float rib = fract(vUv.y / 0.5);
  float groove = 1.0 - smoothstep(0.0, 0.08 + aa.y * 2.0, min(rib, 1.0 - rib));
  float post = fract(vUv.x / 2.0);
  float h = 1.0 - smoothstep(0.0, 0.03 + aa.x * 1.5, min(post, 1.0 - post));
  float stain = owFbm(vUv * vec2(0.2, 0.9), 1.0);
  vec3 c = diffuseColor.rgb * (0.9 + 0.12 * stain);
  c *= 1.0 - groove * 0.3;
  c = mix(c, vec3(0.3, 0.31, 0.31), h * 0.85);
  diffuseColor.rgb = c;
}`,
      );
  };
  material.customProgramCacheKey = () => 'festival-sound-wall-v1';
  return material;
}

/** Dirt track: compacted gravel with wheel ruts, world-space noise, no texture. */
function dirtMaterial() {
  const material = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
  material.name = 'Festival dirt track';
  (material as unknown as { defines: Record<string, string> }).defines = { USE_UV: '' };
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -2;
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${OW_NOISE_GLSL}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec2 q = vUv;
  float lane = abs(q.x);
  float rut = smoothstep(0.35, 0.0, abs(lane - 0.85));
  float grain = owFbm(vec2(q.x * 3.1, q.y * 0.9), 1.0);
  vec3 dirt = mix(vec3(0.20, 0.155, 0.105), vec3(0.30, 0.25, 0.18), grain);
  dirt = mix(dirt, vec3(0.13, 0.10, 0.07), rut * 0.55);
  // Grass creeping in at the crown and the edges.
  float grassy = smoothstep(0.55, 0.85, owFbm(q * vec2(0.6, 0.25), 1.0)) * (smoothstep(0.4, 0.0, lane) + smoothstep(2.2, 2.9, lane));
  diffuseColor.rgb = mix(dirt, vec3(0.07, 0.11, 0.035), grassy * 0.8);
}`,
      );
  };
  material.customProgramCacheKey = () => 'festival-dirt-v1';
  return material;
}
/** Gravel verge strip beside the asphalt. */
function vergeMaterial() {
  const material = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.97, metalness: 0 });
  material.name = 'Festival verge';
  (material as unknown as { defines: Record<string, string> }).defines = { USE_UV: '' };
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -1;
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${OW_NOISE_GLSL}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  float g = owFbm(vUv * vec2(4.0, 1.3), 1.0);
  diffuseColor.rgb = mix(vec3(0.16, 0.145, 0.12), vec3(0.27, 0.25, 0.21), g);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.08, 0.11, 0.04), smoothstep(0.62, 0.8, owFbm(vUv * vec2(1.3, 0.4), 1.0)) * 0.7);
}`,
      );
  };
  material.customProgramCacheKey = () => 'festival-verge-v1';
  return material;
}

/** Photographed loam under the dirt tracks and meadow on the verges (Medium and above). */
function installScannedDirt(material: T.MeshStandardMaterial) {
  installScannedDetail(material, 'forest', { strength: 1, chroma: 0.5, relief: 1.2 });
  return material;
}
function installScannedVerge(material: T.MeshStandardMaterial) {
  installScannedDetail(material, 'meadow', { strength: 0.9, chroma: 0.5, relief: 1 });
  return material;
}

/**
 * Road presentation of the network: asphalt ribbons (fresh on highways and
 * the runway, worn on country and mountain roads, patched in town) from the
 * library's GPU-detailed asphalt with its wet response, gravel verges, dirt
 * tracks, Japanese painted markings by class (white edge lines, orange
 * no-overtaking centre lines, expressway lane lines, town zebra crossings,
 * stop lines, crossing-ahead diamonds and painted 止まれ / カーブ text, optical
 * speed bars; no lines through junction mouths; runway centreline and
 * thresholds), red anti-skid surfacing across sharp bends, bridge decks with
 * beams, piers and parapets, white W-beam guardrails on round posts with
 * amber delineators where the network marks drops (expressway: concrete
 * barrier, with noise walls near towns), and lamp posts along town streets
 * (lit at night). Every height comes from the road surface function the
 * physics reads; nothing here adds a collider.
 */
export class RoadMeshes {
  readonly root = new T.Group();
  readonly lampSockets: StreetLightSocket[] = [];
  readonly materials: Record<Layer, T.Material>;
  readonly lampMaterial: T.MeshStandardMaterial;
  readonly retro: RetroUniforms = { owRetroNight: { value: 0 } };
  readonly reflectorMaterial: T.MeshStandardMaterial;
  /** Galvanised town lamp standards (the guardrail posts are painted). */
  readonly lampPoleMaterial = materials.metal({ kind: 'cast', metal: 'steel', color: 0x8a8d90 });
  private readonly glyphAtlas = roadGlyphAtlas();
  private readonly pavingWet = { value: 0 };
  stats = {
    chunks: 0,
    triangles: 0,
    lamps: 0,
    posts: 0,
    crossings: 0,
    glyphs: 0,
    antiSkidM: 0,
    barrierM: 0,
    soundWallM: 0,
  };
  constructor(
    readonly network: RoadNetwork,
    readonly field: TerrainField,
  ) {
    this.root.name = 'Festival roads';
    // The Low fallback must still read as fine aggregate. The old patched
    // tile repeated large bright islands across every street like cobbles.
    // Photographed maps retain their own measured scale on Medium and above.
    const asphaltMajor = materials.asphalt({ variant: 'fresh', color: 0x3c3d3e, tile: 0.3 });
    const asphalt = materials.asphalt({ variant: 'worn', tile: 0.3 });
    const town = materials.asphalt({
      variant: 'fresh',
      color: 0x424446,
      tile: 0.24,
      puddles: 0.45,
    });
    // Photographed asphalt on Medium and above (ground/scanned-ground.ts).
    for (const m of [asphaltMajor, asphalt, town])
      installScannedMaps(m, 'asphalt', libraryAlbedo(m));
    for (const [m, units] of [
      [asphaltMajor, -4],
      [asphalt, -3],
      [town, -3],
    ] as const) {
      m.polygonOffset = true;
      m.polygonOffsetFactor = -1;
      m.polygonOffsetUnits = units;
    }
    // Japanese road paint: white lines and the orange-yellow (黄色) of
    // no-overtaking centre lines, measured on the references at about
    // sRGB (225, 150, 46) once motion blur and asphalt bleed are removed.
    const paint = wornPaint(
      new T.MeshStandardMaterial({ color: 0xdedcd5, roughness: 0.55, metalness: 0 }),
    );
    const yellow = wornPaint(
      new T.MeshStandardMaterial({ color: 0xe0952e, roughness: 0.55, metalness: 0 }),
    );
    const glyph = new T.MeshStandardMaterial({
      color: 0xdedcd5,
      map: this.glyphAtlas,
      alphaTest: 0.45,
      roughness: 0.55,
      metalness: 0,
    });
    glyph.name = 'Painted Japanese road text';
    for (const m of [paint, yellow, glyph]) {
      m.polygonOffset = true;
      m.polygonOffsetFactor = -2;
      m.polygonOffsetUnits = -6;
    }
    this.lampMaterial = new T.MeshStandardMaterial({
      color: 0xfff1d6,
      emissive: 0xffd9a0,
      emissiveIntensity: 0.05,
      roughness: 0.4,
    });
    // Amber prismatic delineators (視線誘導標) on the guardrail posts.
    this.reflectorMaterial = retroReflective(
      new T.MeshStandardMaterial({
        color: 0xffa21c,
        emissive: 0xff9a1a,
        emissiveIntensity: 0.02,
        roughness: 0.3,
      }),
      this.retro,
      14,
    );
    this.materials = {
      asphaltMajor,
      asphalt,
      town,
      dirt: installScannedDirt(dirtMaterial()),
      verge: installScannedVerge(vergeMaterial()),
      paving: pavingMaterial(this.pavingWet),
      paint,
      yellow,
      antiskid: antiSkidMaterial(this.pavingWet),
      glyph,
      rail: Object.assign(paintedSteel(0xeeece6, 'u'), { side: T.DoubleSide }),
      concrete: Object.assign(materials.concrete({ variant: 'rough', horizontal: 0 }), {
        side: T.DoubleSide,
      }),
      sound: soundWallMaterial(),
      post: paintedSteel(0xe8e6e0, 'y'),
    };
    this.build();
  }
  private layerOf(e: RoadEdge): Layer {
    if (e.spec.surface === 'dirt') return 'dirt';
    if (e.roadClass === 'town') return 'town';
    if (e.roadClass === 'highway' || e.roadClass === 'runway') return 'asphaltMajor';
    return 'asphalt';
  }
  private build() {
    const net = this.network,
      chunks = new Map<string, Map<Layer, Builder>>();
    const builder = (x: number, z: number, layer: Layer) => {
      const key = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
      let chunk = chunks.get(key);
      if (!chunk) chunks.set(key, (chunk = new Map()));
      let b = chunk.get(layer);
      if (!b) chunk.set(layer, (b = new Builder()));
      return b;
    };
    const p = roadPoint(),
      q = roadPoint();
    const posts: T.Matrix4[] = [],
      lamps: T.Matrix4[] = [];
    for (const e of net.edges) {
      const spec = e.spec,
        hw = spec.halfWidth,
        crown = spec.crown,
        layer = this.layerOf(e),
        height: SurfaceHeight = (pt, l) => net.surfaceHeight(pt, l, hw, crown);
      const across = [-hw, -hw * 0.5, 0, hw * 0.5, hw];
      // Running surface and verges, segment by segment.
      for (let i = e.first; i < e.last; i++) {
        net.pointOnSegment(i, 0, p);
        net.pointOnSegment(i, 1, q);
        const mx = (p.x + q.x) / 2,
          mz = (p.z + q.z) / 2,
          v0 = p.s - e.offset,
          v1 = q.s - e.offset;
        const b = builder(mx, mz, layer);
        const row = (pt: TrackPoint, v: number) =>
          across.map((l) => b.vertex(pt.x + pt.nx * l, height(pt, l), pt.z + pt.nz * l, l, v));
        const r0 = row(p, v0),
          r1 = row(q, v1);
        for (let k = 0; k < across.length - 1; k++) b.quad(r0[k], r0[k + 1], r1[k], r1[k + 1]);
        // Verges (gravel, falling slightly away), not on bridges.
        const bridge =
          (net.flags[i] & ROAD_FLAG.BRIDGE) !== 0 && (net.flags[i + 1] & ROAD_FLAG.BRIDGE) !== 0;
        if (spec.shoulder > 0.2 && !bridge) {
          const vb = builder(
            mx,
            mz,
            e.roadClass === 'town'
              ? 'paving'
              : e.roadClass === 'highway' || e.roadClass === 'runway'
                ? layer
                : 'verge',
          );
          for (const side of [-1, 1]) {
            const edge = (pt: TrackPoint, v: number) => {
              const inner = vb.vertex(
                pt.x + pt.nx * side * hw,
                height(pt, side * hw) - 0.005,
                pt.z + pt.nz * side * hw,
                side * hw,
                v,
              );
              const w = hw + spec.shoulder,
                outer = vb.vertex(
                  pt.x + pt.nx * side * w,
                  height(pt, side * hw) - 0.06 - spec.shoulder * 0.03,
                  pt.z + pt.nz * side * w,
                  side * w,
                  v,
                );
              return [inner, outer];
            };
            const [a0, a1] = edge(p, v0),
              [c0, c1] = edge(q, v1);
            if (side > 0) vb.quad(a0, a1, c0, c1);
            else vb.quad(a1, a0, c1, c0);
          }
        }
        if (bridge)
          this.bridgeSegment(
            builder(mx, mz, 'concrete'),
            e.roadClass === 'highway' || e.roadClass === 'runway' ? null : builder(mx, mz, 'post'),
            p,
            q,
            hw + spec.shoulder,
            height,
            posts,
          );
        // Guardrails where the network marks them (not on bridges: parapets).
        // Expressways use a concrete barrier on the same collision-backed
        // face, with a noise wall on top where the road passes a town.
        for (const [bit, side] of [
          [ROAD_FLAG.BARRIER_LEFT, -1],
          [ROAD_FLAG.BARRIER_RIGHT, 1],
        ] as const)
          if (!bridge && net.flags[i] & bit && net.flags[i + 1] & bit) {
            if (e.roadClass === 'highway') {
              const sound = this.nearTown(mx, mz);
              this.barrierSegment(
                builder(mx, mz, 'concrete'),
                sound ? builder(mx, mz, 'sound') : null,
                p,
                q,
                side,
                hw + spec.shoulder + 0.35,
                height,
              );
              this.stats.barrierM += q.s - p.s;
              if (sound) this.stats.soundWallM += q.s - p.s;
            } else
              this.railSegment(
                builder(mx, mz, 'rail'),
                p,
                q,
                side,
                hw + spec.shoulder + 0.35,
                height,
                posts,
              );
          }
      }
      this.markings(e, builder);
      this.bendMarkings(e, builder);
      if (e.roadClass === 'town') this.townLamps(e, lamps);
      this.piers(e, builder);
    }
    for (const approach of junctionApproaches(net)) this.junctionMarkings(approach, builder);
    // Merge per chunk and layer.
    const triangles = { n: 0 };
    for (const [key, chunk] of chunks) {
      const group = new T.Group();
      group.name = `Roads ${key}`;
      for (const [layer, b] of chunk) {
        const g = b.geometry();
        if (!g) continue;
        triangles.n += b.indices.length / 3;
        const mesh = new T.Mesh(g, this.materials[layer]);
        mesh.name = `${layer} ${key}`;
        mesh.receiveShadow = true;
        mesh.castShadow = layer === 'rail' || layer === 'concrete' || layer === 'sound';
        mesh.matrixAutoUpdate = false;
        group.add(mesh);
      }
      this.root.add(group);
    }
    // Guardrail posts and town lamps: instanced.
    if (posts.length) {
      // Round steel posts (φ140 mm pipe), painted like the beam, 0.85 m
      // above the surface with 0.15 m into the verge.
      const post = new T.InstancedMesh(
        new T.CylinderGeometry(0.07, 0.07, 1, 8).translate(0, 0.35, 0),
        this.materials.post,
        posts.length,
      );
      posts.forEach((m, i) => post.setMatrixAt(i, m));
      post.name = 'Guardrail posts';
      post.castShadow = true;
      post.computeBoundingSphere();
      this.root.add(post);
      // Delineators share existing rail-post anchors: no new obstacle in a
      // shoulder. A φ100 mm amber prism on a short stem above every second
      // post, facing along the road both ways (retroreflective at night).
      const lens = new T.CylinderGeometry(0.05, 0.05, 0.035, 12)
        .rotateZ(Math.PI / 2)
        .translate(0, 0.98, 0);
      const stem = new T.BoxGeometry(0.02, 0.12, 0.02).translate(0, 0.89, 0);
      const reflectors = new T.InstancedMesh(
        mergeGeometries([lens, stem], false)!,
        this.reflectorMaterial,
        Math.ceil(posts.length / 2),
      );
      for (let i = 0, k = 0; i < posts.length; i += 2, k++) reflectors.setMatrixAt(k, posts[i]);
      reflectors.name = 'Varda and coast guardrail reflectors';
      reflectors.computeBoundingSphere();
      this.root.add(reflectors);
    }
    if (lamps.length) {
      const pole = new T.CylinderGeometry(0.07, 0.1, 7, 6).translate(0, 3.5, 0);
      const arm = new T.BoxGeometry(1.4, 0.08, 0.08).translate(0.6, 7, 0);
      const head = new T.BoxGeometry(0.6, 0.14, 0.32).translate(1.25, 6.92, 0);
      const metal = mergeGeometries([pole, arm], false)!;
      const poles = new T.InstancedMesh(metal, this.lampPoleMaterial, lamps.length);
      const heads = new T.InstancedMesh(head, this.lampMaterial, lamps.length);
      lamps.forEach((m, i) => {
        poles.setMatrixAt(i, m);
        heads.setMatrixAt(i, m);
        this.lampSockets.push({
          position: new T.Vector3(1.25, 6.82, 0).applyMatrix4(m),
          target: new T.Vector3(2.3, 0.08, 0).applyMatrix4(m),
        });
      });
      poles.name = 'Town lamp posts';
      heads.name = 'Town lamp heads';
      poles.castShadow = true;
      poles.computeBoundingSphere();
      heads.computeBoundingSphere();
      this.root.add(poles, heads);
    }
    this.stats.chunks = chunks.size;
    this.stats.triangles = triangles.n;
    this.stats.lamps = lamps.length;
    this.stats.posts = posts.length;
  }
  /** Patch of road surface between edge-local stations [s0, s1] and
   * laterals [l0, l1], lifted `lift` m off the running surface, split into
   * pieces of at most `step` m so it follows crests and camber. `uv` maps a
   * corner (station, lateral) to texture coordinates. */
  private patch(
    e: RoadEdge,
    builder: ChunkBuilder,
    layer: Layer,
    s0: number,
    s1: number,
    l0: number,
    l1: number,
    lift: number,
    uv?: (s: number, l: number) => readonly [number, number],
    step = 2,
  ) {
    const net = this.network,
      hw = e.spec.halfWidth;
    let a = this.patchA,
      b = this.patchB;
    s0 = Math.max(0, s0);
    s1 = Math.min(e.length, s1);
    if (s1 - s0 < 0.01) return;
    const pieces = Math.max(1, Math.ceil((s1 - s0) / step));
    net.at(e.offset + s0, a);
    for (let k = 0; k < pieces; k++) {
      const sa = s0 + ((s1 - s0) * k) / pieces,
        sb = s0 + ((s1 - s0) * (k + 1)) / pieces;
      net.at(e.offset + sb, b);
      const out = builder((a.x + b.x) / 2, (a.z + b.z) / 2, layer);
      const corner = (pt: TrackPoint, s: number, l: number) => {
        const t = uv?.(s, l);
        return out.vertex(
          pt.x + pt.nx * l,
          net.surfaceHeight(pt, l, hw, e.spec.crown) + lift,
          pt.z + pt.nz * l,
          t ? t[0] : l,
          t ? t[1] : s,
        );
      };
      out.quad(corner(a, sa, l0), corner(a, sa, l1), corner(b, sb, l0), corner(b, sb, l1));
      [a, b] = [b, a];
    }
  }
  private readonly patchA = roadPoint();
  private readonly patchB = roadPoint();
  /** Painted lines by class, to Japanese practice (道路標示): white solid
   * edge lines; on two-lane roads an orange (黄色) no-overtaking centre line
   * wherever bends limit sight (all mountain roads), a white 6 m / 9 m
   * broken line on open straights and a 5 m / 5 m broken line in town;
   * expressways with 20 cm edge lines, 8 m / 12 m lane lines and an orange
   * double centre line; runway markings. No lines through junction mouths. */
  private markings(e: RoadEdge, builder: ChunkBuilder) {
    const spec = e.spec,
      hw = spec.halfWidth;
    if (spec.markings === 'none') return;
    const lines: Stripe[] = [];
    if (spec.markings === 'motorway') {
      lines.push(solid(-(hw - 0.75), 0.2), solid(hw - 0.75, 0.2));
      lines.push(solid(-0.15, 0.15, 'yellow'), solid(0.15, 0.15, 'yellow'));
      lines.push(dashed(-3.6, 0.15, 8, 12), dashed(3.6, 0.15, 8, 12));
    } else if (spec.markings === 'centre') {
      const town = e.roadClass === 'town',
        edge = hw - (town ? 0.45 : 0.27);
      lines.push(solid(-edge, 0.15), solid(edge, 0.15));
      if (town) lines.push(dashed(0, 0.15, 5, 5));
      else {
        const orange = noOvertaking(this.network, e);
        lines.push({ ...solid(0, 0.15, 'yellow'), when: orange });
        lines.push({ ...dashed(0, 0.15, 6, 9), when: (s) => !orange(s) });
      }
    } else if (spec.markings === 'runway') {
      lines.push({ ...solid(0, 0.9), dash: 30, gap: 20, junction: true });
      lines.push(solid(-(hw - 1), 0.9), solid(hw - 1, 0.9));
    }
    const clear = spec.markings === 'runway' ? [0, 0] : junctionClearance(this.network, e);
    const step = 2;
    for (const line of lines) {
      const period = line.dash > 0 ? line.dash + line.gap : e.length,
        w = line.width / 2;
      for (let d0 = 0; d0 < e.length; d0 += period) {
        const d1 = Math.min(e.length, line.dash > 0 ? d0 + line.dash : e.length);
        // Contiguous painted runs within the dash (one patch each).
        let run = -1;
        for (let s = d0; s < d1 - 0.05; s += step) {
          const sb = Math.min(d1, s + step);
          // No lines through junction mouths.
          const paint =
            (line.junction || (s >= clear[0] && sb <= e.length - clear[1])) &&
            (!line.when || line.when((s + sb) / 2));
          if (paint && run < 0) run = s;
          if (!paint && run >= 0) {
            this.patch(e, builder, line.layer, run, s, line.lateral - w, line.lateral + w, 0.012);
            run = -1;
          }
          if (paint && sb >= d1 - 0.05)
            this.patch(e, builder, line.layer, run, sb, line.lateral - w, line.lateral + w, 0.012);
        }
      }
    }
    // Runway thresholds: piano keys across both ends.
    if (spec.markings === 'runway') {
      const net = this.network,
        p = roadPoint();
      for (const s of [12, e.length - 42]) {
        if (s < 0 || s > e.length) continue;
        net.at(e.offset + s, p);
        const a = { ...p };
        net.at(e.offset + s + 30, p);
        const b = { ...p };
        for (let k = -6; k <= 6; k++) {
          if (k === 0) continue;
          const l = k * 1.9,
            bb = builder(a.x, a.z, 'paint');
          const corner = (pt: TrackPoint, ll: number, v: number) =>
            bb.vertex(
              pt.x + pt.nx * ll,
              net.surfaceHeight(pt, ll, hw, spec.crown) + 0.012,
              pt.z + pt.nz * ll,
              ll,
              v,
            );
          bb.quad(
            corner(a, l - 0.6, 0),
            corner(a, l + 0.6, 0),
            corner(b, l - 0.6, 30),
            corner(b, l + 0.6, 30),
          );
        }
      }
    }
  }
  private inJunction(e: RoadEdge, s: number) {
    const net = this.network;
    for (const node of [net.nodes[e.from], net.nodes[e.to]]) {
      if (node.edges.length < 3) continue;
      const along = node === net.nodes[e.from] ? s : e.length - s;
      if (along < e.spec.halfWidth + 9) return true;
    }
    return false;
  }
  private railSegment(
    b: Builder,
    p: TrackPoint,
    q: TrackPoint,
    side: number,
    lateral: number,
    h: SurfaceHeight,
    posts: T.Matrix4[],
  ) {
    const at = (pt: TrackPoint, dy: number) => [
      pt.x + pt.nx * side * lateral,
      h(pt, side * (lateral - 0.4)) + dy,
      pt.z + pt.nz * side * lateral,
    ];
    // Actual rolled W section (Japanese Gr-B: 350 mm beam, centre ~0.63 m).
    // Two crests and a central trough catch different highlights as the car
    // passes instead of reading as a flat ribbon. It stays within 6 cm of
    // the collision-backed rail line.
    const nx = -p.nx * side,
      nz = -p.nz * side,
      base = 0.46;
    const [ax, ay, az] = at(p, base),
      [bx, by, bz] = at(q, base);
    const profile = [
      [0, 0],
      [0.085, 0.055],
      [0.175, 0],
      [0.265, 0.055],
      [0.35, 0],
    ];
    for (let k = 0; k < profile.length - 1; k++) {
      const [y0, d0] = profile[k],
        [y1, d1] = profile[k + 1];
      const gradient = (d1 - d0) / (y1 - y0),
        norm = Math.hypot(1, gradient);
      const nnx = nx / norm,
        nny = -gradient / norm,
        nnz = nz / norm;
      const a0 = b.vertex(ax + nx * d0, ay + y0, az + nz * d0, p.s, y0, nnx, nny, nnz);
      const a1 = b.vertex(ax + nx * d1, ay + y1, az + nz * d1, p.s, y1, nnx, nny, nnz);
      const b0 = b.vertex(bx + nx * d0, by + y0, bz + nz * d0, q.s, y0, nnx, nny, nnz);
      const b1 = b.vertex(bx + nx * d1, by + y1, bz + nz * d1, q.s, y1, nnx, nny, nnz);
      if (side > 0) b.quad(a0, a1, b0, b1);
      else b.quad(a1, a0, b1, b0);
    }
    if (Math.floor(p.s / 4) !== Math.floor(q.s / 4)) {
      const m = new T.Matrix4().compose(
        new T.Vector3(ax + p.nx * side * 0.12, ay - base, az + p.nz * side * 0.12),
        new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), Math.atan2(p.nx, p.nz)),
        new T.Vector3(1, 0.95, 1),
      );
      posts.push(m);
    }
  }
  /** Expressway concrete barrier (剛性防護柵, F-shape, 0.95 m) on the
   * collision-backed rail face, and optionally a 3 m noise wall on top. */
  private barrierSegment(
    b: Builder,
    wall: Builder | null,
    p: TrackPoint,
    q: TrackPoint,
    side: number,
    lateral: number,
    h: SurfaceHeight,
  ) {
    const extrude = (out: Builder, profile: readonly (readonly [number, number])[]) => {
      const point = (pt: TrackPoint, d: number, y: number) => [
        pt.x + pt.nx * side * (lateral + d),
        h(pt, side * (lateral - 0.4)) + y,
        pt.z + pt.nz * side * (lateral + d),
      ];
      for (let k = 0; k < profile.length - 1; k++) {
        const [d0, y0] = profile[k],
          [d1, y1] = profile[k + 1];
        const len = Math.hypot(d1 - d0, y1 - y0) || 1,
          nd = -(y1 - y0) / len,
          ny = (d1 - d0) / len;
        const vertex = (pt: TrackPoint, d: number, y: number, v: number) => {
          const [x, yy, z] = point(pt, d, y);
          return out.vertex(x, yy, z, pt.s, v, pt.nx * side * nd, ny, pt.nz * side * nd);
        };
        const a0 = vertex(p, d0, y0, y0),
          a1 = vertex(p, d1, y1, y1),
          b0 = vertex(q, d0, y0, y0),
          b1 = vertex(q, d1, y1, y1);
        if (side > 0) out.quad(a0, a1, b0, b1);
        else out.quad(a1, a0, b1, b0);
      }
    };
    extrude(b, [
      [0, -0.25],
      [0, 0.08],
      [0.15, 0.3],
      [0.24, 0.95],
      [0.5, 0.95],
      [0.55, -0.6],
    ]);
    if (wall)
      extrude(wall, [
        [0.3, 0.95],
        [0.3, 3.95],
        [0.42, 3.95],
        [0.42, 0.95],
      ]);
  }
  /** Within 700 m of a town's bounds (noise walls along the expressway). */
  private nearTown(x: number, z: number) {
    return this.network.region.towns.some(
      (t) => x > t.x0 - 700 && x < t.x1 + 700 && z > t.z0 - 700 && z < t.z1 + 700,
    );
  }
  /** Painted phrase in the lane of a driver travelling `dir` along the edge:
   * the first character's far end at station `at` (toward the hazard), the
   * rest nearer the driver, each upright for them and read far-to-near. */
  private phrase(
    e: RoadEdge,
    builder: ChunkBuilder,
    text: string,
    at: number,
    dir: 1 | -1,
    lane: number,
  ) {
    const chars = [...text],
      w = GLYPH.width / 2;
    for (let k = 0; k < chars.length; k++) {
      const far = at - dir * k * (GLYPH.length + GLYPH.gap),
        near = far - dir * GLYPH.length;
      const [u0, v0, u1, v1] = glyphRect(chars[k]);
      this.patch(
        e,
        builder,
        'glyph',
        Math.min(near, far),
        Math.max(near, far),
        lane - w,
        lane + w,
        0.013,
        (s, l) => {
          const u = dir > 0 ? (lane + w - l) / (2 * w) : (l - lane + w) / (2 * w),
            v = (s - near) / (far - near);
          return [u0 + (u1 - u0) * u, v0 + (v1 - v0) * v];
        },
        1.2,
      );
    }
    this.stats.glyphs += chars.length;
  }
  /** Length of a painted phrase along the road (m). */
  private static phraseLength(text: string) {
    const n = [...text].length;
    return n * GLYPH.length + (n - 1) * GLYPH.gap;
  }
  /** Straight painted stripe between two (station, lateral) points. */
  private stripe(
    e: RoadEdge,
    builder: ChunkBuilder,
    sa: number,
    la: number,
    sb: number,
    lb: number,
    width: number,
  ) {
    const net = this.network,
      p = roadPoint(),
      len = Math.hypot(sb - sa, lb - la) || 1,
      os = (-(lb - la) / len) * (width / 2),
      ol = ((sb - sa) / len) * (width / 2);
    net.at(e.offset + (sa + sb) / 2, p);
    const out = builder(p.x, p.z, 'paint');
    const corner = (s: number, l: number) => {
      net.at(e.offset + s, p);
      return out.vertex(
        p.x + p.nx * l,
        net.surfaceHeight(p, l, e.spec.halfWidth, e.spec.crown) + 0.012,
        p.z + p.nz * l,
        l,
        s,
      );
    };
    out.quadUp(
      corner(sa + os, la + ol),
      corner(sb + os, lb + ol),
      corner(sb - os, lb - ol),
      corner(sa - os, la - ol),
    );
  }
  /** Sharp bends of mountain and country roads: red anti-skid surfacing
   * across the carriageway, and on each approach the painted 急カーブ (or
   * 左/右カーブ) text before it with optical speed bars (減速マーク) along the
   * outer edge line, spaced closer toward the bend. */
  private bendMarkings(e: RoadEdge, builder: ChunkBuilder) {
    if (e.spec.markings !== 'centre') return;
    const hw = e.spec.halfWidth,
      edge = hw - 0.27,
      clear = junctionClearance(this.network, e),
      inside = (s: number) => s > clear[0] && s < e.length - clear[1];
    for (const zone of bendZones(this.network, e)) {
      for (const [l0, l1] of [
        [-hw, -hw / 2],
        [-hw / 2, 0],
        [0, hw / 2],
        [hw / 2, hw],
      ])
        this.patch(e, builder, 'antiskid', zone.s0, zone.s1, l0, l1, 0.005);
      this.stats.antiSkidM += zone.s1 - zone.s0;
      for (const dir of [1, -1] as const) {
        const entry = dir > 0 ? zone.s0 : zone.s1,
          left = zone.curvature * dir > 0,
          text =
            Math.abs(zone.curvature) > 1 / 30
              ? ROAD_PHRASES.sharpBend
              : left
                ? ROAD_PHRASES.leftBend
                : ROAD_PHRASES.rightBend,
          at = entry - dir * 6,
          near = at - dir * RoadMeshes.phraseLength(text);
        if (!inside(at) || !inside(near)) continue;
        this.phrase(e, builder, text, at, dir, (-dir * edge) / 2);
        // Bars: 0.45 m deep, 0.8 m in from the edge line, 3 m apart
        // nearest the text widening to 5.5 m upstream.
        let u = 4;
        for (let k = 0; k < 10; k++, u += 3 + k * 0.28) {
          const s = near - dir * u;
          if (!inside(s)) break;
          const l = -dir * edge;
          this.patch(
            e,
            builder,
            'paint',
            Math.min(s, s - dir * 0.45),
            Math.max(s, s - dir * 0.45),
            Math.min(l, l + dir * 0.8),
            Math.max(l, l + dir * 0.8),
            0.012,
          );
        }
      }
    }
  }
  /** One arm of a junction: zebra crosswalk (横断歩道: 0.45 m bars and
   * gaps, 4 m deep) across town arms just outside the junction box; on minor
   * arms a 0.45 m stop line across the approach lane with 止まれ behind it;
   * crossing-ahead diamonds (ダイヤマーク) 30 m and 50 m before town
   * crosswalks. */
  private junctionMarkings(a: Approach, builder: ChunkBuilder) {
    const e = a.edge,
      hw = e.spec.halfWidth,
      town = e.roadClass === 'town',
      edge = hw - (town ? 0.45 : 0.27),
      far = junctionClearance(this.network, e)[a.dir > 0 ? 0 : 1],
      st = (along: number) => approachStation(a, along),
      fits = (along: number) => along > 0 && along < e.length - far - 2;
    if (e.spec.markings !== 'centre') return;
    let next = a.mouth + 1.5;
    if (a.crossing && fits(a.mouth + 4)) {
      const n = Math.floor((2 * hw - 0.3) / 0.9),
        first = -((n - 1) * 0.9) / 2,
        s0 = st(a.mouth),
        s1 = st(a.mouth + 4);
      for (let k = 0; k < n; k++) {
        const c = first + k * 0.9;
        this.patch(
          e,
          builder,
          'paint',
          Math.min(s0, s1),
          Math.max(s0, s1),
          c - 0.225,
          c + 0.225,
          0.012,
        );
      }
      next = a.mouth + 5;
      this.stats.crossings++;
    }
    const lane: [number, number] = a.dir > 0 ? [-edge, -0.1] : [0.1, edge];
    if (a.minor && fits(next + 12)) {
      const s0 = st(next),
        s1 = st(next + 0.45);
      this.patch(e, builder, 'paint', Math.min(s0, s1), Math.max(s0, s1), lane[0], lane[1], 0.012);
      this.phrase(e, builder, ROAD_PHRASES.stop, st(next + 2.4), a.dir, (lane[0] + lane[1]) / 2);
    }
    if (!a.crossing) return;
    for (const along of [next + 30, next + 50]) {
      if (!fits(along + 3)) continue;
      const c = (lane[0] + lane[1]) / 2,
        sn = st(along - 2.5),
        sf = st(along + 2.5),
        sm = st(along);
      // Rhombus outline: 1.5 m wide, 5 m long, 0.2 m lines.
      this.stripe(e, builder, sn, c, sm, c - 0.75, 0.2);
      this.stripe(e, builder, sm, c - 0.75, sf, c, 0.2);
      this.stripe(e, builder, sf, c, sm, c + 0.75, 0.2);
      this.stripe(e, builder, sm, c + 0.75, sn, c, 0.2);
    }
  }
  /** Bridge deck beam and parapets for one segment. Expressways keep the
   * 1.0 m concrete wall parapet; other roads get a 0.4 m concrete kerb
   * with a painted three-rail steel railing to 1.1 m (posts every 2 m), as
   * on the touge and city bridges of the references. */
  private bridgeSegment(
    b: Builder,
    railing: Builder | null,
    p: TrackPoint,
    q: TrackPoint,
    half: number,
    h: SurfaceHeight,
    posts: T.Matrix4[],
  ) {
    for (const side of [-1, 1]) {
      const pa = [p.x + p.nx * side * half, h(p, side * half), p.z + p.nz * side * half],
        qa = [q.x + q.nx * side * half, h(q, side * half), q.z + q.nz * side * half];
      const nx = p.nx * side,
        nz = p.nz * side;
      // Parapet: inner face, top, outer face down to the beam soffit.
      const top = railing ? 0.4 : 1.0,
        depth = 1.5,
        t = 0.32;
      const inner = [pa[0] - nx * t, pa[2] - nz * t],
        innerQ = [qa[0] - nx * t, qa[2] - nz * t];
      const i0 = b.vertex(inner[0], pa[1], inner[1], p.s, 0, -nx, 0, -nz),
        i1 = b.vertex(inner[0], pa[1] + top, inner[1], p.s, top, -nx, 0, -nz),
        j0 = b.vertex(innerQ[0], qa[1], innerQ[1], q.s, 0, -nx, 0, -nz),
        j1 = b.vertex(innerQ[0], qa[1] + top, innerQ[1], q.s, top, -nx, 0, -nz);
      if (side > 0) b.quad(i1, i0, j1, j0);
      else b.quad(i0, i1, j0, j1);
      const t0 = b.vertex(inner[0], pa[1] + top, inner[1], p.s, 0),
        t1 = b.vertex(pa[0], pa[1] + top, pa[2], p.s, t),
        u0 = b.vertex(innerQ[0], qa[1] + top, innerQ[1], q.s, 0),
        u1 = b.vertex(qa[0], qa[1] + top, qa[2], q.s, t);
      if (side > 0) b.quad(t0, t1, u0, u1);
      else b.quad(t1, t0, u1, u0);
      const o0 = b.vertex(pa[0], pa[1] + top, pa[2], p.s, 0, nx, 0, nz),
        o1 = b.vertex(pa[0], pa[1] - depth, pa[2], p.s, top + depth, nx, 0, nz),
        k0 = b.vertex(qa[0], qa[1] + top, qa[2], q.s, 0, nx, 0, nz),
        k1 = b.vertex(qa[0], qa[1] - depth, qa[2], q.s, top + depth, nx, 0, nz);
      if (side > 0) b.quad(o0, o1, k0, k1);
      else b.quad(o1, o0, k1, k0);
      if (railing)
        this.bridgeRailing(railing, p, q, side, half - t / 2, pa[1] + top, qa[1] + top, posts);
    }
    // Soffit.
    const l = [p.x - p.nx * half, h(p, -half) - 1.5, p.z - p.nz * half],
      r = [p.x + p.nx * half, h(p, half) - 1.5, p.z + p.nz * half],
      l2 = [q.x - q.nx * half, h(q, -half) - 1.5, q.z - q.nz * half],
      r2 = [q.x + q.nx * half, h(q, half) - 1.5, q.z + q.nz * half];
    const a = b.vertex(l[0], l[1], l[2], -half, p.s, 0, -1, 0),
      c = b.vertex(r[0], r[1], r[2], half, p.s, 0, -1, 0),
      d = b.vertex(l2[0], l2[1], l2[2], -half, q.s, 0, -1, 0),
      e = b.vertex(r2[0], r2[1], r2[2], half, q.s, 0, -1, 0);
    b.quad(c, a, e, d);
  }
  /** Three 60 mm square rails at 0.3, 0.52 and 0.7 m above the kerb top
   * (to 1.1 m over the deck), with a round post (shared with the guardrail
   * posts) wherever the segment crosses a 2 m station. */
  private bridgeRailing(
    b: Builder,
    p: TrackPoint,
    q: TrackPoint,
    side: number,
    lateral: number,
    ya: number,
    yb: number,
    posts: T.Matrix4[],
  ) {
    const r = 0.03,
      nx = p.nx * side,
      nz = p.nz * side,
      ax = p.x + nx * lateral,
      az = p.z + nz * lateral,
      bx = q.x + q.nx * side * lateral,
      bz = q.z + q.nz * side * lateral;
    const ring = [
      [r, r],
      [-r, r],
      [-r, -r],
      [r, -r],
    ];
    for (const dy of [0.3, 0.52, 0.7])
      for (let k = 0; k < 4; k++) {
        const [n0, u0] = ring[k],
          [n1, u1] = ring[(k + 1) % 4],
          fn = (n0 + n1) / (2 * r),
          fu = (u0 + u1) / (2 * r);
        const v = (x: number, y: number, z: number, n: number, u: number, s: number) =>
          b.vertex(x + nx * n, y + dy + u, z + nz * n, s, dy + u, nx * fn, fu, nz * fn);
        b.quadFacing(
          v(ax, ya, az, n0, u0, p.s),
          v(ax, ya, az, n1, u1, p.s),
          v(bx, yb, bz, n1, u1, q.s),
          v(bx, yb, bz, n0, u0, q.s),
          nx * fn,
          fu,
          nz * fn,
        );
      }
    if (Math.floor(p.s / 2) !== Math.floor(q.s / 2))
      posts.push(
        new T.Matrix4().compose(
          new T.Vector3(ax, ya + 0.12, az),
          new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), Math.atan2(p.nx, p.nz)),
          new T.Vector3(0.55, 0.72, 0.55),
        ),
      );
  }
  /** Bridge piers down to the natural ground every ~32 m of span. */
  private piers(e: RoadEdge, builder: (x: number, z: number, layer: Layer) => Builder) {
    const net = this.network,
      p = roadPoint();
    let run = -1;
    for (let i = e.first; i <= e.last; i++) {
      const bridge = (net.flags[i] & ROAD_FLAG.BRIDGE) !== 0;
      if (!bridge) {
        run = -1;
        continue;
      }
      const s = net.s[i] - e.offset;
      if (run < 0) run = s;
      if (
        s - run < 16 ||
        Math.floor((s - run) / 32) ===
          Math.floor((net.s[Math.max(e.first, i - 1)] - e.offset - run) / 32)
      )
        continue;
      net.at(net.s[i], p);
      const top = p.y - 1.5,
        ground = this.field.height(p.x, p.z) - 1;
      if (top - ground < 2) continue;
      const b = builder(p.x, p.z, 'concrete');
      if (e.roadClass === 'highway') {
        // Elevated-expressway T pier (references 013, 037, 075): one
        // 2.0 x 2.6 m column under a 1.6 m deep crosshead spanning the deck.
        const half = e.spec.halfWidth + e.spec.shoulder - 0.4;
        this.prism(b, p, 0, 1.0, 1.3, ground, top - 1.6, false);
        this.prism(b, p, 0, 0.9, half, top - 1.6, top, true);
        continue;
      }
      for (const side of [-1, 1]) {
        const off = side * Math.max(1.2, e.spec.halfWidth * 0.45);
        const cx = p.x + p.nx * off,
          cz = p.z + p.nz * off;
        // A square column (0.9 m) as four faces.
        const w = 0.45;
        const corners = [
          [cx - p.tx * w - p.nx * w, cz - p.tz * w - p.nz * w],
          [cx + p.tx * w - p.nx * w, cz + p.tz * w - p.nz * w],
          [cx + p.tx * w + p.nx * w, cz + p.tz * w + p.nz * w],
          [cx - p.tx * w + p.nx * w, cz - p.tz * w + p.nz * w],
        ];
        for (let k = 0; k < 4; k++) {
          const [ax, az] = corners[k],
            [bx, bz] = corners[(k + 1) % 4];
          const mx = (ax + bx) / 2 - cx,
            mz = (az + bz) / 2 - cz,
            len = Math.hypot(mx, mz) || 1;
          const a0 = b.vertex(ax, ground, az, 0, ground, mx / len, 0, mz / len),
            a1 = b.vertex(ax, top, az, 0, top, mx / len, 0, mz / len),
            b0 = b.vertex(bx, ground, bz, 0.9, ground, mx / len, 0, mz / len),
            b1 = b.vertex(bx, top, bz, 0.9, top, mx / len, 0, mz / len);
          b.quad(a0, b0, a1, b1);
        }
      }
    }
  }
  /** Box from y0 to y1 centred `off` m across the road at p, `ht` m half
   * along and `hn` m half across; optional underside. */
  private prism(
    b: Builder,
    p: TrackPoint,
    off: number,
    ht: number,
    hn: number,
    y0: number,
    y1: number,
    bottom: boolean,
  ) {
    const cx = p.x + p.nx * off,
      cz = p.z + p.nz * off;
    const corner = (st: number, sn: number) =>
      [cx + p.tx * ht * st + p.nx * hn * sn, cz + p.tz * ht * st + p.nz * hn * sn] as const;
    const ring = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
    for (let k = 0; k < 4; k++) {
      const [ax, az] = ring[k],
        [bx, bz] = ring[(k + 1) % 4],
        mx = (ax + bx) / 2 - cx,
        mz = (az + bz) / 2 - cz,
        len = Math.hypot(mx, mz) || 1,
        nx = mx / len,
        nz = mz / len,
        w = Math.hypot(bx - ax, bz - az);
      b.quadFacing(
        b.vertex(ax, y0, az, 0, y0, nx, 0, nz),
        b.vertex(bx, y0, bz, w, y0, nx, 0, nz),
        b.vertex(bx, y1, bz, w, y1, nx, 0, nz),
        b.vertex(ax, y1, az, 0, y1, nx, 0, nz),
        nx,
        0,
        nz,
      );
    }
    if (bottom)
      b.quadFacing(
        ...(ring.map(([x, z]) => b.vertex(x, y0, z, x, z, 0, -1, 0)) as [
          number,
          number,
          number,
          number,
        ]),
        0,
        -1,
        0,
      );
  }
  private townLamps(e: RoadEdge, lamps: T.Matrix4[]) {
    const net = this.network,
      p = roadPoint();
    for (let s = 12; s < e.length - 12; s += 32) {
      if (this.inJunction(e, s)) continue;
      net.at(e.offset + s, p);
      const side = Math.floor(s / 32) % 2 === 0 ? 1 : -1,
        l = side * (e.spec.halfWidth + e.spec.shoulder - 0.4);
      const m = new T.Matrix4().compose(
        new T.Vector3(
          p.x + p.nx * l,
          net.surfaceHeight(p, side * e.spec.halfWidth, e.spec.halfWidth, e.spec.crown) - 0.1,
          p.z + p.nz * l,
        ),
        // The arm reaches over the road (local +x toward the centreline).
        new T.Quaternion().setFromAxisAngle(
          new T.Vector3(0, 1, 0),
          Math.atan2(side * p.nz, -side * p.nx),
        ),
        new T.Vector3(1, 1, 1),
      );
      lamps.push(m);
    }
  }
  /** Night: street lamps glow (bloom carries them). */
  setNight(night: number) {
    this.lampMaterial.emissiveIntensity = 0.05 + night * 9;
    // A faint self-glow keeps distant delineators legible; the bright
    // return comes from the retroreflection toward the headlights.
    this.reflectorMaterial.emissiveIntensity = 0.02 + night * 0.22;
    this.retro.owRetroNight.value = night;
  }
  setWet(wet: number) {
    this.pavingWet.value = T.MathUtils.clamp(wet, 0, 1);
  }
  dispose() {
    this.root.traverse((o) => {
      if (o instanceof T.Mesh) o.geometry.dispose();
    });
    for (const m of Object.values(this.materials)) m.dispose();
    this.lampMaterial.dispose();
    this.lampPoleMaterial.dispose();
    this.reflectorMaterial.dispose();
    this.glyphAtlas.dispose();
  }
}
