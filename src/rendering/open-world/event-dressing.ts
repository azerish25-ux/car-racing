import * as T from 'three';
import type { FestivalEvent } from '../../simulation/open-world/festival-events.ts';
import { isRace } from '../../simulation/open-world/festival-events.ts';
import { StructureGrid, type Structure } from '../../simulation/open-world/placement.ts';
import { pathPoint, type PathPoint } from '../../simulation/open-world/route-path.ts';
import { ROAD_CLASSES } from '../../simulation/open-world/region-data.ts';
import type { OpenWorld } from '../../simulation/open-world/world.ts';
import { trackPoint } from '../../simulation/track.ts';
import { FestivalStartFlares } from './start-flares.ts';

/** Festival event dressing measured from the reference event frames (FH6 ref
 * 025/040/041/042/046/047/049/072/076/077/078): truss arches over the road
 * at event starts (towers ~0.45 m square, clear height ~5.3 m, a 1.5 m
 * printed banner under the beam), neon-lime feather flags with black chevrons
 * (~4.4 m, cloth ~0.8 x 3.4 m) on the outside of drift-zone corners, and a
 * festival hub: white pagoda marquees (5 x 5 m, eaves 2.5 m, peak 4.6 m),
 * line-array speaker towers (~9.5 m truss masts), teardrop pennants, crowd
 * barriers with printed skins, a lime start gantry with LED boards and
 * drag-strip start lights. All wording and graphics are original. Every
 * height comes from the festival ground query; nothing here collides. */

type Height = (x: number, z: number, y?: number) => number;
const UP = new T.Vector3(0, 1, 0);
const FONT =
  '"Inter", "Saira Variable", "Noto Sans JP", "Hiragino Sans", "Yu Gothic", "IPAGothic", sans-serif';
/** Banner atlas rows (each a seamless 2048 x 256 strip). */
const ROW = { drift: 0, festival: 1, speed: 2, lime: 3 } as const;
type Row = (typeof ROW)[keyof typeof ROW];
const PALETTE = {
  magenta: '#e5167f',
  cyan: '#22d3e6',
  teal: '#0f9fb0',
  lime: '#c9f31d',
  charcoal: '#16181d',
  white: '#f4f4f1',
} as const;

/** Merged static geometry with vertex colours and optional atlas UVs. */
class Batch {
  readonly position: number[] = [];
  readonly normal: number[] = [];
  readonly uv: number[] = [];
  readonly color: number[] = [];
  readonly index: number[] = [];
  private readonly p = new T.Vector3();
  private readonly n = new T.Vector3();
  private readonly normalMatrix = new T.Matrix3();
  private readonly c = new T.Color();
  add(
    geometry: T.BufferGeometry,
    matrix: T.Matrix4,
    tint: number,
    uv?: { u0: number; v0: number; u1: number; v1: number },
  ) {
    const positions = geometry.getAttribute('position'),
      normals = geometry.getAttribute('normal'),
      uvs = geometry.getAttribute('uv');
    const offset = this.position.length / 3;
    this.normalMatrix.getNormalMatrix(matrix);
    this.c.setHex(tint);
    for (let i = 0; i < positions.count; i++) {
      this.p.fromBufferAttribute(positions, i).applyMatrix4(matrix);
      this.n.fromBufferAttribute(normals, i).applyMatrix3(this.normalMatrix).normalize();
      this.position.push(this.p.x, this.p.y, this.p.z);
      this.normal.push(this.n.x, this.n.y, this.n.z);
      const u = uvs ? uvs.getX(i) : 0,
        v = uvs ? uvs.getY(i) : 0;
      if (uv) this.uv.push(uv.u0 + (uv.u1 - uv.u0) * u, uv.v0 + (uv.v1 - uv.v0) * v);
      else this.uv.push(u, v);
      this.color.push(this.c.r, this.c.g, this.c.b);
    }
    if (geometry.index)
      for (let i = 0; i < geometry.index.count; i++)
        this.index.push(offset + geometry.index.getX(i));
    else for (let i = 0; i < positions.count; i++) this.index.push(offset + i);
  }
  get empty() {
    return this.index.length === 0;
  }
  finish() {
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(this.position, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(this.normal, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new T.Float32BufferAttribute(this.color, 3));
    g.setIndex(this.index);
    g.computeBoundingSphere();
    return g;
  }
}

/** A local frame on the road: x across (left), y up, z along travel. */
class Frame {
  readonly origin = new T.Vector3();
  readonly left = new T.Vector3();
  readonly forward = new T.Vector3();
  private readonly basis = new T.Matrix4();
  private readonly local = new T.Matrix4();
  private readonly q = new T.Quaternion();
  private readonly s = new T.Vector3();
  private readonly t = new T.Vector3();
  set(x: number, y: number, z: number, tx: number, tz: number) {
    const l = Math.hypot(tx, tz) || 1;
    this.origin.set(x, y, z);
    this.forward.set(tx / l, 0, tz / l);
    // Left = up x forward (a camera facing +z sees +x on its left).
    this.left.set(this.forward.z, 0, -this.forward.x);
    this.basis.makeBasis(this.left, UP, this.forward).setPosition(this.origin);
    return this;
  }
  /** World point of a local offset. */
  point(lx: number, ly: number, lz: number, out = new T.Vector3()) {
    return out
      .copy(this.origin)
      .addScaledVector(this.left, lx)
      .addScaledVector(this.forward, lz)
      .setY(this.origin.y + ly);
  }
  /** Matrix of a primitive placed at a local position, yaw (about up) and
   * scale; `y` is measured from the frame origin height. */
  matrix(
    lx: number,
    ly: number,
    lz: number,
    sx: number,
    sy: number,
    sz: number,
    yaw = 0,
    roll = 0,
  ) {
    this.q.setFromEuler(new T.Euler(0, yaw, roll, 'YXZ'));
    this.local.compose(this.t.set(lx, ly, lz), this.q, this.s.set(sx, sy, sz));
    return new T.Matrix4().multiplyMatrices(this.basis, this.local);
  }
  /** Primitive between two local points (a strut or chord of radius r). */
  strut(a: T.Vector3, b: T.Vector3, r: number) {
    const length = a.distanceTo(b);
    this.t.copy(b).sub(a).normalize();
    this.q.setFromUnitVectors(UP, this.t);
    this.t.copy(a).add(b).multiplyScalar(0.5);
    this.local.compose(this.t, this.q, this.s.set(r, length, r));
    return new T.Matrix4().multiplyMatrices(this.basis, this.local);
  }
}

function canvas2d(width: number, height: number) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  return ctx ? { canvas, ctx } : null;
}
function placeholder(rgba: [number, number, number, number]) {
  const t = new T.DataTexture(new Uint8Array(rgba), 1, 1);
  t.needsUpdate = true;
  return t;
}
function chevrons(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  n: number,
  colour: string,
  dir = 1,
) {
  ctx.fillStyle = colour;
  for (let i = 0; i < n; i++) {
    const cx = x + i * size * 0.72 * dir;
    ctx.beginPath();
    ctx.moveTo(cx - size * 0.32 * dir, y - size * 0.5);
    ctx.lineTo(cx, y - size * 0.5);
    ctx.lineTo(cx + size * 0.34 * dir, y);
    ctx.lineTo(cx, y + size * 0.5);
    ctx.lineTo(cx - size * 0.32 * dir, y + size * 0.5);
    ctx.lineTo(cx + size * 0.02 * dir, y);
    ctx.closePath();
    ctx.fill();
  }
}
/** Four seamless banner strips: drift zone (magenta, cyan type), festival
 * start (charcoal, magenta stripes, white pill), speed (teal), and the lime
 * gantry/barrier skin. Original wording only. */
