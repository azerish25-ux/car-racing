/** Authoritative moving surfaces (WP44, masterplan §16.3). The simulation
 * owns gameplay-relevant motion as a pure function of simulation time, so
 * pause, replay, seek and network state agree, and rendering only follows.
 * Contact uses the surface's own velocity: friction acts on the relative
 * velocity, so a resting vehicle is transported and a stationary one on a
 * moving belt is carried, not left behind or launched. */
export interface MovingSurface {
  /** Surface velocity (m/s) at time t and horizontal position. */
  velocity(t: number, x: number, z: number): { x: number; z: number };
  /** Is (x, z) on the surface at time t? */
  contains(t: number, x: number, z: number): boolean;
  /** Surface height offset at time t. */
  height(t: number): number;
}
/** A conveyor belt along +Z with a deterministic on/off duty cycle. */
export function conveyor(
  x0: number,
  z0: number,
  width: number,
  length: number,
  speed: number,
  period = 0,
  duty = 1,
): MovingSurface {
  const running = (t: number) => period <= 0 || (((t % period) + period) % period) / period < duty;
  return {
    velocity: (t) => ({ x: 0, z: running(t) ? speed : 0 }),
    contains: (_t, x, z) => Math.abs(x - x0) <= width / 2 && z >= z0 && z <= z0 + length,
    height: () => 0,
  };
}
/** A platform oscillating along X: position p(t) = A·sin(2πt/T). */
export function shuttle(
  x0: number,
  z0: number,
  half: number,
  amplitude: number,
  period: number,
): MovingSurface {
  const w = (2 * Math.PI) / period;
  const offset = (t: number) => amplitude * Math.sin(w * t);
  return {
    velocity: (t) => ({ x: amplitude * w * Math.cos(w * t), z: 0 }),
    contains: (t, x, z) => Math.abs(x - (x0 + offset(t))) <= half && Math.abs(z - z0) <= half,
    height: () => 0,
  };
}
/** A body in contact with the ground or a moving surface (point model). */
export interface GroundBody {
  x: number;
  z: number;
  vx: number;
  vz: number;
}
/** Advance a body with Coulomb friction μ·g against the relative velocity. */
export function stepOnSurfaces(
  body: GroundBody,
  surfaces: readonly MovingSurface[],
  t: number,
  dt: number,
  mu = 0.9,
  g = 9.81,
) {
  let sx = 0,
    sz = 0;
  for (const s of surfaces)
    if (s.contains(t, body.x, body.z)) {
      const v = s.velocity(t, body.x, body.z);
      sx = v.x;
      sz = v.z;
      break;
    }
  const rx = body.vx - sx,
    rz = body.vz - sz,
    rel = Math.hypot(rx, rz),
    dv = Math.min(rel, mu * g * dt);
  if (rel > 1e-9) {
    body.vx -= (rx / rel) * dv;
    body.vz -= (rz / rel) * dv;
  }
  body.x += body.vx * dt;
  body.z += body.vz * dt;
}
