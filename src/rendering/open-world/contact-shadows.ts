import * as T from 'three';
import { clamp } from '../../core/math.ts';
import {
  CAR_STRIDE,
  F,
  H,
  HEADER,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../../simulation/protocol.ts';
import type { QualityPreset } from '../options.ts';
import { festivalContactEnabled, festivalContactLocal } from './festival-contacts.ts';

type Ground = (x: number, z: number, y?: number) => number;
const CARS = 8,
  PATCHES = CARS * 5,
  VERTICES = PATCHES * 9;
/** A small ground-conforming contact cue, not a substitute for sun shadows or
 * screen-space AO. Uses the current physical contact layer under bridges and
 * fades above the ground. Every frame is a replacement, including travel and
 * rewind; no accumulated decals, textures or per-car materials are retained. */
export class FestivalContactShadows {
  readonly root = new T.Group();
  readonly stats = { cars: 0, patches: 0, triangles: 0, draws: 0, capacity: PATCHES };
  readonly geometry = new T.BufferGeometry();
  readonly material = new T.ShaderMaterial({
    name: 'Solvane ground contact',
    transparent: true,
    depthWrite: false,
    side: T.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    vertexShader: `attribute float strength; varying vec2 footprint; varying float opacity;
      void main() { footprint=uv*2.0-1.0; opacity=strength;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `varying vec2 footprint; varying float opacity;
      void main() {
        float r=pow(pow(abs(footprint.x),3.0)+pow(abs(footprint.y),3.0),1.0/3.0);
        float a=opacity*(1.0-smoothstep(0.3,1.0,r));
        if(a<0.002) discard; gl_FragColor=vec4(0.0,0.0,0.0,a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  readonly mesh = new T.Mesh(this.geometry, this.material);
  private readonly positions = new Float32Array(VERTICES * 3);
  private readonly strengths = new Float32Array(VERTICES);
  private readonly contacts = Array.from({ length: 4 }, () => new T.Vector3());
  private readonly gaps = new Float64Array(4);
  private readonly loads = new Float64Array(4);
  private readonly quaternion = new T.Quaternion();
  private readonly carPosition = new T.Vector3();
  private readonly candidates: { car: number; distance: number }[] = [];
  private readonly patchY = new Float64Array(9);
  private disposed = false;

  constructor() {
    this.root.name = 'Grounded vehicle contact cues';
    const uv = new Float32Array(VERTICES * 2),
      index: number[] = [];
    for (let p = 0; p < PATCHES; p++) {
      for (let z = 0; z < 3; z++)
        for (let x = 0; x < 3; x++) {
          const v = p * 9 + z * 3 + x;
          uv[v * 2] = x / 2;
          uv[v * 2 + 1] = z / 2;
        }
      for (let z = 0; z < 2; z++)
        for (let x = 0; x < 2; x++) {
          const v = p * 9 + z * 3 + x;
          index.push(v, v + 3, v + 1, v + 1, v + 3, v + 4);
        }
    }
    this.geometry.setAttribute(
      'position',
      new T.BufferAttribute(this.positions, 3).setUsage(T.DynamicDrawUsage),
    );
    this.geometry.setAttribute(
      'strength',
      new T.BufferAttribute(this.strengths, 1).setUsage(T.DynamicDrawUsage),
    );
    this.geometry.setAttribute('uv', new T.BufferAttribute(uv, 2));
    this.geometry.setIndex(index);
    this.geometry.setDrawRange(0, 0);
    this.mesh.name = 'Bounded body and tyre contact field';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.userData.excludeMotionBlur = true;
    this.root.add(this.mesh);
  }

  private patch(
    x: number,
    z: number,
    layer: number,
    rx: number,
    rz: number,
    fx: number,
    fz: number,
    width: number,
    length: number,
    alpha: number,
    ground: Ground,
  ) {
    if (alpha < 0.005 || this.stats.patches >= PATCHES) return;
    const centre = ground(x, z, layer);
    if (!Number.isFinite(centre)) return;
    for (let iz = 0; iz < 3; iz++)
      for (let ix = 0; ix < 3; ix++) {
        const dx = (ix - 1) * width,
          dz = (iz - 1) * length;
        const y = ground(x + rx * dx + fx * dz, z + rz * dx + fz * dz, layer);
        // Never stretch a footprint across a cliff edge or onto another deck.
        if (!Number.isFinite(y) || Math.abs(y - centre) > 0.6) return;
        this.patchY[iz * 3 + ix] = y + 0.012;
      }
    const start = this.stats.patches++ * 9;
    for (let iz = 0; iz < 3; iz++)
      for (let ix = 0; ix < 3; ix++) {
        const dx = (ix - 1) * width,
          dz = (iz - 1) * length,
          v = start + iz * 3 + ix;
        this.positions[v * 3] = x + rx * dx + fx * dz;
        this.positions[v * 3 + 1] = this.patchY[iz * 3 + ix];
        this.positions[v * 3 + 2] = z + rz * dx + fz * dz;
        this.strengths[v] = alpha;
      }
  }

  update(frame: Float32Array, camera: T.Camera, quality: QualityPreset, ground: Ground) {
    if (this.disposed) return;
    this.stats.cars = this.stats.patches = this.stats.triangles = this.stats.draws = 0;
    this.candidates.length = 0;
    const count = Math.min(
      32,
      Math.max(0, Math.floor(frame[H.CARS])),
      Math.floor((frame.length - HEADER) / CAR_STRIDE),
    );
    for (let car = 0; car < count; car++) {
      const o = carBase(car);
      const distance = Math.hypot(
        frame[o + F.X] - camera.position.x,
        frame[o + F.Z] - camera.position.z,
      );
      if (Number.isFinite(distance) && distance < 90) this.candidates.push({ car, distance });
    }
    this.candidates.sort((a, b) => a.distance - b.distance);
    for (const { car, distance } of this.candidates.slice(0, CARS)) {
      const o = carBase(car),
        begin = this.stats.patches;
      this.carPosition.fromArray(frame, o + F.X);
      this.quaternion.fromArray(frame, o + F.QX);
      if (
        !this.carPosition.toArray().every(Number.isFinite) ||
        !this.quaternion.toArray().every(Number.isFinite)
      )
        continue;
      this.quaternion.normalize();
      const q = this.quaternion;
      let fx = 2 * (q.x * q.z + q.w * q.y),
        fz = 1 - 2 * (q.x * q.x + q.y * q.y);
      const directionLength = Math.hypot(fx, fz);
      if (directionLength < 0.2) continue;
      fx /= directionLength;
      fz /= directionLength;
      const rx = fz,
        rz = -fx;
      let left = Infinity,
        right = -Infinity,
        rear = Infinity,
        front = -Infinity,
        floor = 0,
        confidence = 0,
        wheels = 0;
      for (let wheel = 0; wheel < 4; wheel++) {
        this.gaps[wheel] = Infinity;
        this.loads[wheel] = 0;
        if (!festivalContactEnabled(frame, car, wheel)) continue;
        const at = festivalContactLocal(frame, car, wheel, this.contacts[wheel]);
        at.applyQuaternion(q).add(this.carPosition);
        const y = ground(at.x, at.z, at.y);
        if (!Number.isFinite(y) || !at.toArray().every(Number.isFinite)) continue;
        const gap = Math.max(0, at.y - y),
          load = frame[o + WHEEL_BASE + wheel * WHEEL_STRIDE + W.LOAD];
        const loaded = Number.isFinite(load) ? clamp(load / 180, 0, 1) : 0;
        this.gaps[wheel] = gap;
        this.loads[wheel] = loaded;
        const dx = at.x - this.carPosition.x,
          dz = at.z - this.carPosition.z;
        left = Math.min(left, dx * rx + dz * rz);
        right = Math.max(right, dx * rx + dz * rz);
        rear = Math.min(rear, dx * fx + dz * fz);
        front = Math.max(front, dx * fx + dz * fz);
        floor += y;
        confidence += Math.exp(-gap * 5) * loaded;
        wheels++;
      }
      if (!wheels || !confidence) continue;
      const distanceFade = clamp((90 - distance) / 25, 0, 1),
        dark = quality === 'low';
      const cx = (left + right) / 2,
        cz = (rear + front) / 2;
      this.patch(
        this.carPosition.x + rx * cx + fx * cz,
        this.carPosition.z + rz * cx + fz * cz,
        floor / wheels,
        rx,
        rz,
        fx,
        fz,
        Math.max(0.36, (right - left) / 2 + 0.3),
        Math.max(0.7, (front - rear) / 2 + 0.48),
        (((dark ? 0.28 : 0.12) * confidence) / wheels) * distanceFade,
        ground,
      );
      for (let wheel = 0; wheel < 4; wheel++) {
        if (!Number.isFinite(this.gaps[wheel])) continue;
        const at = this.contacts[wheel];
        const alpha =
          (dark ? 0.4 : 0.24) * this.loads[wheel] * Math.exp(-this.gaps[wheel] * 12) * distanceFade;
        this.patch(at.x, at.z, at.y, rx, rz, fx, fz, 0.19, 0.31, alpha, ground);
      }
      if (this.stats.patches > begin) this.stats.cars++;
    }
    this.geometry.setDrawRange(0, this.stats.patches * 24);
    this.geometry.attributes.position.needsUpdate =
      this.geometry.attributes.strength.needsUpdate = true;
    this.mesh.visible = this.stats.patches > 0;
    this.stats.triangles = this.stats.patches * 8;
    this.stats.draws = this.stats.patches ? 1 : 0;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.geometry.dispose();
    this.material.dispose();
    this.root.removeFromParent();
    this.root.clear();
    this.stats.cars = this.stats.patches = this.stats.triangles = this.stats.draws = 0;
  }
}