function bannerAtlas() {
  const surface = canvas2d(2048, 1024);
  if (!surface) return placeholder([229, 22, 127, 255]);
  const { canvas, ctx } = surface;
  const strip = (row: Row, fill: string) => {
    ctx.fillStyle = fill;
    ctx.fillRect(0, row * 256, 2048, 256);
  };
  const type = (
    text: string,
    x: number,
    y: number,
    size: number,
    colour: string,
    italic = true,
    weight = 900,
  ) => {
    ctx.font = `${italic ? 'italic ' : ''}${weight} ${size}px ${FONT}`;
    ctx.fillStyle = colour;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
  };
  // Drift: magenta field, cyan italic word mark outlined in deep teal.
  strip(ROW.drift, PALETTE.magenta);
  ctx.fillStyle = '#c40f6b';
  for (let i = 0; i < 9; i++) ctx.fillRect(i * 240 - 40, 0, 90, 256);
  ctx.fillStyle = PALETTE.magenta;
  ctx.fillRect(0, 22, 2048, 212);
  ctx.lineWidth = 14;
  ctx.strokeStyle = '#0b5f6c';
  ctx.font = `italic 900 150px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeText('DRIFT ZONE', 1024, 118);
  type('DRIFT ZONE', 1024, 118, 150, PALETTE.cyan);
  type('ドリフト', 1580, 196, 44, PALETTE.white, false, 700);
  chevrons(ctx, 140, 128, 120, 3, PALETTE.lime);
  chevrons(ctx, 1908, 128, 120, 3, PALETTE.lime, -1);
  // Festival start: charcoal with magenta rails and a white pill.
  strip(ROW.festival, PALETTE.charcoal);
  ctx.fillStyle = PALETTE.magenta;
  ctx.fillRect(0, 256 + 10, 2048, 22);
  ctx.fillRect(0, 512 - 32, 2048, 22);
  ctx.fillStyle = PALETTE.white;
  ctx.beginPath();
  ctx.roundRect(574, 256 + 58, 900, 140, 70);
  ctx.fill();
  type('SOLVANE', 1024, 256 + 116, 92, PALETTE.magenta);
  type('F E S T I V A L', 1024, 256 + 176, 34, PALETTE.charcoal, false, 800);
  type('スタート', 300, 256 + 128, 64, PALETTE.white, false, 700);
  type('START', 1760, 256 + 128, 82, PALETTE.white);
  // Speed: teal with white italic mark and lime arrows.
  strip(ROW.speed, PALETTE.teal);
  ctx.fillStyle = '#0b7f8d';
  ctx.fillRect(0, 512 + 200, 2048, 56);
  type('SPEED', 1024, 512 + 112, 150, PALETTE.white);
  type('スピード', 1024, 512 + 222, 38, PALETTE.lime, false, 700);
  chevrons(ctx, 160, 512 + 118, 130, 4, PALETTE.lime);
  chevrons(ctx, 1888, 512 + 118, 130, 4, PALETTE.lime, -1);
  // Lime gantry / barrier skin: black type, repeating every 1024 px.
  strip(ROW.lime, PALETTE.lime);
  ctx.fillStyle = PALETTE.charcoal;
  ctx.fillRect(0, 768 + 216, 2048, 40);
  for (const x of [512, 1536]) {
    type('SOLVANE', x - 60, 768 + 104, 104, PALETTE.charcoal);
    type('FESTIVAL', x - 60, 768 + 176, 40, PALETTE.charcoal, false, 800);
    type('祭', x + 330, 768 + 112, 120, PALETTE.magenta, false, 900);
  }
  const t = new T.CanvasTexture(canvas);
  t.colorSpace = T.SRGBColorSpace;
  t.wrapS = T.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
/** Flag sheet: left half the neon-lime chevron feather flag (ref 041/042),
 * right half a white teardrop pennant tinted per instance; the last 6 % of
 * each half is the dark pole. */
function flagSheet() {
  const surface = canvas2d(512, 1024);
  if (!surface) return placeholder([201, 243, 29, 255]);
  const { canvas, ctx } = surface;
  ctx.clearRect(0, 0, 512, 1024);
  // Feather: straight leading edge at the pole, rounded top, tapered foot.
  ctx.fillStyle = PALETTE.lime;
  ctx.beginPath();
  ctx.moveTo(4, 1020);
  ctx.lineTo(4, 70);
  ctx.quadraticCurveTo(10, 4, 120, 10);
  ctx.quadraticCurveTo(232, 30, 236, 150);
  ctx.lineTo(236, 900);
  ctx.quadraticCurveTo(200, 990, 4, 1020);
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = '#111316';
  for (let i = 0; i < 7; i++) {
    const y = 150 + i * 118;
    ctx.beginPath();
    ctx.moveTo(30, y);
    ctx.lineTo(120, y + 62);
    ctx.lineTo(210, y);
    ctx.lineTo(210, y + 34);
    ctx.lineTo(120, y + 96);
    ctx.lineTo(30, y + 34);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  // Teardrop pennant (white; tinted by instance colour).
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(260, 1000);
  ctx.lineTo(260, 120);
  ctx.quadraticCurveTo(262, 6, 380, 40);
  ctx.quadraticCurveTo(486, 90, 488, 300);
  ctx.quadraticCurveTo(470, 640, 260, 1000);
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = 'rgba(20,22,26,0.35)';
  ctx.fillRect(256, 600, 256, 16);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = `italic 900 70px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText('S', 360, 300);
  ctx.restore();
  // Pole strips.
  ctx.fillStyle = '#2a2d31';
  ctx.fillRect(242, 0, 14, 1024);
  ctx.fillRect(498, 0, 14, 1024);
  const t = new T.CanvasTexture(canvas);
  t.colorSpace = T.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Feather or teardrop flag on its pole, as one mesh with sheet UVs. */
function flagGeometry(kind: 'feather' | 'teardrop') {
  const half = kind === 'feather' ? 0 : 0.5;
  const width = kind === 'feather' ? 0.82 : 1.0,
    height = kind === 'feather' ? 3.4 : 2.9,
    foot = kind === 'feather' ? 1.0 : 1.4,
    mast = foot + height + 0.15;
  const batch = new Batch();
  const cloth = new T.PlaneGeometry(1, 1, 4, 8);
  // A gentle wind belly so the cloth is not a flat card.
  const p = cloth.getAttribute('position');
  for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin((p.getX(i) + 0.5) * Math.PI) * 0.06);
  cloth.computeVertexNormals();
  const m = new T.Matrix4().compose(
    new T.Vector3(width / 2 + 0.03, foot + height / 2, 0),
    new T.Quaternion(),
    new T.Vector3(width, height, 1),
  );
  batch.add(cloth, m, 0xffffff, { u0: half + 0.008, v0: 0, u1: half + 0.46, v1: 1 });
  const pole = new T.CylinderGeometry(0.03, 0.035, 1, 6);
  batch.add(
    pole,
    new T.Matrix4().compose(
      new T.Vector3(0, mast / 2, 0),
      new T.Quaternion(),
      new T.Vector3(1, mast, 1),
    ),
    0xffffff,
    { u0: half + 0.48, v0: 0.1, u1: half + 0.49, v1: 0.9 },
  );
  cloth.dispose();
  pole.dispose();
  return batch.finish();
}

