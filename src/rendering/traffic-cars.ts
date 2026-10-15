import * as T from 'three';
import { TF, TRAFFIC_FLAG, TRAFFIC_HEADER, TRAFFIC_STRIDE } from '../simulation/open-world/ambient-traffic.ts';
import { vehicleAt } from '../simulation/vehicles.ts';

/** Most ambient cars drawn at once (the simulation caps the field lower). */
export const TRAFFIC_CAPACITY = 48;
/** Proportions of the generic body in metres (a 4.5 m hatch/saloon). */
const BODY = { halfWidth: 0.92, halfHeight: 0.72, halfLength: 2.25 };
const PAINT = [0xd8dde2, 0x1f2a36, 0x8a1c1c, 0x2f5d8c, 0x3d3f42, 0xb7a27a, 0x24553a, 0xe2e2da, 0x6b6f76, 0x7a2f55];

/** A box from (x0, y0, z0) to (x1, y1, z1) with one vertex colour. */
function box(parts: T.BufferGeometry[], x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, colour: T.Color) {
  const g = new T.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).toNonIndexed();
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const n = g.getAttribute('position').count,
    c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) colour.toArray(c, i * 3);
  g.setAttribute('color', new T.BufferAttribute(c, 3));
  parts.push(g);
}
function merge(parts: T.BufferGeometry[]) {
  const count = parts.reduce((s, g) => s + g.getAttribute('position').count, 0),
    position = new Float32Array(count * 3),
    normal = new Float32Array(count * 3),
    color = new Float32Array(count * 3);
  let o = 0;
  for (const g of parts) {
    position.set(g.getAttribute('position').array as Float32Array, o * 3);
    normal.set(g.getAttribute('normal').array as Float32Array, o * 3);
    color.set(g.getAttribute('color').array as Float32Array, o * 3);
    o += g.getAttribute('position').count;
    g.dispose();
  }
  const out = new T.BufferGeometry();
  out.setAttribute('position', new T.BufferAttribute(position, 3));
  out.setAttribute('normal', new T.BufferAttribute(normal, 3));
  out.setAttribute('color', new T.BufferAttribute(color, 3));
  out.computeBoundingSphere();
  return out;
}
/** The generic traffic body (centred on the box centre, +z forward): lower
 * body in paint (white vertex colour, tinted per instance), a darker glass
 * house, bumpers and four tyres. One geometry for every ambient car. */
function bodyGeometry() {
  const { halfWidth: w, halfHeight: h, halfLength: l } = BODY,
    paint = new T.Color(1, 1, 1),
    glass = new T.Color(0.06, 0.07, 0.08),
    trim = new T.Color(0.09, 0.09, 0.1),
    tyre = new T.Color(0.035, 0.035, 0.035);
  const parts: T.BufferGeometry[] = [];
  const floor = -h + 0.18;
  box(parts, -w, floor, -l, w, 0.02, l, paint);
  box(parts, -w * 0.86, 0.02, -l * 0.52, w * 0.86, h * 0.95, l * 0.3, glass);
  box(parts, -w * 0.8, h * 0.93, -l * 0.46, w * 0.8, h, l * 0.24, paint);
  box(parts, -w * 1.01, floor, l - 0.16, w * 1.01, floor + 0.2, l + 0.04, trim);
  box(parts, -w * 1.01, floor, -l - 0.04, w * 1.01, floor + 0.2, -l + 0.16, trim);
  const r = 0.33;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const g = new T.CylinderGeometry(r, r, 0.24, 14).toNonIndexed();
      g.rotateZ(Math.PI / 2);
      g.translate(sx * (w - 0.1), -h + r, sz * (l - 0.78));
      const n = g.getAttribute('position').count,
        c = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) tyre.toArray(c, i * 3);
      g.setAttribute('color', new T.BufferAttribute(c, 3));
      parts.push(g);
    }
  return merge(parts);
}
/** Head and tail lamps: white at the front, red at the rear (vertex colour),
 * brightened per instance (night, braking, hazards). */
function lampGeometry() {
  const { halfWidth: w, halfLength: l } = BODY,
    head = new T.Color(1, 0.95, 0.85),
    tail = new T.Color(1, 0.06, 0.04);
  const parts: T.BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    box(parts, sx * w * 0.62 - 0.17, -0.12, l - 0.02, sx * w * 0.62 + 0.17, 0.0, l + 0.03, head);
    box(parts, sx * w * 0.66 - 0.16, -0.08, -l - 0.03, sx * w * 0.66 + 0.16, 0.04, -l + 0.02, tail);
  }
  return merge(parts);
}

/**
 * Ambient traffic presentation for the festival: one instanced body mesh and
 * one instanced lamp mesh for every car (two draw calls plus the shadow
 * pass, whatever the field size), posed from the traffic block that comes
 * with each festival frame and interpolated between frames by car id. The
 * generic body is scaled to each registry machine's half extents; paint is
 * chosen per car id. Cheap by design: the player's own car and event rivals
 * keep the full procedural bodies.
 */
