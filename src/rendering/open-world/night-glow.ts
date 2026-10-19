import * as T from 'three';
import type { Structure } from '../../simulation/open-world/placement.ts';
import type { QualityPreset } from '../options.ts';
import { chainShaderHook, injectAfter } from '../studio/shader-hooks.ts';
import type { GlowSource } from './festival-signage.ts';
import { isApartment, type ArchitecturePlan } from './japan-architecture.ts';

/** Night wash of the city canyon (refs 014, 066, 069, 086). In the photos
 * the walls between the signs, the pavement and the road all take the
 * colour of the boards, screens and shopfronts around them: measured on 069
 * a sign-lit wall reads linear Y 0.02-0.19 and the road 0.03-0.04 (pink,
 * R/B 1.3-2.2), where our street was Y 0.003 between the lamp pools.
 *
 * `NightGlow` bakes every lit face of the signage (projecting signs, tenant
 * columns, boards, LED screens, vending machines, store and shop fronts)
 * into one top-down irradiance map over the city at 1 m: rgb is the light a
 * white wall would reflect, alpha the light-weighted top of the sources (the
 * wash fades above it). The facade and street materials add
 * `albedo * wash` (plus a glossy share on the ground: dry sheen, wet
 * streaks) at night; no draw calls and one texture fetch per fragment.
 * A small budget of real point lights (Medium 2, High 3, Ultra 4) follows
 * the strongest faces nearest the camera so the cars take the sign colours
 * too (069's pink flanks). */
export const NIGHT_GLOW = Object.freeze({
  /** Map texel (m) and the largest side it may take. */
  texel: 1,
  maxSize: 2048,
  /** Scale from summed source power to reflected light of a white wall. */
  gain: 0.46,
  /** Distance (m) inside which a source is at full strength. */
  core: 2.4,
  /** Fade (1/m) above the sources' top. */
  fadeAbove: 0.45,
  /** Street surfaces: diffuse gain and glossy share dry / wet. Dark
   * asphalt reads mostly through its sheen (069: road Y 0.03-0.04 under
   * the signs); pale paving mostly diffusely. */
  road: { diffuse: 0.75, dry: 0.3, wet: 0.6 },
  paving: { diffuse: 0.5, dry: 0.06, wet: 0.35 },
  /** Real lights per tier and their candela per unit of source power. */
  lights: { low: 0, medium: 2, high: 3, ultra: 4 } as Record<QualityPreset, number>,
  candela: 16,
  lightRange: 16,
  pickRange: 42,
  /** Bloom threshold drop (scene luminance) at full night. */
  bloomDrop: 1.0,
  /** Shop-front strip power and its warm colour. */
  shopfront: { color: 0xffc890, power: 0.4, reach: 8 },
  /** Saturation of the wash relative to the source colours. */
  saturation: 1.5,
});

const GLSL = /* glsl */ `
uniform sampler2D owGlowMap;
uniform vec4 owGlowBox;
uniform vec2 owGlowState;
varying vec3 vOwGlowWorld;
vec3 owGlowAt(vec3 p, vec3 n) {
  vec2 uv = (p.xz + n.xz * 0.9 - owGlowBox.xy) * owGlowBox.zw;
  if (owGlowState.x <= 0.0 || uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec3(0.0);
  vec4 f = texture2D(owGlowMap, uv);
  return f.rgb * exp(-max(p.y - f.a, 0.0) * ${NIGHT_GLOW.fadeAbove.toFixed(3)}) * owGlowState.x;
}`;

interface Slot {
  light: T.PointLight;
  source: number;
  level: number;
}

export class NightGlow {
  readonly root = new T.Group();
  readonly texture: T.DataTexture | null = null;
  readonly uniforms = {
    owGlowMap: { value: null as T.Texture | null },
    owGlowBox: { value: new T.Vector4() },
    /** x: night amount, y: wetness. */
    owGlowState: { value: new T.Vector2() },
  };
  readonly stats = { sources: 0, width: 0, height: 0, ms: 0 };
  private readonly sources: GlowSource[];
  private readonly strong: number[];
  private readonly slots: Slot[] = [];
  private readonly picked = new Set<number>();

