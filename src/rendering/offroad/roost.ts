import * as T from 'three';
import { clamp, Random } from '../../core/math.ts';
import { MATERIAL } from '../../simulation/surface-material.ts';
import {
  carBase,
  F,
  H,
  O,
  OFFROAD_BASE,
  R,
  RACE_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
} from '../../simulation/protocol.ts';
import { vehicleAt } from '../../simulation/vehicles.ts';

/** Loose ground a spinning tyre throws (WP41). */
const LOOSE = new Set<number>([
  MATERIAL.DIRT,
  MATERIAL.MUD,
  MATERIAL.SAND,
  MATERIAL.GRAVEL_ROAD,
  MATERIAL.GRAVEL,
  MATERIAL.GRASS,
]);
/** Particle pool size (clods and dust puffs share it). */
export const ROOST_CAPACITY = 2400;
function softDisc() {
  const size = 64,
    data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5,
        dy = (y + 0.5) / size - 0.5,
        r = Math.sqrt(dx * dx + dy * dy) * 2,
        a = clamp(1 - r, 0, 1) ** 0.8;
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  const texture = new T.DataTexture(data, size, size, T.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}
/**
 * Roost: clods and dust thrown back by driven wheels spinning on loose
 * ground, from each entrant's snapshot (wheel load, slip and surface, body
 * pose, O.MOISTURE). Presentation only: its own random stream, never read by
 * the simulation, emitted the same way live and in replays. Wet soil throws
 * dark, heavy clods; dry soil adds pale dust that hangs.
 */
export class Roost {
  readonly points: T.Points;
  private readonly positions = new Float32Array(ROOST_CAPACITY * 3);
  private readonly velocities = new Float32Array(ROOST_CAPACITY * 3);
  private readonly colours = new Float32Array(ROOST_CAPACITY * 3);
  private readonly life = new Float32Array(ROOST_CAPACITY);
  private readonly maxLife = new Float32Array(ROOST_CAPACITY);
  private readonly floor = new Float32Array(ROOST_CAPACITY);
  private readonly drag = new Float32Array(ROOST_CAPACITY);
  private readonly emission = new Float64Array(64 * 4);
  private readonly random = new Random(40817);
  private readonly q = new T.Quaternion();
  private readonly v = new T.Vector3();
  private readonly back = new T.Vector3();
  private cursor = 0;
  enabled = true;
  density = 1;
  constructor() {
    const g = new T.BufferGeometry();
    g.setAttribute(
      'position',
      new T.BufferAttribute(this.positions, 3).setUsage(T.DynamicDrawUsage),
    );
    g.setAttribute('color', new T.BufferAttribute(this.colours, 3).setUsage(T.DynamicDrawUsage));
    const material = new T.PointsMaterial({
      size: 0.11,
      sizeAttenuation: true,
      vertexColors: true,
      map: softDisc(),
      transparent: true,
      alphaTest: 0.04,
      depthWrite: false,
    });
    this.points = new T.Points(g, material);
    this.points.name = 'Roost (clods and dust)';
    this.points.frustumCulled = false;
    this.life.fill(0);
    // Parked below the world until born.
    for (let i = 0; i < ROOST_CAPACITY; i++) this.positions[i * 3 + 1] = -1e4;
  }
  private spawn(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    wet: number,
    dust: boolean,
  ) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % ROOST_CAPACITY;
    const r = this.random;
    this.positions.set([x, y, z], i * 3);
    this.velocities.set([vx, vy, vz], i * 3);
    const tone = 0.85 + 0.3 * r.next();
    // Linear albedo: dry loam dust to wet clay.
    const dry = dust ? [0.42, 0.35, 0.27] : [0.3, 0.23, 0.16],
      mud = [0.075, 0.055, 0.038];
    for (let c = 0; c < 3; c++) this.colours[i * 3 + c] = (dry[c] + (mud[c] - dry[c]) * wet) * tone;
    this.maxLife[i] = this.life[i] = dust ? 1.2 + r.next() : 0.6 + 0.6 * r.next();
    this.floor[i] = y - 0.35;
    this.drag[i] = dust ? 2.5 : 0.25;
  }
  update(frame: Float32Array, dt: number) {
    if (!Number.isFinite(dt) || dt < 0) return;
    this.points.visible = this.enabled;
    const step = Math.min(dt, 0.05);
    for (let i = 0; i < ROOST_CAPACITY; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= step;
      const k = i * 3;
      const drag = Math.exp(-this.drag[i] * step);
      this.velocities[k] *= drag;
      this.velocities[k + 2] *= drag;
      this.velocities[k + 1] =
        this.velocities[k + 1] * drag - 9.81 * step * (this.drag[i] > 1 ? 0.08 : 1);
      this.positions[k] += this.velocities[k] * step;
      this.positions[k + 1] += this.velocities[k + 1] * step;
      this.positions[k + 2] += this.velocities[k + 2] * step;
      if (this.life[i] <= 0 || this.positions[k + 1] < this.floor[i]) {
        this.life[i] = 0;
        this.positions[k + 1] = -1e4;
      }
    }
    const g = this.points.geometry;
    g.getAttribute('position').needsUpdate = true;
    g.getAttribute('color').needsUpdate = true;
    if (!this.enabled || dt === 0) return;
    const r = this.random,
      cars = Math.min(64, frame[H.CARS]);
    for (let id = 0; id < cars; id++) {
      const o = carBase(id),
        def = vehicleAt(Math.round(frame[o + RACE_BASE + R.VEHICLE])),
        speed = frame[o + F.SPEED],
        wet = clamp(frame[o + OFFROAD_BASE + O.MOISTURE] * 1.6, 0, 1);
      this.q.set(frame[o + F.QX], frame[o + F.QY], frame[o + F.QZ], frame[o + F.QW]);
      this.back.set(0, 0, -1).applyQuaternion(this.q);
      const bike = def.dynamicsKind === 'bike';
      // Driven wheels: the rear of a bike, all four of a 4WD car.
      const wheels = bike
        ? [2]
        : def.drivetrain === 'fwd'
          ? [0, 1]
          : def.drivetrain === 'rwd'
            ? [2, 3]
            : [0, 1, 2, 3];
      for (const wheel of wheels) {
        const p = o + WHEEL_BASE + wheel * WHEEL_STRIDE,
          slot = id * 4 + wheel;
        const loose = LOOSE.has(Math.round(frame[p + W.SURFACE])),
          load = frame[p + W.LOAD],
          slip = Math.abs(frame[p + W.SLIP]);
        if (!loose || load < 50 || speed < 1.5) {
          this.emission[slot] = 0;
          continue;
        }
        // Spin throws clods; plain rolling on dry ground lifts a little dust.
        const spin = clamp((slip - 0.04) * 6, 0, 1.5),
          rate =
            (spin * (40 + speed * 6) + (1 - wet) * speed * 0.6) * (bike ? 1 : 0.7) * this.density;
        this.emission[slot] += rate * dt;
        let births = Math.floor(this.emission[slot]);
        this.emission[slot] -= births;
        births = Math.min(births, 40);
        const local = def.wheelPositions[wheel];
        for (let b = 0; b < births; b++) {
          this.v.set(local[0], local[1] - 0.25, local[2]).applyQuaternion(this.q);
          const throwSpeed = 2 + spin * (3 + speed * 0.25) + r.next() * 2,
            dust = spin < 0.15 || r.next() < (1 - wet) * 0.25;
          this.spawn(
            frame[o + F.X] + this.v.x,
            frame[o + F.Y] + this.v.y,
            frame[o + F.Z] + this.v.z,
            frame[o + F.VX] * 0.5 + this.back.x * throwSpeed + (r.next() - 0.5) * 2,
            (dust ? 0.6 : 1.5 + spin * 2.5) * (0.6 + 0.8 * r.next()),
            frame[o + F.VZ] * 0.5 + this.back.z * throwSpeed + (r.next() - 0.5) * 2,
            wet,
            dust,
          );
        }
      }
    }
  }
  clear() {
    this.life.fill(0);
    for (let i = 0; i < ROOST_CAPACITY; i++) this.positions[i * 3 + 1] = -1e4;
    this.emission.fill(0);
  }
  /** Live particles (diagnostics, tests). */
  get active() {
    let n = 0;
    for (let i = 0; i < ROOST_CAPACITY; i++) if (this.life[i] > 0) n++;
    return n;
  }
  dispose() {
    this.points.geometry.dispose();
    const m = this.points.material as T.PointsMaterial;
    m.map?.dispose();
    m.dispose();
  }
}
