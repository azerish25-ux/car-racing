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

/** Chunk edge (m) for culling road geometry. */
const CHUNK = 512;
type SurfaceHeight = (point: TrackPoint, lateral: number) => number;
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
  | 'rail'
  | 'concrete'
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
 * tracks, painted lines by class (motorway lanes, centre lines, runway
 * centreline and thresholds; no lines through junction mouths), bridge decks
 * with beams, piers and parapets, W-beam guardrails with posts where the
 * network marks drops, and lamp posts along town streets (lit at night).
 * Every height comes from the same road surface function the physics reads.
 */
export class RoadMeshes {
  readonly root = new T.Group();
  readonly lampSockets: StreetLightSocket[] = [];
  readonly materials: Record<Layer, T.Material>;
  readonly lampMaterial: T.MeshStandardMaterial;
  readonly reflectorMaterial = new T.MeshStandardMaterial({
    color: 0xffdf9a,
    emissive: 0xffd071,
    emissiveIntensity: 0.02,
    roughness: 0.27,
  });
  private readonly pavingWet = { value: 0 };
  stats = { chunks: 0, triangles: 0, lamps: 0, posts: 0 };
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
    const paint = wornPaint(
      new T.MeshStandardMaterial({ color: 0xd8d8d2, roughness: 0.55, metalness: 0 }),
    );
    const yellow = wornPaint(
      new T.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.55, metalness: 0 }),
    );
    for (const m of [paint, yellow]) {
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
    this.materials = {
      asphaltMajor,
      asphalt,
      town,
      dirt: installScannedDirt(dirtMaterial()),
      verge: installScannedVerge(vergeMaterial()),
      paving: pavingMaterial(this.pavingWet),
      paint,
      yellow,
      rail: Object.assign(materials.metal({ kind: 'bare', metal: 'steel', roughness: 0.42 }), {
        side: T.DoubleSide,
      }),
      concrete: Object.assign(materials.concrete({ variant: 'rough', horizontal: 0 }), {
        side: T.DoubleSide,
      }),
      post: materials.metal({ kind: 'cast', metal: 'steel', color: 0x8a8d90 }),
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
          this.bridgeSegment(builder(mx, mz, 'concrete'), p, q, hw + spec.shoulder, height);
        // Guardrails where the network marks them (not on bridges: parapets).
        for (const [bit, side] of [
          [ROAD_FLAG.BARRIER_LEFT, -1],
          [ROAD_FLAG.BARRIER_RIGHT, 1],
        ] as const)
          if (!bridge && net.flags[i] & bit && net.flags[i + 1] & bit)
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
      this.markings(e, builder);
      if (e.roadClass === 'town') this.townLamps(e, lamps);
      this.piers(e, builder);
    }
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
        mesh.castShadow = layer === 'rail' || layer === 'concrete';
        mesh.matrixAutoUpdate = false;
        group.add(mesh);
      }
      this.root.add(group);
    }
    // Guardrail posts and town lamps: instanced.
    if (posts.length) {
      const post = new T.InstancedMesh(
        new T.BoxGeometry(0.15, 1, 0.12).translate(0, 0.5, 0),
        this.materials.post,
        posts.length,
      );
      posts.forEach((m, i) => post.setMatrixAt(i, m));
      post.name = 'Guardrail posts';
      post.castShadow = true;
      post.computeBoundingSphere();
      this.root.add(post);
      // Reflectors share existing rail-post anchors: no new obstacle in a
      // shoulder. The low emission aids legibility, without pretending that
      // the reflectors themselves illuminate the road.
      const reflectors = new T.InstancedMesh(
        new T.BoxGeometry(0.18, 0.09, 0.14).translate(0, 0.9, 0),
        this.reflectorMaterial,
        Math.ceil(posts.length / 3),
      );
      for (let i = 0, k = 0; i < posts.length; i += 3, k++) reflectors.setMatrixAt(k, posts[i]);
      reflectors.name = 'Varda and coast guardrail reflectors';
      reflectors.computeBoundingSphere();
      this.root.add(reflectors);
    }
    if (lamps.length) {
      const pole = new T.CylinderGeometry(0.07, 0.1, 7, 6).translate(0, 3.5, 0);
      const arm = new T.BoxGeometry(1.4, 0.08, 0.08).translate(0.6, 7, 0);
      const head = new T.BoxGeometry(0.6, 0.14, 0.32).translate(1.25, 6.92, 0);
      const metal = mergeGeometries([pole, arm], false)!;
      const poles = new T.InstancedMesh(metal, this.materials.post, lamps.length);
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
    this.stats = {
      chunks: chunks.size,
      triangles: triangles.n,
      lamps: lamps.length,
      posts: posts.length,
    };
  }
  /** Painted lines: edge lines, centre lines and runway markings. */
  private markings(e: RoadEdge, builder: (x: number, z: number, layer: Layer) => Builder) {
    const net = this.network,
      spec = e.spec,
      hw = spec.halfWidth;
    if (spec.markings === 'none') return;
    const lines: {
      lateral: number;
      width: number;
      dash: number;
      gap: number;
      layer: Layer;
      junction: boolean;
    }[] = [];
    const edgeLine = { width: 0.15, dash: 0, gap: 0, layer: 'paint' as Layer, junction: false };
    if (spec.markings === 'motorway') {
      lines.push({ ...edgeLine, lateral: -(hw - 0.75) }, { ...edgeLine, lateral: hw - 0.75 });
      lines.push({
        lateral: -0.12,
        width: 0.12,
        dash: 0,
        gap: 0,
        layer: 'yellow',
        junction: false,
      });
      lines.push({ lateral: 0.12, width: 0.12, dash: 0, gap: 0, layer: 'yellow', junction: false });
      lines.push({
        lateral: -3.6,
        width: 0.14,
        dash: 4.5,
        gap: 7.5,
        layer: 'paint',
        junction: false,
      });
      lines.push({
        lateral: 3.6,
        width: 0.14,
        dash: 4.5,
        gap: 7.5,
        layer: 'paint',
        junction: false,
      });
    } else if (spec.markings === 'centre') {
      lines.push({ ...edgeLine, lateral: -(hw - 0.27) }, { ...edgeLine, lateral: hw - 0.27 });
      const solid = e.roadClass === 'mountain';
      lines.push({
        lateral: 0,
        width: 0.13,
        dash: solid ? 0 : 3,
        gap: solid ? 0 : 6,
        layer: 'paint',
        junction: false,
      });
    } else if (spec.markings === 'runway') {
      lines.push({ lateral: 0, width: 0.9, dash: 30, gap: 20, layer: 'paint', junction: true });
      lines.push(
        { ...edgeLine, width: 0.9, lateral: -(hw - 1) },
        { ...edgeLine, width: 0.9, lateral: hw - 1 },
      );
    }
    const p = roadPoint();
    const step = 2;
    for (const line of lines) {
      for (let s = 0; s < e.length - step; s += step) {
        if (line.dash > 0 && s % (line.dash + line.gap) >= line.dash) continue;
        net.at(e.offset + s, p);
        // No lines through junction mouths.
        if (!line.junction && this.inJunction(e, s)) continue;
        const a = { ...p };
        net.at(e.offset + Math.min(e.length, s + step), p);
        const b = { ...p },
          builderAt = builder((a.x + b.x) / 2, (a.z + b.z) / 2, line.layer);
        const corner = (pt: TrackPoint, l: number, v: number) =>
          builderAt.vertex(
            pt.x + pt.nx * l,
            net.surfaceHeight(pt, l, hw, spec.crown) + 0.012,
            pt.z + pt.nz * l,
            l,
            v,
          );
        const w = line.width / 2;
        const a0 = corner(a, line.lateral - w, s),
          a1 = corner(a, line.lateral + w, s),
          b0 = corner(b, line.lateral - w, s + step),
          b1 = corner(b, line.lateral + w, s + step);
        builderAt.quad(a0, a1, b0, b1);
      }
    }
    // Runway thresholds: piano keys across both ends.
    if (spec.markings === 'runway') {
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
    // Actual rolled W section. Two crests and a central trough catch
    // different highlights as the car passes instead of reading as a flat
    // grey ribbon. It stays within 6 cm of the collision-backed rail line.
    const nx = -p.nx * side,
      nz = -p.nz * side;
    const [ax, ay, az] = at(p, 0.6),
      [bx, by, bz] = at(q, 0.6);
    const profile = [
      [0, 0],
      [0.075, 0.055],
      [0.155, 0],
      [0.235, 0.055],
      [0.31, 0],
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
        new T.Vector3(ax + p.nx * side * 0.12, ay - 0.6, az + p.nz * side * 0.12),
        new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), Math.atan2(p.nx, p.nz)),
        new T.Vector3(1, 0.95, 1),
      );
      posts.push(m);
    }
  }
  /** Bridge deck beam and parapets for one segment. */
  private bridgeSegment(b: Builder, p: TrackPoint, q: TrackPoint, half: number, h: SurfaceHeight) {
    for (const side of [-1, 1]) {
      const pa = [p.x + p.nx * side * half, h(p, side * half), p.z + p.nz * side * half],
        qa = [q.x + q.nx * side * half, h(q, side * half), q.z + q.nz * side * half];
      const nx = p.nx * side,
        nz = p.nz * side;
      // Parapet: inner face, top, outer face down to the beam soffit.
      const top = 1.0,
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
    this.reflectorMaterial.emissiveIntensity = 0.02 + night * 0.72;
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
    this.reflectorMaterial.dispose();
  }
}