  constructor(
    glows: readonly GlowSource[],
    structures: readonly Structure[],
    plan: ArchitecturePlan,
  ) {
    this.root.name = 'Festival night glow';
    const t0 = performance.now();
    // The map spans the city blocks (urban style) with a margin.
    let x0 = Infinity,
      x1 = -Infinity,
      z0 = Infinity,
      z1 = -Infinity;
    const shop = NIGHT_GLOW.shopfront;
    const fronts: GlowSource[] = [];
    structures.forEach((s, i) => {
      if (plan.style[i] !== 'urban') return;
      x0 = Math.min(x0, s.x - 40);
      x1 = Math.max(x1, s.x + 40);
      z0 = Math.min(z0, s.z - 40);
      z1 = Math.max(z1, s.z + 40);
      if (isApartment(s) || plan.konbiniFloor.has(i)) return;
      // The lit ground floor: a warm strip along the frontage.
      const c = Math.cos(s.heading),
        n = Math.sin(s.heading),
        f = plan.front[i],
        out = s.hz + 0.5;
      const px = s.x - n * f * out,
        pz = s.z + c * f * out,
        hx = Math.max(0.5, s.hx - 0.6);
      fronts.push({
        ax: px - c * hx,
        az: pz - n * hx,
        bx: px + c * hx,
        bz: pz + n * hx,
        y0: s.base,
        y1: s.base + 3.6,
        color: shop.color,
        power: shop.power,
        reach: shop.reach,
      });
    });
    this.sources = [...glows, ...fronts].filter(
      (g) => Number.isFinite(x0) && g.ax > x0 && g.ax < x1 && g.az > z0 && g.az < z1,
    );
    this.strong = this.sources.map((g, i) => (g.power >= 0.9 ? i : -1)).filter((i) => i >= 0);
    this.stats.sources = this.sources.length;
    if (this.sources.length) {
      const texel = Math.max(NIGHT_GLOW.texel, Math.max(x1 - x0, z1 - z0) / NIGHT_GLOW.maxSize);
      const w = Math.ceil((x1 - x0) / texel),
        h = Math.ceil((z1 - z0) / texel);
      this.texture = bake(this.sources, x0, z0, texel, w, h);
      this.uniforms.owGlowMap.value = this.texture;
      this.uniforms.owGlowBox.value.set(x0, z0, 1 / (w * texel), 1 / (h * texel));
      this.stats.width = w;
      this.stats.height = h;
    }
    for (let i = 0; i < 4; i++) {
      const light = new T.PointLight(0xffffff, 0, NIGHT_GLOW.lightRange, 2);
      light.name = `Sign light ${i + 1}`;
      light.castShadow = false;
      light.visible = false;
      this.root.add(light);
      this.slots.push({ light, source: -1, level: 0 });
    }
    this.stats.ms = performance.now() - t0;
  }

  /** Add the wash to a lit material: facades take it on their albedo,
   * the ground also as a glossy sheen (stronger when wet). */
  install(material: T.Material, kind: 'facade' | 'road' | 'paving') {
    if (!this.texture) return;
    const u = this.uniforms;
    const ground = kind === 'facade' ? null : NIGHT_GLOW[kind];
    chainShaderHook(material, `festival-night-glow-${kind}-v1`, (shader) => {
      shader.uniforms.owGlowMap = u.owGlowMap;
      shader.uniforms.owGlowBox = u.owGlowBox;
      shader.uniforms.owGlowState = u.owGlowState;
      injectAfter(shader, 'common', 'varying vec3 vOwGlowWorld;', 'vertex');
      injectAfter(
        shader,
        'begin_vertex',
        'vOwGlowWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
        'vertex',
      );
      injectAfter(shader, 'common', GLSL, 'fragment');
      injectAfter(
        shader,
        'lights_fragment_end',
        /* glsl */ `{
  vec3 owGN = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
  vec3 owGE = owGlowAt(vOwGlowWorld, owGN);
  ${
    ground
      ? `reflectedLight.indirectDiffuse += material.diffuseColor * owGE * ${ground.diffuse.toFixed(2)};
  float owGloss = 1.0 - 0.5 * material.roughness;
  reflectedLight.indirectSpecular += owGE * owGloss * mix(${ground.dry.toFixed(3)}, ${ground.wet.toFixed(3)}, owGlowState.y);`
      : 'reflectedLight.indirectDiffuse += material.diffuseColor * owGE;'
  }
}`,
        'fragment',
      );
    });
  }

  update(camera: T.Camera, night: number, preset: QualityPreset, wet: number, dt: number) {
    const amount = Number.isFinite(night) ? T.MathUtils.clamp(night, 0, 1) : 0;
    this.uniforms.owGlowState.value.set(
      amount,
      Number.isFinite(wet) ? T.MathUtils.clamp(wet, 0, 1) : 0,
    );
    const count = amount > 0.05 ? NIGHT_GLOW.lights[preset] : 0;
    // The strongest faces near the camera (power over distance squared);
    // a light fades out before it moves to another face.
    const eye = camera.position;
    this.picked.clear();
    if (count) {
      const best: { i: number; score: number }[] = [];
      const range2 = NIGHT_GLOW.pickRange * NIGHT_GLOW.pickRange;
      for (const i of this.strong) {
        const g = this.sources[i];
        const dx = (g.ax + g.bx) / 2 - eye.x,
          dz = (g.az + g.bz) / 2 - eye.z,
          d2 = dx * dx + dz * dz;
        if (d2 > range2) continue;
        const held = this.slots.some((s) => s.source === i);
        best.push({ i, score: (g.power / Math.max(d2, 9)) * (held ? 1.25 : 1) });
      }
      best.sort((a, b) => b.score - a.score);
      for (const b of best.slice(0, count)) this.picked.add(b.i);
    }
    const step = Number.isFinite(dt) ? T.MathUtils.clamp(dt, 0, 0.1) : 0;
    const free = [...this.picked].filter((i) => !this.slots.some((s) => s.source === i));
    for (let k = 0; k < this.slots.length; k++) {
      const slot = this.slots[k];
      const keep = k < count && slot.source >= 0 && this.picked.has(slot.source);
      slot.level = T.MathUtils.clamp(slot.level + step * (keep ? 2.5 : -4), 0, 1);
      if (!keep && slot.level === 0 && k < count) {
        slot.source = free.shift() ?? -1;
        if (slot.source >= 0) {
          const g = this.sources[slot.source];
          slot.light.position.set((g.ax + g.bx) / 2, Math.min(g.y1, g.y0 + 3.5), (g.az + g.bz) / 2);
          slot.light.color.set(g.color);
        }
      }
      // A fixed light count per tier and lighting state (no recompiles as
      // signs enter and leave range).
      slot.light.visible = k < count;
      const power = slot.source >= 0 ? this.sources[slot.source].power : 0;
      slot.light.intensity = NIGHT_GLOW.candela * Math.min(power, 2.5) * amount * slot.level;
    }
  }