/** Pagoda marquee (5 x 5 m): concave four-sided roof to a finial, valance,
 * corner poles; fabric white, poles aluminium. */
function tentGeometry() {
  const batch = new Batch();
  const half = 2.5,
    eave = 2.5,
    peak = 4.6;
  // Roof: per side, a quad strip eave -> mid -> apex with a concave profile.
  const rings = [
    [half, eave],
    [half * 0.58, eave + 0.62],
    [half * 0.22, eave + 1.45],
    [0.04, peak],
  ];
  const roof = new T.BufferGeometry(),
    pos: number[] = [],
    idx: number[] = [];
  const corners = [
    [1, 1],
    [-1, 1],
    [-1, -1],
    [1, -1],
  ];
  for (let side = 0; side < 4; side++) {
    const a = corners[side],
      b = corners[(side + 1) % 4];
    const base = pos.length / 3;
    for (const [r, y] of rings) pos.push(a[0] * r, y, a[1] * r, b[0] * r, y, b[1] * r);
    for (let k = 0; k < rings.length - 1; k++) {
      const i = base + k * 2;
      idx.push(i, i + 2, i + 1, i + 1, i + 2, i + 3);
    }
  }
  roof.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  roof.setIndex(idx);
  roof.computeVertexNormals();
  roof.setAttribute('uv', new T.Float32BufferAttribute(new Array((pos.length / 3) * 2).fill(0), 2));
  const identity = new T.Matrix4();
  batch.add(roof, identity, 0xf3f3ef);
  const box = new T.BoxGeometry(1, 1, 1),
    cylinder = new T.CylinderGeometry(1, 1, 1, 6);
  // Valance skirt and corner poles.
  for (const [x, z, sx, sz] of [
    [0, half, 2 * half, 0.02],
    [0, -half, 2 * half, 0.02],
    [half, 0, 0.02, 2 * half],
    [-half, 0, 0.02, 2 * half],
  ])
    batch.add(
      box,
      new T.Matrix4().compose(
        new T.Vector3(x, eave - 0.16, z),
        new T.Quaternion(),
        new T.Vector3(sx, 0.32, sz),
      ),
      0xe9e9e4,
    );
  for (const [x, z] of corners)
    batch.add(
      cylinder,
      new T.Matrix4().compose(
        new T.Vector3(x * half, eave / 2, z * half),
        new T.Quaternion(),
        new T.Vector3(0.04, eave, 0.04),
      ),
      0x9ea2a6,
    );
  // Back wall (closed side) and a counter.
  batch.add(
    box,
    new T.Matrix4().compose(
      new T.Vector3(0, eave / 2 - 0.15, -half + 0.02),
      new T.Quaternion(),
      new T.Vector3(2 * half, eave - 0.3, 0.03),
    ),
    0xededea,
  );
  batch.add(
    box,
    new T.Matrix4().compose(
      new T.Vector3(0, 0.5, half - 0.6),
      new T.Quaternion(),
      new T.Vector3(3.2, 1.0, 0.6),
    ),
    0x2a2e33,
  );
  batch.add(
    cylinder,
    new T.Matrix4().compose(
      new T.Vector3(0, peak + 0.15, 0),
      new T.Quaternion(),
      new T.Vector3(0.03, 0.3, 0.03),
    ),
    0x9ea2a6,
  );
  roof.dispose();
  box.dispose();
  cylinder.dispose();
  return batch.finish();
}

