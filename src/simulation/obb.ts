import { Vec3 } from '../core/math.ts';
import type { RigidBody } from './rigid.ts';

/** Convex chassis proxy in metres. Orientation follows the full rigid body,
 * not just yaw. Wheels and wings remain a fidelity boundary of this proxy. */
export class ChassisBox {
  readonly axes = [new Vec3(), new Vec3(), new Vec3()];
  half: readonly number[] = [0.94, 0.38, 2.5];
  readonly center = new Vec3();
  minX = 0;
  maxX = 0;
  update(body: RigidBody) {
    this.center.copy(body.position);
    for (let i = 0; i < 3; i++)
      body.orientation.rotate(
        this.axes[i].set(Number(i === 0), Number(i === 1), Number(i === 2)),
        this.axes[i],
      );
    const radius =
      Math.abs(this.axes[0].x) * this.half[0] +
      Math.abs(this.axes[1].x) * this.half[1] +
      Math.abs(this.axes[2].x) * this.half[2];
    this.minX = this.center.x - radius;
    this.maxX = this.center.x + radius;
  }
  radius(n: Vec3) {
    return (
      Math.abs(this.axes[0].dot(n)) * this.half[0] +
      Math.abs(this.axes[1].dot(n)) * this.half[1] +
      Math.abs(this.axes[2].dot(n)) * this.half[2]
    );
  }
  support(n: Vec3, out: Vec3) {
    out.copy(this.center);
    for (let i = 0; i < 3; i++) {
      const d = this.axes[i].dot(n);
      if (Math.abs(d) > 1e-7) out.addScaled(this.axes[i], Math.sign(d) * this.half[i]);
    }
    return out;
  }
}

/** All 15 separating axes: three faces per box and nine edge cross-products.
 * Scratch storage belongs to this query instance and is reused each solve. */
export class BoxContact {
  readonly normal = new Vec3();
  readonly point = new Vec3();
  depth = 0;
  private axis = new Vec3();
  private delta = new Vec3();
  private aPoint = new Vec3();
  private bPoint = new Vec3();
  intersect(a: ChassisBox, b: ChassisBox): boolean {
    this.delta.copy(a.center).sub(b.center);
    this.depth = Infinity;
    for (let k = 0; k < 15; k++) {
      if (k < 3) this.axis.copy(a.axes[k]);
      else if (k < 6) this.axis.copy(b.axes[k - 3]);
      else this.axis.cross(a.axes[Math.floor((k - 6) / 3)], b.axes[(k - 6) % 3]);
      const magnitude = this.axis.length();
      if (magnitude < 1e-7) continue;
      this.axis.scale(1 / magnitude);
      const distance = this.delta.dot(this.axis);
      const overlap = a.radius(this.axis) + b.radius(this.axis) - Math.abs(distance);
      if (overlap <= 0) return false;
      if (overlap < this.depth) {
        this.depth = overlap;
        this.normal.copy(this.axis).scale(distance < 0 ? -1 : 1);
      }
    }
    a.support(this.axis.copy(this.normal).scale(-1), this.aPoint);
    b.support(this.normal, this.bPoint);
    this.point.copy(this.aPoint).add(this.bPoint).scale(0.5);
    // Face-centre support points are clamped into the overlap along each box
    // tangent; this avoids applying aligned contacts at an arbitrary corner.
    for (let boxIndex = 0; boxIndex < 2; boxIndex++) {
      const box = boxIndex === 0 ? a : b;
      this.delta.copy(this.point).sub(box.center);
      for (let i = 0; i < 3; i++) {
        if (Math.abs(box.axes[i].dot(this.normal)) > 0.95) continue;
        const along = this.delta.dot(box.axes[i]);
        const excess = Math.max(0, Math.abs(along) - box.half[i]);
        if (excess) this.point.addScaled(box.axes[i], -Math.sign(along) * excess);
      }
    }
    return Number.isFinite(this.depth);
  }
}
