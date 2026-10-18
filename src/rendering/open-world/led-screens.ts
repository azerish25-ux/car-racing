import * as T from 'three';

/** Large LED screens on a few tall city buildings (refs 030, 069, 086):
 * a 16:9 face in a 0.25 m black bezel, mounted 0.2-0.3 m off the wall,
 * playing original abstract loops (flowing colour waves, expanding rings,
 * sliding colour blocks, a bouncing disc) that change every 7 s with a
 * wipe. A fine LED pixel grid shows up close and fades with distance.
 * Every screen merges into one mesh and one material (one draw); the
 * content is computed in the fragment shader from time, nothing streams. */
export class LedScreens {
  readonly material: T.MeshStandardMaterial;
  mesh: T.Mesh | null = null;
  readonly uniforms = { ledTime: { value: 0 }, ledNight: { value: 0 } };
  count = 0;
  private readonly position: number[] = [];
  private readonly normal: number[] = [];
  private readonly uv: number[] = [];
  private readonly screen: number[] = [];
  private readonly index: number[] = [];

  constructor() {
    this.material = new T.MeshStandardMaterial({ color: 0x060607, roughness: 0.32, metalness: 0 });
    this.material.name = 'Festival LED screens';
    (this.material as unknown as { defines: Record<string, string> }).defines = { USE_UV: '' };
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.ledTime = this.uniforms.ledTime;
      shader.uniforms.ledNight = this.uniforms.ledNight;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nattribute vec2 screen;\nvarying vec2 vScreen;',
        )
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvScreen = screen;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
uniform float ledTime;
uniform float ledNight;
varying vec2 vScreen;
float ledHash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
vec3 ledContent(vec2 uv, float seed, float t) {
  float clock = t / 7.0 + seed * 5.0;
  float scene = floor(clock), phase = fract(clock);
  float pick = ledHash(scene * 1.37 + seed * 78.233);
  vec3 a = 0.5 + 0.5 * cos(6.2832 * (pick + vec3(0.0, 0.33, 0.67)));
  vec3 b = 0.5 + 0.5 * cos(6.2832 * (pick + 0.45 + vec3(0.0, 0.33, 0.67)));
  vec3 c;
  if (pick < 0.25) {
    float w = sin(uv.x * 9.0 + t * 1.7 + sin(uv.y * 5.0 + t) * 1.5);
    c = mix(a, b, 0.5 + 0.5 * w);
  } else if (pick < 0.5) {
    float r = length((uv - 0.5) * vec2(1.78, 1.0));
    c = mix(a * 0.15, b, smoothstep(0.42, 0.5, fract(r * 4.0 - t * 0.8)));
  } else if (pick < 0.75) {
    float k = floor(uv.x * 6.0 + t * 0.9);
    c = mix(a, b, step(0.5, fract(k * 0.37)));
    c *= 0.6 + 0.4 * step(0.2, fract(uv.y * 3.0 + t * 0.3));
  } else {
    vec2 p = (uv - vec2(0.5 + 0.25 * sin(t * 0.9), 0.5 + 0.2 * cos(t * 1.3))) * vec2(1.78, 1.0);
    c = mix(mix(a * 0.25, a, uv.y), b, 1.0 - smoothstep(0.2, 0.22, length(p)));
  }
  // A dark wipe sweeps across in the last tenth of each loop.
  float bar = step(uv.x, smoothstep(0.9, 1.0, phase) * 1.02);
  return c * (1.0 - 0.92 * bar);
}`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
if (vScreen.y > 0.5) {
  vec3 led = ledContent(vUv, vScreen.x, ledTime);
  // LED pixel grid (about 1 600 x 900 on a 9 m face), resolved only close.
  vec2 cell = vUv * vec2(320.0, 180.0);
  vec2 g = abs(fract(cell) - 0.5);
  float fade = 1.0 - smoothstep(0.15, 0.5, max(fwidth(cell.x), fwidth(cell.y)));
  float dots = mix(1.0, smoothstep(0.5, 0.3, max(g.x, g.y)) * 1.6, fade * 0.7);
  totalEmissiveRadiance += led * dots * (0.85 + ledNight * 1.9);
}`,
        );
    };
    this.material.customProgramCacheKey = () => 'festival-led-screens-v1';
  }

  /** A screen of w x h metres centred at `centre`, facing `normal`. */
  add(centre: T.Vector3, normal: T.Vector3, w: number, h: number, seed: number) {
    const n = normal.clone().normalize();
    const right = new T.Vector3(n.z, 0, -n.x).normalize();
    const up = new T.Vector3(0, 1, 0);
    const s = (seed % 997) / 997;
    const quad = (
      c: T.Vector3,
      nn: T.Vector3,
      r: T.Vector3,
      u: T.Vector3,
      hw: number,
      hh: number,
      face: number,
    ) => {
      const base = this.position.length / 3;
      const corners = [
        [-1, -1, 0, 0],
        [1, -1, 1, 0],
        [1, 1, 1, 1],
        [-1, 1, 0, 1],
      ];
      for (const [a, b, uu, vv] of corners) {
        const p = c
          .clone()
          .addScaledVector(r, a * hw)
          .addScaledVector(u, b * hh);
        this.position.push(p.x, p.y, p.z);
        this.normal.push(nn.x, nn.y, nn.z);
        this.uv.push(uu, vv);
        this.screen.push(s, face);
      }
      this.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    const bezel = 0.25,
      depth = 0.3;
    // Face, then the bezel box behind it (front frame, back, sides, top).
    quad(centre.clone().addScaledVector(n, depth / 2 + 0.005), n, right, up, w / 2, h / 2, 1);
    const W = w / 2 + bezel,
      H = h / 2 + bezel;
    quad(centre.clone().addScaledVector(n, depth / 2), n, right, up, W, H, 0);
    quad(
      centre.clone().addScaledVector(n, -depth / 2),
      n.clone().negate(),
      right.clone().negate(),
      up,
      W,
      H,
      0,
    );
    for (const side of [-1, 1]) {
      const sn = right.clone().multiplyScalar(side);
      quad(
        centre.clone().addScaledVector(right, side * W),
        sn,
        n.clone().multiplyScalar(-side),
        up,
        depth / 2,
        H,
        0,
      );
    }
    quad(centre.clone().addScaledVector(up, H), up, right, n.clone().negate(), W, depth / 2, 0);
    this.count++;
  }

  /** Merge every screen into one mesh (null when there is none). */
  finish() {
    if (!this.index.length) return null;
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(this.position, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(this.normal, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('screen', new T.Float32BufferAttribute(this.screen, 2));
    g.setIndex(this.index);
    g.computeBoundingSphere();
    this.mesh = new T.Mesh(g, this.material);
    this.mesh.name = 'LED screens';
    this.mesh.matrixAutoUpdate = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    return this.mesh;
  }

  get triangles() {
    return this.index.length / 3;
  }

  update(time: number, night: number) {
    this.uniforms.ledTime.value = time;
    this.uniforms.ledNight.value = night;
  }

  dispose() {
    this.mesh?.geometry.dispose();
    this.material.dispose();
  }
}
