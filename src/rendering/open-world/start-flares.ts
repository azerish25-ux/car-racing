import * as T from 'three';
import type { QualityPreset } from '../options.ts';

/** Night start flares, measured from the night touge reference (FH6 ref
 * 048, 1920 x 1080; scene radiance through three's ACES at the night
 * exposure in brackets):
 *
 *  - a road flare stuck in the verge burns a small, intensely bright core at
 *    ground level: yellow-white #face89 (1.6/0.48/0.11) with a short
 *    pink-orange jet #fb7a54 (1.0/0.11/0.06) above it;
 *  - from it rises one continuous, thick smoke column, not puffs: ~0.3 m
 *    wide at the core, widening to ~4-5 m by ~10 m up (half-angle ~12
 *    degrees), leaning a little downwind and running out of the frame; it is
 *    lit from below, saturated red #fe3c36 (0.98/0.02/0.03) low, #d01812
 *    (0.48/0.02/0.006) mid, #910403 (0.23/0/0) high, with turbulent billows
 *    whose edges break up;
 *  - red light spills on the road, the guardrail (#831c0e near the flare)
 *    and the car bodies between the flares.
 *
 * Here: an axial-billboard plume per flare (a strip turned about its leaning
 * axis toward the camera) shaded with rising, domain-warped fbm smoke and the
 * flare's red light falling off with height; a hot core sprite; an additive,
 * ground-conforming red pool; and on MEDIUM+ two red point lights at the
 * flares nearest the camera (a fixed count per lighting and tier, so no
 * shader recompiles as starts come into range). Three draws in all, shown
 * only near a start when the lamps are lit (night, blue hour). */
export const START_FLARES = Object.freeze({
  /** Burning core above the road (m) and its sprite radius. */
  core: Object.freeze({ height: 0.18, radius: 0.5 }),
  plume: Object.freeze({
    height: 11,
    /** Radius at the core and at the top (m). */
    base: 0.14,
    top: 3,
    /** Downwind lean of the top (m) and rise speed of the smoke (m/s). */
    lean: 1.4,
    rise: 2.4,
    segments: 20,
    /** Emission (scene units): the jet over the core, the lit column, the
     * column's top. */
    hot: Object.freeze([2.4, 0.4, 0.14] as const),
    red: Object.freeze([1.05, 0.03, 0.028] as const),
    deep: Object.freeze([0.2, 0.003, 0.002] as const),
  }),
  /** Red light on the road, rails and cars: point lights at 1.4 m over the
   * flare (the bright lower column), candela and cutoff (m). */
  light: Object.freeze({ intensity: 110, distance: 30, height: 1.4, count: 2 }),
  /** Additive pool on the ground at the flare (radius m, peak radiance). */
  pool: Object.freeze({ radius: 4, colour: Object.freeze([0.42, 0.035, 0.022] as const) }),
  /** Visible within this distance of the camera (m). */
  range: 420,
});

/** Ground height near a reference height (bridges, stacked roads). */
type Height = (x: number, z: number, y: number) => number;

const NOISE = /* glsl */ `
// Sine-free hash (Hoskins): stable far from the origin, where a sin() hash
// loses precision and smears into streaks.
float flareHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float flareNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(flareHash(i), flareHash(i + vec2(1.0, 0.0)), f.x),
             mix(flareHash(i + vec2(0.0, 1.0)), flareHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float flareFbm(vec2 p) {
  float sum = 0.0, amplitude = 0.5;
  for (int i = 0; i < 4; i++) {
    sum += amplitude * flareNoise(p);
    p = p * 2.07 + vec2(11.3, 5.9);
    amplitude *= 0.5;
  }
  return sum / 0.9375;
}
`;
const vec3 = (c: readonly number[]) => `vec3(${c.map((v) => v.toFixed(4)).join(', ')})`;