/** Line-array speaker tower: ballast, 0.36 m truss mast to 9.4 m, a header,
 * and a J-curved hang of eight black cabinets facing +z. */
function speakerGeometry() {
  const batch = new Batch();
  const frame = new Frame().set(0, 0, 0, 0, 1);
  const box = new T.BoxGeometry(1, 1, 1),
    cylinder = new T.CylinderGeometry(1, 1, 1, 4, 1, true);
  batch.add(box, frame.matrix(0, 0.15, 0, 1.6, 0.3, 1.6), 0x3b3d41);
  truss(batch, frame, cylinder, new T.Vector3(0, 0.3, 0), new T.Vector3(0, 9.4, 0), 0.36, 0x26282c);
  batch.add(box, frame.matrix(0, 9.5, 0.35, 0.5, 0.2, 1.2), 0x1e2023);
  let y = 9.25,
    tilt = 0.02;
  for (let i = 0; i < 8; i++) {
    const h = 0.26;
    batch.add(box, frame.matrix(0, y - h / 2, 0.75 + i * 0.02, 0.9, h, 0.55, 0, 0), 0x121315);
    // Grille on the front face.
    batch.add(
      box,
      frame.matrix(0, y - h / 2, 1.03 + i * 0.02 + Math.sin(tilt) * 0.1, 0.84, h * 0.82, 0.01),
      0x26282b,
    );
    y -= h + 0.01;
    tilt += 0.05;
  }
  box.dispose();
  cylinder.dispose();
  return batch.finish();
}

/** Square truss between two local points: four chords and ladder rungs with
 * alternating diagonals on every face. */
function truss(
  batch: Batch,
  frame: Frame,
  cylinder: T.BufferGeometry,
  a: T.Vector3,
  b: T.Vector3,
  size: number,
  colour: number,
) {
  const axis = b.clone().sub(a),
    length = axis.length();
  axis.normalize();
  const u = Math.abs(axis.y) > 0.9 ? new T.Vector3(1, 0, 0) : new T.Vector3(0, 1, 0);
  const v = new T.Vector3().crossVectors(axis, u).normalize();
  u.crossVectors(v, axis).normalize();
  const h = size / 2;
  const offsets = [
    [h, h],
    [-h, h],
    [-h, -h],
    [h, -h],
  ];
  const corner = (k: number, t: number) =>
    a
      .clone()
      .addScaledVector(axis, t)
      .addScaledVector(u, offsets[k][0])
      .addScaledVector(v, offsets[k][1]);
  for (let k = 0; k < 4; k++)
    batch.add(cylinder, frame.strut(corner(k, 0), corner(k, length), 0.024), colour);
  const bays = Math.max(1, Math.round(length / 0.62));
  for (let i = 0; i <= bays; i++) {
    const t = (i / bays) * length,
      t2 = (Math.min(bays, i + 1) / bays) * length;
    for (let k = 0; k < 4; k++) {
      batch.add(cylinder, frame.strut(corner(k, t), corner((k + 1) % 4, t), 0.012), colour);
      if (i < bays)
        batch.add(
          cylinder,
          frame.strut(corner(k, i % 2 ? t : t2), corner((k + 1) % 4, i % 2 ? t2 : t), 0.01),
          colour,
        );
    }
  }
}

interface Placed {
  root: T.Object3D;
  centre: T.Vector3;
  range: number;
}
const ARCH_CLEAR = 5.35;

/**
 * Static festival dressing around event starts, drift zones and the Kestrel
 * festival hub. Each placement is its own small group (frustum-culled by its
 * bounding sphere and hidden beyond a distance by preset): arches are two
 * draws, a drift zone's flags one instanced draw, the hub six draws.
 */
