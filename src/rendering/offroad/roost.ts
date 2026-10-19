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
import { TrackTerrainSurface } from '../../simulation/offroad/course-terrain.ts';
import { Track, trackPoint } from '../../simulation/track.ts';
import { chainShaderHook, injectAfter, injectDeclarations } from '../studio/shader-hooks.ts';

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
function softDisc(soft = false) {
  const size = 64,
    data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5,
        dy = (y + 0.5) / size - 0.5,
        r = Math.sqrt(dx * dx + dy * dy) * 2,
        a = clamp(1 - r, 0, 1) ** (soft ? 1.35 : 0.8);
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
  readonly contactShadows: T.InstancedMesh | null;
  private readonly positions = new Float32Array(ROOST_CAPACITY * 3);
  private readonly velocities = new Float32Array(ROOST_CAPACITY * 3);
  private readonly colours = new Float32Array(ROOST_CAPACITY * 3);
  private readonly life = new Float32Array(ROOST_CAPACITY);
  private readonly maxLife = new Float32Array(ROOST_CAPACITY);
  private readonly floor = new Float32Array(ROOST_CAPACITY);
  private readonly drag = new Float32Array(ROOST_CAPACITY);
  private readonly sizes = new Float32Array(ROOST_CAPACITY);
  private readonly bornSize = new Float32Array(ROOST_CAPACITY);
  private readonly opacity = new Float32Array(ROOST_CAPACITY);
  /** Dust/clod kind and a stable silhouette seed, in the same bounded draw. */
  private readonly shapes = new Float32Array(ROOST_CAPACITY * 2);
  private readonly bornOpacity = new Float32Array(ROOST_CAPACITY);
  private readonly dust = new Uint8Array(ROOST_CAPACITY);
  private readonly emission = new Float64Array(64 * 4);
  private readonly wasAirborne = new Uint8Array(64);
  private readonly random = new Random(40817);
  private readonly q = new T.Quaternion();
  private readonly v = new T.Vector3();
  private readonly back = new T.Vector3();
  private readonly contactNormal = new T.Vector3(0, 1, 0);
  private readonly point = trackPoint();
  private readonly shadowPose = new T.Object3D();
  private readonly up = new T.Vector3(0, 1, 0);
  private readonly terrain: TrackTerrainSurface | null;
  private readonly motocross: boolean;
  private cursor = 0;
  enabled = true;
  density = 1;
  constructor(private readonly track?: Track) {
    const surface = track ? Track.offroadOf(track) : null;
    this.terrain = surface instanceof TrackTerrainSurface ? surface : null;
    this.motocross = surface?.kind === 'motocross' || surface?.kind === 'supercross';
    const g = new T.BufferGeometry();
    g.setAttribute(
      'position',
      new T.BufferAttribute(this.positions, 3).setUsage(T.DynamicDrawUsage),
    );
    g.setAttribute('color', new T.BufferAttribute(this.colours, 3).setUsage(T.DynamicDrawUsage));
    g.setAttribute(
      'mxParticleSize',
      new T.BufferAttribute(this.sizes, 1).setUsage(T.DynamicDrawUsage),
    );
    g.setAttribute(
      'mxParticleAlpha',
      new T.BufferAttribute(this.opacity, 1).setUsage(T.DynamicDrawUsage),
    );
    if (this.motocross)
      g.setAttribute(
        'mxParticleShape',
        new T.BufferAttribute(this.shapes, 2).setUsage(T.DynamicDrawUsage),
      );
    const material = new T.PointsMaterial({
      size: this.motocross ? 1 : 0.11,
      sizeAttenuation: true,
      vertexColors: true,
      map: this.motocross ? null : softDisc(),
      transparent: true,
      alphaTest: this.motocross ? 0.008 : 0.04,
      depthWrite: false,
    });
    if (this.motocross)
      chainShaderHook(material, 'mx-roost-particle-v2', (shader) => {
        injectDeclarations(
          shader,
          'common',
          'attribute float mxParticleSize;\nattribute float mxParticleAlpha;\nattribute vec2 mxParticleShape;\nvarying float vMxParticleAlpha;\nvarying vec2 vMxParticleShape;',
          'vertex',
        );
        injectAfter(
          shader,
          'begin_vertex',
          'vMxParticleAlpha = mxParticleAlpha;\nvMxParticleShape = mxParticleShape;',
          'vertex',
        );
        injectAfter(shader, 'gl_PointSize = size;', 'gl_PointSize *= mxParticleSize;', 'vertex');
        injectDeclarations(
          shader,
          'common',
          'varying float vMxParticleAlpha;\nvarying vec2 vMxParticleShape;',
          'fragment',
        );
        injectAfter(
          shader,
          'map_particle_fragment',
          /* glsl */ `{
            // 094–096: hard, irregular soil fragments sit within soft dust.
            // A shared circular sprite made every fragment look like a puff.
            vec2 p = gl_PointCoord * 2.0 - 1.0;
            float seed = vMxParticleShape.y;
            float angle = seed * 6.2831853;
            vec2 q = mat2( cos( angle ), -sin( angle ), sin( angle ), cos( angle ) ) * p;
            q.x *= 0.84 + seed * 0.25;
            float radius = dot( q, q );
            float boundary = 0.70 + 0.12 * sin( q.x * 8.0 + seed * 13.0 )
              * sin( q.y * 6.0 - seed * 9.0 );
            float edge = max( fwidth( radius ), 0.025 );
            float clod = 1.0 - smoothstep( boundary - edge, boundary + edge, radius );
            float envelope = 1.0 - smoothstep( 0.05, 0.95, radius );
            float billow = 0.68 + 0.18 * sin( q.x * 6.0 + seed * 19.0 )
              + 0.14 * sin( q.y * 8.0 - seed * 7.0 );
            float cloud = envelope * envelope * clamp( billow, 0.28, 1.0 );
            diffuseColor.a *= mix( clod, cloud, vMxParticleShape.x );
            // Soft form shading on solids; no bright additive dust or halo.
            diffuseColor.rgb *= mix( 0.70 + 0.30 * clamp( 0.7 - q.y * 0.45
              + q.x * 0.15, 0.0, 1.0 ), 1.0, vMxParticleShape.x );
          }`,
          'fragment',
        );
        injectAfter(shader, 'color_fragment', 'diffuseColor.a *= vMxParticleAlpha;', 'fragment');
      });
    this.points = new T.Points(g, material);
    this.points.name = 'Roost (clods and dust)';
    this.points.frustumCulled = false;
    this.life.fill(0);
    this.contactShadows = this.motocross
      ? new T.InstancedMesh(
          new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
          new T.MeshBasicMaterial({
            color: 0x100d09,
            map: softDisc(true),
            transparent: true,
            opacity: 0.38,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1,
            toneMapped: false,
          }),
          128,
        )
      : null;
    if (this.contactShadows) {
      this.contactShadows.name = 'MX loaded tyre contact shadows';
      this.contactShadows.instanceMatrix.setUsage(T.DynamicDrawUsage);
      this.contactShadows.count = 0;
      this.contactShadows.frustumCulled = false;
      this.contactShadows.renderOrder = 1;
    }
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
    this.floor[i] = y - (this.motocross ? 0.06 : 0.35);
    this.drag[i] = dust ? 2.5 : 0.25;
    this.dust[i] = dust ? 1 : 0;
    this.shapes[i * 2] = dust ? 1 : 0;
    this.shapes[i * 2 + 1] = (i * 0.61803398875) % 1;
    this.bornSize[i] = this.sizes[i] = this.motocross
      ? dust
        ? 0.28 + r.next() * 0.27
        : 0.035 + r.next() * 0.065
      : 1;
    this.bornOpacity[i] = this.opacity[i] = dust ? 0.24 * (1 - wet * 0.7) : 0.95;
    if (this.motocross && dust) this.opacity[i] *= 0.3;
    if (this.motocross)
      this.maxLife[i] = this.life[i] = dust ? 1.5 + r.next() * 1.1 : 0.55 + r.next() * 0.5;
  }
  /** Contact height/normal from the same course as the tyres. The renderer's
   * course is static; the wheel's worker-reported rut depth supplies its
   * current depression. A jump can never emit dust from a flat datum. */
  private contact(x: number, z: number, rut: number, fallback: number) {
    this.contactNormal.set(0, 1, 0);
    if (!this.track || !this.terrain) return fallback;
    const p = this.point,
      t = this.terrain.terrain;
    const lateral = this.track.nearest(x, z, p),
      s = p.s;
    const across = (t.baseHeight(s, lateral + 0.2) - t.baseHeight(s, lateral - 0.2)) / 0.4;
    const along = (t.baseHeight(s + 0.2, lateral) - t.baseHeight(s - 0.2, lateral)) / 0.4;
    this.contactNormal
      .set(-across * p.nx - along * p.tx, 1, -across * p.nz - along * p.tz)
      .normalize();
    return t.baseHeight(s, lateral) - clamp(rut, 0, 0.3);
  }
  private shadows(frame: Float32Array) {
    const mesh = this.contactShadows;
    if (!mesh) return;
    let count = 0;
    for (let id = 0; id < Math.min(64, frame[H.CARS]); id++) {
      const o = carBase(id),
        def = vehicleAt(Math.round(frame[o + RACE_BASE + R.VEHICLE]));
      if (def.dynamicsKind !== 'bike' || frame[o + OFFROAD_BASE + O.AIRBORNE] > 0.5) continue;
      this.q.set(frame[o + F.QX], frame[o + F.QY], frame[o + F.QZ], frame[o + F.QW]);
      this.back.set(0, 0, 1).applyQuaternion(this.q);
      for (const wheel of [0, 2]) {
        const w = o + WHEEL_BASE + wheel * WHEEL_STRIDE;
        if (frame[w + W.LOAD] < 45) continue;
        const local = def.wheelPositions[wheel];
        this.v.set(local[0], local[1], local[2]).applyQuaternion(this.q);
        const x = frame[o + F.X] + this.v.x,
          z = frame[o + F.Z] + this.v.z;
        const y = this.contact(
          x,
          z,
          frame[o + OFFROAD_BASE + (wheel === 0 ? O.RUT_FRONT : O.RUT_REAR)],
          frame[o + F.Y] + this.v.y - def.spec.wheelRadius,
        );
        const pose = this.shadowPose;
        pose.position.set(x, y + 0.022, z);
        pose.quaternion.setFromUnitVectors(this.up, this.contactNormal);
        pose.rotateY(Math.atan2(this.back.x, this.back.z));
        const load = clamp(frame[w + W.LOAD] / 650, 0.25, 1);
        pose.scale.set(0.38 + load * 0.12, 1, 0.6 + load * 0.2);
        pose.updateMatrix();
        mesh.setMatrixAt(count++, pose.matrix);
      }
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
  }
  update(frame: Float32Array, dt: number) {
    if (!Number.isFinite(dt) || dt < 0) return;
    this.points.visible = this.enabled;
    this.shadows(frame);
    const step = Math.min(dt, 0.05);
    for (let i = 0; i < ROOST_CAPACITY; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= step;
      const k = i * 3;
      const drag = Math.exp(-this.drag[i] * step);
      this.velocities[k] *= drag;
      this.velocities[k + 2] *= drag;
      this.velocities[k + 1] =
        this.velocities[k + 1] * drag -
        9.81 * step * (this.drag[i] > 1 ? (this.motocross ? 0.025 : 0.08) : 1);
      this.positions[k] += this.velocities[k] * step;
      this.positions[k + 1] += this.velocities[k + 1] * step;
      this.positions[k + 2] += this.velocities[k + 2] * step;
      if (this.motocross) {
        const remaining = clamp(this.life[i] / this.maxLife[i], 0, 1);
        this.sizes[i] = this.bornSize[i] * (this.dust[i] ? 1 + (1 - remaining) * 3.5 : 1);
        this.opacity[i] = this.dust[i]
          ? this.bornOpacity[i] * remaining * Math.min(1, (1 - remaining) * 12 + 0.3)
          : this.bornOpacity[i] * Math.min(1, remaining * 4);
      }
      if (this.life[i] <= 0 || this.positions[k + 1] < this.floor[i]) {
        this.life[i] = 0;
        this.opacity[i] = 0;
        this.positions[k + 1] = -1e4;
      }
    }
    const g = this.points.geometry;
    g.getAttribute('position').needsUpdate = true;
    g.getAttribute('color').needsUpdate = true;
    g.getAttribute('mxParticleSize').needsUpdate = true;
    g.getAttribute('mxParticleAlpha').needsUpdate = true;
    if (this.motocross) g.getAttribute('mxParticleShape').needsUpdate = true;
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
      const airborne = frame[o + OFFROAD_BASE + O.AIRBORNE] > 0.5;
      // Physics publishes this landing's normal impact on the contact edge.
      const landing = this.motocross && bike && this.wasAirborne[id] > 0 && !airborne;
      this.wasAirborne[id] = airborne ? 1 : 0;
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
        const local = def.wheelPositions[wheel];
        this.v.set(local[0], local[1] - 0.25, local[2]).applyQuaternion(this.q);
        const x = frame[o + F.X] + this.v.x,
          z = frame[o + F.Z] + this.v.z;
        const y =
          this.motocross && loose && load >= 50
            ? this.contact(x, z, frame[o + OFFROAD_BASE + O.RUT_REAR], frame[o + F.Y] + this.v.y) +
              0.045
            : frame[o + F.Y] + this.v.y;
        if (landing && loose && load >= 50) {
          const impact = clamp(frame[o + OFFROAD_BASE + O.LANDING_SPEED], 0, 12);
          const count = impact > 1.2 ? Math.round((8 + impact * 3) * this.density) : 0;
          for (let b = 0; b < count; b++) {
            const angle = r.next() * Math.PI * 2,
              outward = 0.7 + r.next() * impact * 0.45;
            this.spawn(
              x,
              y,
              z,
              Math.cos(angle) * outward,
              0.4 + r.next() * impact * 0.23,
              Math.sin(angle) * outward,
              wet,
              wet < 0.6 && b % 3 !== 0,
            );
          }
        }
        if (!loose || load < 50 || speed < 1.5 || (this.motocross && bike && airborne)) {
          this.emission[slot] = 0;
          continue;
        }
        // Spin throws clods; plain rolling on dry ground lifts a little dust.
        const spin = clamp((slip - 0.04) * 6, 0, 1.5),
          rate =
            (spin * (40 + speed * 6) + (1 - wet) * speed * 0.6) * (bike ? 1 : 0.7) * this.density;
        const sideKick = this.motocross ? clamp(frame[p + W.ANGLE], -0.5, 0.5) * speed * 0.35 : 0;
        this.emission[slot] += rate * dt;
        let births = Math.floor(this.emission[slot]);
        this.emission[slot] -= births;
        births = Math.min(births, 40);
        for (let b = 0; b < births; b++) {
          const throwSpeed = 2 + spin * (3 + speed * 0.25) + r.next() * 2,
            dust = spin < 0.15 || r.next() < (1 - wet) * 0.25;
          this.spawn(
            x,
            y,
            z,
            frame[o + F.VX] * 0.5 +
              this.back.x * throwSpeed -
              this.back.z * sideKick +
              (r.next() - 0.5) * 2,
            (dust ? 0.6 : 1.5 + spin * 2.5) * (0.6 + 0.8 * r.next()),
            frame[o + F.VZ] * 0.5 +
              this.back.z * throwSpeed +
              this.back.x * sideKick +
              (r.next() - 0.5) * 2,
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
    this.opacity.fill(0);
    this.wasAirborne.fill(0);
    this.points.geometry.getAttribute('position').needsUpdate = true;
    this.points.geometry.getAttribute('mxParticleAlpha').needsUpdate = true;
    if (this.contactShadows) this.contactShadows.count = 0;
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
    if (this.contactShadows) {
      this.contactShadows.geometry.dispose();
      const shadow = this.contactShadows.material as T.MeshBasicMaterial;
      shadow.map?.dispose();
      shadow.dispose();
    }
  }
}
