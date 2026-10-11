import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as T from 'three';
import { CHASE, TCAM_PITCH } from '../src/rendering/renderer.ts';
import { COCKPIT_FRAMING, TCAM_FOV, tcamFov } from '../src/rendering/cockpit-framing.ts';
import { COCKPIT_FOV, graphicsPreset } from '../src/rendering/options.ts';
import {
  SUN_OFFSET,
  SUNSET_OFFSET,
  circuitLightState,
  daylightState,
} from '../src/rendering/daylight.ts';
import { skyLight } from '../src/rendering/sky-light.ts';
import { COMPOUNDS, LIVERIES } from '../src/simulation/config.ts';
import { KERB } from '../src/rendering/studio/kerb-runoff-finish.ts';
import { bloomStrength } from '../src/rendering/studio/lens-effects.ts';
import { BRANDS } from '../src/rendering/studio/brand-atlas.ts';

/**
 * Studio look contracts (D33 qa-signoff): the producer decisions P1-P12 and
 * P19 of docs/studio/PRODUCTION_PLAN.md section 1, pinned in one place so a
 * later change to any of them is a deliberate, visible test update.
 */
const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
const saturation = (c: number) => {
  const r = (c >> 16) & 255,
    g = (c >> 8) & 255,
    b = c & 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  return max ? (max - min) / max : 0;
};

describe('studio look contracts', () => {
  it('P1/P2: day sun at 50 degrees, golden hour near 10 degrees', () => {
    expect(SUN_OFFSET.toArray()).toEqual([-140, 235, -115]);
    expect(SUNSET_OFFSET.toArray()).toEqual([-215, 45, -150]);
    const elevation = (v: T.Vector3) => (Math.asin(v.y / v.length()) * 180) / Math.PI;
    // P1's vector itself sits at 52.4 degrees, inside AB-A's measured 50-58.
    expect(elevation(SUN_OFFSET)).toBeGreaterThanOrEqual(50);
    expect(elevation(SUN_OFFSET)).toBeLessThan(53);
    expect(Math.abs(elevation(SUNSET_OFFSET) - 10)).toBeLessThan(1.5);
  });

  it('P3: diffuse environment, hemisphere and sun follow cover', () => {
    for (const cover of [0, 0.5, 1]) {
      const light = daylightState(cover, 0);
      // The PMREM is the physical dome at full share; the fill rises with
      // cover; the key is the sun through the atmosphere, dimmed by cloud.
      expect(light.environment).toBe(1);
      expect(light.fill).toBeCloseTo(0.06 + 0.2 * cover, 10);
      expect(light.sun).toBeCloseTo(
        skyLight(cover, 'day').sunIrradiance * (1 - 0.94 * cover ** 1.45),
        10,
      );
    }
  });

  it('P5-P7: chase, cockpit and T-cam framing', () => {
    // P5's own numbers (1.65 m, 4.9 m, lookAhead 13, lift 0.4) framed the car
    // at ~31 % of the width, short of P5's binding 36-42 % (PSQ036); the
    // KPI iteration (e83ec1f) matched the reference geometry instead.
    expect(CHASE).toMatchObject({
      fov: 50,
      fovGain: 4,
      distance: 4.5,
      height: 1.3,
      lookAhead: 10,
      lookLift: -0.25,
    });
    expect(COCKPIT_FOV).toEqual({ default: 54, min: 44, max: 70 });
    expect(COCKPIT_FRAMING.eyeOffset).toEqual([0, -0.03, -0.04]);
    expect(TCAM_PITCH).toBe(-0.075);
    expect(TCAM_FOV).toEqual({ base: 58, gain: 0.05, max: 4 });
    expect(tcamFov(200)).toBe(62);
  });

  it('P8: compound colours', () => {
    expect(Object.values(COMPOUNDS).map((c) => hex(c.color))).toEqual([
      '#e2262f',
      '#f5c400',
      '#f2f2ee',
      '#2bb04a',
      '#0a6fd0',
    ]);
  });

  it('P9: 1.1 m kerb stripes rendering #c4222a / #ecebe6', () => {
    expect(KERB.width).toBe(1.1);
    expect(KERB.pair).toBe(2.2);
    // The albedo #bc0a14 renders P9's #c4222a in the day sun (KPI 11).
    expect(KERB.colours[0].map(hex)).toEqual(['#bc0a14', '#ecebe6']);
  });

  it('P10/P11/P12: motion blur, bloom and haze', () => {
    expect(graphicsPreset('low').motionBlur).toBe(0);
    expect(graphicsPreset('medium').motionBlur).toBe(0.35);
    expect(graphicsPreset('high').motionBlur).toBe(0.5);
    expect([
      bloomStrength('day', 0),
      bloomStrength('sunset', 0),
      bloomStrength('night', 0),
    ]).toEqual([0.45, 0.55, 0.8]);
    expect(bloomStrength('day', 1)).toBeCloseTo(0.8, 10);
    expect(daylightState(0, 0).fogDensity).toBeCloseTo(0.00055, 10);
    expect(daylightState(1, 0).fogDensity).toBeCloseTo(0.0008, 10);
    expect(circuitLightState(0, 0, 'sunset').fogDensity).toBeCloseTo(0.0006, 4);
    expect(circuitLightState(0, 0, 'night').fogDensity).toBeCloseTo(0.0004, 4);
  });

  it('team liveries stay saturated (vehicle-paint): every colour livery >= 0.45', () => {
    // White, black and silver are the deliberate achromatic schemes.
    const colour = LIVERIES.filter((c) => !['#e9e9eb', '#16181b', '#9ea4aa'].includes(hex(c)));
    expect(colour.length).toBeGreaterThanOrEqual(9);
    for (const c of colour) expect(saturation(c), hex(c)).toBeGreaterThanOrEqual(0.45);
  });

  it('P19: only the fictional brand list appears in the brand atlas and UI strings', () => {
    expect([...BRANDS]).toEqual([
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
      'APEX CORSA',
      'SLICK 18',
    ]);
    // Real sponsor and team marks must never appear in source strings.
    const forbidden =
      /\b(bybit|oracle|red bull|redbull|pirelli|rolex|aramco|heineken|dhl|crypto\.com|petronas|ferrari|mercedes|mclaren|williams|haas|sauber|aston martin|visa cash app|mobil ?1|emirates|lenovo|tag heuer|infinitum|hard rock|honda|ford)\b/i;
    // P13: brand-atlas.ts maps the supplied car's real decal sheet names to
    // fictional marks at runtime; those keys are identifiers, never drawn.
    const replacementMap = join('src', 'rendering', 'studio', 'brand-atlas.ts');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|css|html)$/.test(name)) files.push(path);
      }
    };
    walk('src');
    const hits: string[] = [];
    for (const file of files) {
      if (file === replacementMap) continue;
      const text = readFileSync(file, 'utf8')
        // Comments may name a removed real mark when explaining its replacement.
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      const match = text.match(forbidden);
      if (match) hits.push(`${file}: ${match[0]}`);
    }
    expect(hits).toEqual([]);
  });
});
