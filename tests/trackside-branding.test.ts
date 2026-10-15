import { afterEach, describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { Track, trackPoint } from '../src/simulation/track.ts';
import {
  ATLAS,
  COLOURWAYS,
  LED_SHARE,
  PANELS,
  SPAN_METRES,
  TRACKSIDE_BRANDS,
  brandingPlan,
} from '../src/rendering/studio/branding-plan.ts';
import {
  BRIDGES,
  CHUNK_METRES,
  LED,
  VINYL,
  brandLedUniforms,
  buildTracksideBranding,
  setBrandLedLighting,
  drawBrandingAtlas,
  vinylModules,
} from '../src/rendering/studio/trackside-branding.ts';
import { BRANDS } from '../src/rendering/studio/brand-atlas.ts';
import { guardrailRole } from '../src/rendering/steel-guardrails.ts';
import { impactBarrierRole } from '../src/rendering/impact-barriers.ts';
import type { StudioShader } from '../src/rendering/studio/shader-hooks.ts';

/** P19: the only words allowed in trackside textures. */
const P19 = [
  'VOLTEX',
  'NORDFIN',
  'KESTREL TIME',
  'HALCYON AIR',
  'ORBITEL',
  'MERIDIAN OIL',
  'AUREL BANK',
  'VANTA',
  'NORTHLINE',
  'OBSIDIAN',
];

function recordingCanvas() {
  const calls: string[] = [];
  const context = new Proxy({} as Record<string, unknown>, {
    get(target, key: string) {
      if (key in target) return target[key];
      if (key.startsWith('create')) return () => ({ addColorStop() {} });
      return (...args: unknown[]) => calls.push(`${key}:${args.map(String).join(',')}`);
    },
    set(target, key: string, value) {
      target[key] = value;
      return true;
    },
  });
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  });
  return { calls, context: context as unknown as CanvasRenderingContext2D };
}
afterEach(() => vi.unstubAllGlobals());

describe('sponsor plan', () => {
  const track = new Track();
  const spans = brandingPlan(track.length);
  it('covers both sides of the lap with 80-150 m spans, never the same sponsor twice in a row', () => {
    expect(brandingPlan(track.length)).toEqual(spans);
    for (const side of [-1, 1]) {
      const list = spans.filter((s) => s.side === side);
      expect(list[0].start).toBe(0);
      expect(list[list.length - 1].end).toBe(track.length);
      list.forEach((span, i) => {
        const length = span.end - span.start;
        expect(length).toBeGreaterThanOrEqual(SPAN_METRES.min - 1e-9);
        expect(length).toBeLessThanOrEqual(SPAN_METRES.max + SPAN_METRES.min);
        if (i) {
          expect(span.start).toBe(list[i - 1].end);
          expect(span.panel.brand).not.toBe(list[i - 1].panel.brand);
        }
      });
    }
    const led = spans.filter((s) => s.led).length / spans.length;
    expect(led).toBeGreaterThan(LED_SHARE * 0.3);
    expect(led).toBeLessThan(LED_SHARE * 2.5);
  });

  it('uses only P19 brands and the house colourways', () => {
    expect([...TRACKSIDE_BRANDS].sort()).toEqual([...P19].sort());
    for (const brand of BRANDS) expect([...P19, 'APEX CORSA', 'SLICK 18']).toContain(brand);
    const used = new Set(PANELS.filter((p) => p.brand).map((p) => p.brand));
    expect(used.size).toBe(P19.length);
    for (const p of PANELS) expect(COLOURWAYS).toContain(p.colourway);
    // Each brand appears on two different colourways.
    for (const brand of P19) {
      const ways = new Set(PANELS.filter((p) => p.brand === brand).map((p) => p.colourway.name));
      expect(ways.size).toBe(2);
    }
    expect(PANELS).toHaveLength(
      (ATLAS.width / ATLAS.panelWidth) * (ATLAS.height / ATLAS.panelHeight),
    );
  });

  it('draws every atlas word from the P19 list', () => {
    const { calls, context } = recordingCanvas();
    drawBrandingAtlas(context);
    // Background fills for every panel, and strokes for the branded ones.
    expect(calls.filter((c) => c.startsWith('fillRect')).length).toBeGreaterThanOrEqual(
      PANELS.length,
    );
    expect(calls.some((c) => c.startsWith('stroke'))).toBe(true);
    expect(calls.some((c) => c.startsWith('fillText'))).toBe(false);
  });
});

