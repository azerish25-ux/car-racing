import * as T from 'three';
import { StructureGrid, type Structure } from '../../simulation/open-world/placement.ts';
import type { RoadEdge } from '../../simulation/open-world/road-network.ts';
import type { OpenWorld } from '../../simulation/open-world/world.ts';
import { trackPoint } from '../../simulation/track.ts';
import type { QualityPreset } from '../options.ts';
import { isApartment, LOT, type ArchitecturePlan } from './japan-architecture.ts';
import { approachStation, junctionApproaches, junctionClearance } from './road-layout.ts';
import type { SignLight } from './festival-signage.ts';

/** Street life of the festival towns (refs 014, 030, 038, 053, 066, 068,
 * 069, 086): the small things on a Japanese pavement and at its junctions.
 * Measured (real-world sizes where the photos are ambiguous):
 *
 * - steel bollards 0.85 m, 114 mm pipe, black with a reflective band, at
 *   corners and in front of busy frontages, 1.3-2.4 m apart (030, 014);
 * - pedestrian guard fences (横断防止柵) 0.8 m, 2.0 m panels, white or dark
 *   green tube, along the kerb either side of a crosswalk (068, 053);
 * - mamachari bicycles (26" wheels, 1.85 m long, basket) parked in groups
 *   against shop fronts (012, 030, 038), concrete planters (030);
 * - traffic cones 0.7 m and water barricades on the pavement (030);
 * - horizontal three-lamp traffic signals (green, amber, red toward the
 *   centre line) on 6 m poles with a 3 m arm, pedestrian signals below;
 *   a 30 s cycle, lit day and night (069 background, 013);
 * - 600 mm iron manhole covers in the lanes; bus stops (round sign,
 *   timetable, bench, shelter) and grey phone booths;
 * - at night, coloured light pools on the pavement under projecting signs,
 *   machines, store fronts and lanterns, and warm spill in front of lit
 *   shopfronts (014, 066, 069: the street glows, not only the signs).
 *
 * Everything is merged per 128 m chunk (one draw for props, one for the
 * light pools), range-culled per quality tier, on the existing ground and
 * road heights. Nothing is a collider; nothing stands on a carriageway
 * (every standing item is >= 0.25 m outside the nearest road's lanes). */
export const TOWN_LIFE = Object.freeze({
  chunk: 192,
  /** Props and pools draw distance (m) per quality tier; signals reach
   * further (they read from a distance). LOW keeps signals only. */
  range: { low: 0, medium: 150, high: 220, ultra: 300 } as Record<QualityPreset, number>,
  signalRange: { low: 180, medium: 260, high: 340, ultra: 420 } as Record<QualityPreset, number>,
  /** Signal cycle (s): green, amber, all-red share per axis. */
  cycle: 30,
});

type Height = (x: number, z: number, y?: number) => number;
const UP = new T.Vector3(0, 1, 0);
type Rect = readonly [number, number, number, number];
const ATLAS_W = 512,
  ATLAS_H = 256;
