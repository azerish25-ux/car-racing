import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { Track } from '../src/simulation/track.ts';
import { CIRCUITS } from '../src/simulation/circuits.ts';
import {
  KERB_STYLES,
  RUNOFF_STYLES,
  kerbStyleAt,
  runoffStyleAt,
} from '../src/rendering/venue-plan.ts';
import {
  KERB,
  KERB_HOOK,
  RUNOFF,
  RUNOFF_HOOK,
  installKerbFinish,
  installRunoffFinish,
  kerbUsage,
} from '../src/rendering/studio/kerb-runoff-finish.ts';
import { installCircuitFinish } from '../src/rendering/circuit-finish.ts';
import { studioHookKeys, type StudioShader } from '../src/rendering/studio/shader-hooks.ts';

const compile = (m: T.Material) => {
  const shader = {
    uniforms: T.UniformsUtils.clone(T.ShaderLib.standard.uniforms),
    vertexShader: T.ShaderLib.standard.vertexShader,
    fragmentShader: T.ShaderLib.standard.fragmentShader,
  } as unknown as StudioShader;
  m.onBeforeCompile(shader, {} as T.WebGLRenderer);
  return shader;
};
const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

describe('kerb and run-off plan', () => {
  for (const circuit of [CIRCUITS.aurel, CIRCUITS.vellamar]) {
    const track = new Track('clear', false, undefined, circuit);
    it(`${circuit.id}: red/white by default, one blue complex and one yellow/green corner`, () => {
      const seen = new Set<number>();
      for (let s = 0; s < track.length; s += 5) seen.add(kerbStyleAt(track, s));
      expect([...seen].sort()).toEqual([0, 1, 2]);
      const corners = circuit.corners;
      expect(KERB_STYLES[kerbStyleAt(track, corners[1].s)]).toBe('blue-white');
      expect(KERB_STYLES[kerbStyleAt(track, corners[3].s)]).toBe('yellow-green');
      expect(KERB_STYLES[kerbStyleAt(track, corners[0].s)]).toBe('red-white');
      // Straights stay red/white with green run-off bands.
      const mid = (corners[0].s + corners[1].s) / 2;
      if (corners[1].s - corners[0].s > 400) {
        expect(kerbStyleAt(track, mid)).toBe(0);
        expect(RUNOFF_STYLES[runoffStyleAt(track, mid)]).toBe('green');
      }
      const runoff = new Set<number>();
      for (let s = 0; s < track.length; s += 5) runoff.add(runoffStyleAt(track, s));
      expect(runoff.has(4)).toBe(true); // astroturf somewhere
      expect(runoff.size).toBeGreaterThanOrEqual(4);
    });
  }

  it('weights kerb rubber by how close the racing line runs', () => {
    expect(kerbUsage(0)).toBe(1);
    expect(kerbUsage(1.2)).toBeCloseTo(Math.exp(-1), 10);
    expect(kerbUsage(5)).toBeLessThan(1e-7);
    expect(kerbUsage(NaN)).toBe(0);
  });
});

describe('kerb and run-off finishes', () => {
  it('paints P9 kerbs: 1.1 m stripes, ridges by normal, rubber and wear', () => {
    expect(KERB.pair).toBe(2.2);
    // TEST-UPDATE (photoreal pass): real kerb paint, not ink-pure red and paper
    // white. The red keeps a little green/blue; the white sits near 0.6 linear.
    expect(hex(KERB.colours[0][0])).toBe('#a82a26');
    expect(hex(KERB.colours[0][1])).toBe('#cfccc3');
    expect(hex(KERB.colours[1][0])).toBe('#2c4a86');
    expect(KERB.colours[2].map(hex)).toEqual(['#c9a53a', '#3f6e4c']);
    const red = new T.Color(KERB.colours[0][0]),
      white = new T.Color(KERB.colours[0][1]);
    expect(red.g).toBeGreaterThan(0.015);
    expect(red.r).toBeLessThan(0.45);
    expect(white.r).toBeLessThan(0.66);
    expect(white.r).toBeGreaterThan(0.55);
    expect(KERB.wearFloor).toBeGreaterThanOrEqual(0.15);
    expect(KERB.wearFloor).toBeLessThanOrEqual(0.2);
    const kerb = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    installCircuitFinish(kerb, 'kerb');
    expect(installKerbFinish(kerb)).toBe(true);
    expect(installKerbFinish(kerb)).toBe(false);
    expect(studioHookKeys(kerb)).toEqual([KERB_HOOK]);
    const shader = compile(kerb);
    expect(kerb.vertexColors).toBe(false);
    expect(shader.vertexShader).toContain('attribute float kerbStyle;');
    const f = shader.fragmentShader;
    expect(f).toContain('float stripePhase = vFinishMetres.y / 2.2000;');
    expect(f).toContain(
      'apexStripeCoverage( stripePhase + stripeWaver, max( fwidth( stripePhase ), 0.0055 ), .25 )',
    );
    // Every kerb carries some rubber; dust settles in the ridge troughs.
    expect(f).toContain('float kerbUse = max( vKerbUsage, 0.1800 );');
    expect(f).toContain('float dustTrough =');
    // TEST-UPDATE (KPI 11 iteration): rougher paint, less sky sheen on the red.
    expect(f).toContain('roughnessFactor = mix( 0.8200, 0.9200, kerbWear );');
    expect(f).toContain('normal = apexReliefNormal(');
    // The circuit finish (chips, joints) still runs after the paint.
    expect(f.indexOf('D15 kerb paint')).toBeLessThan(f.indexOf('float jointPhase'));
    // The construction detail is no longer erased at color_fragment.
    expect(f.slice(f.indexOf('#include <color_fragment>'))).not.toContain(
      'diffuseColor.rgb = kerbPaint;',
    );
    expect(shader.uniforms.apexEdgeLapLength.value).toBe(3600);
  });

  it('paints the run-off with bands, chevrons, astroturf and soil seams, without the old tint', () => {
    const runoff = new T.MeshStandardMaterial({ color: 0x8aa58d });
    installCircuitFinish(runoff, 'paint');
    installRunoffFinish(runoff);
    expect(runoff.color.getHex()).toBe(0xffffff);
    expect(studioHookKeys(runoff)).toEqual([RUNOFF_HOOK]);
    const f = compile(runoff).fragmentShader;
    expect(f).toContain('D15 run-off');
    expect(f).toContain('if ( style == 4 )');
    expect(RUNOFF.bands.map(hex)).toEqual(['#3f6e4c', '#a03a33', '#34548c', '#c4a244']);
    expect(hex(RUNOFF.base)).toBe('#6f6c68');
    expect(hex(RUNOFF.turf)).toBe('#3f7f50');
    expect(RUNOFF.band[1] - RUNOFF.band[0]).toBeGreaterThanOrEqual(1.5);
    expect(RUNOFF.band[1] - RUNOFF.band[0]).toBeLessThanOrEqual(2);
  });
});
