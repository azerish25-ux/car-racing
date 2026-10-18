import * as T from 'three';
import { Random, clamp } from '../../core/math.ts';
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

/** Festival drift smoke, measured from the reference drift captures (FH6 ref
 * 040/042/050/100): white-grey (#d8d8d8..#ebebeb lit, ~#8a8a8a in shade)
 * rubber smoke that leaves the rear tyres as dense puffs, billows to 2-3 m
 * clouds about 1-2.5 m tall and hangs over the line for several seconds,
 * forming a 30-40 m trail through a long slide. Rates are per sliding wheel. */
export const DRIFT_SMOKE = Object.freeze({
  /** Puffs per second from one fully sliding rear tyre. */
  rate: 30,
  /** Front tyres smoke only under lock-up or heavy understeer. */
  frontShare: 0.3,
  life: Object.freeze([3.4, 5.6] as const),
  /** Birth radius (m) and the radius each puff adds as it billows. */
  size: Object.freeze([0.42, 0.62] as const),
  growth: 1.9,
  /** Billow time constant (s): growth and rise slow as the puff ages. */
  settle: 1.6,
  rise: Object.freeze([0.25, 0.75] as const),
  /** Share of the car's velocity carried by a newly shed puff. */
  inherit: 0.18,
  /** Rubber thrown back by tyre slip, per m/s of measured slide speed. */
  throwBack: 0.08,
  scatter: 0.9,
  /** Relaxation (1/s) of puff velocity toward still air. */
  drag: 0.9,
  alpha: 0.5,
  minSpeed: 2.5,
  /** Slip power (W) at which a tyre smokes at its full rate. */
  fullPower: 16000,
});
const CAPACITY = { low: 0, medium: 900, high: 1600, ultra: 1600 } as const;

/** One instanced draw: lit, soft-edged billboards that fade analytically
 * into the road under their birth point. Births follow measured slip, slip
 * power, load, surface and water from the presented snapshot (the same
 * channels the trails and contact smoke use); wet and loose surfaces do not
 * smoke. Simulation time drives ageing, so a paused or photo frame holds. */