/** Atlas regions (pixels, y down). */
const AREA = {
  white: [448, 192, 64, 64] as Rect,
  bus: [0, 0, 128, 128] as Rect,
  parking: [128, 0, 128, 128] as Rect,
  phone: [256, 0, 256, 64] as Rect,
  walkRed: [256, 64, 64, 64] as Rect,
  walkGreen: [320, 64, 64, 64] as Rect,
  timetable: [384, 64, 64, 128] as Rect,
};
const FONT = '"Noto Sans JP","Hiragino Sans","Yu Gothic","IPAGothic",sans-serif';
function atlas() {
  if (typeof document === 'undefined') {
    const t = new T.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    t.needsUpdate = true;
    return t;
  }
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_W;
  canvas.height = ATLAS_H;
  const c = canvas.getContext('2d')!;
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, ATLAS_W, ATLAS_H);
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  // Bus stop: white disc, blue ring, バス / のりば.
  c.fillStyle = '#1d4fa0';
  c.beginPath();
  c.arc(64, 64, 62, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#ffffff';
  c.beginPath();
  c.arc(64, 64, 50, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#1d4fa0';
  c.font = `900 34px ${FONT}`;
  c.fillText('バス', 64, 52);
  c.font = `700 20px ${FONT}`;
  c.fillText('のりば', 64, 84);
  // Coin parking: yellow board, black P, 24H.
  c.fillStyle = '#f5c400';
  c.fillRect(132, 4, 120, 120);
  c.fillStyle = '#111111';
  c.font = `900 84px ${FONT}`;
  c.fillText('P', 192, 54);
  c.font = `800 22px ${FONT}`;
  c.fillText('24H 駐車場', 192, 108);
  // Phone booth roof band.
  c.fillStyle = '#1e7a4c';
  c.fillRect(256, 0, 256, 64);
  c.fillStyle = '#ffffff';
  c.font = `800 40px ${FONT}`;
  c.fillText('公衆電話', 384, 33);
  // Pedestrian signal faces: standing red figure, walking green figure.
  const figure = (x: number, colour: string, walking: boolean) => {
    c.fillStyle = '#111214';
    c.fillRect(x, 64, 64, 64);
    c.fillStyle = colour;
    c.beginPath();
    c.arc(x + 32, 76, 6, 0, Math.PI * 2);
    c.fill();
    c.lineWidth = 7;
    c.lineCap = 'round';
    c.strokeStyle = colour;
    c.beginPath();
    c.moveTo(x + 32, 86);
    c.lineTo(x + 32, 104);
    c.moveTo(x + 32, 104);
    c.lineTo(x + (walking ? 22 : 27), 120);
    c.moveTo(x + 32, 104);
    c.lineTo(x + (walking ? 42 : 37), 120);
    c.moveTo(x + 32, 90);
    c.lineTo(x + (walking ? 22 : 25), 100);
    c.moveTo(x + 32, 90);
    c.lineTo(x + (walking ? 42 : 39), 100);
    c.stroke();
  };
  figure(256, '#ff3b2a', false);
  figure(320, '#19e0a5', true);
  // Timetable: white sheet with ruled lines.
  c.fillStyle = '#f4f4ef';
  c.fillRect(384, 64, 64, 128);
  c.fillStyle = '#1d4fa0';
  c.fillRect(384, 64, 64, 16);
  c.fillStyle = '#5a5e64';
  for (let k = 0; k < 12; k++) c.fillRect(390, 88 + k * 8, 52, 2);
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Unit pieces (non-indexed, with normals and uvs). */
const pieces = () => ({
  box: new T.BoxGeometry(1, 1, 1).toNonIndexed(),
  pipe: new T.CylinderGeometry(1, 1, 1, 8).toNonIndexed(),
  tube: new T.CylinderGeometry(1, 1, 1, 5, 1, true).toNonIndexed(),
  disc: new T.CircleGeometry(1, 16).toNonIndexed(),
  ring: new T.TorusGeometry(1, 0.06, 3, 14).toNonIndexed(),
  cone: new T.ConeGeometry(1, 1, 8, 1, true).toNonIndexed(),
  blob: new T.IcosahedronGeometry(1, 1).toNonIndexed(),
  plane: new T.PlaneGeometry(1, 1).toNonIndexed(),
});
type Pieces = ReturnType<typeof pieces>;

/** Emitter codes of the props material (attribute townGlow.x). */
const GLOW = { none: 0, lamp: 1, signal: 2, walk: 3 } as const;
type Kit = 'bicycle' | 'bollard' | 'fence' | 'cone' | 'planter';
const KITS: readonly Kit[] = ['bicycle', 'bollard', 'fence', 'cone', 'planter'];
interface ChunkEntry {
  props: Chunk;
  signals: Chunk;
  pools: Pools;
  kits: Map<Kit, { matrix: T.Matrix4; color: number }[]>;
}

/** Merged chunk geometry: position, normal, uv (atlas), colour, glow. */
class Chunk {
  readonly position: number[] = [];
  readonly normal: number[] = [];
  readonly uv: number[] = [];
  readonly color: number[] = [];
  readonly glow: number[] = [];
  private readonly p = new T.Vector3();
  private readonly n = new T.Vector3();
  private readonly nm = new T.Matrix3();
  private readonly c = new T.Color();
  constructor(readonly centre: T.Vector3) {}
  add(
    g: T.BufferGeometry,
    m: T.Matrix4,
    color: number,
    glow: readonly [number, number, number] = [0, 0, 0],
    rect: Rect = AREA.white,
  ) {
    const pos = g.getAttribute('position'),
      nor = g.getAttribute('normal'),
      uv = g.getAttribute('uv');
    this.nm.getNormalMatrix(m);
    this.c.setHex(color);
    const textured = rect !== AREA.white;
    for (let i = 0; i < pos.count; i++) {
      this.p.fromBufferAttribute(pos, i).applyMatrix4(m);
      this.n.fromBufferAttribute(nor, i).applyMatrix3(this.nm).normalize();
      this.position.push(this.p.x, this.p.y, this.p.z);
      this.normal.push(this.n.x, this.n.y, this.n.z);
      const u = textured ? uv.getX(i) : 0.5,
        v = textured ? uv.getY(i) : 0.5;
      this.uv.push((rect[0] + rect[2] * u) / ATLAS_W, 1 - (rect[1] + rect[3] * (1 - v)) / ATLAS_H);
      this.color.push(this.c.r, this.c.g, this.c.b);
      this.glow.push(glow[0], glow[1], glow[2]);
    }
  }
  get triangles() {
    return this.position.length / 9;
  }
  finish() {
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(this.position, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(this.normal, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new T.Float32BufferAttribute(this.color, 3));
    g.setAttribute('townGlow', new T.Float32BufferAttribute(this.glow, 3));
    g.computeBoundingSphere();
    return g;
  }
}
/** Light pools: ground-conforming 5 x 5 grids, colour x strength, radial uv. */
class Pools {
  readonly position: number[] = [];
  readonly color: number[] = [];
  readonly uv: number[] = [];
  readonly index: number[] = [];
  private readonly c = new T.Color();
  /** An elliptic pool: radius `ra` along the unit axis (ax, az), `rb`
   * across it. */
  add(
    x: number,
    z: number,
    ra: number,
    rb: number,
    ax: number,
    az: number,
    color: number,
    strength: number,
    height: Height,
  ) {
    const base = this.position.length / 3,
      n = 5;
    this.c.setHex(color).multiplyScalar(strength);
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const u = (i / (n - 1)) * 2 - 1,
          v = (j / (n - 1)) * 2 - 1,
          px = x + u * ra * ax - v * rb * az,
          pz = z + u * ra * az + v * rb * ax;
        this.position.push(px, height(px, pz) + 0.05, pz);
        this.uv.push(u, v);
        this.color.push(this.c.r, this.c.g, this.c.b);
      }
    for (let j = 0; j < n - 1; j++)
      for (let i = 0; i < n - 1; i++) {
        const a = base + j * n + i;
        this.index.push(a, a + n, a + 1, a + 1, a + n, a + n + 1);
      }
  }
  get empty() {
    return this.index.length === 0;
  }
  finish() {
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(this.position, 3));
    g.setAttribute('color', new T.Float32BufferAttribute(this.color, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.index);
    g.computeBoundingSphere();
    return g;
  }
}

/** Props: vertex colours, a small sign atlas, and lit lamps (constant,
 * vehicle signals and pedestrian signals on a shared cycle). */
function propsMaterial(map: T.Texture, uniforms: Record<string, T.IUniform>) {
  const material = new T.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    map,
    roughness: 0.55,
    metalness: 0.12,
  });
  material.name = 'Town life props';
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec3 townGlow;\nvarying vec3 vTownGlow;',
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTownGlow = townGlow;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float townNight;
uniform float townTime;
uniform float townCycle;
varying vec3 vTownGlow;
/** Vehicle phase of a signal group (y: 0 major axis, 1 minor; z: junction
 * offset): 0 green, 1 amber, 2 red. */
float townPhase(float axis, float offset) {
  float t = mod(townTime + offset + axis * townCycle * 0.5, townCycle) / townCycle;
  return t < 0.42 ? 0.0 : t < 0.5 ? 1.0 : 2.0;
}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
{
  float kind = vTownGlow.x, on = 0.0;
  if (kind > 0.5 && kind < 1.5) on = vTownGlow.y * (0.06 + townNight);
  else if (kind > 1.5 && kind < 2.5) {
    // Lamp index in y (0 green, 1 amber, 2 red), group in z.
    float lamp = floor(vTownGlow.y + 0.5), axis = floor(vTownGlow.z), offset = fract(vTownGlow.z) * townCycle;
    on = abs(townPhase(axis, offset) - lamp) < 0.5 ? 1.6 + townNight * 2.4 : 0.0;
  } else if (kind > 2.5) {
    // Walk signal: red figure (y 0) unless the parallel traffic is green.
    float axis = floor(vTownGlow.z), offset = fract(vTownGlow.z) * townCycle;
    float walk = townPhase(axis, offset) < 0.5 ? 1.0 : 0.0;
    on = abs(walk - vTownGlow.y) < 0.5 ? 1.2 + townNight * 2.0 : 0.0;
  }
  totalEmissiveRadiance += diffuseColor.rgb * on;
}`,
      );
  };
  material.customProgramCacheKey = () => 'festival-town-life-v1';
  return material;
}
/** Street kit (bicycles, bollards, fences, cones, planters): one instanced
 * draw per kind and chunk; tinted parts (townGlow.x) take the instance
 * colour, chrome, tyres and saddles keep their own. */
function kitMaterial() {
  const material = new T.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.45,
    metalness: 0.35,
  });
  material.name = 'Town street kit';
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 townGlow;')
      .replace(
        '#include <color_vertex>',
        `vColor = color;
#ifdef USE_INSTANCING_COLOR
  vColor = mix(color, instanceColor.rgb, townGlow.x);
#endif`,
      );
  };
  material.customProgramCacheKey = () => 'festival-town-kit-v1';
  return material;
}
/** Additive light pools: soft disc falloff, brighter on wet ground. */
function poolMaterial(uniforms: Record<string, T.IUniform>) {
  return new T.ShaderMaterial({
    name: 'Town light pools',
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: T.AdditiveBlending,
    vertexColors: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
    vertexShader: `varying vec2 vPool; varying vec3 vPoolColor;
      void main() {
        vPool = uv; vPoolColor = color;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `uniform float townNight; uniform float townWet;
      varying vec2 vPool; varying vec3 vPoolColor;
      void main() {
        float r2 = dot(vPool, vPool);
        float a = exp(-r2 * 2.6) * (1.0 - smoothstep(0.55, 1.0, r2));
        if (a * townNight < 0.002) discard;
        gl_FragColor = vec4(vPoolColor * a * townNight * (1.0 + townWet * 0.7), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

function hash(...values: number[]) {
  let h = 0x9e3779b9;
  for (const v of values) h = Math.imul(h ^ (Math.round(v * 16) | 0), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const BIKE_PAINT = [0xc9ccce, 0xf2f2ee, 0x1b1c1e, 0x7fa9c8, 0xb8312f, 0xe6a6b8, 0x3c5a3e, 0xd8c9a8];
const SHRUB = [0x3f5f2e, 0x4c6b34, 0x355a2c];

export class FestivalTownLife {
  readonly root = new T.Group();
  readonly stats = {
    bollards: 0,
    fences: 0,
    bicycles: 0,
    planters: 0,
    cones: 0,
    signals: 0,
    manholes: 0,
    busStops: 0,
    phones: 0,
    coinParks: 0,
    pools: 0,
    chunks: 0,
    triangles: 0,
  };
  private readonly uniforms = {
    townNight: { value: 0 },
    townTime: { value: 0 },
    townCycle: { value: TOWN_LIFE.cycle },
    townWet: { value: 0 },
  };
  private readonly atlas = atlas();
  readonly material = propsMaterial(this.atlas, this.uniforms);
  readonly poolMaterial = poolMaterial(this.uniforms);
  readonly kitMaterial = kitMaterial();
  private readonly kitGeometries = new Map<Kit, T.BufferGeometry>();
  private readonly chunks = new Map<string, ChunkEntry>();
  private readonly meshes: {
    mesh: T.Mesh;
    centre: T.Vector3;
    kind: 'props' | 'signals' | 'pools';
  }[] = [];
  private readonly grid: StructureGrid;
  private readonly p = trackPoint();
  private readonly q = trackPoint();
  private readonly g: Pieces = pieces();
  private readonly taken = new Map<string, { x: number; z: number; r: number }[]>();
  private readonly m = new T.Matrix4();
  private readonly v = new T.Vector3();
  private readonly quat = new T.Quaternion();
  private readonly scale = new T.Vector3();
  /** Konbini car parks (store index, rectangle in its frame). */
  private readonly lots: { s: Structure; side: number; length: number }[] = [];
  /** Coin-park bays (ground point, nose heading) for the parked cars. */
  readonly parkingBays: { x: number; y: number; z: number; yaw: number; lot: number }[] = [];
  constructor(
    readonly world: OpenWorld,
    readonly structures: readonly Structure[],
    readonly plan: ArchitecturePlan,
    readonly height: Height,
    lights: readonly SignLight[],
    /** Points other modules already occupy (poles, signs, machines). */
    occupied: readonly { x: number; z: number; r?: number }[] = [],
  ) {
    this.root.name = 'Festival town life';
    this.grid = new StructureGrid(structures);
    for (const o of occupied) this.take(o.x, o.z, o.r ?? 0.45);
    for (const [i, side] of plan.lotSide)
      this.lots.push({ s: structures[i], side, length: LOT.offset + LOT.length });
    this.townLamps();
    this.coinParks();
    this.junctions();
    this.frontages();
    this.manholes();
    this.busStops();
    this.pools(lights);
    for (const kind of KITS) this.kitGeometries.set(kind, this.kitGeometry(kind));
    const c = new T.Color();
    for (const [key, { props, signals, pools, kits }] of this.chunks) {
      for (const [kind, list] of kits) {
        const geometry = this.kitGeometries.get(kind)!,
          mesh = new T.InstancedMesh(geometry, this.kitMaterial, list.length);
        list.forEach((item, i) => {
          mesh.setMatrixAt(i, item.matrix);
          mesh.setColorAt(i, c.setHex(item.color));
        });
        mesh.name = `Town ${kind} ${key}`;
        mesh.castShadow = kind !== 'bollard';
        mesh.receiveShadow = true;
        mesh.computeBoundingSphere();
        this.stats.triangles += (geometry.getAttribute('position').count / 3) * list.length;
        this.root.add(mesh);
        this.meshes.push({ mesh, centre: props.centre, kind: 'props' });
      }
      for (const [chunk, kind] of [
        [props, 'props'],
        [signals, 'signals'],
      ] as const) {
        if (!chunk.position.length) continue;
        const mesh = new T.Mesh(chunk.finish(), this.material);
        mesh.name = `Town life ${kind} ${key}`;
        mesh.castShadow = kind === 'props';
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        this.stats.triangles += chunk.triangles;
        this.root.add(mesh);
        this.meshes.push({ mesh, centre: chunk.centre, kind });
      }
      if (!pools.empty) {
        const mesh = new T.Mesh(pools.finish(), this.poolMaterial);
        mesh.name = `Town light pools ${key}`;
        mesh.renderOrder = 1;
        mesh.matrixAutoUpdate = false;
        mesh.visible = false;
        this.stats.triangles += pools.index.length / 3;
        this.root.add(mesh);
        this.meshes.push({ mesh, centre: props.centre, kind: 'pools' });
      }
    }
    this.stats.chunks = this.chunks.size;
    this.chunks.clear();
    for (const g of Object.values(this.g)) g.dispose();
  }

  // --- Placement helpers ------------------------------------------------
  private chunk(x: number, z: number) {
    const size = TOWN_LIFE.chunk,
      cx = Math.floor(x / size),
      cz = Math.floor(z / size),
      key = `${cx},${cz}`;
    let entry = this.chunks.get(key);
    if (!entry) {
      const centre = new T.Vector3((cx + 0.5) * size, 0, (cz + 0.5) * size);
      entry = {
        props: new Chunk(centre),
        signals: new Chunk(centre),
        pools: new Pools(),
        kits: new Map(),
      };
      this.chunks.set(key, entry);
    }
    return entry;
  }
  private cell(x: number, z: number) {
    return `${Math.floor(x / 4)},${Math.floor(z / 4)}`;
  }
  private take(x: number, z: number, r: number) {
    const key = this.cell(x, z);
    const list = this.taken.get(key);
    if (list) list.push({ x, z, r });
    else this.taken.set(key, [{ x, z, r }]);
  }
  /** Free of other items, buildings, store car parks and every carriageway
   * (>= 0.25 m outside the nearest road's lanes). */
  private free(x: number, z: number, r: number) {
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++)
        for (const o of this.taken.get(`${Math.floor(x / 4) + i},${Math.floor(z / 4) + j}`) ?? [])
          if (Math.hypot(o.x - x, o.z - z) < o.r + r) return false;
    if (this.grid.blocks(x, z, r + 0.1)) return false;
    for (const { s, side, length } of this.lots) {
      const c = Math.cos(s.heading),
        n = Math.sin(s.heading),
        dx = x - s.x,
        dz = z - s.z,
        lx = (dx * c + dz * n) * side,
        lz = -dx * n + dz * c;
      if (lx > s.hx - 0.5 && lx < s.hx + length + 1 && Math.abs(lz) < s.hz + 2) return false;
    }
    const net = this.world.network,
      lateral = net.nearest(x, z, this.q),
      e = net.edges[net.edgeOf[net.lastSegment]];
    return Math.abs(lateral) >= e.spec.halfWidth + 0.15 + r;
  }
  private inTown(x: number, z: number) {
    return this.world.region.towns.some(
      (t) => x > t.x0 - 20 && x < t.x1 + 20 && z > t.z0 - 20 && z < t.z1 + 20,
    );
  }
  private compose(x: number, y: number, z: number, yaw: number, sx = 1, sy = 1, sz = 1) {
    return this.m.compose(
      this.v.set(x, y, z),
      this.quat.setFromAxisAngle(UP, yaw),
      this.scale.set(sx, sy, sz),
    );
  }
  /** Local frame helper: a point `along` the tangent and `out` along the
   * normal from (x, z) with yaw `yaw` (local +z forward). */
  private local(yaw: number, x: number, z: number, along: number, out: number) {
    const s = Math.sin(yaw),
      c = Math.cos(yaw);
    return [x + s * along + c * out, z + c * along - s * out] as const;
  }

  // --- Pieces -------------------------------------------------------------
  /** Instanced street kit, one geometry each, built at the origin (+z
   * forward, ground at y = 0). Parts with townGlow.x = 1 take the instance
   * colour (bicycle paint, fence paint). */
  private kitGeometry(kind: Kit) {
    const chunk = new Chunk(new T.Vector3()),
      TINT: readonly [number, number, number] = [1, 0, 0],
      at = (along: number, up: number, side = 0) => new T.Vector3(side, up, along),
      put = (
        g: T.BufferGeometry,
        c: T.Vector3,
        sx: number,
        sy: number,
        sz: number,
        color: number,
        tint = false,
        yaw = 0,
      ) =>
        chunk.add(
          g,
          this.m.compose(c, this.quat.setFromAxisAngle(UP, yaw), this.scale.set(sx, sy, sz)),
          color,
          tint ? TINT : undefined,
        );
    if (kind === 'bollard') {
      // 114 mm steel pipe, 0.85 m, black with a reflective band and cap.
      put(this.g.pipe, at(0, 0.42), 0.057, 0.84, 0.057, 0x1d1f21);
      put(this.g.pipe, at(0, 0.86), 0.062, 0.05, 0.062, 0x6b6f72);
      put(this.g.tube, at(0, 0.7), 0.059, 0.06, 0.059, 0xd9dcd8);
    } else if (kind === 'fence') {
      // 2.0 m panel, 0.8 m: posts, two rails, five balusters (painted).
      for (const z of [-0.98, 0.98]) put(this.g.tube, at(z, 0.4), 0.03, 0.8, 0.03, 0xffffff, true);
      for (const h of [0.78, 0.18]) put(this.g.box, at(0, h), 0.04, 0.04, 1.96, 0xffffff, true);
      for (let k = -2; k <= 2; k++)
        put(this.g.box, at(k * 0.33, 0.48), 0.022, 0.6, 0.022, 0xffffff, true);
    } else if (kind === 'cone') {
      put(this.g.box, at(0, 0.02), 0.38, 0.04, 0.38, 0x1d1e1f, false, 0.4);
      put(this.g.cone, at(0, 0.36), 0.15, 0.66, 0.15, 0xf05a14);
      put(this.g.tube, at(0, 0.42), 0.092, 0.11, 0.092, 0xf2f2ee);
    } else if (kind === 'planter') {
      // Precast planter 1.3 x 0.5 x 0.48 m with clipped shrubs.
      put(this.g.box, at(0, 0.24), 0.5, 0.48, 1.3, 0xa8a59c);
      for (let k = -1; k <= 1; k++) {
        const r = 0.33 + (k & 1) * 0.06;
        put(this.g.blob, at(k * 0.4, 0.5 + r * 0.5), r, r * 0.85, r * 1.1, SHRUB[k + 1], false, k);
      }
    } else {
      // Mamachari: 26" wheels, 1.85 m, step-through frame, basket, rack.
      const R = 0.33;
      for (const z of [-0.53, 0.53]) {
        put(this.g.ring, at(z, R), R, R, 0.3, 0x161718, false, Math.PI / 2);
        put(this.g.box, at(z, R + 0.07), 0.06, 0.01, 0.42, 0xb9bdc0);
      }
      const tube = (a: T.Vector3, b: T.Vector3, r: number, color: number, tint = false) => {
        const mid = a.clone().add(b).multiplyScalar(0.5),
          d = b.clone().sub(a),
          len = d.length();
        this.quat.setFromUnitVectors(UP, d.normalize());
        chunk.add(
          this.g.tube,
          this.m.compose(mid, this.quat, this.scale.set(r, len, r)),
          color,
          tint ? TINT : undefined,
        );
      };
      const rear = at(-0.53, R),
        front = at(0.53, R),
        crank = at(-0.05, 0.3),
        seat = at(-0.22, 0.86),
        head = at(0.38, 0.84),
        bar = at(0.33, 1.02);
      tube(head, crank, 0.022, 0xffffff, true);
      tube(crank, seat, 0.02, 0xffffff, true);
      tube(rear, crank, 0.012, 0xffffff, true);
      tube(rear, seat.clone().setY(seat.y - 0.12), 0.012, 0xffffff, true);
      tube(head, front, 0.016, 0xb9bdc0);
      tube(head, bar, 0.015, 0xb9bdc0);
      tube(at(0.3, 1.02, 0.26), at(0.3, 1.02, -0.26), 0.012, 0xb9bdc0);
      put(this.g.box, seat.clone().setY(seat.y + 0.03), 0.15, 0.06, 0.26, 0x1a1a1b);
      put(this.g.box, at(0.62, 0.86), 0.36, 0.22, 0.27, 0x9fa3a6);
      put(this.g.box, at(-0.58, 0.72), 0.18, 0.02, 0.36, 0x9fa3a6);
      put(this.g.box, at(-0.3, 0.33, 0.05), 0.02, 0.1, 0.5, 0xffffff, true);
    }
    return chunk.finish();
  }
  private place(kind: Kit, x: number, z: number, yaw: number, color = 0xffffff) {
    const y = this.height(x, z),
      entry = this.chunk(x, z);
    let list = entry.kits.get(kind);
    if (!list) entry.kits.set(kind, (list = []));
    list.push({ matrix: this.compose(x, y, z, yaw).clone(), color });
  }
  private bollard(x: number, z: number) {
    this.place('bollard', x, z, 0);
    this.take(x, z, 0.12);
    this.stats.bollards++;
  }
  /** 2.0 m guard-fence panel centred at (x, z), along `yaw`. */
  private fence(x: number, z: number, yaw: number, color: number) {
    this.place('fence', x, z, yaw, color);
    this.stats.fences++;
  }
  private bicycle(x: number, z: number, yaw: number, paint: number) {
    this.place('bicycle', x, z, yaw, paint);
    this.stats.bicycles++;
  }
  private planter(x: number, z: number, yaw: number) {
    this.place('planter', x, z, yaw + Math.PI / 2);
    this.take(x, z, 0.75);
    this.stats.planters++;
  }
  private cone(x: number, z: number) {
    this.place('cone', x, z, 0);
    this.take(x, z, 0.25);
    this.stats.cones++;
  }

  // --- Layout ---------------------------------------------------------------
  /** Town lamp standards of the road mesh (every 32 m, alternate sides). */
  private townLamps() {
    const net = this.world.network;
    for (const e of net.edges) {
      if (e.roadClass !== 'town') continue;
      for (let s = 12; s < e.length - 12; s += 32) {
        net.at(e.offset + s, this.p);
        const side = Math.floor(s / 32) % 2 === 0 ? 1 : -1,
          l = side * (e.spec.halfWidth + e.spec.shoulder - 0.4);
        this.take(this.p.x + this.p.nx * l, this.p.z + this.p.nz * l, 0.5);
      }
    }
  }
  /** Signals, guard fences, corner bollards and phone booths at town
   * junctions (crosswalk arms). */
  private junctions() {
    const net = this.world.network,
      p = this.p;
    let phones = 0;
    for (const a of junctionApproaches(net)) {
      if (!a.crossing) continue;
      const e = a.edge,
        hw = e.spec.halfWidth,
        kerb = -a.dir,
        far = junctionClearance(net, e)[a.dir > 0 ? 0 : 1];
      const fits = (along: number) => along > 0 && along < e.length - far - 2;
      const at = (along: number, lateral: number) => {
        net.at(e.offset + approachStation(a, along), p);
        return [p.x + p.nx * lateral, p.z + p.nz * lateral] as const;
      };
      if (!fits(a.mouth + 18)) continue;
      const nodeOffset = hash(a.node, 3),
        axis = a.minor ? 1 : 0;
      // Signal pole on the kerb beside the approach lane, at the crosswalk.
      {
        const along = a.mouth + 4.8;
        const [x, z] = at(along, kerb * (hw + 0.55));
        if (this.free(x, z, 0.2)) {
          net.at(e.offset + approachStation(a, along), p);
          const chunk = this.chunk(x, z).signals;
          this.signal(
            chunk,
            x,
            z,
            p.tx * a.dir,
            p.tz * a.dir,
            p.nx * kerb,
            p.nz * kerb,
            hw,
            axis + nodeOffset,
          );
          this.take(x, z, 0.4);
        }
      }
      // Bollards at both kerbs where the crosswalk meets the pavement.
      for (const side of [-1, 1])
        for (const along of [a.mouth - 0.7, a.mouth + 4.7, a.mouth + 6.1]) {
          const [x, z] = at(along, side * (hw + 0.35));
          if (this.free(x, z, 0.12)) this.bollard(x, z);
        }
      // Guard fences along both kerbs behind the crosswalk (8-10 m).
      const color = hash(a.node, 7) < 0.6 ? 0xe9eae6 : 0x2f4a3a;
      for (const side of [-1, 1])
        for (let k = 0; k < 4; k++) {
          const along = a.mouth + 7.6 + k * 2.05;
          if (!fits(along + 1)) break;
          const [x, z] = at(along, side * (hw + 0.32));
          const [x0, z0] = at(along - 0.95, side * (hw + 0.32)),
            [x1, z1] = at(along + 0.95, side * (hw + 0.32));
          if (!this.free(x0, z0, 0.05) || !this.free(x1, z1, 0.05) || !this.free(x, z, 0.05)) break;
          this.fence(x, z, Math.atan2(x1 - x0, z1 - z0), color);
          this.take(x, z, 0.9);
        }
      // A phone booth on a few corners.
      if (phones < 6 && hash(a.node, a.dir, 11) < 0.22) {
        const along = a.mouth + 17,
          lateral = -kerb * (hw + e.spec.shoulder - 0.6);
        const [x, z] = at(along, lateral);
        if (this.free(x, z, 0.65) && this.inTown(x, z)) {
          net.at(e.offset + approachStation(a, along), p);
          this.phone(this.chunk(x, z).props, x, z, Math.atan2(p.nx * kerb, p.nz * kerb));
          this.take(x, z, 0.8);
          phones++;
        }
      }
    }
  }
  /** Signal pole (6 m), arm over the approach lane and a horizontal head
   * facing approaching traffic; a pedestrian signal across the crosswalk. */
  private signal(
    chunk: Chunk,
    x: number,
    z: number,
    fx: number,
    fz: number,
    kx: number,
    kz: number,
    hw: number,
    group: number,
  ) {
    const y = this.height(x, z),
      grey = 0x8f9396;
    chunk.add(this.g.pipe, this.compose(x, y + 3.0, z, 0, 0.11, 6.0, 0.11), grey);
    // Arm toward the centre line (opposite the kerb), 5.6 m up.
    const reach = hw * 0.5 + 0.55 + 0.6,
      ax = x - kx * reach * 0.5,
      az = z - kz * reach * 0.5,
      yaw = Math.atan2(kx, kz);
    chunk.add(this.g.box, this.compose(ax, y + 5.65, az, yaw, 0.08, 0.1, reach), grey);
    // Head under the arm end, facing back along the approach.
    const hx = x - kx * (reach - 0.2),
      hz = z - kz * (reach - 0.2),
      face = Math.atan2(-fx, -fz);
    chunk.add(this.g.box, this.compose(hx, y + 5.3, hz, face, 1.18, 0.38, 0.17), 0x9da2a5);
    // Lamps: green at the kerb side, red toward the centre (driver's view).
    const colours = [0x00c8a0, 0xffb000, 0xff2a1a];
    for (let k = 0; k < 3; k++) {
      const off = (k - 1) * 0.38,
        lx = hx + kx * -off,
        lz = hz + kz * -off;
      const cx = lx - fx * 0.095,
        cz = lz - fz * 0.095;
      chunk.add(this.g.disc, this.compose(cx, y + 5.3, cz, face, 0.125, 0.125, 1), colours[k], [
        GLOW.signal,
        k,
        group,
      ]);
      // Visor over each lamp.
      const vx = lx - fx * 0.17,
        vz = lz - fz * 0.17;
      chunk.add(this.g.box, this.compose(vx, y + 5.44, vz, face, 0.28, 0.02, 0.16), 0x7d8285);
    }
    // Pedestrian signal 2.5 m up on the pole, facing across the road.
    const px = x - kx * 0.2,
      pz = z - kz * 0.2,
      across = Math.atan2(-kx, -kz);
    chunk.add(this.g.box, this.compose(px, y + 2.6, pz, across, 0.32, 0.66, 0.18), 0x8f9396);
    for (const [k, h] of [
      [0, 2.76],
      [1, 2.44],
    ] as const)
      chunk.add(
        this.g.plane,
        this.compose(px - kx * 0.095, y + h, pz - kz * 0.095, across, 0.26, 0.26, 1),
        0xffffff,
        [GLOW.walk, k, group],
        k ? AREA.walkGreen : AREA.walkRed,
      );
    this.stats.signals++;
  }
  private phone(chunk: Chunk, x: number, z: number, yaw: number) {
    const y = this.height(x, z);
    chunk.add(this.g.box, this.compose(x, y + 0.06, z, yaw, 0.95, 0.12, 0.95), 0x8e8f8c);
    for (const [a, b] of [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
    ]) {
      const [px, pz] = this.local(yaw, x, z, a * 0.43, b * 0.43);
      chunk.add(this.g.box, this.compose(px, y + 1.2, pz, yaw, 0.06, 2.2, 0.06), 0xc9cbc7);
    }
    // Glazed sides (dark glass), a lit interior panel and the roof band.
    chunk.add(this.g.box, this.compose(x, y + 1.2, z, yaw, 0.84, 1.9, 0.84), 0x1d2a2c);
    chunk.add(this.g.box, this.compose(x, y + 1.25, z, yaw, 0.7, 0.8, 0.7), 0xd8efe6, [
      GLOW.lamp,
      0.25,
      0,
    ]);
    chunk.add(this.g.box, this.compose(x, y + 2.38, z, yaw, 0.95, 0.24, 0.95), 0xe7e8e4);
    for (let k = 0; k < 4; k++) {
      const a = yaw + (k * Math.PI) / 2,
        [px, pz] = this.local(a, x, z, 0.481, 0);
      chunk.add(
        this.g.plane,
        this.compose(px, y + 2.38, pz, a, 0.9, 0.22, 1),
        0xffffff,
        [GLOW.lamp, 0.8, 0],
        AREA.phone,
      );
    }
    this.stats.phones++;
  }
  /** Bicycles, planters, cones and bollard runs in front of town frontages. */
  private frontages() {
    const net = this.world.network,
      p = this.p;
    this.structures.forEach((s, i) => {
      const style = this.plan.style[i];
      if (style !== 'urban' && style !== 'machiya') return;
      if (!this.inTown(s.x, s.z)) return;
      net.nearest(s.x, s.z, p);
      const e = net.edges[net.edgeOf[net.lastSegment]];
      if (e.roadClass !== 'town' && e.roadClass !== 'country') return;
      const front = this.plan.front[i],
        c = Math.cos(s.heading),
        n = Math.sin(s.heading),
        tx = c,
        tz = n,
        nx = -n * front,
        nz = c * front;
      const at = (x: number, out: number) =>
        [s.x + tx * x + nx * (s.hz + out), s.z + tz * x + nz * (s.hz + out)] as const;
      const facing = Math.atan2(-nx, -nz),
        along = Math.atan2(tx, tz);
      const h = hash(s.x, s.z, s.style);
      const chunk = this.chunk(s.x, s.z).props;
      const shopfront = style === 'urban' && !isApartment(s);
      // Parked bicycles against the shop (about a third of the frontages).
      if (shopfront && h < 0.36) {
        const count = 2 + Math.floor(hash(s.style, 2) * 4),
          x0 = (hash(s.style, 5) - 0.5) * Math.max(0, s.hx * 2 - count * 0.62 - 2);
        for (let k = 0; k < count; k++) {
          const x = x0 + (k - (count - 1) / 2) * 0.62;
          const [bx, bz] = at(x, 1.55);
          const [fx, fz] = at(x, 0.85),
            [rx, rz] = at(x, 2.3);
          if (!this.free(bx, bz, 0.22) || !this.free(fx, fz, 0.2) || !this.free(rx, rz, 0.2))
            continue;
          this.bicycle(
            bx,
            bz,
            facing + (hash(s.style, k) - 0.5) * 0.35,
            BIKE_PAINT[Math.floor(hash(s.style, k, 9) * BIKE_PAINT.length)],
          );
          this.take(bx, bz, 0.28);
        }
      }
      // Planters flanking an entrance.
      if (h > 0.36 && h < 0.5)
        for (const x of [-s.hx * 0.55, s.hx * 0.55]) {
          const [px, pz] = at(x, 1.6);
          if (this.free(px, pz, 0.7)) this.planter(px, pz, along);
        }
      // Cones and a barricade at a delivery bay or work.
      if (h > 0.5 && h < 0.56) {
        for (let k = 0; k < 3; k++) {
          const [cx, cz] = at(-s.hx * 0.4 + k * 1.3, 3.1);
          if (this.free(cx, cz, 0.22)) this.cone(cx, cz);
        }
        const [bx, bz] = at(s.hx * 0.3, 3.0);
        if (this.free(bx, bz, 0.7)) {
          const y = this.height(bx, bz);
          chunk.add(this.g.box, this.compose(bx, y + 0.4, bz, along, 0.42, 0.8, 1.4), 0xf2c400);
          for (let k = -2; k <= 2; k++) {
            const [sx, sz] = this.local(along, bx, bz, k * 0.28, 0);
            chunk.add(
              this.g.box,
              this.compose(sx, y + 0.42, sz, along + 0.6, 0.43, 0.6, 0.07),
              0x18191a,
            );
          }
          this.take(bx, bz, 0.8);
        }
      }
      // A bollard run along the kerb in front of busy blocks (030).
      if (shopfront && s.kind === 'block' && h > 0.56 && h < 0.8) {
        const [kx, kz] = at(0, 0);
        const lateral = net.nearest(kx, kz, p),
          road = net.edges[net.edgeOf[net.lastSegment]];
        const out = Math.abs(lateral) - (road.spec.halfWidth + 0.35);
        for (let x = -s.hx + 1; x <= s.hx - 1; x += 2.4) {
          const [bx, bz] = at(x, out);
          if (this.free(bx, bz, 0.12)) this.bollard(bx, bz);
        }
      }
    });
  }
  /** Coin parks (コインパーキング) in a few flat, unbuilt frontage gaps
   * beside town shops: an asphalt apron, four 2.5 x 5 m nose-in bays with
   * lines and wheel stops, a yellow P sign and a pay machine. */
  private coinParks() {
    const net = this.world.network,
      p = this.p,
      width = 11,
      chosen: T.Vector3[] = [];
    this.structures.forEach((s, i) => {
      if (chosen.length >= 6 || this.plan.style[i] !== 'urban' || s.kind !== 'shop') return;
      if (this.plan.lotSide.has(i) || !this.inTown(s.x, s.z) || s.hz < 4.5) return;
      if (hash(s.style, 41) > 0.5) return;
      net.nearest(s.x, s.z, p);
      if (net.edges[net.edgeOf[net.lastSegment]].roadClass !== 'town') return;
      const front = this.plan.front[i],
        c = Math.cos(s.heading),
        n = Math.sin(s.heading);
      for (const side of [-1, 1]) {
        const at = (x: number, z: number) =>
          [
            s.x + c * side * x - n * front * (s.hz + z),
            s.z + n * side * x + c * front * (s.hz + z),
          ] as const;
        const x0 = s.hx + 0.8;
        if (chosen.some((q) => Math.hypot(q.x - s.x, q.z - s.z) < 140)) return;
        let ok = true;
        for (let a = 0; a <= width && ok; a += 2.2)
          for (const z of [-0.2, -2.8, -5.6]) {
            const [x, w] = at(x0 + a, z);
            if (!this.free(x, w, 0.4) || this.grid.blocks(x, w, 0.6)) {
              ok = false;
              break;
            }
          }
        if (!ok) continue;
        let low = Infinity,
          high = -Infinity;
        for (const a of [0, width / 2, width])
          for (const z of [-0.4, -5.6]) {
            const [x, w] = at(x0 + a, z),
              y = this.height(x, w);
            low = Math.min(low, y);
            high = Math.max(high, y);
          }
        if (high - low > 0.5) continue;
        const lot = chosen.length,
          [cx, cz] = at(x0 + width / 2, -2.8),
          entry = this.chunk(cx, cz),
          chunk = entry.props;
        chosen.push(new T.Vector3(cx, 0, cz));
        this.lots.push({ s, side, length: 0.8 + width });
        const yawBack = Math.atan2(n * front, -c * front),
          along = Math.atan2(c * side, n * side);
        // Apron (4 x 3 quads on the ground) and bay lines.
        const quad = (corners: (readonly [number, number])[], lift: number, color: number) => {
          const v = corners.map(([x, w]) => new T.Vector3(x, this.height(x, w) + lift, w));
          const g = new T.BufferGeometry().setFromPoints([v[0], v[1], v[2], v[0], v[2], v[3]]);
          g.computeVertexNormals();
          if (g.getAttribute('normal').getY(0) < 0)
            g.setFromPoints([v[0], v[2], v[1], v[0], v[3], v[2]]).computeVertexNormals();
          g.setAttribute('uv', new T.Float32BufferAttribute(new Float32Array(12), 2));
          chunk.add(g, this.m.identity(), color);
          g.dispose();
        };
        for (let a = 0; a < 4; a++)
          for (let b = 0; b < 3; b++) {
            const xa = x0 + (a * width) / 4,
              xb = x0 + ((a + 1) * width) / 4,
              za = 0.4 - b * 2.1,
              zb = 0.4 - (b + 1) * 2.1;
            quad([at(xa, za), at(xb, za), at(xb, zb), at(xa, zb)], 0.03, 0x34373a);
          }
        for (let k = 0; k <= 4; k++) {
          const x = x0 + 0.5 + k * 2.5;
          quad(
            [at(x - 0.06, -0.3), at(x + 0.06, -0.3), at(x + 0.06, -5.3), at(x - 0.06, -5.3)],
            0.045,
            0xe9e9e4,
          );
          if (k === 4) continue;
          // Bay: wheel stop at its head and the car's ground point.
          for (const off of [0.75, 1.75]) {
            const [wx, wz] = at(x + off, -4.75);
            chunk.add(
              this.g.box,
              this.compose(wx, this.height(wx, wz) + 0.075, wz, along, 0.62, 0.15, 0.12),
              0xc9c6bd,
            );
          }
          const [bx, bz] = at(x + 1.25, -2.85);
          this.parkingBays.push({ x: bx, y: this.height(bx, bz) + 0.03, z: bz, yaw: yawBack, lot });
        }
        // Yellow P sign on a pole at the street corner, and a pay machine.
        const [px, pz] = at(x0 + width - 0.4, 0.2),
          py = this.height(px, pz),
          face = yawBack + Math.PI;
        chunk.add(this.g.pipe, this.compose(px, py + 1.5, pz, 0, 0.04, 3.0, 0.04), 0x9a9d9f);
        chunk.add(this.g.box, this.compose(px, py + 2.65, pz, face, 0.62, 0.62, 0.06), 0xf5c400);
        for (const flip of [0, Math.PI])
          chunk.add(
            this.g.plane,
            this.compose(
              px + Math.sin(face + flip) * 0.032,
              py + 2.65,
              pz + Math.cos(face + flip) * 0.032,
              face + flip,
              0.58,
              0.58,
              1,
            ),
            0xffffff,
            [GLOW.lamp, 0.35, 0],
            AREA.parking,
          );
        const [mx, mz] = at(x0 + 0.3, -0.6);
        chunk.add(
          this.g.box,
          this.compose(mx, this.height(mx, mz) + 0.65, mz, face, 0.5, 1.3, 0.4),
          0xb8bcbe,
          [GLOW.lamp, 0.15, 0],
        );
        this.take(px, pz, 0.3);
        this.take(mx, mz, 0.5);
        this.stats.coinParks++;
        return;
      }
    });
  }
  /** 600 mm iron covers in the lanes of town streets, ~26 m apart. */
  private manholes() {
    const net = this.world.network,
      p = this.p;
    for (const e of net.edges) {
      if (e.roadClass !== 'town') continue;
      const clear = junctionClearance(net, e);
      for (let s = clear[0] + 6; s < e.length - clear[1] - 4; s += 22 + hash(e.index, s) * 10) {
        net.at(e.offset + s, p);
        const side = hash(e.index, s, 1) < 0.5 ? -1 : 1,
          l = side * e.spec.halfWidth * (0.3 + hash(e.index, s, 2) * 0.35),
          x = p.x + p.nx * l,
          z = p.z + p.nz * l,
          y = net.surfaceHeight(p, l, e.spec.halfWidth, e.spec.crown) + 0.012;
        const chunk = this.chunk(x, z).props,
          flat = -Math.PI / 2;
        chunk.add(
          this.g.disc,
          this.m.compose(
            this.v.set(x, y, z),
            this.quat.setFromEuler(new T.Euler(flat, hash(e.index, s, 4) * 6, 0, 'YXZ')),
            this.scale.set(0.34, 0.34, 1),
          ),
          0x2f2d2b,
        );
        chunk.add(
          this.g.disc,
          this.m.compose(this.v.set(x, y + 0.004, z), this.quat, this.scale.set(0.29, 0.29, 1)),
          0x4a4743,
        );
        this.stats.manholes++;
      }
    }
  }
  /** Bus stops on the long town streets: pole sign, timetable, bench and,
   * where the setback allows, a shelter. */
  private busStops() {
    const net = this.world.network,
      p = this.p,
      byRoad = new Map<string, RoadEdge[]>();
    for (const e of net.edges)
      if (e.roadClass === 'town') byRoad.set(e.road.id, [...(byRoad.get(e.road.id) ?? []), e]);
    for (const edges of byRoad.values()) {
      const total = edges.reduce((a, e) => a + e.length, 0);
      if (total < 260) continue;
      let next = 90,
        walked = 0,
        side = 1;
      for (const e of edges) {
        const clear = junctionClearance(net, e);
        for (let s = Math.max(clear[0] + 12, next - walked); s < e.length - clear[1] - 12; s += 6) {
          net.at(e.offset + s, p);
          const l = side * (e.spec.halfWidth + e.spec.shoulder - 0.45),
            x = p.x + p.nx * l,
            z = p.z + p.nz * l;
          if (!this.inTown(x, z) || !this.free(x, z, 0.5)) continue;
          const yaw = Math.atan2(p.nx * side, p.nz * side),
            chunk = this.chunk(x, z).props,
            y = this.height(x, z);
          chunk.add(this.g.pipe, this.compose(x, y + 1.2, z, 0, 0.035, 2.4, 0.035), 0xc4c7c9);
          // Round stop sign read along the street both ways.
          for (const flip of [0, Math.PI]) {
            const a = yaw + Math.PI / 2 + flip;
            chunk.add(
              this.g.disc,
              this.compose(
                x + Math.sin(a) * 0.03,
                y + 2.25,
                z + Math.cos(a) * 0.03,
                a,
                0.27,
                0.27,
                1,
              ),
              0xffffff,
              [GLOW.lamp, 0.15, 0],
              AREA.bus,
            );
          }
          // Timetable box facing the waiting passengers.
          chunk.add(this.g.box, this.compose(x, y + 1.35, z, yaw, 0.36, 0.5, 0.06), 0x1d4fa0);
          chunk.add(
            this.g.plane,
            this.compose(
              x + Math.sin(yaw) * 0.032,
              y + 1.33,
              z + Math.cos(yaw) * 0.032,
              yaw,
              0.3,
              0.44,
              1,
            ),
            0xffffff,
            [GLOW.lamp, 0.3, 0],
            AREA.timetable,
          );
          // Bench behind the pole, parallel to the kerb.
          const [bx, bz] = this.local(yaw, x, z, 0.75, 1.6);
          if (this.free(bx, bz, 0.5)) {
            const by = this.height(bx, bz),
              along = yaw + Math.PI / 2;
            chunk.add(
              this.g.box,
              this.compose(bx, by + 0.43, bz, along, 0.42, 0.05, 1.6),
              0x7a5a3c,
            );
            chunk.add(this.g.box, this.compose(bx, by + 0.2, bz, along, 0.36, 0.4, 0.06), 0x55585b);
            this.take(bx, bz, 0.9);
          }
          // Shelter over the bench in the setback (roof 3 x 1.4 m at 2.4 m).
          const [sx, sz] = this.local(yaw, x, z, 0.75, 1.9);
          if (this.free(sx, sz, 1.2)) {
            const sy = this.height(sx, sz),
              along = yaw + Math.PI / 2;
            chunk.add(this.g.box, this.compose(sx, sy + 2.45, sz, along, 1.5, 0.06, 3.1), 0xd6d8d6);
            const [wx, wz] = this.local(yaw, sx, sz, 0.62, 0);
            chunk.add(this.g.box, this.compose(wx, sy + 1.3, wz, along, 0.03, 1.9, 2.9), 0x2a3638);
            for (const a of [-1.4, 1.4]) {
              const [px, pz] = this.local(yaw + Math.PI / 2, wx, wz, a, 0);
              chunk.add(
                this.g.box,
                this.compose(px, sy + 1.22, pz, along, 0.07, 2.44, 0.07),
                0x9a9d9f,
              );
            }
            this.take(sx, sz, 1.6);
          }
          this.take(x, z, 0.6);
          this.stats.busStops++;
          side = -side;
          next = walked + s + 340;
          break;
        }
        walked += e.length;
      }
    }
  }
  /** Night light pools from the signage and warm spill from shopfronts. */
  private pools(lights: readonly SignLight[]) {
    const net = this.world.network,
      p = this.p,
      q = this.q;
    // Pools lie on the flush pavement and the street: the nearest road's
    // surface, carried flat across the setback (cheap, and level with it).
    const surface = (x: number, z: number) => {
      const lateral = net.nearest(x, z, q),
        e = net.edges[net.edgeOf[net.lastSegment]];
      return net.surfaceHeight(q, lateral, e.spec.halfWidth, e.spec.crown);
    };
    for (const l of lights) {
      if (!this.inTown(l.x, l.z)) continue;
      // Pull the pool toward the road a little: light falls outward.
      const lateral = net.nearest(l.x, l.z, p),
        dir = Math.sign(lateral) || 1,
        x = l.x - p.nx * dir * 0.6,
        z = l.z - p.nz * dir * 0.6;
      this.chunk(x, z).pools.add(x, z, l.radius, l.radius, 1, 0, l.color, 0.32 * l.glow, surface);
      this.stats.pools++;
    }
    this.structures.forEach((s, i) => {
      if (this.plan.style[i] !== 'urban' || isApartment(s) || !this.inTown(s.x, s.z)) return;
      const front = this.plan.front[i],
        c = Math.cos(s.heading),
        n = Math.sin(s.heading);
      // One warm pool the length of the lit ground floor (most fronts are
      // lit at night; about one in seven is shuttered).
      if (hash(s.style, 31) < 0.14) return;
      const out = s.hz + 1.6,
        px = s.x - n * front * out,
        pz = s.z + c * front * out;
      this.chunk(px, pz).pools.add(px, pz, s.hx + 1.2, 2.6, c, n, 0xffd6a4, 0.22, surface);
      this.stats.pools++;
    });
  }

  update(camera: T.Camera, night: number, preset: QualityPreset, time: number, wet = 0) {
    this.uniforms.townNight.value = night;
    this.uniforms.townTime.value = time;
    this.uniforms.townWet.value = wet;
    const range = TOWN_LIFE.range[preset],
      signal = TOWN_LIFE.signalRange[preset];
    const eye = camera.position;
    for (const { mesh, centre, kind } of this.meshes) {
      const d = Math.hypot(eye.x - centre.x, eye.z - centre.z) - TOWN_LIFE.chunk * 0.7;
      mesh.visible =
        kind === 'signals'
          ? d < signal
          : kind === 'pools'
            ? night > 0.05 && d < range * 1.4
            : d < range;
    }
  }
  dispose() {
    for (const { mesh } of this.meshes)
      if (mesh instanceof T.InstancedMesh) mesh.dispose();
      else mesh.geometry.dispose();
    this.material.dispose();
    this.poolMaterial.dispose();
    this.kitMaterial.dispose();
    for (const g of this.kitGeometries.values()) g.dispose();
    this.atlas.dispose();
    this.root.removeFromParent();
    this.root.clear();
    this.meshes.length = 0;
  }
}
