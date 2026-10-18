import * as T from 'three';
import { hash01 } from '../../simulation/open-world/noise.ts';
import { StructureGrid, type Structure } from '../../simulation/open-world/placement.ts';
import {
  ROAD_FLAG,
  roadCandidates,
  type RoadEdge,
} from '../../simulation/open-world/road-network.ts';
import type { OpenWorld } from '../../simulation/open-world/world.ts';
import { trackPoint, type TrackPoint } from '../../simulation/track.ts';
import type { QualityPreset } from '../options.ts';
import type { StreetLightSocket } from './street-light-pools.ts';
import {
  approachStation,
  bendZones,
  junctionApproaches,
  junctionClearance,
  type Approach,
} from './road-layout.ts';
import { retroReflective, retroUniforms } from './retro-reflect.ts';
import { roadSignAtlas, SIGN, signRect } from './road-signs.ts';

/** Furniture chunk edge (m): merged geometry per chunk and material. */
const CHUNK = 256;
/** Chunk draw distance by quality (m beyond the chunk's bounding sphere). */
export const FURNITURE_RANGE = Object.freeze({ low: 220, medium: 420, high: 640, ultra: 860 });
/** Power-line spans fade out over the last part of the chunk range. */
const WIRE_FADE = Object.freeze({ low: 160, medium: 300, high: 460, ultra: 620 });
/** Part finishes; matte and metal share one merged 'body' material. */
type Kind = 'matte' | 'metal' | 'sign' | 'mirror' | 'lamp';
type BatchKind = 'body' | 'sign' | 'mirror' | 'lamp';
type Rect = readonly [number, number, number, number];
const UP = new T.Vector3(0, 1, 0);
/** Solid swatch of the chevron board's yellow (delineator lenses). */
const AMBER: Rect = [240 / 1024, 1 - 10 / 1024, 240 / 1024, 1 - 10 / 1024];
/** Spherical cap, base radius 1 on z = 0, apex at z = 1 (convex mirror). */
function convexCap() {
  const theta = 0.42,
    g = new T.SphereGeometry(1, 20, 6, 0, Math.PI * 2, 0, theta).rotateX(Math.PI / 2);
  g.translate(0, 0, -Math.cos(theta));
  g.scale(1 / Math.sin(theta), 1 / Math.sin(theta), 1 / (1 - Math.cos(theta)));
  return g;
}

/** Merged static geometry of one chunk and material (vertex colours; signs
 * also carry atlas UVs). */
class Batch {
  readonly position: number[] = [];
  readonly normal: number[] = [];
  readonly uv: number[] = [];
  readonly color: number[] = [];
  /** 1 for galvanised steel, 0 for concrete and paint (body material). */
  readonly metal: number[] = [];
  readonly index: number[] = [];
  private readonly c = new T.Color();
  /** Append `geometry` transformed by `m` = rotation x axis scale `scale`
   * (no shear), so normals need only M3 · (n / s²), not an inverse. */
  add(
    geometry: T.BufferGeometry,
    m: T.Matrix4,
    scale: T.Vector3,
    tint: number,
    rect?: Rect,
    metal = 0,
  ) {
    const pos = geometry.getAttribute('position').array,
      nor = geometry.getAttribute('normal').array,
      uv = geometry.getAttribute('uv')?.array,
      count = pos.length / 3,
      offset = this.position.length / 3,
      e = m.elements,
      ix = 1 / (scale.x * scale.x),
      iy = 1 / (scale.y * scale.y),
      iz = 1 / (scale.z * scale.z);
    this.c.setHex(tint, T.SRGBColorSpace);
    const { r, g, b } = this.c;
    for (let i = 0; i < count; i++) {
      const x = pos[i * 3],
        y = pos[i * 3 + 1],
        z = pos[i * 3 + 2];
      this.position.push(
        e[0] * x + e[4] * y + e[8] * z + e[12],
        e[1] * x + e[5] * y + e[9] * z + e[13],
        e[2] * x + e[6] * y + e[10] * z + e[14],
      );
      const a = nor[i * 3] * ix,
        c = nor[i * 3 + 1] * iy,
        d = nor[i * 3 + 2] * iz,
        nx = e[0] * a + e[4] * c + e[8] * d,
        ny = e[1] * a + e[5] * c + e[9] * d,
        nz = e[2] * a + e[6] * c + e[10] * d,
        len = Math.hypot(nx, ny, nz) || 1;
      this.normal.push(nx / len, ny / len, nz / len);
      const u = uv ? uv[i * 2] : 0,
        v = uv ? uv[i * 2 + 1] : 0;
      if (rect) this.uv.push(rect[0] + (rect[2] - rect[0]) * u, rect[1] + (rect[3] - rect[1]) * v);
      else this.uv.push(u, v);
      this.color.push(r, g, b);
      this.metal.push(metal);
    }
    const index = geometry.index;
    if (index) {
      const list = index.array;
      for (let i = 0; i < list.length; i++) this.index.push(offset + list[i]);
    } else for (let i = 0; i < count; i++) this.index.push(offset + i);
  }
  geometry() {
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(this.position, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(this.normal, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new T.Float32BufferAttribute(this.color, 3));
    g.setAttribute('furnitureMetal', new T.Float32BufferAttribute(this.metal, 1));
    g.setIndex(this.index);
    g.computeBoundingSphere();
    return g;
  }
}

/** Overhead conductors as screen-aligned ribbons: each segment's two
 * vertices sit on the centreline and the vertex shader widens them across
 * the view to the physical radius or 0.75 px, whichever is larger, scaling
 * opacity by the ratio so a thin far wire fades instead of aliasing into
 * dashes ("phone-wire AA"). */
class WireBatch {
  readonly position: number[] = [];
  readonly direction: number[] = [];
  readonly side: number[] = [];
  readonly radius: number[] = [];
  readonly index: number[] = [];
  segments = 0;
  /** Sagging span from a to b: parabola through the ends (a close match to
   * the catenary at these tensions), `sag` m at mid-span, `n` segments. */
  span(a: T.Vector3, b: T.Vector3, sag: number, radius: number, n = 8) {
    let px = a.x,
      py = a.y,
      pz = a.z;
    for (let k = 1; k <= n; k++) {
      const t = k / n,
        x = a.x + (b.x - a.x) * t,
        y = a.y + (b.y - a.y) * t - 4 * sag * t * (1 - t),
        z = a.z + (b.z - a.z) * t;
      const dx = x - px,
        dy = y - py,
        dz = z - pz,
        len = Math.hypot(dx, dy, dz) || 1,
        o = this.position.length / 3;
      for (const [vx, vy, vz] of [
        [px, py, pz],
        [x, y, z],
      ])
        for (const s of [-1, 1]) {
          this.position.push(vx, vy, vz);
          this.direction.push(dx / len, dy / len, dz / len);
          this.side.push(s);
          this.radius.push(radius);
        }
      this.index.push(o, o + 2, o + 1, o + 1, o + 2, o + 3);
      this.segments++;
      px = x;
      py = y;
      pz = z;
    }
  }
  geometry() {
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(this.position, 3));
    g.setAttribute('wireDir', new T.Float32BufferAttribute(this.direction, 3));
    g.setAttribute('wireSide', new T.Float32BufferAttribute(this.side, 1));
    g.setAttribute('wireRadius', new T.Float32BufferAttribute(this.radius, 1));
    g.setIndex(this.index);
    g.computeBoundingSphere();
    return g;
  }
}

