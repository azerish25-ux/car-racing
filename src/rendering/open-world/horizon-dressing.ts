import * as T from 'three';
import { hash01 } from '../../simulation/open-world/noise.ts';
import { StructureGrid, type Structure } from '../../simulation/open-world/placement.ts';
import { carvedGroundHeight } from '../../simulation/open-world/ground-height.ts';
import type { OpenWorld } from '../../simulation/open-world/world.ts';
import { trackPoint } from '../../simulation/track.ts';
import type { QualityPreset } from '../options.ts';
import { TrackGrass, type GrassClump } from '../vegetation/grass.ts';
import { PhotoForest, type PhotoPlant } from '../vegetation/forest.ts';
import type { VegetationLibrary } from '../vegetation/library.ts';
import { VEGETATION } from '../vegetation/materials.ts';
import { SPECIES } from '../vegetation/species.ts';

/** Original Solvane scenery derived from the reference review's visual
 * principles: human-scale commercial detail, legible road edges, layered
 * meadow silhouettes and a working coastal town. Reference images are not
 * shipped or used as textures. Everything here is generated geometry or
 * original typography; all ground heights come from the existing world. */

const CHUNK = 256;
const UP = new T.Vector3(0, 1, 0);

class GeometryBatch {
  readonly position: number[] = [];
  readonly normal: number[] = [];
  readonly uv: number[] = [];
  readonly color: number[] = [];
  readonly indices: number[] = [];
  private readonly p = new T.Vector3();
  private readonly n = new T.Vector3();
  private readonly normalMatrix = new T.Matrix3();
  private readonly c = new T.Color();
  add(geometry: T.BufferGeometry, transform: T.Matrix4, tint: number, tile?: number) {
    const positions = geometry.getAttribute('position'),
      normals = geometry.getAttribute('normal');
    const uvs = geometry.getAttribute('uv'),
      colors = geometry.getAttribute('color');
    const offset = this.position.length / 3;
    this.normalMatrix.getNormalMatrix(transform);
    this.c.setHex(tint);
    for (let i = 0; i < positions.count; i++) {
      this.p.fromBufferAttribute(positions, i).applyMatrix4(transform);
      this.n.fromBufferAttribute(normals, i).applyMatrix3(this.normalMatrix).normalize();
      this.position.push(this.p.x, this.p.y, this.p.z);
      this.normal.push(this.n.x, this.n.y, this.n.z);
      let u = uvs?.getX(i) ?? 0,
        v = uvs?.getY(i) ?? 0;
      if (tile !== undefined) {
        // Two-pixel guard band inside each original sign atlas tile.
        u = ((tile % 4) + 0.008 + u * 0.984) / 4;
        v = (3 - Math.floor(tile / 4) + 0.016 + v * 0.968) / 4;
      }
      this.uv.push(u, v);
      this.color.push(
        this.c.r * (colors?.getX(i) ?? 1),
        this.c.g * (colors?.getY(i) ?? 1),
        this.c.b * (colors?.getZ(i) ?? 1),
      );
    }
    if (geometry.index)
      for (let i = 0; i < geometry.index.count; i++)
        this.indices.push(offset + geometry.index.getX(i));
    else for (let i = 0; i < positions.count; i++) this.indices.push(offset + i);
  }
  finish() {
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(this.position, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(this.normal, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new T.Float32BufferAttribute(this.color, 3));
    g.setIndex(this.indices);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

const SHOP_NAMES = [
  ['ILSE MOTOR CLUB', 'COASTAL DRIVES · EST. 1986'],
  ['NORTH PIER', 'COFFEE · KITCHEN · RECORDS'],
  ['SOLVANE', 'COAST FESTIVAL'],
  ['VALE WORKSHOP', 'SERVICE · PARTS · REPAIR'],
  ['BLUE HOUR', 'RECORDS & LATE COFFEE'],
  ['ASHVALE', 'BAKERY · PROVISIONS'],
  ['SALT & STONE', 'COASTAL GOODS'],
  ['PORT ILSE', 'VISITOR INFORMATION'],
  ['THORNWOOD', 'OUTDOOR EQUIPMENT'],
  ['THE LOFT', 'ROOMS BY THE WATER'],
  ['TIDE CYCLES', 'WORKSHOP & RENTALS'],
  ['KESTREL', 'MOTOR SUPPLY'],
  ['QUAYSIDE', 'FISH MARKET'],
  ['EASTERN LINE', 'DESIGN STUDIO'],
  ['VARDA', 'GUIDES & OUTFITTERS'],
  ['MOTOBOUND', 'FESTIVAL DRIVERS CLUB'],
] as const;

/** One small atlas, authored at runtime: no individual sign textures and no
 * remote image dependency. The fallback allows geometry inspection in Node. */
function signAtlas() {
  if (typeof document === 'undefined') {
    const t = new T.DataTexture(new Uint8Array([52, 82, 88, 255]), 1, 1);
    t.needsUpdate = true;
    return t;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Solvane sign atlas needs a 2D canvas context');
  const colors = [
    '#173b40',
    '#ddd2b5',
    '#b44c3c',
    '#303d4b',
    '#476858',
    '#9e743e',
    '#e4ded0',
    '#274f60',
  ];
  SHOP_NAMES.forEach(([name, sub], i) => {
    const x = (i % 4) * 256,
      y = Math.floor(i / 4) * 128;
    const pale = i % 8 === 1 || i % 8 === 6;
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(x, y, 256, 128);
    ctx.strokeStyle = pale ? '#4d655b' : '#dccca7';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(x + 7, y + 9, 242, 110);
    ctx.fillStyle = pale ? '#1e3937' : '#f5efdc';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let font = 25;
    do {
      ctx.font = `700 ${font--}px sans-serif`;
    } while (ctx.measureText(name).width > 231 && font > 10);
    ctx.fillText(name, x + 128, y + 51);
    ctx.globalAlpha = 0.83;
    ctx.font = '500 10px sans-serif';
    ctx.fillText(sub, x + 128, y + 83);
    ctx.globalAlpha = 1;
    ctx.fillRect(x + 107, y + 100, 42, 2);
  });
  const texture = new T.CanvasTexture(canvas);
  texture.name = 'Original Solvane commercial sign atlas';
  texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Real blade silhouettes, curved along three segments, retain volume when
 * no photographic plant pack is loaded. Vertex colours distinguish green
 * basal leaves from pale dry tips; there is no transparent overdraw. */
function meadowGeometry() {
  const position: number[] = [],
    normal: number[] = [],
    color: number[] = [],
    indices: number[] = [];
  for (let blade = 0; blade < 11; blade++) {
    const a = blade * 2.399963,
      h = 0.35 + hash01(blade, 2, 916) * 0.65;
    const radius = 0.03 + hash01(blade, 3, 916) * 0.22;
    const x = Math.sin(a) * radius,
      z = Math.cos(a) * radius;
    const dx = Math.cos(a),
      dz = -Math.sin(a),
      bend = 0.1 + hash01(blade, 4, 916) * 0.28;
    const start = position.length / 3;
    for (let row = 0; row <= 3; row++) {
      const t = row / 3,
        w = (1 - t) * (0.018 + hash01(blade, 5, 916) * 0.022);
      const bx = x + Math.sin(a) * bend * t * t,
        bz = z + Math.cos(a) * bend * t * t;
      for (const side of [-1, 1]) {
        position.push(bx + dx * w * side, h * t, bz + dz * w * side);
        const n = new T.Vector3(Math.sin(a) * 0.3, 0.85, Math.cos(a) * 0.3).normalize();
        normal.push(n.x, n.y, n.z);
        color.push(0.3 + 0.38 * t, 0.39 + 0.25 * t, 0.13 + 0.2 * t);
      }
      if (row) {
        const i = start + row * 2;
        indices.push(i - 2, i, i - 1, i - 1, i, i + 1);
      }
    }
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(position, 3));
  g.setAttribute('normal', new T.Float32BufferAttribute(normal, 3));
  g.setAttribute('color', new T.Float32BufferAttribute(color, 3));
  g.setIndex(indices);
  g.computeBoundingSphere();
  return g;
}

/** A working boat with a swept, chine-defined hull. Width and sheer change
 * at every station; it is not a scaled box pretending to be a hull. */
function workboatHull() {
  const positions: number[] = [],
    colors: number[] = [],
    index: number[] = [];
  const stations = [
    [-4.6, 1.18, 1.0],
    [-3.1, 1.57, 1.05],
    [-1, 1.62, 1.1],
    [1.2, 1.51, 1.22],
    [3.3, 0.97, 1.47],
    [4.7, 0.06, 1.74],
  ];
  const row = [
    [-1, 1],
    [-0.87, 0.1],
    [-0.2, -0.67],
    [0.2, -0.67],
    [0.87, 0.1],
    [1, 1],
  ];
  const cream = new T.Color(0xd5cbb5),
    navy = new T.Color(0x294a50);
  for (let s = 0; s < stations.length; s++) {
    const [z, w, sheer] = stations[s];
    for (let k = 0; k < row.length; k++) {
      const [x, y] = row[k];
      positions.push(x * w, y > 0.5 ? sheer : y, z);
      const c = k === 2 || k === 3 ? navy : cream;
      colors.push(c.r, c.g, c.b);
      if (s && k) {
        const i = s * row.length + k;
        index.push(i - 7, i - 6, i - 1, i - 1, i - 6, i);
      }
    }
  }
  // Flat stern and a deck that follows the sheer, instead of leaving the
  // hull as a hollow, double-sided shell.
  index.push(0, 4, 1, 0, 5, 4, 1, 3, 2, 1, 4, 3);
  for (let s = 1; s < stations.length; s++) {
    const i = s * row.length;
    index.push(i - 6, i + 5, i - 1, i - 6, i, i + 5);
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

type BatchKind = 'stone' | 'metal' | 'glass' | 'sign' | 'bulb';
type StaticChunk = { kind: BatchKind; batch: GeometryBatch };

export class HorizonDressing {
  readonly root = new T.Group();
  readonly stats = {
    chunks: 0,
    triangles: 0,
    shopSigns: 0,
    meadowClumps: 0,
    planters: 0,
    boats: 0,
    lanterns: 0,
  };
  private readonly atlas = signAtlas();
  private readonly materials: Record<BatchKind, T.MeshStandardMaterial>;
  private batchScope = '';
  private authoredBoats = false;
  useAuthoredBoats() {
    this.authoredBoats = true;
  }
  private readonly chunks = new Map<string, StaticChunk>();
  private readonly primitives = {
    box: new T.BoxGeometry(1, 1, 1),
    cylinder: new T.CylinderGeometry(1, 1, 1, 8),
    sphere: new T.SphereGeometry(1, 8, 5),
    plane: new T.PlaneGeometry(1, 1),
    ring: new T.TorusGeometry(1, 0.19, 6, 18),
  };
  private readonly transform = new T.Matrix4();
  private readonly orientation = new T.Quaternion();
  private readonly position = new T.Vector3();
  private readonly scale = new T.Vector3();
  private readonly meadow = new T.Group();
  private readonly meadowChunks: { mesh: T.InstancedMesh; center: T.Vector3; radius: number }[] =
    [];
  private readonly meadowGeometry = meadowGeometry();
  private readonly meadowMaterial = new T.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    side: T.DoubleSide,
    roughness: 0.94,
  });
  private readonly windTime = { value: 0 };
  private readonly meadowRange = { value: 110 };
  private readonly clumps: GrassClump[] = [];
  private photoGrass: TrackGrass | null = null;
  private photoPocket: PhotoForest | null = null;
  private readonly pocketPlants: { x: number; y: number; z: number; yaw: number }[] = [];
  private lanterns: T.Points | null = null;
  private readonly lanternTime = { value: 0 };
  private readonly eye = new T.Vector3();
  private readonly staticMeshes: T.Mesh[] = [];

  constructor(
    readonly world: OpenWorld,
    readonly structures: readonly Structure[],
  ) {
    this.root.name = 'Solvane Horizon reference art pass';
    this.materials = {
      stone: new T.MeshStandardMaterial({
        color: 0xffffff,
        vertexColors: true,
        roughness: 0.78,
        side: T.DoubleSide,
      }),
      metal: new T.MeshStandardMaterial({
        color: 0xffffff,
        vertexColors: true,
        roughness: 0.4,
        metalness: 0.72,
      }),
      glass: new T.MeshStandardMaterial({
        color: 0xffffff,
        vertexColors: true,
        roughness: 0.12,
        metalness: 0.25,
      }),
      sign: new T.MeshStandardMaterial({
        map: this.atlas,
        emissiveMap: this.atlas,
        emissive: 0xffffff,
        emissiveIntensity: 0.015,
        roughness: 0.46,
        metalness: 0.12,
        side: T.DoubleSide,
      }),
      bulb: new T.MeshStandardMaterial({
        color: 0xffe1a7,
        vertexColors: true,
        emissive: 0xffc579,
        emissiveIntensity: 0.04,
        roughness: 0.32,
      }),
    };
    this.shopfronts();
    this.harbourStrings();
    this.batchScope = 'legacy-boats ';
    this.coastalBoats();
    this.batchScope = '';
    this.buildMeadow();
    this.makeLanterns();
    for (const [key, chunk] of this.chunks) {
      const g = chunk.batch.finish();
      const mesh = new T.Mesh(g, this.materials[chunk.kind]);
      mesh.name = `Solvane ${key}`;
      mesh.userData.horizonDetailKind = chunk.kind;
      mesh.userData.legacyBoat = key.startsWith('legacy-boats ');
      mesh.castShadow = chunk.kind !== 'sign' && chunk.kind !== 'bulb';
      mesh.receiveShadow = chunk.kind !== 'bulb';
      mesh.matrixAutoUpdate = false;
      this.stats.triangles += (g.index?.count ?? 0) / 3;
      this.root.add(mesh);
      this.staticMeshes.push(mesh);
    }
    this.stats.chunks = this.chunks.size;
    this.chunks.clear();
    this.root.add(this.meadow);
    for (const geometry of Object.values(this.primitives)) geometry.dispose();
  }

  private batch(kind: BatchKind, x: number, z: number) {
    const key = `${this.batchScope}${kind} ${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = { kind, batch: new GeometryBatch() };
      this.chunks.set(key, chunk);
    }
    return chunk.batch;
  }
  private part(
    kind: BatchKind,
    shape: T.BufferGeometry,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    color: number,
    yaw = 0,
    tile?: number,
  ) {
    this.orientation.setFromAxisAngle(UP, yaw);
    this.transform.compose(
      this.position.set(x, y, z),
      this.orientation,
      this.scale.set(sx, sy, sz),
    );
    this.batch(kind, x, z).add(shape, this.transform, color, tile);
  }
  private box(
    kind: BatchKind,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    color: number,
    yaw = 0,
  ) {
    this.part(kind, this.primitives.box, x, y, z, sx, sy, sz, color, yaw);
  }
  private beam(kind: BatchKind, a: T.Vector3, b: T.Vector3, radius: number, color: number) {
    const length = a.distanceTo(b);
    this.orientation.setFromUnitVectors(UP, this.position.copy(b).sub(a).normalize());
    this.position.copy(a).add(b).multiplyScalar(0.5);
    this.transform.compose(this.position, this.orientation, this.scale.set(radius, length, radius));
    this.batch(kind, a.x, a.z).add(this.primitives.cylinder, this.transform, color);
  }

  private shopfronts() {
    const p = trackPoint();
    for (const s of this.structures) {
      if (s.kind !== 'shop' && s.kind !== 'block' && s.kind !== 'terminal') continue;
      this.world.network.nearest(s.x, s.z, p);
      const c = Math.cos(s.heading),
        n = Math.sin(s.heading);
      const side = (p.x - s.x) * -n + (p.z - s.z) * c >= 0 ? 1 : -1;
      const at = (lx: number, y: number, lz: number) =>
        new T.Vector3(s.x + lx * c - lz * n, y, s.z + lx * n + lz * c);
      const frontage = Math.min(s.hx * 1.62, 9.2),
        front = side * (s.hz + 0.105);
      const signY = s.base + 2.7,
        sign = at(0, signY, front);
      const yaw = -s.heading + (side < 0 ? Math.PI : 0);
      this.part(
        'sign',
        this.primitives.plane,
        sign.x,
        sign.y,
        sign.z,
        frontage,
        0.84,
        1,
        0xffffff,
        yaw,
        s.style % SHOP_NAMES.length,
      );
      this.stats.shopSigns++;
      // A shallow projecting canopy and its valance make the shopfront
      // cast an actual shadow. Projection remains below 0.45 m.
      const awning = at(0, s.base + 2.21, side * (s.hz + 0.22));
      const shade = [0x2c514e, 0x7b493e, 0x53636a, 0x937b51][(s.style >>> 4) % 4];
      this.box('stone', awning.x, awning.y, awning.z, frontage + 0.3, 0.1, 0.43, shade, -s.heading);
      const valance = at(0, s.base + 2.1, side * (s.hz + 0.435));
      this.box(
        'stone',
        valance.x,
        valance.y,
        valance.z,
        frontage + 0.3,
        0.16,
        0.06,
        shade,
        -s.heading,
      );
      // Sill-side wall lamps and service boxes are all on the collision-
      // backed facade rather than placed in the usable road/shoulder.
      for (const sideX of [-1, 1]) {
        const lamp = at(sideX * (s.hx - 0.7), s.base + 3.5, side * (s.hz + 0.15));
        this.box('metal', lamp.x, lamp.y, lamp.z, 0.2, 0.38, 0.18, 0x3f4d50, -s.heading);
        this.box(
          'bulb',
          lamp.x,
          lamp.y - 0.1,
          lamp.z + side * 0.025,
          0.14,
          0.14,
          0.19,
          0xffffff,
          -s.heading,
        );
      }
      if ((s.style & 3) === 0) {
        const equipment = at(s.hx - 0.5, s.base + 1.28, side * (s.hz + 0.1));
        this.box(
          'metal',
          equipment.x,
          equipment.y,
          equipment.z,
          0.46,
          0.7,
          0.2,
          0x929b96,
          -s.heading,
        );
      }
      if (s.style % 3 === 0) {
        // Small planted forecourt pockets, entirely within the facade's
        // existing setback. Each base samples the carved terrain instead
        // of assuming all buildings and road shoulders have equal height.
        const planter = at(-s.hx + 1.5, 0, side * (s.hz + 0.43));
        const ground = carvedGroundHeight(this.world.carver, planter.x, planter.z);
        this.box(
          'stone',
          planter.x,
          ground + 0.25,
          planter.z,
          1.28,
          0.54,
          0.58,
          0x82847a,
          -s.heading,
        );
        this.box(
          'stone',
          planter.x,
          ground + 0.532,
          planter.z,
          1.1,
          0.025,
          0.43,
          0x343a27,
          -s.heading,
        );
        for (const lx of [-0.3, 0.24]) {
          const plant = at(-s.hx + 1.5 + lx, ground + 0.51, side * (s.hz + 0.43));
          this.part(
            'stone',
            this.meadowGeometry,
            plant.x,
            plant.y,
            plant.z,
            0.72,
            0.5,
            0.5,
            0x94a279,
            -s.heading + lx * 4,
          );
        }
        this.pocketPlants.push({ x: planter.x, y: ground + 0.49, z: planter.z, yaw: -s.heading });
        this.stats.planters++;
      }
    }
  }

  private harbourStrings() {
    // Hanging decoration over Harbour Front uses wall-height anchors. Its
    // lowest point is >7 m above the road, with no post in a driving lane.
    const net = this.world.network,
      p = trackPoint();
    const candidates = net.edges.filter((e) => e.roadClass === 'town' && e.road.id === 'harbour');
    for (const edge of candidates) {
      for (let s = 95; s < edge.length - 30; s += 170) {
        net.at(edge.offset + s, p);
        const half = edge.spec.halfWidth + edge.spec.shoulder + 1.15;
        let previous: T.Vector3 | null = null;
        for (let k = 0; k <= 20; k++) {
          const t = k / 20,
            l = (t * 2 - 1) * half;
          const y = p.y + 9.2 - 1.15 * Math.sin(t * Math.PI);
          const position = new T.Vector3(p.x + p.nx * l, y, p.z + p.nz * l);
          if (previous) this.beam('metal', previous, position, 0.016, 0x4c5656);
          previous = position;
          if (k % 2 === 1) {
            this.part(
              'bulb',
              this.primitives.sphere,
              position.x,
              position.y - 0.14,
              position.z,
              0.09,
              0.12,
              0.09,
              0xffffff,
            );
          } else if (k > 0 && k < 20) {
            const triangle = new T.BufferGeometry();
            triangle.setAttribute(
              'position',
              new T.Float32BufferAttribute([-0.32, 0, 0, 0.32, 0, 0, 0.09, -0.88, 0.045], 3),
            );
            triangle.computeVertexNormals();
            const colors = [0xd7c497, 0x3d7374, 0xad5c44, 0xd0d5c3];
            this.part(
              'stone',
              triangle,
              position.x,
              position.y,
              position.z,
              1,
              1,
              1,
              colors[(k / 2) % colors.length],
              Math.atan2(-p.nz, p.nx),
            );
            triangle.dispose();
          }
        }
      }
    }
  }

  private coastalBoats() {
    // Beyond the existing coastal surface, never on a road or river mouth.
    // Search the real field for water so an authored coordinate cannot put
    // the hull floating above land after a region-data change.
    for (let boat = 0; boat < 3; boat++) {
      const x = 670 + boat * 69;
      let z = -2720;
      while (z > -3300 && this.world.field.height(x, z) > this.world.region.seaLevel - 1.25) z -= 8;
      if (this.world.field.height(x, z) > this.world.region.seaLevel - 1.25) continue;
      const y = this.world.region.seaLevel - 0.03;
      const yaw = -0.28 + boat * 0.31,
        c = Math.cos(yaw),
        n = Math.sin(yaw);
      const at = (lx: number, ly: number, lz: number) =>
        new T.Vector3(x + lx * c + lz * n, y + ly, z - lx * n + lz * c);
      const hull = workboatHull();
      this.part('stone', hull, x, y, z, 1, 1, 1, 0xffffff, yaw);
      hull.dispose();
      const box = (
        kind: BatchKind,
        lx: number,
        ly: number,
        lz: number,
        sx: number,
        sy: number,
        sz: number,
        color: number,
      ) => {
        const p = at(lx, ly, lz);
        this.box(kind, p.x, p.y, p.z, sx, sy, sz, color, yaw);
      };
      box('stone', 0, 1.09, -1.35, 2.6, 0.15, 4.5, 0x72634c);
      box('stone', 0, 1.85, 0.28, 1.9, 1.55, 2.35, 0xc9c7b9);
      box('metal', 0, 2.67, 0.28, 2.17, 0.13, 2.66, 0x4b6265);
      box('glass', 0, 2.12, 1.465, 1.48, 0.59, 0.025, 0x1e3940);
      for (const side of [-1, 1]) {
        box('glass', side * 0.96, 2.13, 0.48, 0.025, 0.58, 1.25, 0x25434a);
        for (let k = 0; k < 5; k++) {
          const lz = -3.9 + k * 1.55,
            width = k < 3 ? 1.55 : 1.1;
          this.beam(
            'metal',
            at(side * width, 1.17, lz),
            at(side * width, 1.88, lz),
            0.026,
            0x929c99,
          );
          if (k < 4)
            this.beam(
              'metal',
              at(side * width, 1.88, lz),
              at(side * (k < 2 ? 1.55 : 1.1), 1.88, lz + 1.55),
              0.022,
              0xa2aca7,
            );
        }
        for (const lz of [-3.15, -1.8, 1.8]) {
          const fender = at(side * 1.6, 0.82, lz);
          this.part(
            'stone',
            this.primitives.sphere,
            fender.x,
            fender.y,
            fender.z,
            0.2,
            0.43,
            0.2,
            0x3c4847,
          );
          this.beam('metal', at(side * 1.5, 1.85, lz), at(side * 1.6, 1.06, lz), 0.014, 0xb0a488);
        }
      }
      this.beam('metal', at(0, 2.7, 0.12), at(0, 6.5, 0.12), 0.055, 0xabb6ad);
      this.beam('metal', at(-1.8, 4.8, 0.12), at(1.8, 4.8, 0.12), 0.033, 0xaab3aa);
      for (const lz of [-4.2, 4.15])
        this.beam('metal', at(0, 6.15, 0.12), at(0, 1.9, lz), 0.014, 0x756e58);
      for (const side of [-1, 1])
        this.beam('metal', at(0, 5.25, 0.12), at(side * 1.4, 1.9, -1), 0.016, 0x756e58);
      box('metal', 0, 5.1, 0.12, 1.25, 0.13, 0.24, 0xd7ddd5);
      const lamp = at(0, 6.55, 0.12);
      this.part(
        'bulb',
        this.primitives.sphere,
        lamp.x,
        lamp.y,
        lamp.z,
        0.065,
        0.09,
        0.065,
        0xffffff,
      );
      const ring = at(0, 1.83, -0.92);
      this.part(
        'stone',
        this.primitives.ring,
        ring.x,
        ring.y,
        ring.z,
        0.37,
        0.37,
        0.37,
        0xcc673e,
        yaw,
      );
      // Crate stack and a small rope net on the aft working deck.
      for (let k = 0; k < 4; k++)
        box(
          'stone',
          -0.7 + (k % 2) * 0.76,
          1.42 + Math.floor(k / 2) * 0.44,
          -2.8,
          0.68,
          0.42,
          0.85,
          boat % 2 ? 0x5e847b : 0x9c874b,
        );
      for (let k = 0; k < 8; k++)
        this.beam(
          'metal',
          at(-1.2, 1.27, -3.9 + k * 0.16),
          at(1.2, 1.27, -3.9 + k * 0.16),
          0.011,
          0x776e50,
        );
      this.stats.boats++;
    }
  }

  private buildMeadow() {
    const p = trackPoint(),
      q = trackPoint(),
      structures = new StructureGrid(this.structures);
    const net = this.world.network,
      field = this.world.field;
    const groups = new Map<string, GrassClump[]>();
    for (const edge of net.edges) {
      if (edge.roadClass === 'town' || edge.roadClass === 'runway') continue;
      const step = edge.roadClass === 'dirt' ? 8 : 12;
      for (let station = 18; station < edge.length - 18; station += step) {
        net.at(edge.offset + station, p);
        for (const side of [-1, 1]) {
          const h = hash01(Math.round(station), edge.index * side, 0x17e2);
          const lateral = side * (edge.spec.halfWidth + edge.spec.shoulder + 2.8 + h * 4.5);
          const x = p.x + p.nx * lateral,
            z = p.z + p.nz * lateral;
          const roadDistance = Math.abs(net.nearest(x, z, q));
          const nearest = net.edges[net.edgeOf[net.lastSegment]];
          if (roadDistance < nearest.spec.halfWidth + nearest.spec.shoulder + 2) continue;
          const ground = field.height(x, z);
          if (
            ground < field.region.seaLevel + 1.5 ||
            ground > field.snowLine(x, z) - 35 ||
            structures.blocks(x, z, 2)
          )
            continue;
          if (field.flatWeight('town', x, z) > 0.35 || field.flatWeight('airfield', x, z) > 0.45)
            continue;
          const valley = field.valleyAt(x, z);
          if (valley.distance < field.region.valley.channel + 4) continue;
          const y = carvedGroundHeight(this.world.carver, x, z);
          for (let k = 0; k < 4; k++) {
            const theta = h * Math.PI * 2 + k * 2.399963,
              radius = k * 0.22;
            const clump: GrassClump = {
              x: x + Math.sin(theta) * radius,
              y: y - 0.045,
              z: z + Math.cos(theta) * radius,
              width: 0.62 + h * 0.35,
              height: 0.72 + hash01(k, edge.index, Math.round(station)) * 0.45,
              yaw: theta,
              tile: Math.floor(h * 8),
              tint: h,
            };
            const key = `${Math.floor(clump.x / CHUNK)},${Math.floor(clump.z / CHUNK)}`;
            const group = groups.get(key);
            if (group) group.push(clump);
            else groups.set(key, [clump]);
            this.clumps.push(clump);
          }
        }
      }
    }
    this.meadowMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.solvaneTime = this.windTime;
      shader.uniforms.solvaneGrassRange = this.meadowRange;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nuniform float solvaneTime;\nuniform float solvaneGrassRange;',
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
vec3 solvaneWorld = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;
float solvaneDistance = distance(cameraPosition.xz, solvaneWorld.xz);
float solvaneFade = 1.0 - smoothstep(solvaneGrassRange * 0.65, solvaneGrassRange, solvaneDistance);
transformed.y *= solvaneFade;
transformed.x += sin(solvaneTime * 1.7 + solvaneWorld.x * 0.11 + solvaneWorld.z * 0.04) * position.y * position.y * 0.11 * solvaneFade;
transformed.z += cos(solvaneTime * 1.2 + solvaneWorld.z * 0.08) * position.y * position.y * 0.05 * solvaneFade;`,
        );
    };
    this.meadowMaterial.customProgramCacheKey = () => 'solvane-meadow-silhouette-v1';
    const transform = new T.Object3D(),
      color = new T.Color();
    for (const [key, clumps] of groups) {
      const mesh = new T.InstancedMesh(this.meadowGeometry, this.meadowMaterial, clumps.length);
      mesh.name = `Solvane meadow ${key}`;
      clumps.forEach((clump, i) => {
        transform.position.set(clump.x, clump.y, clump.z);
        transform.rotation.set(0, clump.yaw, 0);
        transform.scale.set(clump.width, clump.height, clump.width);
        transform.updateMatrix();
        mesh.setMatrixAt(i, transform.matrix);
        mesh.setColorAt(
          i,
          color.setRGB(
            0.86 + clump.tint * 0.25,
            0.87 + clump.tint * 0.16,
            0.73 + clump.tint * 0.24,
          ),
        );
      });
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      const sphere = mesh.boundingSphere!;
      this.meadowChunks.push({ mesh, center: sphere.center.clone(), radius: sphere.radius });
      this.meadow.add(mesh);
    }
    this.stats.meadowClumps = this.clumps.length;
  }

  /** Reuse the repository's licensed photographic meadow atlas when the
   * high/ultra vegetation library is available; procedural blades remain a
   * complete, independently working fallback. The library owns textures. */
  usePhotoVegetation(library: VegetationLibrary) {
    const shrub = library.get(SPECIES.shrub);
    if (shrub && !this.photoPocket) {
      this.photoPocket = new PhotoForest(library);
      const plants: PhotoPlant[] = this.pocketPlants.map((plant, i) => ({
        ...plant,
        species: SPECIES.shrub,
        scale: 0.42 / Math.max(0.1, shrub.info.radius),
        tint: [0.93 + (i % 5) * 0.015, 0.97, 0.85] as const,
      }));
      this.photoPocket.add(plants, {
        label: 'Port Ilse flowering planters',
        shadows: false,
        chunk: CHUNK,
      });
      this.root.add(this.photoPocket.root);
    }
    const species = library.get(SPECIES.grass);
    if (!species?.grass || this.photoGrass) return false;
    const tiles = species.grass.tiles;
    const plan = this.clumps.map((clump) => ({
      ...clump,
      tile: Math.floor(clump.tint * tiles) % tiles,
    }));
    this.photoGrass = new TrackGrass(species, plan);
    this.root.add(this.photoGrass.root);
    this.meadow.visible = false;
    return true;
  }

  private makeLanterns() {
    const positions: number[] = [];
    for (let i = 0; i < 32; i++) {
      const r = hash01(i, 5, 7342),
        angle = i * 2.399963;
      positions.push(
        660 + Math.cos(angle) * (10 + r * 23),
        12 + r * 34,
        -2740 + Math.sin(angle) * 22,
      );
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    geometry.computeBoundingSphere();
    geometry.boundingSphere!.radius += 8;
    const material = new T.PointsMaterial({
      color: 0xffc276,
      size: 1.1,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: T.AdditiveBlending,
    });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.solvaneLanternTime = this.lanternTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float solvaneLanternTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
transformed.y += sin(solvaneLanternTime * 0.17 + position.x) * 2.1;
transformed.x += sin(solvaneLanternTime * 0.11 + position.z) * 2.7;`,
        );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
float lanternRadius = length((gl_PointCoord - 0.5) * vec2(1.0, 0.83));
diffuseColor.a *= (1.0 - smoothstep(0.17, 0.5, lanternRadius));
if (diffuseColor.a < 0.01) discard;`,
      );
    };
    material.customProgramCacheKey = () => 'solvane-lantern-evening-v1';
    this.lanterns = new T.Points(geometry, material);
    this.lanterns.name = 'Port Ilse evening lanterns';
    this.lanterns.visible = false;
    this.root.add(this.lanterns);
    this.stats.lanterns = positions.length / 3;
  }

  update(time: number, night: number, camera: T.Camera, preset: QualityPreset) {
    this.windTime.value = time;
    this.lanternTime.value = time;
    this.materials.sign.emissiveIntensity = 0.015 + night * 0.78;
    this.materials.bulb.emissiveIntensity = 0.04 + night * 4.5;
    if (this.lanterns) {
      this.lanterns.visible = night > 0.08;
      (this.lanterns.material as T.PointsMaterial).opacity = night * 0.9;
    }
    camera.getWorldPosition(this.eye);
    // Small storefront hardware has no silhouette value kilometres away.
    // Cull by chunk bounds as well as the camera frustum; the collision-
    // backed building shells and their skyline remain in Buildings.
    const detailDistance =
      preset === 'low' ? 160 : preset === 'medium' ? 250 : preset === 'high' ? 360 : 500;
    for (const mesh of this.staticMeshes) {
      const sphere = mesh.geometry.boundingSphere!;
      const reach =
        mesh.userData.horizonDetailKind === 'sign' ? detailDistance * 1.18 : detailDistance;
      mesh.visible =
        !(this.authoredBoats && mesh.userData.legacyBoat) &&
        this.eye.distanceTo(sphere.center) - sphere.radius < reach;
    }
    const distance =
      preset === 'low' ? 0 : preset === 'medium' ? 75 : preset === 'high' ? 115 : 150;
    this.meadowRange.value = distance;
    for (const chunk of this.meadowChunks)
      chunk.mesh.visible =
        distance > 0 && this.eye.distanceTo(chunk.center) - chunk.radius < distance;
    if (this.photoGrass) {
      const photoDistance = VEGETATION.grass[preset];
      this.photoGrass.update(camera, photoDistance);
      this.photoGrass.root.visible = photoDistance > 0;
      this.meadow.visible = false;
    } else this.meadow.visible = true;
    this.photoPocket?.update(camera, preset);
  }

  dispose() {
    this.photoGrass?.dispose();
    this.photoGrass = null;
    this.photoPocket?.dispose();
    this.photoPocket = null;
    for (const mesh of this.staticMeshes) mesh.geometry.dispose();
    for (const chunk of this.meadowChunks) chunk.mesh.dispose();
    this.meadowChunks.length = 0;
    this.meadowGeometry.dispose();
    this.meadowMaterial.dispose();
    if (this.lanterns) {
      this.lanterns.geometry.dispose();
      (this.lanterns.material as T.Material).dispose();
    }
    for (const material of Object.values(this.materials)) material.dispose();
    this.atlas.dispose();
    this.root.clear();
    this.root.removeFromParent();
  }
}
