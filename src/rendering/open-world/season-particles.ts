import * as T from 'three';
import type { QualityPreset } from '../options.ts';
import { seasonUniforms } from './season.ts';
import { studioUniforms } from '../studio/studio-frame.ts';

/** Particles per tier (one instanced draw; LOW draws none). */
const COUNT: Readonly<Record<QualityPreset, number>> = Object.freeze({
  low: 0,
  medium: 1400,
  high: 2600,
  ultra: 3600,
});
/** Half extent of the camera-wrapped volume (m) and its height. */
const RADIUS = 34;
const HEIGHT = 22;

/**
 * Falling season flakes around the camera (refs 015, 033, 050: blossom
 * petals; 027, 052: maple leaves; 064, 070, 073: snow). The whole volume is
 * evaluated in the vertex shader from per-instance seeds, the clock and the
 * shared wind, wrapped around the camera, so the CPU never touches it.
 * Summer and LOW draw nothing.
 */
export class SeasonParticles {
  readonly root: T.InstancedMesh;
  private readonly material: T.ShaderMaterial;
  private readonly centre = { value: new T.Vector3() };
  private readonly light = { value: new T.Color(1, 1, 1) };
  private capacity = COUNT.ultra;
  constructor() {
    const geometry = new T.PlaneGeometry(1, 1);
    const seeds = new Float32Array(this.capacity * 4);
    let s = 0x9e3779b9;
    const random = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    for (let i = 0; i < seeds.length; i++) seeds[i] = random();
    geometry.setAttribute('seed', new T.InstancedBufferAttribute(seeds, 4));
    this.material = new T.ShaderMaterial({
      name: 'Festival season flakes',
      transparent: true,
      depthWrite: false,
      side: T.DoubleSide,
      uniforms: {
        owSeason: seasonUniforms.owSeason,
        studioTime: studioUniforms.studioTime,
        studioWind: studioUniforms.studioWind,
        flakeCentre: this.centre,
        flakeLight: this.light,
      },
      vertexShader: /* glsl */ `
uniform vec4 owSeason;
uniform float studioTime;
uniform vec4 studioWind;
uniform vec3 flakeCentre;
attribute vec4 seed;
varying vec2 vUv;
varying vec3 vTint;
varying float vFade;
const float R = ${RADIUS.toFixed(1)};
const float H = ${HEIGHT.toFixed(1)};
mat3 spin(vec3 axis, float a) {
  float c = cos(a), s = sin(a), t = 1.0 - c;
  return mat3(t*axis.x*axis.x+c, t*axis.x*axis.y+s*axis.z, t*axis.x*axis.z-s*axis.y,
              t*axis.x*axis.y-s*axis.z, t*axis.y*axis.y+c, t*axis.y*axis.z+s*axis.x,
              t*axis.x*axis.z+s*axis.y, t*axis.y*axis.z-s*axis.x, t*axis.z*axis.z+c);
}
void main() {
  vUv = uv;
  float snow = owSeason.w, leaf = owSeason.z, petal = owSeason.x;
  // Fall speeds: petals flutter 0.6–1.0 m/s, leaves 1.0–1.6, snow 0.7–1.2.
  float fall = mix(mix(0.6, 1.0, seed.w), mix(1.0, 1.6, seed.w), leaf);
  fall = mix(fall, mix(0.7, 1.2, seed.w), snow);
  float t = studioTime;
  vec3 wind = vec3(studioWind.x, 0.0, studioWind.y) * (0.35 + 0.3 * seed.z);
  vec3 p = vec3(seed.x * 2.0 * R, -t * fall + seed.y * H, seed.z * 2.0 * R) + wind * t;
  // Flutter: lateral sway with each flake's own phase.
  float phase = seed.w * 6.2832;
  p.x += sin(t * (1.1 + seed.x) + phase) * mix(0.5, 0.18, snow);
  p.z += cos(t * (0.9 + seed.y) + phase) * mix(0.5, 0.18, snow);
  // Wrap the volume around the camera.
  vec3 origin = flakeCentre - vec3(R, H * 0.35, R);
  vec3 local = mod(p - origin, vec3(2.0 * R, H, 2.0 * R));
  vec3 world = origin + local;
  // Size: petals 2–3 cm, leaves 4–7 cm, snow 0.8–1.6 cm.
  float size = mix(mix(0.022, 0.032, seed.x), mix(0.04, 0.07, seed.x), leaf);
  size = mix(size, mix(0.008, 0.016, seed.x), snow);
  vec3 axis = normalize(vec3(seed.y - 0.5, 0.6, seed.z - 0.5));
  mat3 r = spin(axis, t * mix(2.5, 0.6, snow) + phase);
  vec3 corner = r * vec3(position.xy * size * vec2(1.0, mix(1.0, 0.7, petal)), 0.0);
  vec4 view = viewMatrix * vec4(world + corner, 1.0);
  // Fade at the volume's edges and very close to the lens.
  vec3 edge = min(local, vec3(2.0 * R, H, 2.0 * R) - local) / vec3(4.0, 3.0, 4.0);
  vFade = clamp(min(min(edge.x, edge.y), edge.z), 0.0, 1.0) * smoothstep(0.35, 1.2, -view.z);
  vec3 petalTint = mix(vec3(0.98, 0.78, 0.84), vec3(0.95, 0.66, 0.74), seed.y);
  vec3 leafTint = mix(mix(vec3(0.78, 0.16, 0.06), vec3(0.92, 0.46, 0.08), seed.y), vec3(0.85, 0.66, 0.12), step(0.72, seed.z));
  vTint = petal * petalTint + leaf * leafTint + snow * vec3(0.97, 0.98, 1.0);
  vFade *= clamp(petal + leaf + snow, 0.0, 1.0);
  gl_Position = projectionMatrix * view;
}`,
      fragmentShader: /* glsl */ `
uniform vec3 flakeLight;
varying vec2 vUv;
varying vec3 vTint;
varying float vFade;
void main() {
  vec2 q = vUv * 2.0 - 1.0;
  float shape = 1.0 - smoothstep(0.75, 1.0, length(q));
  float alpha = shape * vFade;
  if (alpha < 0.02) discard;
  vec3 colour = vTint * flakeLight;
  gl_FragColor = vec4(colour, alpha * 0.92);
  #include <colorspace_fragment>
}`,
    });
    this.root = new T.InstancedMesh(geometry, this.material, this.capacity);
    this.root.name = 'Festival season flakes';
    this.root.frustumCulled = false;
    this.root.renderOrder = 3;
    this.root.count = 0;
    const identity = new T.Matrix4();
    for (let i = 0; i < this.capacity; i++) this.root.setMatrixAt(i, identity);
  }
  /** Follow the camera. `light` is the linear radiance a white flake
   * reflects this frame (flakes are thin and unshaded). */
  update(camera: T.Camera, preset: QualityPreset, light: T.Color) {
    const season = seasonUniforms.owSeason.value;
    const active = season.x + season.z + season.w > 0.5;
    this.root.count = active ? COUNT[preset] : 0;
    this.root.visible = this.root.count > 0;
    camera.getWorldPosition(this.centre.value);
    this.light.value.copy(light);
  }
  dispose() {
    this.root.geometry.dispose();
    this.material.dispose();
    this.root.dispose();
  }
}
