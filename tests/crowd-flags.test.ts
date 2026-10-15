import { describe, expect, it } from 'vitest';
import * as T from 'three';
import {
  CLOTH_ALBEDO_MAX,
  COHORT_SHARE,
  CROWD_FLAG_COLOURS,
  CROWD_NEUTRALS,
  CROWD_PALETTE,
  CROWD_TEAM_COLOURS,
  CROWD_TEAM_KITS,
  FLAG_EVERY,
  FLAG_RANGE,
  buildCrowdFlags,
  crowdColour,
  flagGeometry,
  flagMaterial,
  fanColour,
  TEAM_SHARE,
} from '../src/rendering/studio/crowd-flags.ts';
import { studioUniforms } from '../src/rendering/studio/studio-frame.ts';
import type { StudioShader } from '../src/rendering/studio/shader-hooks.ts';

describe('crowd palette', () => {
  it('is mostly dark everyday clothing with muted team kit in small cohorts', () => {
    expect(CROWD_TEAM_KITS.map((c) => c.toString(16).padStart(6, '0'))).toEqual([
      'c8102e',
      'ff8000',
      '1e3a8a',
      'f2f2f2',
      '0b6e4f',
      'ffd200',
      '111111',
      'e5007d',
    ]);
    expect(CROWD_PALETTE).toHaveLength(CROWD_TEAM_COLOURS.length + CROWD_NEUTRALS.length);
    const lin = (hex: number) => new T.Color().setHex(hex);
    const sat = (c: T.Color) => {
      const hi = Math.max(c.r, c.g, c.b),
        lo = Math.min(c.r, c.g, c.b);
      return hi > 0 ? (hi - lo) / hi : 0;
    };
    // Shirts: dyed cotton, never above 0.55 linear, 40 % less saturated.
    CROWD_TEAM_COLOURS.forEach((c, i) => {
      const shirt = lin(c),
        kit = lin(CROWD_TEAM_KITS[i]);
      expect(Math.max(shirt.r, shirt.g, shirt.b)).toBeLessThanOrEqual(CLOTH_ALBEDO_MAX + 0.01);
      if (sat(kit) > 0.2) expect(sat(shirt)).toBeLessThan(sat(kit) - 0.05);
    });
    for (const c of CROWD_FLAG_COLOURS) {
      const flag = lin(c);
      expect(Math.max(flag.r, flag.g, flag.b)).toBeLessThanOrEqual(0.71);
    }
    for (const n of [0x1c1c1e, 0x1f2a40, 0x3a4f6e, 0xc4c2bc]) expect(CROWD_NEUTRALS).toContain(n);
    expect(fanColour(0xffffff)).toBe(new T.Color().setRGB(0.55, 0.55, 0.55).getHex());
    let team = 0,
      dark = 0,
      white = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const c = crowdColour((i * 0.618034) % 1, (i * 0.414214) % 1);
      expect(CROWD_PALETTE).toContain(c);
      if ((CROWD_TEAM_COLOURS as readonly number[]).includes(c)) team++;
      else {
        const l = lin(c);
        if (0.2126 * l.r + 0.7152 * l.g + 0.0722 * l.b < 0.08) dark++;
        if (c === 0xc4c2bc) white++;
      }
    }
    expect(team / N).toBeGreaterThan(TEAM_SHARE - 0.04);
    expect(team / N).toBeLessThan(TEAM_SHARE + 0.04);
    expect(TEAM_SHARE).toBeLessThanOrEqual(0.25);
    // Most of the neutral picks are dark; white tees about one in ten.
    expect(dark / (N - team)).toBeGreaterThan(0.6);
    expect(white / (N - team)).toBeGreaterThan(0.07);
    expect(white / (N - team)).toBeLessThan(0.15);
    expect(COHORT_SHARE).toBe(0.35);
  });
});

describe('crowd flags', () => {
  it('gives every 13th spectator a waving team flag, in one instanced draw', () => {
    const people = Array.from({ length: 260 }, (_, i) =>
      new T.Matrix4().makeTranslation(i * 0.65, 0, 0),
    );
    const material = flagMaterial();
    const flags = buildCrowdFlags(people, 55, material)!;
    expect(flags).toBeInstanceOf(T.InstancedMesh);
    expect(flags.count).toBe(260 / FLAG_EVERY);
    expect(flags.castShadow).toBe(false);
    for (let i = 0; i < flags.count; i++) {
      const c = new T.Color();
      flags.getColorAt(i, c);
      expect(CROWD_FLAG_COLOURS as readonly number[]).toContain(c.getHex());
    }
    expect(buildCrowdFlags([], 1, material)).toBeNull();
    const g = flagGeometry();
    expect(g.getAttribute('flagFly').count).toBe(g.getAttribute('position').count);
    const shader = {
      uniforms: T.UniformsUtils.clone(T.ShaderLib.standard.uniforms),
      vertexShader: T.ShaderLib.standard.vertexShader,
      fragmentShader: T.ShaderLib.standard.fragmentShader,
    } as unknown as StudioShader;
    material.onBeforeCompile(shader, {} as T.WebGLRenderer);
    expect(shader.uniforms.studioTime).toBe(studioUniforms.studioTime);
    expect(shader.vertexShader).toContain('D21 flag wave');
    expect(shader.vertexShader).toContain(`> ${FLAG_RANGE.toFixed(1)} )`);
  });
});
