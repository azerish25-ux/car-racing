import { ChassisBox, BoxContact } from './obb.ts';
import { clamp, mod, Vec3 } from '../core/math.ts';
import { trackPoint, type Track } from './track.ts';
import type { Vehicle } from './vehicle.ts';
/** Scratch state is owned per collision solver, not by a mutable module singleton. */
export class CollisionSolver {
  private n = new Vec3();
  private boxes: ChassisBox[] = [];
  private order: number[] = [];
  private contact = new BoxContact();
  private corner = new Vec3();
  private rA = new Vec3();
  private rB = new Vec3();
  private vA = new Vec3();
  private vB = new Vec3();
  private cross = new Vec3();
  private inertia = new Vec3();
  private point = new Vec3();
  private trackPos = trackPoint();
  impulse(a: Vehicle, b: Vehicle | null, contact: Vec3, normal: Vec3, penetration: number) {
    const { rA, rB, vA, vB, cross, inertia } = this,
      A = a.body,
      B = b?.body;
    A.pointVelocity(contact, vA);
    if (B) B.pointVelocity(contact, vB);
    else vB.set(0, 0, 0);
    vA.sub(vB);
    const vn = vA.dot(normal),
      inverseMass = 1 / A.mass + (B ? 1 / B.mass : 0);
    rA.copy(contact).sub(A.position);
    cross.cross(rA, normal);
    A.inverseInertia(cross, inertia);
    let denominator = inverseMass + inertia.dot(cross);
    if (B) {
      rB.copy(contact).sub(B.position);
      cross.cross(rB, normal);
      B.inverseInertia(cross, inertia);
      denominator += inertia.dot(cross);
    }
    if (vn < 0) {
      const j = (-1.08 * vn) / denominator;
      A.velocity.addScaled(normal, j / A.mass);
      cross.cross(rA, normal).scale(j);
      A.inverseInertia(cross, inertia);
      A.omega.add(inertia);
      if (B) {
        B.velocity.addScaled(normal, -j / B.mass);
        cross.cross(rB, normal).scale(-j);
        B.inverseInertia(cross, inertia);
        B.omega.add(inertia);
      }
      // Recompute tangential relative velocity after the normal impulse.
      // Friction has rotational effective mass and angular impulse too.
      A.pointVelocity(contact, vA);
      if (B) B.pointVelocity(contact, vB);
      else vB.set(0, 0, 0);
      vA.sub(vB).addScaled(normal, -vA.dot(normal));
      const speed = vA.length();
      if (speed > 1e-5) {
        vA.scale(1 / speed);
        cross.cross(rA, vA);
        A.inverseInertia(cross, inertia);
        let tangentMass = inverseMass + inertia.dot(cross);
        if (B) {
          cross.cross(rB, vA);
          B.inverseInertia(cross, inertia);
          tangentMass += inertia.dot(cross);
        }
        const jt = Math.min(j * 0.3, speed / tangentMass);
        A.velocity.addScaled(vA, -jt / A.mass);
        cross.cross(rA, vA).scale(-jt);
        A.inverseInertia(cross, inertia);
        A.omega.add(inertia);
        if (B) {
          B.velocity.addScaled(vA, jt / B.mass);
          cross.cross(rB, vA).scale(jt);
          B.inverseInertia(cross, inertia);
          B.omega.add(inertia);
        }
      }
      const energy = (0.5 * vn * vn) / denominator;
      a.impactAt(energy, contact);
      if (b) b.impactAt(energy, contact);
    }
    const correction = (Math.max(0, penetration - 0.004) * 0.48) / inverseMass;
    A.position.addScaled(normal, correction / A.mass);
    if (B) B.position.addScaled(normal, -correction / B.mass);
  }
  solve(cars: Vehicle[], track: Track) {
    const { n, point, trackPos } = this;
    while (this.boxes.length < cars.length) this.boxes.push(new ChassisBox());
    if (this.order.length !== cars.length) this.order = cars.map((_, i) => i);
    for (let i = 0; i < cars.length; i++) {
      this.boxes[i].half = cars[i].definition.halfExtents;
      this.boxes[i].update(cars[i].body);
    }
    // Sweep-and-prune broad phase; stable ID tie-break makes ordering repeatable.
    this.order.sort((a, b) => this.boxes[a].minX - this.boxes[b].minX || a - b);
    for (let k = 0; k < cars.length; k++) {
      const i = this.order[k],
        a = cars[i],
        A = this.boxes[i];
      for (let l = k + 1; l < cars.length; l++) {
        const j = this.order[l],
          B = this.boxes[j];
        if (B.minX > A.maxX) break;
        if (this.contact.intersect(A, B))
          this.impulse(a, cars[j], this.contact.point, this.contact.normal, this.contact.depth);
      }
    }
    for (const a of cars) {
      let deepest = 0;
      // Probe chassis corners, not just its centre, against track barriers.
      for (let side = -1; side <= 1; side += 2)
        for (let end = -1; end <= 1; end += 2) {
          a.body.orientation
            .rotate(
              this.corner.set(
                side * a.definition.halfExtents[0],
                0,
                end * a.definition.halfExtents[2],
              ),
              this.corner,
            )
            .add(a.body.position);
          let lateral = track.nearest(this.corner.x, this.corner.z, trackPos, this.corner.y);
          // Stadium rhythm lanes are close enough that a chassis corner can
          // be nearer the next lane while the bike is still on this one.
          // That lane's opposite-facing wall would push it farther out. Keep
          // the usual exact projection unless it leaves the bike's local
          // course neighbourhood, then project only around its own station.
          if (track.circuit.offroad && a.definition.bike?.offroad) {
            const reach = Math.max(
              4,
              3 * Math.hypot(a.definition.halfExtents[0], a.definition.halfExtents[2]),
            );
            const distance =
              mod(trackPos.s - a.s + track.length / 2, track.length) - track.length / 2;
            if (Math.abs(distance) > reach) {
              let along = 0;
              for (let i = 0; i < 3; i++) {
                track.at(a.s + along, trackPos);
                const step =
                  (this.corner.x - trackPos.x) * trackPos.tx +
                  (this.corner.z - trackPos.z) * trackPos.tz;
                along = clamp(along + step, -reach, reach);
              }
              track.at(a.s + along, trackPos);
              lateral =
                (this.corner.x - trackPos.x) * trackPos.nx +
                (this.corner.z - trackPos.z) * trackPos.nz;
            }
          }
          const boundary = track.boundaryAt(trackPos, Math.sign(lateral));
          const penetration = Math.abs(lateral) - boundary;
          if (penetration > deepest) {
            deepest = penetration;
            n.set(-trackPos.nx * Math.sign(lateral), 0, -trackPos.nz * Math.sign(lateral));
            point.copy(this.corner);
          }
        }
      if (deepest > 0) this.impulse(a, null, point, n, deepest);
    }
  }
}
