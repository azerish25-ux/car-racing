import * as T from 'three';

/** Night start flares, measured from the night touge reference (FH6 ref
 * 048): a hand flare at each side of the start burns a white-red core at
 * ground level and pours a red-lit smoke column ~6-9 m tall that widens to
 * ~4 m and leans downwind. Each puff is analytic in time (no per-puff CPU
 * state): one instanced draw, shown only at night near a start. */
export const START_FLARES = Object.freeze({
  /** Puffs per flare (one of them the burning core). */
  puffs: 22,
  life: Object.freeze([2.8, 4.4] as const),
  height: 7.5,
  /** Final puff radius (m). */
  spread: 2.1,
  /** Visible within this distance of the camera (m). */
  range: 420,
});

export class FestivalStartFlares {
  readonly mesh: T.Mesh<T.InstancedBufferGeometry, T.ShaderMaterial>;
  private readonly sites: T.Vector3[];
  private readonly material: T.ShaderMaterial;
  constructor(sites: readonly T.Vector3[]) {
    this.sites = sites.map((s) => s.clone());
    const count = this.sites.length * START_FLARES.puffs;
    const origin = new Float32Array(count * 3),
      seed = new Float32Array(count);
    this.sites.forEach((site, f) => {
      for (let i = 0; i < START_FLARES.puffs; i++) {
        const k = f * START_FLARES.puffs + i;
        site.toArray(origin, k * 3);
        // Puff 0 of each flare is its core (negative seed).
        seed[k] = i === 0 ? -1 : (((k * 0.61803398875) % 1) + 1) % 1;
      }
    });
    const geometry = new T.InstancedBufferGeometry();
    geometry.setAttribute(
      'position',
      new T.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3),
    );
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute('origin', new T.InstancedBufferAttribute(origin, 3));
    geometry.setAttribute('seed', new T.InstancedBufferAttribute(seed, 1));
    geometry.instanceCount = count;
    const k = START_FLARES;
    this.material = new T.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: true,
      uniforms: T.UniformsUtils.merge([
        T.UniformsLib.fog,
        { time: { value: 0 }, strength: { value: 0 } },
      ]),
      vertexShader: /* glsl */ `
        attribute vec3 origin;
        attribute float seed;
        uniform float time;
        uniform float strength;
        varying vec2 vUv;
        varying vec3 vColour;
        varying float vAlpha;
        varying float vSpin;
        #include <common>
        #include <fog_pars_vertex>
        void main() {
          vUv = position.xy;
          float core = step(seed, -0.5);
          float s = max(seed, 0.0);
          float life = ${k.life[0].toFixed(2)} + s * ${(k.life[1] - k.life[0]).toFixed(2)};
          float phase = core > 0.5 ? 0.0 : fract(time / life + s * 7.13);
          vSpin = s * 6.2831853 + phase * 1.7;
          // Rise fast near the flare, slow and spread as the column cools;
          // lean downwind (+x, +z) and wander per puff.
          float rise = ${k.height.toFixed(2)} * (1.0 - pow(1.0 - phase, 1.6)) * (0.75 + 0.5 * fract(s * 13.7));
          vec3 wander = vec3(sin(s * 41.0), 0.0, cos(s * 23.0)) * 0.9 * phase;
          vec3 centre = origin + vec3(0.0, 0.25 + rise, 0.0) + wander + vec3(0.8, 0.0, 0.5) * phase * phase;
          float radius = core > 0.5 ? 0.32 : 0.35 + phase * ${k.spread.toFixed(2)};
          // Hot white-red at the flare, red smoke above it; the core flickers.
          float flicker = 0.85 + 0.15 * sin(time * 31.0 + origin.x) * sin(time * 17.0 + origin.z);
          vColour = core > 0.5
            ? vec3(14.0, 3.2, 1.6) * flicker
            : mix(vec3(4.2, 0.55, 0.28), vec3(0.75, 0.05, 0.035), smoothstep(0.0, 0.45, phase));
          vAlpha = strength * (core > 0.5 ? 0.95 : smoothstep(0.0, 0.06, phase) * (1.0 - phase) * 0.62);
          vec4 mvPosition = modelViewMatrix * vec4(centre, 1.0);
          #include <fog_vertex>
          if (vAlpha <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          mvPosition.xy += position.xy * radius;
          gl_Position = projectionMatrix * mvPosition;
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vColour;
        varying float vAlpha;
        varying float vSpin;
        #include <common>
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
          float density = exp(-r2 * 2.8) * (0.6 + 0.8 * noise(q * 2.6 + vSpin));
          float alpha = (1.0 - exp(-density * vAlpha * 2.0)) * (1.0 - smoothstep(0.6, 1.0, sqrt(r2)));
          if (alpha < 0.004) discard;
          gl_FragColor = vec4(vColour, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    this.mesh = new T.Mesh(geometry, this.material);
    this.mesh.name = 'Festival night start flares';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
  }
  /** Shown at night when the camera is near any start (`night` 0..1). */
  update(camera: T.Camera, night: number, time: number) {
    let near = Infinity;
    for (const s of this.sites) near = Math.min(near, camera.position.distanceTo(s));
    const strength = Math.max(0, Math.min(1, (night - 0.5) * 2));
    this.mesh.visible = this.sites.length > 0 && strength > 0 && near < START_FLARES.range;
    this.material.uniforms.strength.value = strength;
    // Wrap well inside float precision; puff lives are a few seconds.
    this.material.uniforms.time.value = Number.isFinite(time) ? time % 3600 : 0;
  }
  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