  dispose() {
    this.texture?.dispose();
    for (const { light } of this.slots) light.dispose();
    this.root.removeFromParent();
    this.root.clear();
  }
}

/** Splat the sources into a half-float map: rgb = summed wash (linear),
 * a = light-weighted top of the sources (m). */
function bake(
  sources: readonly GlowSource[],
  x0: number,
  z0: number,
  texel: number,
  w: number,
  h: number,
) {
  const rgb = new Float32Array(w * h * 3);
  const top = new Float32Array(w * h);
  const weight = new Float32Array(w * h);
  const colour = new T.Color();
  const core2 = NIGHT_GLOW.core * NIGHT_GLOW.core;
  for (const g of sources) {
    colour.setHex(g.color); // linear working space
    const lum = 0.2126 * colour.r + 0.7152 * colour.g + 0.0722 * colour.b;
    // Coloured light reads more saturated on the walls than the lit face
    // itself, which clips toward white (014, 069).
    const sat = NIGHT_GLOW.saturation;
    colour.setRGB(
      Math.max(0, lum + (colour.r - lum) * sat),
      Math.max(0, lum + (colour.g - lum) * sat),
      Math.max(0, lum + (colour.b - lum) * sat),
      T.LinearSRGBColorSpace,
    );
    const R = g.reach,
      ex = g.bx - g.ax,
      ez = g.bz - g.az,
      len2 = ex * ex + ez * ez;
    const ix0 = Math.max(0, Math.floor((Math.min(g.ax, g.bx) - R - x0) / texel)),
      ix1 = Math.min(w - 1, Math.ceil((Math.max(g.ax, g.bx) + R - x0) / texel)),
      iz0 = Math.max(0, Math.floor((Math.min(g.az, g.bz) - R - z0) / texel)),
      iz1 = Math.min(h - 1, Math.ceil((Math.max(g.az, g.bz) + R - z0) / texel));
    for (let iz = iz0; iz <= iz1; iz++) {
      const pz = z0 + (iz + 0.5) * texel;
      for (let ix = ix0; ix <= ix1; ix++) {
        const px = x0 + (ix + 0.5) * texel;
        let t = len2 > 1e-6 ? ((px - g.ax) * ex + (pz - g.az) * ez) / len2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = px - (g.ax + ex * t),
          dz = pz - (g.az + ez * t),
          d2 = dx * dx + dz * dz;
        if (d2 >= R * R) continue;
        const f = 1 - d2 / (R * R);
        const k = (g.power / (1 + d2 / core2)) * f * f;
        const i = iz * w + ix;
        rgb[i * 3] += colour.r * k;
        rgb[i * 3 + 1] += colour.g * k;
        rgb[i * 3 + 2] += colour.b * k;
        // Weighted by k^2: the dominant nearby face sets the height the
        // wash reaches (a tall banner does not lift its neighbours' light).
        top[i] += g.y1 * k * k * lum;
        weight[i] += k * k * lum;
      }
    }
  }
  const data = new Uint16Array(w * h * 4);
  const half = T.DataUtils.toHalfFloat;
  for (let i = 0; i < w * h; i++) {
    // Soft-saturate the sum so a pile of signs cannot blow a wall out.
    for (let c = 0; c < 3; c++) {
      const v = rgb[i * 3 + c] * NIGHT_GLOW.gain;
      data[i * 4 + c] = half(v / (1 + v * 0.35));
    }
    data[i * 4 + 3] = half(weight[i] > 0 ? top[i] / weight[i] : -1000);
  }
  const texture = new T.DataTexture(data, w, h, T.RGBAFormat, T.HalfFloatType);
  texture.minFilter = T.LinearFilter;
  texture.magFilter = T.LinearFilter;
  texture.wrapS = texture.wrapT = T.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.colorSpace = T.NoColorSpace;
  texture.needsUpdate = true;
  texture.name = 'Festival night glow';
  return texture;
}