export class FestivalEventDressing {
  readonly root = new T.Group();
  readonly stats = { arches: 0, flags: 0, tents: 0, speakers: 0, pennants: 0, triangles: 0 };
  private readonly placed: Placed[] = [];
  private readonly banners = bannerAtlas();
  private readonly flags = flagSheet();
  private readonly grid: StructureGrid;
  private readonly point = pathPoint();
  private readonly road = trackPoint();
  readonly materials = {
    frame: new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.45 }),
    banner: new T.MeshStandardMaterial({
      map: this.banners,
      emissiveMap: this.banners,
      emissive: 0xffffff,
      emissiveIntensity: 0.06,
      roughness: 0.72,
      metalness: 0,
    }),
    fabric: new T.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.85,
      side: T.DoubleSide,
      emissive: 0x5b4cff,
      emissiveIntensity: 0,
    }),
    flag: new T.MeshStandardMaterial({
      map: this.flags,
      alphaTest: 0.5,
      side: T.DoubleSide,
      roughness: 0.8,
      emissive: 0xffffff,
      emissiveMap: this.flags,
      emissiveIntensity: 0.05,
    }),
    lamp: new T.MeshBasicMaterial({ vertexColors: true }),
  };
  private readonly geometries: T.BufferGeometry[] = [];
  private readonly flareSites: T.Vector3[] = [];
  /** Night flares at race and drift starts (ref 048). */
  readonly flares: FestivalStartFlares;
  constructor(
    readonly events: readonly FestivalEvent[],
    readonly world: OpenWorld,
    structures: readonly Structure[],
    readonly height: Height,
  ) {
    this.root.name = 'Festival event dressing';
    // Floodlit print keeps its dye at night: tint the self-lit term by the
    // pennant's instance colour, as the lit term already is.
    this.materials.flag.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n#ifdef USE_COLOR\n  totalEmissiveRadiance *= vColor;\n#endif',
      );
    };
    this.grid = new StructureGrid(structures);
    const hub = events.find((e) => e.spec.id === 'runway-launch') ?? null;
    for (const event of events) {
      const kind = event.spec.kind;
      // The hub gantry spans the runway starts; no second arch beside it.
      if (hub && hub !== event && this.nearHub(event, hub)) {
        if (kind === 'drift-zone') this.driftFlags(event);
        continue;
      }
      if (event === hub) continue;
      if (kind === 'drift-zone') {
        this.arch(event, 9, ROW.drift);
        this.driftFlags(event);
      } else if (kind === 'speed-trap') this.arch(event, event.path.finishDistance, ROW.speed);
      else if (kind === 'speed-zone') this.arch(event, 9, ROW.speed);
      else if (isRace(kind)) this.arch(event, 11, ROW.festival);
    }
    if (hub) this.festivalHub(hub);
    const opening = events.find((e) => e.spec.id === 'harbour-welcome');
    if (opening) this.welcomeCorner(opening);
    this.flares = new FestivalStartFlares(this.flareSites);
    this.root.traverse((node) => {
      if (node instanceof T.Mesh) {
        const g = node.geometry as T.BufferGeometry;
        const count = (g.index?.count ?? g.getAttribute('position').count) / 3;
        this.stats.triangles += node instanceof T.InstancedMesh ? count * node.count : count;
      }
    });
    this.root.add(this.flares.mesh);
  }
  private nearHub(event: FestivalEvent, hub: FestivalEvent) {
    return (
      Math.hypot(event.marker.x - hub.marker.x, event.marker.z - hub.marker.z) < 1800 &&
      Math.abs(event.marker.z - hub.marker.z) < 60 &&
      this.roadClassAt(event.marker.x, event.marker.z) === 'runway'
    );
  }
  private roadClassAt(x: number, z: number) {
    const net = this.world.network;
    net.nearest(x, z, this.road);
    return net.edges[net.edgeOf[net.lastSegment]].roadClass;
  }
  /** Clear of every road surface and building footprint (with margins). */
  private clear(x: number, z: number, pad: number) {
    const net = this.world.network;
    const lateral = net.nearest(x, z, this.road);
    const edge = net.edges[net.edgeOf[net.lastSegment]];
    if (
      Math.abs(lateral) < edge.spec.halfWidth + edge.spec.shoulder + pad ||
      net.lastDistance < edge.spec.halfWidth + pad
    )
      return false;
    if (this.grid.blocks(x, z, pad + 1)) return false;
    return this.height(x, z) > this.world.field.region.seaLevel + 0.4;
  }
  private group(name: string, centre: T.Vector3, range: number) {
    const root = new T.Group();
    root.name = name;
    this.root.add(root);
    this.placed.push({ root, centre: centre.clone(), range });
    return root;
  }
  private mesh(batch: Batch, material: T.Material, name: string, shadows = true) {
    const geometry = batch.finish();
    this.geometries.push(geometry);
    const mesh = new T.Mesh(geometry, material);
    mesh.name = name;
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    return mesh;
  }
  private span(p: PathPoint) {
    const edge = this.world.network.edges[p.edge];
    return Math.min(23, p.halfWidth + ROAD_CLASSES[edge.roadClass].shoulder + 0.9);
  }
  /** Truss arch across the route at `distance`, its banner facing the
   * approaching driver (and readable from behind). */
  private arch(event: FestivalEvent, distance: number, row: Row, towerHeight = 7.4) {
    const p = event.path.at(Math.min(distance, event.path.length - 1), this.point);
    const half = this.span(p);
    const frame = new Frame();
    const left = new T.Vector3(p.x, 0, p.z).addScaledVector(new T.Vector3(p.tz, 0, -p.tx), half),
      right = new T.Vector3(p.x, 0, p.z).addScaledVector(new T.Vector3(p.tz, 0, -p.tx), -half);
    const yl = this.height(left.x, left.z, p.y),
      yr = this.height(right.x, right.z, p.y),
      road = this.height(p.x, p.z, p.y);
    const base = Math.min(yl, yr, road);
    frame.set(p.x, base, p.z, p.tx, p.tz);
    const top = Math.max(yl, yr, road) - base + towerHeight;
    const metal = new Batch(),
      print = new Batch();
    const box = new T.BoxGeometry(1, 1, 1),
      cylinder = new T.CylinderGeometry(1, 1, 1, 4, 1, true),
      plane = new T.PlaneGeometry(1, 1);
    for (const [side, y] of [
      [1, yl - base],
      [-1, yr - base],
    ] as const) {
      const x = side * half;
      metal.add(box, frame.matrix(x, y + 0.22, 0, 1.1, 0.44, 1.1), 0x6d7074);
      truss(
        metal,
        frame,
        cylinder,
        new T.Vector3(x, y + 0.44, 0),
        new T.Vector3(x, top, 0),
        0.45,
        0x2c2f33,
      );
      // Printed tower skins facing the approach and the road.
      const skin = row === ROW.drift ? 0xe5167f : row === ROW.speed ? 0x0f9fb0 : 0x16181d;
      metal.add(box, frame.matrix(x, y + 3.0, -0.25, 0.5, 4.2, 0.03), skin);
      metal.add(box, frame.matrix(x - side * 0.25, y + 3.0, 0, 0.03, 4.2, 0.5), skin);
    }
    truss(
      metal,
      frame,
      cylinder,
      new T.Vector3(half + 0.25, top + 0.22, 0),
      new T.Vector3(-half - 0.25, top + 0.22, 0),
      0.45,
      0x2c2f33,
    );
    // Banner: under the beam, clear height >= 5.35 m above the higher edge.
    const width = 2 * half - 0.5,
      bannerHeight = Math.min(1.6, Math.max(1.2, width / 8));
    const centreY = Math.max(
      top - 0.1 - bannerHeight / 2,
      Math.max(yl, yr, road) - base + ARCH_CLEAR + bannerHeight / 2,
    );
    const tiles = Math.max(1, Math.round(width / (bannerHeight * 8)));
    const v0 = 1 - (row + 1) / 4 + 0.006,
      v1 = 1 - row / 4 - 0.006;
    print.add(plane, frame.matrix(0, centreY, -0.03, width, bannerHeight, 1, Math.PI), 0xffffff, {
      u0: 0,
      v0,
      u1: tiles,
      v1,
    });
    print.add(plane, frame.matrix(0, centreY, 0.03, width, bannerHeight, 1, 0), 0xffffff, {
      u0: 0,
      v0,
      u1: tiles,
      v1,
    });
    metal.add(box, frame.matrix(0, centreY, 0, width, bannerHeight + 0.08, 0.04), 0x1a1c20);
    box.dispose();
    cylinder.dispose();
    plane.dispose();
    const centre = frame.point(0, top / 2, 0);
    const group = this.group(`Festival arch ${event.spec.id}`, centre, 900);
    group.add(
      this.mesh(metal, this.materials.frame, 'Arch truss'),
      this.mesh(print, this.materials.banner, 'Arch banner'),
    );
    this.stats.arches++;
    // Night start flares just before each tower of a race or drift start.
    if (row === ROW.festival || row === ROW.drift)
      for (const side of [1, -1]) {
        const at = frame.point(side * (half + 0.9), 0, -2.5);
        at.y = this.height(at.x, at.z, p.y);
        this.flareSites.push(at);
      }
  }
  /** Neon chevron flags on the outside of the drift zone's corners and,
   * sparsely, along its straights. */
  private driftFlags(event: FestivalEvent) {
    const path = event.path,
      finish = Math.min(path.finishDistance, path.length - 1);
    const spots: { x: number; y: number; z: number; yaw: number }[] = [];
    const last = [-1e9, -1e9];
    let straight = 0;
    for (let d = 10; d < finish && spots.length < 40; d += 6) {
      const p = path.at(d, this.point);
      const k = p.curvature;
      let side = 0;
      if (Math.abs(k) > 1 / 75) side = k > 0 ? -1 : 1;
      else if (d - straight > 42) {
        side = spots.length % 2 ? 1 : -1;
      }
      if (!side) continue;
      const slot = side > 0 ? 0 : 1;
      if (d - last[slot] < (Math.abs(k) > 1 / 75 ? 16 : 40)) continue;
      const edge = this.world.network.edges[p.edge];
      const offset = p.halfWidth + ROAD_CLASSES[edge.roadClass].shoulder + 1.3;
      const lx = p.tz,
        lz = -p.tx;
      const x = p.x + lx * offset * side,
        z = p.z + lz * offset * side;
      if (!this.clear(x, z, 0.6)) continue;
      last[slot] = d;
      straight = d;
      // Face the approach, turned ~25 degrees toward the road.
      const yaw = Math.atan2(-p.tx, -p.tz) - side * 0.45;
      spots.push({ x, y: this.height(x, z, p.y) - 0.05, z, yaw });
    }
    if (!spots.length) return;
    const geometry = flagGeometry('feather');
    this.geometries.push(geometry);
    const mesh = new T.InstancedMesh(geometry, this.materials.flag, spots.length);
    mesh.name = `Drift zone flags ${event.spec.id}`;
    const m = new T.Object3D();
    const centre = new T.Vector3();
    spots.forEach((s, i) => {
      m.position.set(s.x, s.y, s.z);
      m.rotation.set(0, s.yaw, 0);
      m.updateMatrix();
      mesh.setMatrixAt(i, m.matrix);
      centre.add(m.position);
    });
    centre.divideScalar(spots.length);
    mesh.castShadow = true;
    mesh.computeBoundingSphere();
    const group = this.group(
      `Drift flags ${event.spec.id}`,
      centre,
      650 + (mesh.boundingSphere?.radius ?? 0),
    );
    group.add(mesh);
    this.stats.flags += spots.length;
  }
  /** Kestrel festival hub at the runway launch: lime start gantry with LED
   * boards, start lights, barriers with printed skins, pennants, marquees
   * and speaker towers on the clear apron either side. */
  private festivalHub(event: FestivalEvent) {
    const path = event.path;
    const p = path.at(0, pathPoint());
    const half = this.span(p) + 0.6;
    const frame = new Frame().set(p.x, this.height(p.x, p.z, p.y), p.z, p.tx, p.tz);
    const metal = new Batch(),
      print = new Batch(),
      lamps = new Batch();
    const box = new T.BoxGeometry(1, 1, 1),
      cylinder = new T.CylinderGeometry(1, 1, 1, 4, 1, true),
      plane = new T.PlaneGeometry(1, 1),
      sphere = new T.SphereGeometry(1, 8, 6);
    const ground = (lx: number, lz: number) => {
      const w = frame.point(lx, 0, lz);
      return this.height(w.x, w.z, p.y) - frame.origin.y;
    };
    const uvRow = (row: Row, tiles: number) => ({
      u0: 0,
      v0: 1 - (row + 1) / 4 + 0.006,
      u1: tiles,
      v1: 1 - row / 4 - 0.006,
    });
    // Start gantry 18 m past the line: towers, beam, lime banner, LED boards.
    const gz = 18,
      top = 8.2;
    for (const side of [1, -1]) {
      const x = side * half,
        y = ground(x, gz);
      metal.add(box, frame.matrix(x, y + 0.25, gz, 1.3, 0.5, 1.3), 0x6d7074);
      truss(
        metal,
        frame,
        cylinder,
        new T.Vector3(x, y + 0.5, gz),
        new T.Vector3(x, top, gz),
        0.55,
        0x2c2f33,
      );
      // LED board on the tower head (dark cabinet, festival art face).
      metal.add(box, frame.matrix(x + side * 0.4, top + 1.55, gz, 4.6, 2.7, 0.3), 0x0d0e10);
      print.add(
        plane,
        frame.matrix(x + side * 0.4, top + 1.55, gz - 0.16, 4.3, 2.4, 1, Math.PI),
        0xffffff,
        {
          ...uvRow(ROW.festival, 1),
          u0: 0.27,
          u1: 0.73,
        },
      );
      // Printed tower skins (magenta on the approach, teal toward the strip).
      metal.add(box, frame.matrix(x, y + 3.6, gz - 0.29, 0.56, 5.2, 0.03), 0xe5167f);
      metal.add(box, frame.matrix(x - side * 0.29, y + 3.6, gz, 0.03, 5.2, 0.56), 0x0f9fb0);
    }
    truss(
      metal,
      frame,
      cylinder,
      new T.Vector3(half + 0.3, top - 0.3, gz),
      new T.Vector3(-half - 0.3, top - 0.3, gz),
      0.55,
      0x2c2f33,
    );
    const width = 2 * half - 0.6;
    const tiles = Math.max(1, Math.round(width / 9.6));
    print.add(
      plane,
      frame.matrix(0, top - 1.35, gz - 0.02, width, 1.2, 1, Math.PI),
      0xffffff,
      uvRow(ROW.lime, tiles),
    );
    print.add(
      plane,
      frame.matrix(0, top - 1.35, gz + 0.02, width, 1.2, 1, 0),
      0xffffff,
      uvRow(ROW.lime, tiles),
    );
    // Drag-strip start lights on both shoulders, facing the line.
    for (const side of [1, -1]) {
      const x = side * (half - 3.2),
        z = -2.5,
        y = ground(x, z);
      metal.add(cylinder, frame.matrix(x, y + 1.3, z, 0.07, 2.6, 0.07), 0x202225);
      metal.add(box, frame.matrix(x, y + 2.75, z, 0.42, 1.9, 0.22), 0x17181b);
      const colours = [0x5aa8ff, 0x5aa8ff, 0x553311, 0x553311, 0x553311, 0x18ff5a, 0x441111];
      colours.forEach((c, i) => {
        for (const dx of [-0.11, 0.11])
          lamps.add(
            sphere,
            frame.matrix(x + dx, y + 3.55 - i * 0.26, z - 0.13, 0.075, 0.075, 0.03),
            c,
          );
      });
    }
    // Crowd barriers with printed skins along both runway edges.
    for (const side of [1, -1]) {
      const x = side * (half + 1.2);
      for (let z = -30; z < 120; z += 2.4) {
        const y = ground(x, z);
        metal.add(box, frame.matrix(x, y + 0.55, z, 0.05, 1.1, 2.3), 0x8d9196);
        const row = Math.floor((z + 30) / 2.4) % 6 === 0 ? ROW.festival : ROW.lime;
        print.add(
          plane,
          frame.matrix(
            x - side * 0.03,
            y + 0.6,
            z,
            2.3,
            0.85,
            1,
            side > 0 ? -Math.PI / 2 : Math.PI / 2,
          ),
          0xffffff,
          {
            u0: (Math.abs(z) % 9.6) / 9.6,
            v0: 1 - (row + 1) / 4 + 0.006,
            u1: (Math.abs(z) % 9.6) / 9.6 + 0.24,
            v1: 1 - row / 4 - 0.006,
          },
        );
      }
    }
    box.dispose();
    cylinder.dispose();
    plane.dispose();
    sphere.dispose();
    const centre = frame.point(0, 4, 40);
    const group = this.group('Kestrel festival hub', centre, 1500);
    group.add(
      this.mesh(metal, this.materials.frame, 'Hub gantry, lights and barriers'),
      this.mesh(print, this.materials.banner, 'Hub printed skins'),
      this.mesh(lamps, this.materials.lamp, 'Hub start lamps', false),
    );
    // Teardrop pennants along both edges.
    const pennants: T.Matrix4[] = [],
      tints: number[] = [];
    const tint = [0xe5167f, 0x16b8c8, 0xc9f31d, 0xf4f4f1];
    for (const side of [1, -1])
      for (let z = -20, i = 0; z <= 130; z += 11, i++) {
        const x = side * (half + 2.6),
          w = frame.point(x, 0, z);
        if (!this.clear(w.x, w.z, 0)) continue;
        const m = frame.matrix(x, ground(x, z) - 0.05, z, 1, 1, 1, Math.PI + side * 0.5);
        pennants.push(m);
        tints.push(tint[(i + (side > 0 ? 0 : 2)) % 4]);
      }
    if (pennants.length) {
      const geometry = flagGeometry('teardrop');
      this.geometries.push(geometry);
      const mesh = new T.InstancedMesh(geometry, this.materials.flag, pennants.length);
      mesh.name = 'Hub pennants';
      const c = new T.Color();
      pennants.forEach((m, i) => {
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, c.setHex(tints[i]));
      });
      mesh.castShadow = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
      this.stats.pennants += pennants.length;
    }
    // Marquees and speaker towers on clear apron/grass beside the strip.
    const tents: T.Matrix4[] = [],
      speakers: T.Matrix4[] = [];
    for (const side of [1, -1]) {
      for (let row = 0; row < 2; row++)
        for (let k = 0; k < 6; k++) {
          const x = side * (half + 12 + row * 8),
            z = 4 + k * 7.5;
          const w = frame.point(x, 0, z);
          if (!this.clear(w.x, w.z, 3.2) || tents.length >= 16) continue;
          tents.push(
            frame.matrix(x, ground(x, z), z, 1, 1, 1, side > 0 ? -Math.PI / 2 : Math.PI / 2),
          );
        }
      for (const z of [-6, 56]) {
        const x = side * (half + 9),
          w = frame.point(x, 0, z);
        if (!this.clear(w.x, w.z, 1.2)) continue;
        // Arrays face the strip.
        speakers.push(
          frame.matrix(x, ground(x, z), z, 1, 1, 1, side > 0 ? -Math.PI / 2 : Math.PI / 2),
        );
      }
    }
    for (const [list, geometry, material, name] of [
      [tents, tentGeometry(), this.materials.fabric, 'Hub marquees'],
      [speakers, speakerGeometry(), this.materials.frame, 'Hub speaker towers'],
    ] as const) {
      this.geometries.push(geometry);
      if (!list.length) continue;
      const mesh = new T.InstancedMesh(geometry, material, list.length);
      mesh.name = name;
      list.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
    this.stats.tents += tents.length;
    this.stats.speakers += speakers.length;
  }
  /** A small welcome corner beside the opening run's start: two marquees,
   * a speaker tower and pennants where the harbour front has room. */
  private welcomeCorner(event: FestivalEvent) {
    const p = event.path.at(0, pathPoint());
    const frame = new Frame().set(p.x, this.height(p.x, p.z, p.y), p.z, p.tx, p.tz);
    const tents: T.Matrix4[] = [],
      speakers: T.Matrix4[] = [],
      pennants: T.Matrix4[] = [];
    const tints: number[] = [];
    const ground = (lx: number, lz: number) => {
      const w = frame.point(lx, 0, lz);
      return this.height(w.x, w.z, p.y) - frame.origin.y;
    };
    for (const side of [1, -1])
      for (const lateral of [11, 16, 22])
        for (const z of [-14, -6, 2, 10, 18]) {
          const x = side * lateral,
            w = frame.point(x, 0, z);
          if (tents.length >= 3 || !this.clear(w.x, w.z, 3)) continue;
          if (
            tents.some(
              (m) =>
                new T.Vector3().setFromMatrixPosition(m).distanceTo(frame.point(x, 0, z)) < 6.5,
            )
          )
            continue;
          tents.push(
            frame.matrix(x, ground(x, z), z, 1, 1, 1, side > 0 ? -Math.PI / 2 : Math.PI / 2),
          );
        }
    for (const side of [1, -1])
      for (const z of [-20, 24]) {
        const x = side * 9.5,
          w = frame.point(x, 0, z);
        if (speakers.length >= 2 || !this.clear(w.x, w.z, 1)) continue;
        speakers.push(
          frame.matrix(x, ground(x, z), z, 1, 1, 1, side > 0 ? -Math.PI / 2 : Math.PI / 2),
        );
      }
    const tint = [0xe5167f, 0x16b8c8, 0xc9f31d];
    for (const side of [1, -1])
      for (let z = -12, i = 0; z <= 36; z += 8, i++) {
        const edge = this.world.network.edges[p.edge];
        const x = side * (p.halfWidth + ROAD_CLASSES[edge.roadClass].shoulder + 0.7),
          w = frame.point(x, 0, z);
        if (!this.clear(w.x, w.z, 0)) continue;
        pennants.push(frame.matrix(x, ground(x, z) - 0.05, z, 1, 1, 1, Math.PI + side * 0.5));
        tints.push(tint[i % 3]);
      }
    if (!tents.length && !speakers.length && !pennants.length) return;
    const group = this.group('Harbour welcome corner', frame.point(0, 3, 6), 700);
    for (const [list, make, material, name] of [
      [tents, tentGeometry, this.materials.fabric, 'Welcome marquees'],
      [speakers, speakerGeometry, this.materials.frame, 'Welcome speaker towers'],
      [pennants, () => flagGeometry('teardrop'), this.materials.flag, 'Welcome pennants'],
    ] as const) {
      if (!list.length) continue;
      const geometry = make();
      this.geometries.push(geometry);
      const mesh = new T.InstancedMesh(geometry, material, list.length);
      mesh.name = name;
      const c = new T.Color();
      list.forEach((m, i) => {
        mesh.setMatrixAt(i, m);
        if (list === pennants) mesh.setColorAt(i, c.setHex(tints[i]));
      });
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
    this.stats.tents += tents.length;
    this.stats.speakers += speakers.length;
    this.stats.pennants += pennants.length;
  }
  /** Distance visibility by preset and night lighting of the printed and
   * fabric surfaces (floodlit at night, as ref 072). */
  update(camera: T.Camera, night: number, preset: string, time = 0) {
    const scale = preset === 'low' ? 0.45 : preset === 'medium' ? 0.75 : 1;
    const eye = camera.position;
    for (const p of this.placed) p.root.visible = eye.distanceTo(p.centre) < p.range * scale;
    this.materials.banner.emissiveIntensity = 0.06 + night * 0.55;
    this.materials.fabric.emissiveIntensity = night * 0.35;
    this.materials.flag.emissiveIntensity = 0.05 + night * 0.4;
    this.flares.update(camera, night, time);
  }
  dispose() {
    for (const g of this.geometries) g.dispose();
    for (const m of Object.values(this.materials)) m.dispose();
    this.banners.dispose();
    this.flags.dispose();
    this.flares.dispose();
    this.root.clear();
  }
}
