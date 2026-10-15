import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Random } from '../../core/math.ts';
import { trackPoint, type Track } from '../../simulation/track.ts';
import { materials } from '../materials/index.ts';

/** Indoor stadium dimensions (m). */
export const STADIUM = Object.freeze({
  margin: 9,
  tiers: 16,
  rise: 0.82,
  depth: 0.95,
  seat: 0.62,
  roof: 34,
  occupancy: 0.78,
});
/**
 * Supercross stadium bowl (WP41): stepped concrete stands on four sides of
 * the stadium floor, an instanced crowd (one draw), a roof deck on steel
 * trusses and rows of floodlight heads under it (unlit HDR emitters the
 * bloom halos; the floor itself is lit by the night light pools).
 */
export class Stadium {
  readonly root = new T.Group();
  readonly crowd: T.InstancedMesh;
  constructor(track: Track) {
    this.root.name = 'Supercross stadium';
    const p = trackPoint(),
      box = new T.Box3();
    let floor = Infinity;
    for (let s = 0; s < track.length; s += 4) {
      track.at(s, p);
      box.expandByPoint(new T.Vector3(p.x + p.nx * p.width, p.y, p.z + p.nz * p.width));
      box.expandByPoint(new T.Vector3(p.x - p.nx * p.width, p.y, p.z - p.nz * p.width));
      floor = Math.min(floor, p.y);
    }
    box.expandByVector(new T.Vector3(STADIUM.margin, 0, STADIUM.margin));
    const concrete = materials.concrete({ variant: 'rough', horizontal: 1, color: 0x8b8882 });
    const steel = materials.metal({
      kind: 'cast',
      metal: 'steel',
      color: 0x2c2f33,
      roughness: 0.6,
    });
    const deck = new T.MeshStandardMaterial({
      color: 0x101114,
      roughness: 0.9,
      name: 'Stadium roof deck',
    });
    const lamp = new T.MeshStandardMaterial({
      color: 0x111111,
      emissive: 0xfff4e2,
      emissiveIntensity: 14,
      name: 'Floodlight head',
    });
    const r = new Random(7151);
    const tiers: T.BufferGeometry[] = [];
    const seats: T.Matrix4[] = [];
    const colours: T.Color[] = [];
    const sides = [
      { axis: 'x', sign: -1 },
      { axis: 'x', sign: 1 },
      { axis: 'z', sign: -1 },
      { axis: 'z', sign: 1 },
    ] as const;
    const min = box.min,
      max = box.max;
    for (const side of sides) {
      const along = side.axis === 'x' ? max.z - min.z : max.x - min.x;
      for (let k = 0; k < STADIUM.tiers; k++) {
        const out = k * STADIUM.depth + STADIUM.depth / 2,
          top = floor + (k + 1) * STADIUM.rise;
        const g = new T.BoxGeometry(
          side.axis === 'x' ? STADIUM.depth : along + 2 * k * STADIUM.depth,
          top - floor + 0.4,
          side.axis === 'x' ? along + 2 * k * STADIUM.depth : STADIUM.depth,
        );
        const cx =
            side.axis === 'x' ? (side.sign < 0 ? min.x - out : max.x + out) : (min.x + max.x) / 2,
          cz =
            side.axis === 'z' ? (side.sign < 0 ? min.z - out : max.z + out) : (min.z + max.z) / 2;
        g.translate(cx, (top + floor - 0.4) / 2, cz);
        tiers.push(g);
        // Spectators along the tier.
        const n = Math.floor((along + 2 * k * STADIUM.depth) / STADIUM.seat);
        for (let i = 0; i < n; i++) {
          if (r.next() > STADIUM.occupancy) continue;
          const t = (i + 0.5) / n - 0.5,
            x = side.axis === 'x' ? cx : cx + t * (along + 2 * k * STADIUM.depth),
            z = side.axis === 'z' ? cz : cz + t * (along + 2 * k * STADIUM.depth);
          const m = new T.Matrix4().makeRotationY(
            side.axis === 'x'
              ? side.sign < 0
                ? Math.PI / 2
                : -Math.PI / 2
              : side.sign < 0
                ? 0
                : Math.PI,
          );
          m.setPosition(x, top, z);
          seats.push(m);
          colours.push(
            new T.Color().setHSL(r.next(), 0.08 + 0.3 * r.next(), 0.1 + 0.28 * r.next()),
          );
        }
      }
    }
    const stands = new T.Mesh(mergeGeometries(tiers, false), concrete);
    for (const g of tiers) g.dispose();
    stands.receiveShadow = true;
    stands.name = 'Stadium stands';
    this.root.add(stands);
    // One spectator: seated torso and head (merged), instanced per seat.
    const torso = new T.BoxGeometry(0.42, 0.62, 0.3).translate(0, 0.31, 0);
    const head = new T.SphereGeometry(0.11, 10, 8).translate(0, 0.76, 0.02);
    const person = mergeGeometries([torso, head], false);
    torso.dispose();
    head.dispose();
    const clothing = new T.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.85,
      name: 'Spectators',
    });
    this.crowd = new T.InstancedMesh(person, clothing, seats.length);
    seats.forEach((m, i) => {
      this.crowd.setMatrixAt(i, m);
      this.crowd.setColorAt(i, colours[i]);
    });
    this.crowd.name = 'Stadium crowd (instanced)';
    this.crowd.instanceMatrix.needsUpdate = true;
    this.root.add(this.crowd);
    // Roof deck and trusses with floodlight rows.
    const span = new T.Vector3();
    box.getSize(span);
    const outer = STADIUM.tiers * STADIUM.depth;
    const roof = new T.Mesh(new T.BoxGeometry(span.x + 2 * outer, 0.6, span.z + 2 * outer), deck);
    roof.position.set((min.x + max.x) / 2, floor + STADIUM.roof, (min.z + max.z) / 2);
    this.root.add(roof);
    const rows = 5;
    for (let k = 0; k < rows; k++) {
      const z = min.z + ((k + 0.5) / rows) * span.z;
      const truss = new T.Mesh(new T.BoxGeometry(span.x + outer, 1.2, 0.8), steel);
      truss.position.set((min.x + max.x) / 2, floor + STADIUM.roof - 2, z);
      this.root.add(truss);
      for (let i = 0; i < 8; i++) {
        const head = new T.Mesh(new T.BoxGeometry(0.9, 0.35, 0.9), lamp);
        head.position.set(min.x + ((i + 0.5) / 8) * span.x, floor + STADIUM.roof - 2.9, z);
        this.root.add(head);
      }
    }
  }
  dispose() {
    this.root.traverse((o) => {
      if (o instanceof T.Mesh) {
        o.geometry.dispose();
        (o.material as T.Material).dispose();
      }
    });
  }
}
