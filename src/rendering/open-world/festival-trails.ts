import * as T from 'three';
import { clamp } from '../../core/math.ts';
import {
  F,
  H,
  R,
  RACE_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../../simulation/protocol.ts';
import { vehicleAt } from '../../simulation/vehicles.ts';
import { tireSmokeSliding } from '../effects.ts';
import { festivalContactLocal } from './festival-contacts.ts';

/** A bounded ribbon of rubber at the player's actual loaded wheel contacts.
 * Wet/loose surfaces and airborne wheels do not receive asphalt skid marks.
 * Resets and travel break the ribbon, never joining two distant locations. */
export class FestivalTrails {
  readonly capacity = 1024;
  readonly root: T.Mesh;
  private readonly positions = new Float32Array(this.capacity * 12);
  private readonly born = new Float32Array(this.capacity * 4).fill(-1000);
  private readonly opacity = new Float32Array(this.capacity * 4);
  private readonly geometry = new T.BufferGeometry();
  private readonly material: T.ShaderMaterial;
  private readonly last = Array.from({ length: 4 }, () => new T.Vector3(NaN, NaN, NaN));
  private readonly current = new T.Vector3();
  private readonly quaternion = new T.Quaternion();
  private previousTime = NaN;
  private previousVehicle = -1;
  private cursor = 0;
  segments = 0;
  enabled = true;
  constructor() {
    const uv = new Float32Array(this.capacity * 8),
      indices = new Uint16Array(this.capacity * 6);
    for (let i = 0; i < this.capacity; i++) {
      uv.set([0, 0, 1, 0, 0, 1, 1, 1], i * 8);
      indices.set([i * 4, i * 4 + 2, i * 4 + 1, i * 4 + 1, i * 4 + 2, i * 4 + 3], i * 6);
    }
    this.geometry.setAttribute(
      'position',
      new T.BufferAttribute(this.positions, 3).setUsage(T.DynamicDrawUsage),
    );
    this.geometry.setAttribute(
      'born',
      new T.BufferAttribute(this.born, 1).setUsage(T.DynamicDrawUsage),
    );
    this.geometry.setAttribute(
      'strength',
      new T.BufferAttribute(this.opacity, 1).setUsage(T.DynamicDrawUsage),
    );
    this.geometry.setAttribute('uv', new T.BufferAttribute(uv, 2));
    this.geometry.setIndex(new T.BufferAttribute(indices, 1));
    this.geometry.setDrawRange(0, 0);
    this.material = new T.ShaderMaterial({
      uniforms: { time: { value: 0 }, water: { value: 0 } },
      vertexShader: `attribute float born; attribute float strength;
        varying vec2 vUv; varying float vBorn; varying float vStrength;
        void main(){ vUv=uv; vBorn=born; vStrength=strength;
          gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `uniform float time; uniform float water;
        varying vec2 vUv; varying float vBorn; varying float vStrength;
        void main(){ float edge=smoothstep(0.,.17,vUv.x)*smoothstep(0.,.17,1.-vUv.x);
          float fade=1.-smoothstep(28.,45.,time-vBorn);
          float grooves=.7+.3*sin(vUv.x*73.);
          float a=edge*fade*vStrength*grooves*(1.-water*.85);
          if(a<.008) discard; gl_FragColor=vec4(.035,.033,.03,a); }`,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      side: T.DoubleSide,
    });
    this.root = new T.Mesh(this.geometry, this.material);
    this.root.name = 'Festival contact rubber trails';
    this.root.frustumCulled = false;
  }
  reset() {
    this.last.forEach((p) => p.set(NaN, NaN, NaN));
    this.previousTime = NaN;
  }
  update(frame: Float32Array, height: (x: number, z: number, y?: number) => number) {
    const time = frame[H.TIME],
      o = carBase(0),
      vehicle = Math.round(frame[o + RACE_BASE + R.VEHICLE]);
    this.root.visible = this.enabled;
    this.material.uniforms.time.value = time;
    this.material.uniforms.water.value = clamp(frame[H.WATER], 0, 1);
    if (time === this.previousTime) return;
    if (time < this.previousTime) {
      this.segments = 0;
      this.cursor = 0;
      this.geometry.setDrawRange(0, 0);
    }
    if (
      !this.enabled ||
      vehicle !== this.previousVehicle ||
      !(time > this.previousTime) ||
      time - this.previousTime > 0.5
    )
      this.reset();
    this.previousVehicle = vehicle;
    this.previousTime = time;
    if (!this.enabled) return;
    const def = vehicleAt(vehicle);
    this.quaternion.set(frame[o + F.QX], frame[o + F.QY], frame[o + F.QZ], frame[o + F.QW]);
    let changed = false;
    for (let w = 0; w < 4; w++) {
      // Bikes duplicate front/rear telemetry into each axle's two slots.
      if (def.dynamicsKind === 'bike' && w % 2 === 1) continue;
      const p = o + WHEEL_BASE + w * WHEEL_STRIDE,
        contact = this.last[w],
        surface = frame[p + W.SURFACE];
      const sliding = tireSmokeSliding(frame[p + W.SLIP], frame[p + W.ANGLE]);
      const sealed = surface === 0 || surface === 1 || surface === 2 || surface === 5;
      if (
        frame[p + W.LOAD] < 30 ||
        Math.abs(frame[o + F.SPEED]) < 3 ||
        sliding < 0.06 ||
        !sealed ||
        frame[p + W.WATER] > 0.25
      ) {
        contact.set(NaN, NaN, NaN);
        continue;
      }
      festivalContactLocal(frame, 0, w, this.current).applyQuaternion(this.quaternion);
      this.current.x += frame[o + F.X];
      this.current.z += frame[o + F.Z];
      this.current.y =
        height(this.current.x, this.current.z, frame[o + F.Y] + this.current.y) + 0.028;
      const distance = contact.distanceTo(this.current);
      if (!Number.isFinite(distance) || distance > 12) {
        contact.copy(this.current);
        continue;
      }
      if (distance < 0.5) continue;
      const halfWidth = def.dynamicsKind === 'bike' ? 0.065 : 0.12;
      const dx = ((this.current.z - contact.z) / distance) * halfWidth;
      const dz = (-(this.current.x - contact.x) / distance) * halfWidth;
      this.positions.set(
        [
          contact.x - dx,
          contact.y,
          contact.z - dz,
          contact.x + dx,
          contact.y,
          contact.z + dz,
          this.current.x - dx,
          this.current.y,
          this.current.z - dz,
          this.current.x + dx,
          this.current.y,
          this.current.z + dz,
        ],
        this.cursor * 12,
      );
      this.born.fill(time, this.cursor * 4, this.cursor * 4 + 4);
      this.opacity.fill(clamp(sliding * 0.62, 0.1, 0.62), this.cursor * 4, this.cursor * 4 + 4);
      this.cursor = (this.cursor + 1) % this.capacity;
      this.segments = Math.min(this.capacity, this.segments + 1);
      contact.copy(this.current);
      changed = true;
    }
    if (changed) {
      for (const key of ['position', 'born', 'strength'])
        this.geometry.getAttribute(key).needsUpdate = true;
      this.geometry.setDrawRange(0, this.segments * 6);
    }
  }
  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