export class TrafficCars {
  readonly root = new T.Group();
  readonly bodies: T.InstancedMesh;
  readonly lamps: T.InstancedMesh;
  private readonly matrix = new T.Matrix4();
  private readonly position = new T.Vector3();
  private readonly previous = new T.Vector3();
  private readonly quaternion = new T.Quaternion();
  private readonly qa = new T.Quaternion();
  private readonly scale = new T.Vector3();
  private readonly colour = new T.Color();
  private readonly index = new Map<number, number>();
  /** Cars drawn in the last update. */
  count = 0;
  constructor() {
    this.root.name = 'Ambient traffic';
    const material = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.15 });
    this.bodies = new T.InstancedMesh(bodyGeometry(), material, TRAFFIC_CAPACITY);
    this.bodies.name = 'Ambient traffic bodies (instanced)';
    this.bodies.castShadow = true;
    this.bodies.receiveShadow = true;
    this.bodies.frustumCulled = false;
    this.bodies.count = 0;
    this.lamps = new T.InstancedMesh(lampGeometry(), new T.MeshBasicMaterial({ vertexColors: true }), TRAFFIC_CAPACITY);
    this.lamps.name = 'Ambient traffic lamps (instanced)';
    this.lamps.frustumCulled = false;
    this.lamps.count = 0;
    // Allocate the per-instance colour buffers.
    for (let i = 0; i < TRAFFIC_CAPACITY; i++) {
      this.bodies.setColorAt(i, this.colour.setRGB(1, 1, 1));
      this.lamps.setColorAt(i, this.colour.setRGB(1, 1, 1));
    }
    this.root.add(this.bodies, this.lamps);
  }
  /** Pose from two traffic blocks (`a` older) at `alpha`; `time` (s) blinks hazards. */
  update(a: Float32Array | null, b: Float32Array | null, alpha: number, night: number, time: number) {
    if (!b || b.length < TRAFFIC_HEADER) {
      this.bodies.count = this.lamps.count = this.count = 0;
      return;
    }
    const n = Math.min(TRAFFIC_CAPACITY, Math.round(b[0]));
    this.index.clear();
    if (a && a.length >= TRAFFIC_HEADER)
      for (let k = 0, m = Math.round(a[0]); k < m; k++) this.index.set(a[TRAFFIC_HEADER + k * TRAFFIC_STRIDE + TF.ID], k);
    for (let k = 0; k < n; k++) {
      const o = TRAFFIC_HEADER + k * TRAFFIC_STRIDE,
        id = b[o + TF.ID],
        previous = this.index.get(id),
        p = previous === undefined || !a ? -1 : TRAFFIC_HEADER + previous * TRAFFIC_STRIDE;
      this.position.set(b[o + TF.X], b[o + TF.Y], b[o + TF.Z]);
      this.quaternion.set(b[o + TF.QX], b[o + TF.QY], b[o + TF.QZ], b[o + TF.QW]);
      if (p >= 0 && a) {
        this.position.copy(this.previous.set(a[p + TF.X], a[p + TF.Y], a[p + TF.Z]).lerp(this.position, alpha));
        this.qa.set(a[p + TF.QX], a[p + TF.QY], a[p + TF.QZ], a[p + TF.QW]);
        this.quaternion.copy(this.qa.slerp(this.quaternion, alpha));
      }
      const def = vehicleAt(Math.round(b[o + TF.VEHICLE])),
        [hx, hy, hz] = def.halfExtents;
      this.scale.set(hx / BODY.halfWidth, Math.max(0.5, hy) / BODY.halfHeight, hz / BODY.halfLength);
      this.matrix.compose(this.position, this.quaternion, this.scale);
      this.bodies.setMatrixAt(k, this.matrix);
      this.lamps.setMatrixAt(k, this.matrix);
      const paint = PAINT[Math.abs(Math.round(id) * 7919) % PAINT.length];
      this.bodies.setColorAt(k, this.colour.setHex(paint));
      const flags = b[o + TF.FLAGS],
        hazard = (flags & TRAFFIC_FLAG.HAZARD) !== 0 && Math.floor(time * 2.5) % 2 === 0,
        brake = b[o + TF.BRAKE];
      // Lamp brightness: dipped at night, brighter on the brakes or hazards.
      const glow = Math.max(0.35 + night * 2.2, brake > 0.05 ? 2.6 : 0, hazard ? 3 : 0);
      this.lamps.setColorAt(k, this.colour.setScalar(glow));
    }
    this.bodies.count = this.lamps.count = this.count = n;
    this.bodies.instanceMatrix.needsUpdate = true;
    this.lamps.instanceMatrix.needsUpdate = true;
    if (this.bodies.instanceColor) this.bodies.instanceColor.needsUpdate = true;
    if (this.lamps.instanceColor) this.lamps.instanceColor.needsUpdate = true;
  }
  dispose() {
    this.root.removeFromParent();
    this.bodies.geometry.dispose();
    (this.bodies.material as T.Material).dispose();
    this.lamps.geometry.dispose();
    (this.lamps.material as T.Material).dispose();
    this.bodies.dispose();
    this.lamps.dispose();
  }
}