/** Concrete, paint and galvanised steel in one program: vertex colour,
 * and a per-vertex metal flag (roughness 0.82 -> 0.48, metalness 0 -> 0.55). */
function bodyMaterial() {
  const material = new T.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1 });
  material.name = 'Roadside concrete, paint and galvanised steel';
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float furnitureMetal;\nvarying float vFurnitureMetal;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvFurnitureMetal = furnitureMetal;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vFurnitureMetal;')
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
roughnessFactor = mix(0.82, 0.48, vFurnitureMetal);
metalnessFactor = 0.55 * vFurnitureMetal;`,
      );
  };
  material.customProgramCacheKey = () => 'festival-roadside-body-v1';
  return material;
}

function wireMaterial(uniforms: {
  owWireViewport: { value: number };
  owWireFade: { value: number };
}) {
  const material = new T.MeshBasicMaterial({
    color: 0x1b1b1b,
    transparent: true,
    depthWrite: false,
    side: T.DoubleSide,
  });
  material.name = 'Overhead power and telecom lines';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.owWireViewport = uniforms.owWireViewport;
    shader.uniforms.owWireFade = uniforms.owWireFade;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec3 wireDir;
attribute float wireSide;
attribute float wireRadius;
uniform float owWireViewport;
uniform float owWireFade;
varying float vWireAlpha;`,
      )
      .replace(
        '#include <project_vertex>',
        `vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
{
  vec3 along = normalize((modelViewMatrix * vec4(wireDir, 0.0)).xyz);
  vec3 across = cross(along, normalize(-mvPosition.xyz));
  float l = length(across);
  across = l > 1e-4 ? across / l : vec3(0.0, 1.0, 0.0);
  float wireDist = -mvPosition.z;
  float pixel = 2.0 * max(wireDist, 0.1) / (projectionMatrix[1][1] * owWireViewport);
  float halfWidth = max(wireRadius, pixel * 0.75);
  vWireAlpha = (wireRadius / halfWidth) * (1.0 - smoothstep(owWireFade * 0.6, owWireFade, wireDist));
  mvPosition.xyz += across * wireSide * halfWidth;
}
gl_Position = projectionMatrix * mvPosition;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vWireAlpha;')
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\ndiffuseColor.a *= clamp(vWireAlpha, 0.0, 1.0);',
      );
  };
  material.customProgramCacheKey = () => 'festival-wire-aa-v1';
  return material;
}

interface Pole {
  x: number;
  y: number;
  z: number;
  /** Unit outward (away from the road) and along-road directions. */
  ox: number;
  oz: number;
  tx: number;
  tz: number;
  town: boolean;
}

/**
 * Japanese roadside furniture of the festival region, measured from the
 * reference set: concrete utility poles (12 m, φ190-350 mm taper, 30-45 m
 * apart) with crossarms, insulators and pole transformers, and the sagging
 * high-voltage, low-voltage and telecom lines between them plus service
 * drops across town streets; orange-pole convex traffic mirrors (φ800)
 * opposite minor junction arms and on hairpins; yellow/black chevron boards
 * around sharp bends; white delineator posts; red/white corner posts;
 * 止まれ, speed-limit and bend-warning signs; expressway lamp standards (10 m,
 * their light pools join StreetLightPools) and green guide-sign gantries.
 * Everything stands outside every road footprint (checked against the
 * network), on the existing carved ground or road-surface heights, and
 * nothing adds a collider. Merged per 256 m chunk and material; chunks are
 * culled by a per-quality distance.
 */
export class RoadFurniture {
  readonly root = new T.Group();
  readonly lampSockets: StreetLightSocket[] = [];
  /** Ground anchor of every standing item (validation and tests). */
  readonly anchors: { kind: string; x: number; y: number; z: number }[] = [];
  readonly stats = {
    poles: 0,
    transformers: 0,
    wireSpans: 0,
    wireSegments: 0,
    mirrors: 0,
    chevrons: 0,
    delineators: 0,
    signs: 0,
    lamps: 0,
    gantries: 0,
    chunks: 0,
    triangles: 0,
  };
  private readonly atlas = roadSignAtlas();
  private readonly retro = retroUniforms();
  private readonly wireUniforms = { owWireViewport: { value: 1080 }, owWireFade: { value: 400 } };
  private readonly materials: Record<BatchKind | 'wire', T.Material>;
  private readonly lampMaterial: T.MeshStandardMaterial;
  private readonly batches = new Map<string, Batch>();
  private readonly wires = new Map<string, WireBatch>();
  private readonly meshes: T.Mesh[] = [];
  private readonly grid: StructureGrid;
  private readonly candidates = roadCandidates();
  private readonly eye = new T.Vector3();
  private readonly m = new T.Matrix4();
  private readonly basis = new T.Matrix4();
  private readonly q = new T.Quaternion();
  private readonly v = new T.Vector3();
  private readonly s = new T.Vector3();
  private readonly shapes = {
    pole: new T.CylinderGeometry(0.095, 0.175, 1, 8, 1, true).translate(0, 0.5, 0),
    cylinder: new T.CylinderGeometry(1, 1, 1, 8).translate(0, 0.5, 0),
    tube: new T.CylinderGeometry(1, 1, 1, 8, 1, true).translate(0, 0.5, 0),
    thin: new T.CylinderGeometry(1, 1, 1, 6, 1, true).translate(0, 0.5, 0),
    box: new T.BoxGeometry(1, 1, 1),
    disc: new T.CylinderGeometry(1, 1, 1, 18).rotateX(Math.PI / 2),
    dome: convexCap(),
    plane: new T.PlaneGeometry(1, 1),
  };
  constructor(
    readonly world: OpenWorld,
    structures: readonly Structure[],
    /** Ground (or road surface) height at a point: the renderer's height
     * function, so furniture stands on the same carved ground. */
    readonly ground: (x: number, z: number) => number,
  ) {
    this.root.name = 'Japanese roadside furniture';
    this.grid = new StructureGrid(structures);
    this.lampMaterial = new T.MeshStandardMaterial({
      color: 0xf2f4f6,
      emissive: 0xfff0d8,
      emissiveIntensity: 0.05,
      roughness: 0.35,
    });
    const sign = new T.MeshStandardMaterial({
      map: this.atlas,
      roughness: 0.42,
      metalness: 0,
    });
    sign.name = 'Retroreflective sign faces';
    this.materials = {
      body: bodyMaterial(),
      sign: retroReflective(sign, this.retro, 3.2, 26, 'festival-sign-retro'),
      mirror: new T.MeshStandardMaterial({ color: 0xe9edf0, roughness: 0.04, metalness: 1 }),
      lamp: this.lampMaterial,
      wire: wireMaterial(this.wireUniforms),
    };
    this.materials.mirror.name = 'Convex traffic mirror';
    this.build();
    for (const shape of Object.values(this.shapes)) shape.dispose();
  }

  // --- Placement helpers ----------------------------------------------------
  private batch(kind: BatchKind, x: number, z: number) {
    const key = `${kind} ${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
    let b = this.batches.get(key);
    if (!b) this.batches.set(key, (b = new Batch()));
    return b;
  }
  private wireBatch(x: number, z: number) {
    const key = `wire ${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
    let b = this.wires.get(key);
    if (!b) this.wires.set(key, (b = new WireBatch()));
    return b;
  }
  /** Right-handed local frame at (x, y, z): z toward (fx, fz) (outward, or
   * the facing of a sign: planes face +z), y up, x = y × z. */
  private frame(x: number, y: number, z: number, fx: number, fz: number) {
    return this.basis.set(fz, 0, fx, x, 0, 1, 0, y, -fx, 0, fz, z, 0, 0, 0, 1);
  }
  /** Add `shape` scaled by (sx, sy, sz) at local (lx, ly, lz) in `frame`. */
  private part(
    kind: Kind,
    shape: T.BufferGeometry,
    frame: T.Matrix4,
    lx: number,
    ly: number,
    lz: number,
    sx: number,
    sy: number,
    sz: number,
    tint: number,
    rect?: Rect,
    yaw = 0,
  ) {
    this.q.setFromAxisAngle(UP, yaw);
    this.m.compose(this.v.set(lx, ly, lz), this.q, this.s.set(sx, sy, sz)).premultiply(frame);
    const e = this.m.elements;
    const metal = kind === 'metal';
    this.batch(metal || kind === 'matte' ? 'body' : kind, e[12], e[14]).add(
      shape,
      this.m,
      this.s,
      tint,
      rect,
      metal ? 1 : 0,
    );
  }
  /** Free of every road footprint (with `margin`) and every building. */
  private clear(x: number, y: number, z: number, margin: number) {
    if (this.world.network.covering(x, z, y, margin, this.candidates) > 0) return false;
    return !this.grid.blocks(x, z, 0.35);
  }
  private onBridge(e: RoadEdge, s: number, reach = 6) {
    const net = this.world.network;
    for (let i = e.first; i <= e.last; i++) {
      const d = net.s[i] - e.offset - s;
      if (d < -reach) continue;
      if (d > reach) break;
      if (net.flags[i] & ROAD_FLAG.BRIDGE) return true;
    }
    return false;
  }
  private railed(e: RoadEdge, s: number, side: number) {
    const net = this.world.network,
      bit = side < 0 ? ROAD_FLAG.BARRIER_LEFT : ROAD_FLAG.BARRIER_RIGHT;
    for (let i = e.first; i <= e.last; i++) {
      const d = net.s[i] - e.offset - s;
      if (d < -4) continue;
      if (d > 4) break;
      if (net.flags[i] & bit) return true;
    }
    return false;
  }
  /** A post standing `lateral` m from the centreline (signed, Track
   * convention), facing along the road, if the spot is clear. */
  private spot(e: RoadEdge, s: number, lateral: number, p: TrackPoint, kind = 'post') {
    const net = this.world.network;
    net.at(e.offset + s, p);
    const x = p.x + p.nx * lateral,
      z = p.z + p.nz * lateral,
      road = net.surfaceHeight(
        p,
        Math.sign(lateral) * e.spec.halfWidth,
        e.spec.halfWidth,
        e.spec.crown,
      ),
      y = this.ground(x, z);
    if (!Number.isFinite(y) || Math.abs(y - road) > 2.5 || y < 0.4) return null;
    if (!this.clear(x, y, z, 0.25)) return null;
    this.anchors.push({ kind, x, y, z });
    return { x, y, z };
  }

  // --- Build ----------------------------------------------------------------
  private build() {
    const net = this.world.network;
    const approaches = junctionApproaches(net);
    for (const e of net.edges) {
      if (e.roadClass === 'town' || e.roadClass === 'country') this.utilityPoles(e);
      if (e.roadClass === 'country' || e.roadClass === 'mountain') {
        this.bends(e);
        this.delineators(e);
        this.speedSigns(e);
      }
      if (e.roadClass === 'town') this.speedSigns(e);
      if (e.roadClass === 'highway') this.expressway(e);
    }
    for (const a of approaches) this.junctionFurniture(a);
    this.finish();
  }
  private finish() {
    const kinds = new Map<string, number>();
    for (const [key, batch] of this.batches) {
      const kind = key.split(' ')[0] as BatchKind;
      const g = batch.geometry(),
        mesh = new T.Mesh(g, this.materials[kind]);
      mesh.name = `Roadside ${key}`;
      mesh.castShadow = kind === 'body';
      mesh.receiveShadow = kind !== 'lamp';
      mesh.matrixAutoUpdate = false;
      mesh.userData.furnitureKind = kind;
      this.stats.triangles += batch.index.length / 3;
      kinds.set(key.split(' ')[1], 1);
      this.meshes.push(mesh);
      this.root.add(mesh);
    }
    for (const [key, wires] of this.wires) {
      const mesh = new T.Mesh(wires.geometry(), this.materials.wire);
      mesh.name = `Roadside ${key}`;
      mesh.matrixAutoUpdate = false;
      mesh.renderOrder = 2;
      mesh.userData.furnitureKind = 'wire';
      this.stats.wireSegments += wires.segments;
      this.stats.triangles += wires.index.length / 3;
      kinds.set(key.split(' ')[1], 1);
      this.meshes.push(mesh);
      this.root.add(mesh);
    }
    this.stats.chunks = kinds.size;
    this.batches.clear();
    this.wires.clear();
  }

  // --- Utility poles and lines ---------------------------------------------
  /** Concrete distribution poles on one side of town streets and country
   * roads, 30-45 m apart, outside the footprint (town: in the strip
   * between footway and frontage; country: 0.9 m beyond the verge), never
   * in junction mouths or on bridges; lines span consecutive poles. */
  private utilityPoles(e: RoadEdge) {
    const net = this.world.network,
      spec = e.spec,
      town = e.roadClass === 'town',
      seed = e.index * 7919,
      side = hash01(e.index, 3, 0x9e1) < 0.5 ? -1 : 1,
      lateral = side * (spec.halfWidth + spec.shoulder + (town ? 0.4 : 0.9)),
      clear = junctionClearance(net, e),
      p = trackPoint();
    const poles: (Pole | null)[] = [];
    for (let s = clear[0] + 4, k = 0; s < e.length - clear[1] - 4; k++) {
      let at = s;
      // Town lamp standards stand at s = 12 + 32 n, alternating sides.
      const lamp = Math.round((at - 12) / 32) * 32 + 12,
        lampSide = Math.floor(lamp / 32) % 2 === 0 ? 1 : -1;
      if (town && lampSide === side && Math.abs(at - lamp) < 4) at = lamp + 4.5;
      const spot = this.onBridge(e, at) ? null : this.spot(e, at, lateral, p);
      if (spot) {
        poles.push({
          ...spot,
          ox: p.nx * side,
          oz: p.nz * side,
          tx: p.tx,
          tz: p.tz,
          town,
        });
        this.pole(poles[poles.length - 1]!, hash01(seed, k, 11));
      } else poles.push(null);
      s += 30 + 15 * hash01(seed, k, 5);
    }
    for (let k = 0; k + 1 < poles.length; k++) {
      const a = poles[k],
        b = poles[k + 1];
      if (!a || !b || Math.hypot(a.x - b.x, a.z - b.z) > 56) continue;
      this.lines(a, b);
      if (town) this.serviceDrop(e, a, hash01(seed, k, 17));
    }
  }
  private pole(pole: Pole, r: number) {
    const f = this.frame(pole.x, pole.y, pole.z, pole.ox, pole.oz);
    const concrete = 0xa9a8a1,
      steel = 0x8c9092,
      porcelain = 0xd9d6cc;
    // Shaft: 12.5 m (0.5 m buried), φ350 mm at the base, φ190 mm at the top.
    this.part('matte', this.shapes.pole, f, 0, -0.5, 0, 1, 12.5, 1, concrete);
    // Crossarm across the line (toward the road), three pin insulators.
    this.part('metal', this.shapes.box, f, 0, 11.35, -0.2, 0.09, 0.09, 1.9, steel);
    for (const o of [-0.95, -0.4, 0.55])
      this.part('matte', this.shapes.thin, f, 0, 11.4, o, 0.05, 0.16, 0.05, porcelain);
    // Lower arm for the low-voltage bundle and a pole-top cap.
    this.part('metal', this.shapes.box, f, 0, 9.55, -0.1, 0.07, 0.07, 1.0, steel);
    this.part('matte', this.shapes.cylinder, f, 0, 12, 0, 0.1, 0.12, 0.1, 0x8f8e88);
    // Telecom cable clamps.
    this.part('metal', this.shapes.box, f, 0, 6.4, -0.16, 0.12, 0.16, 0.14, 0x4a4c4d);
    if (r < 0.32) {
      // Pole transformer (柱上変圧器) on the field side, with its hanger.
      this.part('metal', this.shapes.cylinder, f, 0, 8.25, 0.42, 0.27, 0.9, 0.27, 0x9aa1a4);
      this.part('metal', this.shapes.box, f, 0, 9.05, 0.2, 0.08, 0.08, 0.5, steel);
      if (r < 0.1)
        this.part('metal', this.shapes.cylinder, f, 0.32, 8.3, 0.36, 0.22, 0.75, 0.22, 0x9aa1a4);
      this.stats.transformers++;
    }
    // Yellow/black reflective sleeve on poles at the carriageway edge.
    if (pole.town || r > 0.55)
      this.part(
        'sign',
        this.shapes.tube,
        f,
        0,
        0.5,
        0,
        0.165,
        1.5,
        0.165,
        0xffffff,
        signRect(SIGN.hazard),
      );
    this.stats.poles++;
  }
  private readonly wa = new T.Vector3();
  private readonly wb = new T.Vector3();
  /** High voltage on the crossarm (sag ~0.45 m at 35 m), the low-voltage
   * bundle (0.6 m) and two telecom cables (0.8 m, heavier and darker). */
  private lines(a: Pole, b: Pole) {
    const span = Math.hypot(a.x - b.x, a.z - b.z),
      wires = this.wireBatch((a.x + b.x) / 2, (a.z + b.z) / 2),
      k = (span / 35) ** 2;
    const at = (p: Pole, out: T.Vector3, o: number, h: number) =>
      out.set(p.x + p.ox * o, p.y + h, p.z + p.oz * o);
    for (const o of [-0.95, -0.4, 0.55])
      wires.span(at(a, this.wa, o, 11.5), at(b, this.wb, o, 11.5), 0.45 * k, 0.006);
    wires.span(at(a, this.wa, -0.55, 9.5), at(b, this.wb, -0.55, 9.5), 0.6 * k, 0.014);
    wires.span(at(a, this.wa, -0.24, 6.5), at(b, this.wb, -0.24, 6.5), 0.8 * k, 0.018);
    wires.span(at(a, this.wa, -0.24, 6.15), at(b, this.wb, -0.24, 6.15), 0.85 * k, 0.012);
    this.stats.wireSpans++;
  }
  /** Service drops from a town pole across the street to a frontage. */
  private serviceDrop(e: RoadEdge, pole: Pole, r: number) {
    if (r > 0.65) return;
    // The pole stands 0.4 m and the frontage 1.2 m beyond the footway edge.
    const edge = e.spec.halfWidth + e.spec.shoulder,
      // Across the street (back past the centreline) or to this side.
      across = r < 0.4,
      d = across ? -(2 * edge + 1.6) : 0.8,
      along = (r - 0.3) * 18,
      x = pole.x + pole.ox * d + pole.tx * along,
      z = pole.z + pole.oz * d + pole.tz * along;
    // Only where a building front stands to take the drop.
    const inward = across ? -1 : 1;
    if (!this.grid.blocks(x + pole.ox * inward * 1.2, z + pole.oz * inward * 1.2, 0)) return;
    const y = this.ground(x, z) + 5.2;
    this.wa.set(pole.x - pole.ox * 0.2, pole.y + 7.6, pole.z - pole.oz * 0.2);
    this.wb.set(x, y, z);
    this.wireBatch(pole.x, pole.z).span(this.wa, this.wb, 0.35, 0.008, 6);
  }

  // --- Bends ------------------------------------------------------------------
  /** Yellow/black chevron boards along the outside of each sharp bend
   * (about every 9 m, board 0.45 x 0.6 m at 1.0-1.6 m), a bend-warning
   * diamond 60 m before it each way, and on hairpins (radius < 25 m) a
   * double convex mirror at the outside of the apex. */
  private bends(e: RoadEdge) {
    const net = this.world.network,
      spec = e.spec,
      p = trackPoint(),
      clear = junctionClearance(net, e);
    for (const zone of bendZones(net, e)) {
      const out = -Math.sign(zone.curvature),
        railed = this.railed(e, zone.apex, out),
        lateral = out * (spec.halfWidth + spec.shoulder + (railed ? 0.95 : 0.7));
      const first = zone.s0 + 6,
        last = zone.s1 - 6,
        count = Math.max(3, Math.round((last - first) / 9) + 1);
      for (let k = 0; k < count; k++) {
        const s = first + ((last - first) * k) / (count - 1),
          spot = this.spot(e, s, lateral, p);
        if (!spot) continue;
        // Faces back along the road (+z = -t, toward forward drivers, whose
        // left is image left); the chevron points into the bend for them,
        // and the mirrored back face does for drivers the other way.
        const f = this.frame(spot.x, spot.y, spot.z, -p.tx, -p.tz);
        this.part('metal', this.shapes.thin, f, 0, -0.3, 0, 0.035, 1.3, 0.035, 0x7d8286);
        this.part('metal', this.shapes.box, f, 0, 1.3, 0.045, 0.46, 0.61, 0.02, 0x8a8f93);
        this.part(
          'sign',
          this.shapes.plane,
          f,
          0,
          1.3,
          0.058,
          0.45,
          0.6,
          1,
          0xffffff,
          signRect(SIGN.chevron, 1, zone.curvature < 0),
        );
        this.part(
          'sign',
          this.shapes.plane,
          f,
          0,
          1.3,
          0.032,
          0.45,
          0.6,
          1,
          0xffffff,
          signRect(SIGN.chevron, 1, zone.curvature > 0),
          Math.PI,
        );
        this.stats.chevrons++;
      }
      for (const dir of [1, -1] as const) {
        const s = (dir > 0 ? zone.s0 : zone.s1) - dir * 60;
        if (s < clear[0] || s > e.length - clear[1]) continue;
        const left = zone.curvature * dir > 0;
        this.postSign(e, s, dir, left ? SIGN.curveLeft : SIGN.curveRight, 0.9, 0.9, p);
      }
      if (Math.abs(zone.curvature) > 1 / 25) {
        const spot = this.spot(e, zone.apex, out * (spec.halfWidth + spec.shoulder + 1.2), p);
        if (spot) this.mirror(spot.x, spot.y, spot.z, -p.nx * out, -p.nz * out, 0.95);
      }
    }
  }
  /** Sign facing drivers travelling `dir`, on their right, `w` x `h` m with
   * its centre at 2.3 m (Japanese minimum 1.8 m to the bottom edge). */
  private postSign(
    e: RoadEdge,
    s: number,
    dir: 1 | -1,
    cell: number,
    w: number,
    h: number,
    p: TrackPoint,
  ) {
    const spec = e.spec,
      lateral = -dir * (spec.halfWidth + spec.shoulder + (this.railed(e, s, -dir) ? 1.0 : 0.6)),
      spot = this.spot(e, s, lateral, p);
    if (!spot) return false;
    // Frame z toward the approaching driver (-dir along the road).
    const f = this.frame(spot.x, spot.y, spot.z, -dir * p.tx, -dir * p.tz);
    this.part('metal', this.shapes.thin, f, 0, -0.3, -0.09, 0.038, 2.15 + h, 0.038, 0x8a8f93);
    this.part(
      'metal',
      this.shapes.box,
      f,
      0,
      1.85 + h / 2,
      -0.04,
      w * 0.96,
      h * 0.96,
      0.02,
      0x8a8f93,
    );
    this.part(
      'sign',
      this.shapes.plane,
      f,
      0,
      1.85 + h / 2,
      -0.022,
      w,
      h,
      1,
      0xffffff,
      signRect(cell),
    );
    this.stats.signs++;
    return true;
  }
  /** Convex mirror on a 3.4 m orange pole: two φ800 mirrors at ±`spread`
   * rad about the facing direction (fx, fz), orange backs and hoods. */
  private mirror(x: number, y: number, z: number, fx: number, fz: number, spread: number) {
    const f = this.frame(x, y, z, fx, fz),
      orange = 0xe8641c;
    this.part('matte', this.shapes.thin, f, 0, -0.3, 0, 0.038, 3.6, 0.038, orange);
    this.part('matte', this.shapes.box, f, 0, 3.05, 0, 0.9, 0.06, 0.06, orange);
    for (const sideSign of [-1, 1]) {
      const yaw = sideSign * spread * 0.5,
        cx = sideSign * 0.45;
      this.part(
        'matte',
        this.shapes.disc,
        f,
        cx,
        3.0,
        -0.02,
        0.43,
        0.43,
        0.06,
        orange,
        undefined,
        yaw,
      );
      this.part(
        'mirror',
        this.shapes.dome,
        f,
        cx,
        3.0,
        0.01,
        0.39,
        0.39,
        0.06,
        0xffffff,
        undefined,
        yaw,
      );
      this.part(
        'matte',
        this.shapes.box,
        f,
        cx,
        3.45,
        0.06,
        0.6,
        0.03,
        0.16,
        orange,
        undefined,
        yaw,
      );
    }
    this.stats.mirrors++;
  }

  // --- Delineators and signs ----------------------------------------------
  /** White delineator posts (φ60, 1.0 m) with amber φ100 reflectors along
   * unrailed country and mountain edges: every 50 m, staggered sides. */
  private delineators(e: RoadEdge) {
    const net = this.world.network,
      spec = e.spec,
      p = trackPoint(),
      clear = junctionClearance(net, e);
    for (let s = clear[0] + 10, k = 0; s < e.length - clear[1] - 10; s += 25, k++) {
      const side = k % 2 ? 1 : -1;
      if (this.railed(e, s, side) || this.onBridge(e, s, 3)) continue;
      const spot = this.spot(e, s, side * (spec.halfWidth + spec.shoulder + 0.45), p);
      if (!spot) continue;
      const f = this.frame(spot.x, spot.y, spot.z, p.nx * side, p.nz * side);
      this.part('matte', this.shapes.thin, f, 0, -0.25, 0, 0.032, 1.3, 0.032, 0xe9e8e2);
      // One 100 mm amber prism block facing along the road both ways.
      this.part('sign', this.shapes.box, f, 0, 0.92, 0, 0.075, 0.1, 0.1, 0xffffff, AMBER);
      this.stats.delineators++;
    }
  }
  /** Speed limits by class (town 30, country 50, mountain 40) about every
   * 1.4 km per direction, a little past each junction. */
  private speedSigns(e: RoadEdge) {
    const net = this.world.network,
      p = trackPoint(),
      clear = junctionClearance(net, e),
      cell =
        e.roadClass === 'town'
          ? SIGN.speed30
          : e.roadClass === 'mountain'
            ? SIGN.speed40
            : SIGN.speed50;
    for (const dir of [1, -1] as const) {
      const start = dir > 0 ? clear[0] + 22 : e.length - clear[1] - 22;
      for (let u = 0; u < e.length - clear[0] - clear[1] - 44; u += 1400) {
        const s = start + dir * u;
        for (const nudge of [0, 6, -6, 12])
          if (this.postSign(e, s + nudge, dir, cell, 0.6, 0.6, p)) break;
      }
    }
  }
  /** Minor arms: 止まれ sign at the stop line, red/white corner posts and
   * a double convex mirror across the junction facing the arm. */
  private junctionFurniture(a: Approach) {
    const e = a.edge,
      net = this.world.network,
      p = trackPoint();
    if (!a.minor || e.spec.markings !== 'centre') return;
    const stop = a.mouth + (a.crossing ? 5 : 1.5);
    this.postSign(e, approachStation(a, stop + 0.6), a.dir, SIGN.stop, 0.8, 0.7, p);
    if (e.roadClass !== 'town')
      for (const side of [-1, 1]) {
        const s = approachStation(a, a.mouth + 1.5),
          spot = this.spot(e, s, side * (e.spec.halfWidth + e.spec.shoulder + 0.55), p);
        if (!spot) continue;
        const f = this.frame(spot.x, spot.y, spot.z, p.nx, p.nz);
        this.part(
          'sign',
          this.shapes.tube,
          f,
          0,
          -0.2,
          0,
          0.05,
          1.4,
          0.05,
          0xffffff,
          signRect(SIGN.banded),
        );
      }
    // Across the junction, opposite the arm, facing back up it.
    const node = net.nodes[a.node];
    net.at(e.offset + approachStation(a, 2), p);
    const ux = node.x - p.x,
      uz = node.z - p.z,
      len = Math.hypot(ux, uz) || 1,
      dx = ux / len,
      dz = uz / len;
    let reach = 0;
    for (const index of node.edges) {
      const o = net.edges[index];
      if (o !== e) reach = Math.max(reach, o.spec.halfWidth + o.spec.shoulder);
    }
    for (const shift of [0, 1, -1]) {
      const lateral = shift * (e.spec.halfWidth + e.spec.shoulder + 1.2),
        x = node.x + dx * (reach + 1.1) + dz * lateral,
        z = node.z + dz * (reach + 1.1) - dx * lateral,
        y = this.ground(x, z);
      if (!Number.isFinite(y) || Math.abs(y - node.y) > 2 || !this.clear(x, y, z, 0.3)) continue;
      this.anchors.push({ kind: 'mirror', x, y, z });
      this.mirror(x, y, z, -dx, -dz, 1.1);
      break;
    }
  }

  // --- Expressway -------------------------------------------------------------
  /** 10 m lamp standards every 40 m on alternating sides with the head
   * reaching 2 m over the shoulder (a light-pool socket each), and green
   * guide-sign gantries every ~1.8 km clear of junctions. */
  private expressway(e: RoadEdge) {
    const net = this.world.network,
      spec = e.spec,
      p = trackPoint(),
      clear = junctionClearance(net, e);
    for (let s = clear[0] + 12, k = 0; s < e.length - clear[1] - 12; s += 40, k++) {
      const side = k % 2 ? 1 : -1;
      net.at(e.offset + s, p);
      const bridge = this.onBridge(e, s, 2);
      let x: number, y: number, z: number;
      if (bridge) {
        // On the parapet top.
        const l = side * (spec.halfWidth + spec.shoulder - 0.16);
        x = p.x + p.nx * l;
        z = p.z + p.nz * l;
        y = net.surfaceHeight(p, side * spec.halfWidth, spec.halfWidth, spec.crown) + 1.0;
      } else {
        const spot = this.spot(e, s, side * (spec.halfWidth + spec.shoulder + 0.7), p);
        if (!spot) continue;
        ({ x, y, z } = spot);
      }
      const f = this.frame(x, y, z, p.nx * side, p.nz * side),
        steel = 0x9a9ea1;
      const pole = bridge ? 9.0 : 10.0;
      this.part('metal', this.shapes.tube, f, 0, -0.3, 0, 0.085, pole + 0.3, 0.085, steel);
      this.part(
        'metal',
        this.shapes.box,
        f,
        0,
        pole - 0.05,
        -0.75,
        0.07,
        0.07,
        1.6,
        steel,
        undefined,
      );
      this.part('metal', this.shapes.box, f, 0, pole - 0.35, -0.15, 0.06, 0.6, 0.06, steel);
      this.part('lamp', this.shapes.box, f, 0, pole - 0.12, -1.75, 0.34, 0.12, 0.7, 0xffffff);
      const head = new T.Vector3(0, pole - 0.2, -1.75).applyMatrix4(f),
        target = new T.Vector3(0, 0, -4.2).applyMatrix4(f);
      target.y = net.surfaceHeight(p, 0, spec.halfWidth, spec.crown);
      this.lampSockets.push({ position: head, target });
      this.stats.lamps++;
    }
    // Gantries.
    for (let s = clear[0] + 260, k = 0; s < e.length - clear[1] - 120; s += 1800, k++)
      this.gantry(e, s, k, p);
  }
  private gantry(e: RoadEdge, s: number, k: number, p: TrackPoint) {
    const net = this.world.network,
      spec = e.spec,
      reach = spec.halfWidth + spec.shoulder + 1.2;
    if (this.onBridge(e, s, 20)) return;
    net.at(e.offset + s, p);
    const feet: { x: number; y: number; z: number }[] = [];
    for (const side of [-1, 1]) {
      const x = p.x + p.nx * side * reach,
        z = p.z + p.nz * side * reach,
        y = this.ground(x, z);
      if (!Number.isFinite(y) || Math.abs(y - p.y) > 3 || !this.clear(x, y, z, 0.6)) return;
      feet.push({ x, y, z });
      this.anchors.push({ kind: 'gantry', x, y, z });
    }
    const steel = 0x9ca1a3,
      deck = p.y + 7.6;
    for (const foot of feet) {
      const f = this.frame(foot.x, foot.y, foot.z, p.nx, p.nz);
      this.part('metal', this.shapes.tube, f, 0, -0.4, 0, 0.26, deck - foot.y + 1.2, 0.26, steel);
    }
    const f = this.frame(p.x, 0, p.z, p.nx, p.nz);
    // Twin-chord beam across the carriageway.
    for (const dy of [0, 0.9])
      this.part('metal', this.shapes.box, f, 0, deck + dy, 0, 0.22, 0.22, reach * 2, steel);
    for (let l = -reach; l <= reach; l += 1.8)
      this.part('metal', this.shapes.box, f, 0, deck + 0.45, l, 0.1, 0.9, 0.1, steel);
    // A guide board over the right-hand carriageway of each direction
    // (5.4 x 2.7 m, bottom 5.2 m above the road) and an exit panel beside
    // it over the shoulder, hung on the driver's side of the beam. In the
    // board's frame (+z toward the driver) local +x is the driver's right.
    for (const dir of [1, -1] as const) {
      const g = this.frame(p.x, 0, p.z, -dir * p.tx, -dir * p.tz),
        lx = spec.halfWidth * 0.5,
        lz = 0.25;
      const cell = SIGN.guide[(k + (dir > 0 ? 0 : 1)) % SIGN.guide.length];
      this.part('metal', this.shapes.box, g, lx, deck - 1.25, lz - 0.06, 5.5, 2.8, 0.08, 0x6d7275);
      this.part(
        'sign',
        this.shapes.plane,
        g,
        lx,
        deck - 1.25,
        lz,
        5.4,
        2.7,
        1,
        0xffffff,
        signRect(cell, 2),
      );
      this.part(
        'metal',
        this.shapes.box,
        g,
        lx + 3.4,
        deck - 0.9,
        lz - 0.06,
        1.25,
        1.25,
        0.08,
        0x6d7275,
      );
      this.part(
        'sign',
        this.shapes.plane,
        g,
        lx + 3.4,
        deck - 0.9,
        lz,
        1.2,
        1.2,
        1,
        0xffffff,
        signRect(SIGN.exit),
      );
    }
    this.stats.gantries++;
  }

  // --- Runtime ----------------------------------------------------------------
  update(camera: T.Camera, preset: QualityPreset, viewportHeight: number) {
    camera.getWorldPosition(this.eye);
    const range = FURNITURE_RANGE[preset];
    this.wireUniforms.owWireViewport.value = Math.max(240, viewportHeight);
    this.wireUniforms.owWireFade.value = WIRE_FADE[preset];
    for (const mesh of this.meshes) {
      const sphere = mesh.geometry.boundingSphere!;
      const reach = mesh.userData.furnitureKind === 'wire' ? WIRE_FADE[preset] : range;
      mesh.visible = this.eye.distanceTo(sphere.center) - sphere.radius < reach;
    }
  }
  setNight(night: number) {
    this.lampMaterial.emissiveIntensity = 0.05 + night * 9;
    this.retro.owRetroNight.value = night;
    (this.materials.wire as T.MeshBasicMaterial).color.setHex(night > 0.5 ? 0x070707 : 0x1b1b1b);
  }
  dispose() {
    for (const mesh of this.meshes) mesh.geometry.dispose();
    for (const material of Object.values(this.materials)) material.dispose();
    this.atlas.dispose();
    this.root.clear();
    this.root.removeFromParent();
  }
}