export class FestivalStartFlares {
  /** Smoke, cores and pools: shown near a start when lit. */
  readonly root = new T.Group();
  /** The red point lights (added to the scene by the renderer): kept apart
   * from `root` so their count only changes with the lighting and tier. */
  readonly lightRoot = new T.Group();
  /** The smoke columns (one instanced draw). */
  readonly mesh: T.Mesh<T.InstancedBufferGeometry, T.ShaderMaterial>;
  readonly cores: T.Mesh<T.InstancedBufferGeometry, T.ShaderMaterial>;
  readonly pools: T.Mesh<T.BufferGeometry, T.ShaderMaterial>;
  readonly lights: T.PointLight[] = [];
  private readonly sites: T.Vector3[];
  private readonly material: T.ShaderMaterial;
  private readonly coreMaterial: T.ShaderMaterial;
  private readonly poolMaterial: T.ShaderMaterial;
  private readonly uniforms = {
    time: { value: 0 },
    strength: { value: 0 },
    fill: { value: new T.Vector3() },
  };
  private readonly order: number[] = [];
  constructor(sites: readonly T.Vector3[], height?: Height) {
    this.root.name = 'Festival start flares';
    this.lightRoot.name = 'Festival start flare lights';
    this.sites = sites.map((s) => s.clone());
    const count = this.sites.length;
    const origin = new Float32Array(count * 3),
      seed = new Float32Array(count);
    this.sites.forEach((site, i) => {
      site.toArray(origin, i * 3);
      seed[i] = (i * 0.61803398875) % 1;
    });
    const k = START_FLARES.plume;
    // Plume strip: x across (-1..1), y along the column (0..1).
    const strip: number[] = [],
      index: number[] = [];
    for (let j = 0; j <= k.segments; j++) {
      const t = j / k.segments;
      strip.push(-1, t, 0, 1, t, 0);
      if (j < k.segments) index.push(2 * j, 2 * j + 1, 2 * j + 2, 2 * j + 1, 2 * j + 3, 2 * j + 2);
    }
    const instanced = (positions: number[], indices: number[]) => {
      const g = new T.InstancedBufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
      g.setIndex(indices);
      g.setAttribute('origin', new T.InstancedBufferAttribute(origin, 3));
      g.setAttribute('seed', new T.InstancedBufferAttribute(seed, 1));
      g.instanceCount = count;
      return g;
    };
    const fog = T.UniformsLib.fog;
    this.material = new T.ShaderMaterial({
      name: 'Start flare smoke',
      transparent: true,
      depthWrite: false,
      side: T.DoubleSide,
      fog: true,
      uniforms: { ...T.UniformsUtils.clone(fog), ...this.uniforms },
      vertexShader: /* glsl */ `
        attribute vec3 origin;
        attribute float seed;
        uniform float time;
        varying vec2 vPlume;
        varying float vHeight;
        varying float vSeed;
        #include <common>
        #include <fog_pars_vertex>
        void main() {
          float t = position.y;
          float h = t * ${k.height.toFixed(2)};
          vec3 wind = normalize(vec3(0.8, 0.0, 0.5));
          float sway = (sin(time * 0.55 + seed * 6.2832) * 0.3 + sin(time * 1.3 + seed * 17.0) * 0.12) * t * t;
          vec3 axis = (modelMatrix * vec4(origin, 1.0)).xyz
            + vec3(0.0, ${START_FLARES.core.height.toFixed(2)} + h, 0.0)
            + wind * ${k.lean.toFixed(2)} * t * t + vec3(-wind.z, 0.0, wind.x) * sway;
          float radius = ${k.base.toFixed(3)} + ${(k.top - k.base).toFixed(3)} * pow(t, 0.7);
          // Axial billboard: the strip turns about the column toward the eye.
          vec2 view = cameraPosition.xz - axis.xz;
          vec2 across = length(view) > 1e-3 ? normalize(vec2(-view.y, view.x)) : vec2(1.0, 0.0);
          vec3 world = axis + vec3(across.x, 0.0, across.y) * position.x * radius * 1.4;
          vPlume = vec2(position.x * 1.4, radius);
          vHeight = h;
          vSeed = seed;
          vec4 mvPosition = viewMatrix * vec4(world, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform float time;
        uniform float strength;
        uniform vec3 fill;
        varying vec2 vPlume;
        varying float vHeight;
        varying float vSeed;
        #include <common>
        #include <fog_pars_fragment>
        ${NOISE}
        void main() {
          float t = vHeight / ${k.height.toFixed(2)};
          // Rising turbulence: eddies widen with the column; the vertical
          // scale is fixed so the scroll never shears into streaks.
          float cell = 0.4 + 0.15 * vHeight;
          vec2 p = vec2(vPlume.x * vPlume.y / cell + vSeed * 13.0,
                        (vHeight - time * ${k.rise.toFixed(2)}) / 0.9);
          float warp = flareFbm(p * 0.55 + vec2(vSeed * 7.0, -time * 0.15));
          float n = flareFbm(p + vec2(1.6 * warp - 0.8, 0.0));
          float across = vPlume.x * (1.0 + 0.35 * (warp - 0.5));
          float density = exp(-across * across * 2.2) * (0.3 + 1.15 * n) - 0.2 - 0.25 * t;
          density *= mix(1.7, 0.75, t) * (1.0 - smoothstep(0.7, 1.0, t));
          float alpha = (1.0 - exp(-max(density, 0.0) * 3.2)) * strength;
          if (alpha < 0.004) discard;
          // Lit from the flare below: hot over the core, red in the column,
          // deep red where the light has fallen off; thicker smoke a little
          // brighter (more of it scatters the light).
          vec3 colour = ${vec3(k.deep)}
            + ${vec3(k.red.map((v, i) => v - k.deep[i]))} * exp(-vHeight / 3.6)
            + ${vec3(k.hot.map((v, i) => v - k.red[i]))} * exp(-vHeight / 0.45);
          colour *= 0.75 + 0.5 * n;
          colour += fill * (1.0 - exp(-vHeight / 3.6));
          gl_FragColor = vec4(colour, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    this.mesh = new T.Mesh(instanced(strip, index), this.material);
    this.mesh.name = 'Festival start flare smoke';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    // Core sprites: a white-hot point in a pink-red glow (the bloom spreads it).
    this.coreMaterial = new T.ShaderMaterial({
      name: 'Start flare cores',
      transparent: true,
      depthWrite: false,
      blending: T.AdditiveBlending,
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        attribute vec3 origin;
        attribute float seed;
        uniform float time;
        uniform float strength;
        varying vec2 vSprite;
        varying float vFlicker;
        void main() {
          vSprite = position.xy;
          vFlicker = strength * (0.82 + 0.18 * sin(time * 37.0 + seed * 40.0) * sin(time * 23.0 + seed * 9.0));
          vec4 mvPosition = viewMatrix * modelMatrix * vec4(origin + vec3(0.0, ${START_FLARES.core.height.toFixed(2)}, 0.0), 1.0);
          mvPosition.xy += position.xy * ${START_FLARES.core.radius.toFixed(2)};
          // Pull toward the eye so the column's base never hides it.
          mvPosition.xyz *= 1.0 - 0.3 / max(length(mvPosition.xyz), 0.6);
          gl_Position = projectionMatrix * mvPosition;
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vSprite;
        varying float vFlicker;
        void main() {
          float r2 = dot(vSprite, vSprite);
          if (r2 >= 1.0) discard;
          vec3 c = vec3(9.0, 4.2, 2.6) * exp(-r2 * 60.0) + vec3(2.2, 0.32, 0.16) * exp(-r2 * 9.0);
          gl_FragColor = vec4(c * vFlicker * (1.0 - r2), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.cores = new T.Mesh(
      instanced([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], [0, 1, 2, 0, 2, 3]),
      this.coreMaterial,
    );
    this.cores.name = 'Festival start flare cores';
    this.cores.frustumCulled = false;
    this.cores.renderOrder = 4;
    // Red pools on the ground at each flare (ground-conforming 7 x 7 grids).
    const pool = START_FLARES.pool,
      n = 7,
      positions: number[] = [],
      uvs: number[] = [],
      poolIndex: number[] = [];
    for (const site of this.sites) {
      const base = positions.length / 3;
      for (let j = 0; j < n; j++)
        for (let i = 0; i < n; i++) {
          const u = (i / (n - 1)) * 2 - 1,
            v = (j / (n - 1)) * 2 - 1,
            x = site.x + u * pool.radius,
            z = site.z + v * pool.radius;
          positions.push(x, (height ? height(x, z, site.y) : site.y) + 0.05, z);
          uvs.push(u, v);
        }
      for (let j = 0; j < n - 1; j++)
        for (let i = 0; i < n - 1; i++) {
          const a = base + j * n + i;
          poolIndex.push(a, a + n, a + 1, a + 1, a + n, a + n + 1);
        }
    }
    const poolGeometry = new T.BufferGeometry();
    poolGeometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    poolGeometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
    poolGeometry.setIndex(poolIndex);
    poolGeometry.computeBoundingSphere();
    this.poolMaterial = new T.ShaderMaterial({
      name: 'Start flare pools',
      transparent: true,
      depthWrite: false,
      blending: T.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        varying vec2 vPool;
        void main() {
          vPool = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float strength;
        varying vec2 vPool;
        void main() {
          float r2 = dot(vPool, vPool);
          float a = (exp(-r2 * 9.0) + 0.25 * exp(-r2 * 2.5)) * (1.0 - smoothstep(0.6, 1.0, r2));
          if (a * strength < 0.002) discard;
          gl_FragColor = vec4(${vec3(pool.colour)} * a * strength, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.pools = new T.Mesh(poolGeometry, this.poolMaterial);
    this.pools.name = 'Festival start flare pools';
    this.pools.renderOrder = 2;
    for (let i = 0; i < START_FLARES.light.count; i++) {
      const light = new T.PointLight(0xff1d12, 0, START_FLARES.light.distance, 2);
      light.name = `Start flare light ${i + 1}`;
      light.castShadow = false;
      light.visible = false;
      this.lights.push(light);
    }
    this.root.add(this.pools, this.mesh, this.cores);
    this.lightRoot.add(...this.lights);
    this.root.visible = false;
  }
  /** Shown when the lamps are lit (`night` 0..1: blue hour and night) and
   * the camera is near a start; `fill` is the sky light on the smoke. */
  update(
    camera: T.Camera,
    night: number,
    time: number,
    preset: QualityPreset = 'medium',
    fill?: T.Vector3,
  ) {
    const eye = camera.position;
    this.order.length = 0;
    for (let i = 0; i < this.sites.length; i++) this.order.push(i);
    this.order.sort((a, b) => eye.distanceTo(this.sites[a]) - eye.distanceTo(this.sites[b]));
    const near = this.order.length ? eye.distanceTo(this.sites[this.order[0]]) : Infinity;
    const lit = Number.isFinite(night) ? Math.min(1, Math.max(0, (night - 0.5) / 0.25)) : 0;
    const strength = lit;
    this.root.visible = this.sites.length > 0 && strength > 0 && near < START_FLARES.range;
    this.uniforms.strength.value = strength;
    // Wrap well inside float precision (the smoke scrolls rise x time over
    // eddies of half a metre): one seam every ten minutes.
    this.uniforms.time.value = Number.isFinite(time) ? time % 600 : 0;
    if (fill) this.uniforms.fill.value.copy(fill);
    // A fixed light count per lighting and tier; only intensity and place
    // follow the camera.
    const lights = strength > 0 && preset !== 'low' ? this.lights.length : 0;
    const flicker = 0.88 + 0.12 * Math.sin(time * 37) * Math.sin(time * 23);
    this.lights.forEach((light, i) => {
      light.visible = i < lights;
      const site = i < this.order.length ? this.sites[this.order[i]] : null;
      if (!light.visible || !site) {
        light.intensity = 0;
        return;
      }
      const d = eye.distanceTo(site),
        fade = 1 - Math.min(1, Math.max(0, (d - 150) / 150));
      light.position.set(site.x, site.y + START_FLARES.light.height, site.z);
      light.intensity = START_FLARES.light.intensity * strength * fade * flicker;
    });
  }
  dispose() {
    this.mesh.geometry.dispose();
    this.cores.geometry.dispose();
    this.pools.geometry.dispose();
    this.material.dispose();
    this.coreMaterial.dispose();
    this.poolMaterial.dispose();
    for (const light of this.lights) light.dispose();
    this.root.clear();
    this.lightRoot.removeFromParent();
    this.lightRoot.clear();
  }
}