describe('barrier vinyl and bridges', () => {
  const track = new Track();
  const skip = (s: number, side: number) =>
    !!(guardrailRole(s, side) || impactBarrierRole(s, side));
  it('lines every concrete run outside the guardrail and impact spans', () => {
    const modules = vinylModules(track, skip);
    for (const m of modules) expect(skip((m.a + m.b) / 2, m.span.side)).toBe(false);
    // All concrete metres carry vinyl.
    let concrete = 0,
      covered = 0;
    for (const side of [-1, 1])
      for (let s = 1; s < track.length; s += 2) if (!skip(s, side)) concrete++;
    for (const m of modules) covered += (m.b - m.a) / 2;
    expect(covered / concrete).toBeGreaterThan(0.97);
  });

  it('builds about ten merged vinyl draws plus two bridges, in front of the barrier face', () => {
    recordingCanvas();
    const root = new T.Group();
    const built = buildTracksideBranding(track, root, skip);
    const vinyl = built.meshes.filter((m) => m.name.startsWith('Sponsor barrier vinyl'));
    expect(vinyl.length).toBeLessThanOrEqual(Math.ceil(track.length / CHUNK_METRES));
    expect(built.meshes.length - vinyl.length).toBe(BRIDGES.stations.length);
    expect(built.meshes.length).toBeLessThanOrEqual(24);
    expect(built.coverage).toBeGreaterThan(0.8);
    for (const mesh of vinyl) {
      expect(mesh.castShadow).toBe(false);
      expect(mesh.layers.isEnabled(5)).toBe(true);
    }
    // The first vinyl vertex sits 6 mm proud of the barrier's base face.
    const g = vinyl[0].geometry;
    const p = new T.Vector3().fromBufferAttribute(
      g.getAttribute('position') as T.BufferAttribute,
      0,
    );
    const nearest = trackPoint();
    const l = track.nearest(p.x, p.z, nearest);
    const outward = Math.abs(l) - track.boundary(nearest.s, Math.sign(l));
    expect(outward).toBeCloseTo(-VINYL.profile[0][0], 2);
    // Every vinyl face looks at the track (front faces are drawn, backs culled).
    for (const mesh of vinyl) {
      const position = mesh.geometry.getAttribute('position') as T.BufferAttribute;
      const index = mesh.geometry.index!;
      const a = new T.Vector3(),
        b = new T.Vector3(),
        c = new T.Vector3(),
        q = trackPoint();
      for (let i = 0; i < index.count; i += 30) {
        a.fromBufferAttribute(position, index.getX(i));
        b.fromBufferAttribute(position, index.getX(i + 1));
        c.fromBufferAttribute(position, index.getX(i + 2));
        const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
        const centre = a.clone().add(b).add(c).divideScalar(3);
        track.nearest(centre.x, centre.z, q);
        const toTrack = new T.Vector3(q.x - centre.x, 0, q.z - centre.z).normalize();
        expect(normal.dot(toTrack)).toBeGreaterThan(0.3);
      }
    }
    // Material: atlas panel per vertex, LED glow and scroll from presented time only.
    const material = vinyl[0].material as T.MeshStandardMaterial;
    const shader = {
      uniforms: T.UniformsUtils.clone(T.ShaderLib.standard.uniforms),
      vertexShader: T.ShaderLib.standard.vertexShader,
      fragmentShader: T.ShaderLib.standard.fragmentShader,
    } as unknown as StudioShader;
    material.onBeforeCompile(shader, {} as T.WebGLRenderer);
    expect(shader.fragmentShader).toContain('textureGrad( map, atlasUv');
    expect(shader.fragmentShader).toContain('boardUv.x += vBrandLed * studioTime');
    expect(material.roughness).toBe(0.7);
    // LED boards are displays: wordmark colour as emission of a filtered
    // matrix on a dark glossy face, gain set by the lighting, not albedo x 2.5.
    expect(shader.uniforms.brandLedGain).toBe(brandLedUniforms.brandLedGain);
    expect(shader.fragmentShader).toContain('totalEmissiveRadiance += apexLedEmission;');
    expect(shader.fragmentShader).toContain(`vec3( ${LED.substrate.toFixed(3)} ), vBrandLed`);
    expect(shader.fragmentShader).not.toContain('2.50 * diffuseColor.rgb');
    setBrandLedLighting('night');
    expect(brandLedUniforms.brandLedGain.value).toBe(LED.gain.night);
    setBrandLedLighting('day');
    expect(brandLedUniforms.brandLedGain.value).toBeLessThanOrEqual(0.9);
    expect(LED.gain.night).toBeGreaterThan(LED.gain.day * 2);
  });
});
