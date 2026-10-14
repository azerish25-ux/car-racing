import { G, Vec3 } from '../core/math.ts';
import type { Track } from './track.ts';
import { surfaceSample } from './track.ts';

export interface Fragment {
  active: boolean;
  kind: number;
  age: number;
  mass: number;
  position: Vec3;
  velocity: Vec3;
  rotation: number;
  spin: number;
}
/** Bounded per-car debris pool; fragments carry inherited contact velocity and
 * exchange impulses with the ground. Expired pieces do not allocate replacements. */
export class DebrisPool {
  readonly pieces: Fragment[] = Array.from({ length: 4 }, () => ({
    active: false,
    kind: 0,
    age: 0,
    mass: 0,
    position: new Vec3(),
    velocity: new Vec3(),
    rotation: 0,
    spin: 0,
  }));
  private surface = surfaceSample();
  emit(kind: number, position: Vec3, velocity: Vec3, mass: number, spin: number) {
    const piece = this.pieces.find((p) => !p.active);
    if (!piece) return;
    piece.active = true;
    piece.kind = kind;
    piece.age = 0;
    piece.mass = mass;
    piece.position.copy(position);
    piece.velocity.copy(velocity);
    piece.rotation = 0;
    piece.spin = spin;
  }
  step(dt: number, track: Track) {
    for (const p of this.pieces) {
      if (!p.active) continue;
      p.age += dt;
      if (p.age > 20) {
        p.active = false;
        continue;
      }
      p.velocity.y -= G * dt;
      p.velocity.scale(Math.exp((-0.08 * p.velocity.length() * dt) / Math.max(1, p.mass)));
      p.position.addScaled(p.velocity, dt);
      p.rotation += p.spin * dt;
      track.sample(p.position.x, p.position.z, this.surface, p.position.y);
      if (p.position.y < this.surface.height + 0.025) {
        p.position.y = this.surface.height + 0.025;
        const normalSpeed = p.velocity.dot(this.surface.normal);
        if (normalSpeed < 0) p.velocity.addScaled(this.surface.normal, -normalSpeed * 1.15);
        p.velocity.scale(Math.exp(-5 * dt));
        p.spin *= Math.exp(-8 * dt);
      }
    }
  }
}