export class FestivalDriftSmoke {
  readonly root: T.Mesh<T.InstancedBufferGeometry, T.ShaderMaterial>;
  readonly capacity = CAPACITY.high;
  private limit: number = CAPACITY.medium;
  private readonly centers = new Float32Array(this.capacity * 3);
  private readonly velocities = new Float32Array(this.capacity * 3);
  /** Per puff: radius, opacity, ground height at birth, spin seed. */
  private readonly puffs = new Float32Array(this.capacity * 4);
  private readonly age = new Float32Array(this.capacity);
  private readonly life = new Float32Array(this.capacity);
  private readonly strength = new Float32Array(this.capacity);
  private readonly emission = new Float64Array(12 * 4);
  private readonly geometry = new T.InstancedBufferGeometry();
  private readonly material: T.ShaderMaterial;
  private readonly random = new Random(40961);
  private readonly local = new T.Vector3();
  private readonly quaternion = new T.Quaternion();
  private readonly back = new T.Vector3();
  private readonly side = new T.Vector3();
  private cursor = 0;
  /** Per car: last chassis x, vehicle index and z. */
  private readonly previous = new Float64Array(12 * 3).fill(NaN);
  private previousTime = NaN;
  live = 0;
  enabled = true;
  constructor() {
    this.geometry.setAttribute(
      'position',
      new T.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3),
    );
    this.geometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.geometry.setAttribute(
      'center',
      new T.InstancedBufferAttribute(this.centers, 3).setUsage(T.DynamicDrawUsage),
    );
    this.geometry.setAttribute(
      'puff',
      new T.InstancedBufferAttribute(this.puffs, 4).setUsage(T.DynamicDrawUsage),
    );
    this.geometry.instanceCount = 0;
    this.material = new T.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: true,
      lights: true,
      uniforms: T.UniformsUtils.merge([
        T.UniformsLib.fog,
        T.UniformsLib.lights,
        { skyFill: { value: new T.Color(0.3, 0.33, 0.36) } },
      ]),
      vertexShader: /* glsl */ `
        attribute vec3 center;
        attribute vec4 puff;
        varying vec2 vUv;
        varying float vOpacity;
        varying float vGround;
        varying float vSpin;
        #include <common>
        #include <fog_pars_vertex>
        void main() {
          vUv = position.xy;
          vSpin = puff.w;
          vOpacity = 0.0;
          vGround = 1.0;
          vec4 mvPosition = modelViewMatrix * vec4(center, 1.0);
          #include <fog_vertex>
          float depth = -mvPosition.z;
          float radius = max(0.05, puff.x);
          // A puff the camera sits inside would be one flat screen-filling
          // card: dissolve it as the lens enters the cloud.
          float near = smoothstep(radius * 0.35 + 0.3, radius * 1.4 + 1.2, depth);
          if (puff.y <= 0.0 || near <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          vOpacity = puff.y * near;
          vec2 offset = position.xy * radius;
          mvPosition.xy += offset;
          gl_Position = projectionMatrix * mvPosition;
          float cornerY = (modelMatrix * vec4(center, 1.0)).y
            + (transpose(mat3(viewMatrix)) * vec3(offset, 0.0)).y;
          vGround = (cornerY - puff.z) / max(0.08, radius * 0.5);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 skyFill;
        varying vec2 vUv;
        varying float vOpacity;
        varying float vGround;
        varying float vSpin;
        #include <common>
        #include <lights_pars_begin>
        #include <fog_pars_fragment>
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                     mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        void main() {
          float r2 = dot(vUv, vUv);
          if (r2 >= 1.0) discard;
          float c = cos(vSpin), s = sin(vSpin);
          vec2 q = mat2(c, -s, s, c) * vUv;
          // Billowing lobes: two octaves of value noise on the rotated disc.
          float billow = 0.62 * noise(q * 2.3 + vSpin * 3.1) + 0.38 * noise(q * 5.1 - vSpin);
          float density = exp(-r2 * 2.6) * (0.55 + 0.9 * billow);
          density *= 1.0 - smoothstep(0.55, 1.0, sqrt(r2));
          float alpha = (1.0 - exp(-density * vOpacity * 2.2)) * smoothstep(0.0, 1.0, vGround);
          if (alpha < 0.004) discard;
          // A rounded cloud lit by the key light: a sphere normal on the card,
          // softened toward the camera (forward scattering keeps the shaded
          // side grey, not black) plus the sky fill the scene gets from IBL.
          vec3 n = normalize(vec3(vUv * 0.85 + (billow - 0.5) * 0.35, sqrt(max(0.0, 1.0 - r2)) + 0.25));
          vec3 light = skyFill + ambientLightColor;
          #if NUM_HEMI_LIGHTS > 0
            for (int i = 0; i < NUM_HEMI_LIGHTS; i++)
              light += 0.5 * mix(hemisphereLights[i].groundColor, hemisphereLights[i].skyColor, 0.5 + 0.5 * n.y);
          #endif
          #if NUM_DIR_LIGHTS > 0
            for (int i = 0; i < NUM_DIR_LIGHTS; i++)
              light += directionalLights[i].color * (0.05 + 0.25 * max(0.0, dot(n, directionalLights[i].direction)));
          #endif
          vec3 albedo = vec3(0.86, 0.86, 0.84) * (0.9 + 0.2 * billow);
          gl_FragColor = vec4(min(albedo * light, vec3(2.2)), alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    this.root = new T.Mesh(this.geometry, this.material);
    this.root.name = 'Festival drift tyre smoke';
    this.root.frustumCulled = false;
    this.root.renderOrder = 2;
  }
  /** Pool size by preset (LOW draws no drift smoke). */
  setQuality(preset: keyof typeof CAPACITY) {
    this.limit = CAPACITY[preset] ?? CAPACITY.medium;
    this.enabled = this.limit > 0;
    if (this.cursor >= this.limit) this.cursor = 0;
    if (!this.enabled) this.clear();
  }
  /** Sky fill (linear) for the shaded side: the renderer passes the fog
   * colour scaled by the environment intensity of the current lighting. */
  setFill(r: number, g: number, b: number) {
    (this.material.uniforms.skyFill.value as T.Color).setRGB(r, g, b);
  }
  clear() {
    this.age.fill(0);
    this.life.fill(0);
    this.puffs.fill(0);
    this.emission.fill(0);
    this.previous.fill(NaN);
    this.live = 0;
    this.geometry.instanceCount = 0;
  }
  private spawn(
    x: number,
    y: number,
    z: number,
    vx: number,
    vz: number,
    intensity: number,
    age: number,
  ) {
    const r = this.random,
      i = this.cursor;
    this.cursor = (this.cursor + 1) % this.limit;
    const k = DRIFT_SMOKE;
    this.centers[i * 3] = x;
    this.centers[i * 3 + 1] = y;
    this.centers[i * 3 + 2] = z;
    this.velocities[i * 3] = vx + (r.next() - 0.5) * 2 * k.scatter;
    this.velocities[i * 3 + 1] = k.rise[0] + r.next() * (k.rise[1] - k.rise[0]);
    this.velocities[i * 3 + 2] = vz + (r.next() - 0.5) * 2 * k.scatter;
    // Negative until its birth instant inside the current step (see update).
    this.age[i] = age;
    this.life[i] = (k.life[0] + r.next() * (k.life[1] - k.life[0])) * (0.65 + 0.35 * intensity);
    this.strength[i] = intensity;
    this.puffs[i * 4] = k.size[0] + r.next() * (k.size[1] - k.size[0]);
    this.puffs[i * 4 + 1] = 0;
    this.puffs[i * 4 + 2] = y - 0.12;
    this.puffs[i * 4 + 3] = r.next() * 6.2831853;
  }
  /** Advance by the presented snapshot's simulation time. Births over the
   * step are spread along the path actually driven (previous to current
   * chassis position) with their true ages, so a slow frame or a 30 Hz
   * display lays the same trail as 144 Hz; a rewind or teleport clears. */
  update(frame: Float32Array, height: (x: number, z: number, y?: number) => number) {
    const time = frame[H.TIME];
    this.root.visible = this.enabled;
    if (!this.enabled) return;
    const gap = time - this.previousTime;
    if (!(gap > 0)) {
      if (time < this.previousTime) this.clear();
      if (time !== this.previousTime) this.previousTime = time;
      return;
    }
    this.previousTime = time;
    const dt = Math.min(4, gap);
    const k = DRIFT_SMOKE;
    const cars = Math.min(12, frame[H.CARS]);
    for (let id = 0; id < cars; id++) {
      const o = carBase(id),
        speed = Math.abs(frame[o + F.SPEED]);
      const vehicle = Math.round(frame[o + RACE_BASE + R.VEHICLE]),
        def = vehicleAt(vehicle);
      const x0 = frame[o + F.X],
        z0 = frame[o + F.Z];
      let px = this.previous[id * 3],
        pz = this.previous[id * 3 + 2];
      // A machine change, reset or travel is not a path to fill with smoke.
      if (
        this.previous[id * 3 + 1] !== vehicle ||
        !(Math.hypot(x0 - px, z0 - pz) <= speed * gap * 1.8 + 12)
      ) {
        px = x0;
        pz = z0;
      }
      this.previous[id * 3] = x0;
      this.previous[id * 3 + 1] = vehicle;
      this.previous[id * 3 + 2] = z0;
      this.quaternion.set(frame[o + F.QX], frame[o + F.QY], frame[o + F.QZ], frame[o + F.QW]);
      this.back.set(0, 0, -1).applyQuaternion(this.quaternion);
      this.side.set(1, 0, 0).applyQuaternion(this.quaternion);
      for (let w = 0; w < 4; w++) {
        const slot = id * 4 + w,
          p = o + WHEEL_BASE + w * WHEEL_STRIDE,
          surface = frame[p + W.SURFACE];
        // Bikes duplicate each axle's telemetry into its second slot.
        const bike = def.dynamicsKind === 'bike';
        const sealed = surface === 0 || surface === 1 || surface === 2 || surface === 5;
        const sliding = tireSmokeSliding(frame[p + W.SLIP], frame[p + W.ANGLE]);
        if (
          (bike && w % 2 === 1) ||
          speed < k.minSpeed ||
          frame[p + W.LOAD] < 30 ||
          !sealed ||
          frame[p + W.WATER] > 0.25 ||
          sliding <= 0
        ) {
          this.emission[slot] = 0;
          continue;
        }
        const power = clamp(frame[p + W.SLIP_POWER] / k.fullPower, 0.15, 1);
        const intensity = sliding * power;
        this.emission[slot] += k.rate * intensity * (w < 2 ? k.frontShare : 1) * dt;
        const births = Math.min(160, Math.floor(this.emission[slot]));
        this.emission[slot] -= births;
        if (!births) continue;
        festivalContactLocal(frame, id, w, this.local).applyQuaternion(this.quaternion);
        // Slide speed at the contact: lateral body speed plus wheelspin.
        const slide = Math.hypot(frame[o + F.VX], frame[o + F.VZ]) * Math.min(1, sliding);
        const outward = (w % 2 === 0 ? 1 : -1) * 0.6;
        for (let b = 0; b < births; b++) {
          const t = (b + 0.5) / births;
          const x = px + (x0 - px) * t + this.local.x + this.side.x * outward * 0.3,
            z = pz + (z0 - pz) * t + this.local.z + this.side.z * outward * 0.3;
          const ground = height(x, z, frame[o + F.Y] + this.local.y);
          this.spawn(
            x,
            ground + 0.32,
            z,
            frame[o + F.VX] * k.inherit + this.back.x * slide * k.throwBack + this.side.x * outward,
            frame[o + F.VZ] * k.inherit + this.back.z * slide * k.throwBack + this.side.z * outward,
            intensity,
            // Born at fraction t of the step: (1 - t) * dt old at its end.
            -t * dt,
          );
        }
      }
    }
    // Age, advect and fade the pool.
    let last = -1;
    this.live = 0;
    for (let i = 0; i < this.limit; i++) {
      if (this.life[i] <= 0) continue;
      const before = this.age[i];
      this.age[i] += dt;
      const step = this.age[i] - Math.max(0, before);
      const t = this.age[i] / this.life[i];
      if (t >= 1) {
        this.life[i] = 0;
        this.puffs[i * 4 + 1] = 0;
        continue;
      }
      last = i;
      this.live++;
      const v = i * 3,
        relax = 1 - Math.exp(-step * k.drag);
      this.centers[v] += this.velocities[v] * step * (1 - relax * 0.5);
      this.centers[v + 1] += this.velocities[v + 1] * step * (1 - relax * 0.3);
      this.centers[v + 2] += this.velocities[v + 2] * step * (1 - relax * 0.5);
      this.velocities[v] -= this.velocities[v] * relax;
      this.velocities[v + 1] -= this.velocities[v + 1] * relax * 0.6;
      this.velocities[v + 2] -= this.velocities[v + 2] * relax;
      // Radius follows the closed form of growth * exp(-age / settle).
      const settled = Math.exp(-Math.max(0, before) / k.settle) - Math.exp(-this.age[i] / k.settle);
      this.puffs[i * 4] += k.growth * k.settle * settled * (0.6 + 0.4 * this.strength[i]);
      this.puffs[i * 4 + 3] += step * 0.25 * (this.strength[i] - 0.5);
      // Dense birth, slow thinning as the cloud spreads.
      this.puffs[i * 4 + 1] =
        Math.min(1, Math.max(0, this.age[i]) / 0.2) *
        Math.pow(1 - t, 1.4) *
        k.alpha *
        (0.45 + 0.55 * this.strength[i]);
    }
    this.geometry.instanceCount = last + 1;
    if (last >= 0) {
      (this.geometry.getAttribute('center') as T.BufferAttribute).needsUpdate = true;
      (this.geometry.getAttribute('puff') as T.BufferAttribute).needsUpdate = true;
    }
  }
  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
