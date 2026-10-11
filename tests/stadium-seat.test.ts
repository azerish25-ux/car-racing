import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { installStadiumSeat, stadiumSeatGeometry } from '../src/rendering/stadium-seat.ts';

describe('moulded stadium seat', () => {
  it('builds three falling tiers of a closed plastic shell on a pedestal that reaches the tread', () => {
    const tris = [0, 1, 2].map((tier) => {
      const g = stadiumSeatGeometry(tier as 0 | 1 | 2);
      const box = g.boundingBox!;
      // Fits the 0.65 m seat pitch and the 0.98 m row depth; the pedestal
      // stands on the tread 0.3 m below the seat reference.
      expect(box.max.z).toBeLessThan(0.22);
      expect(box.min.z).toBeGreaterThan(-0.22);
      expect(box.min.y).toBeCloseTo(-0.3, 2);
      expect(box.max.y).toBeGreaterThan(0.38);
      expect(box.max.y).toBeLessThan(0.45);
      expect(box.min.x).toBeGreaterThan(-0.24);
      expect(box.max.x).toBeLessThan(0.26);
      const part = g.getAttribute('seatPart');
      const parts = new Set<number>();
      for (let i = 0; i < part.count; i++) parts.add(part.getX(i));
      expect([...parts].sort()).toEqual([0, 1]);
      // The occupant surface faces up in the middle of the pan.
      const p = g.getAttribute('position'),
        n = g.getAttribute('normal');
      let best = -1,
        bestD = Infinity;
      for (let i = 0; i < p.count; i++) {
        const d = Math.hypot(p.getX(i) + 0.03, p.getY(i) - 0.02, p.getZ(i));
        if (part.getX(i) === 0 && d < bestD) {
          bestD = d;
          best = i;
        }
      }
      expect(n.getY(best)).toBeGreaterThan(0.9);
      for (let i = 0; i < n.count; i++)
        expect(new T.Vector3().fromBufferAttribute(n, i).length()).toBeCloseTo(1, 3);
      const count = g.index!.count / 3;
      g.dispose();
      return count;
    });
    expect(tris[0]).toBeLessThanOrEqual(520);
    expect(tris[1]).toBeLessThan(tris[0] * 0.5);
    expect(tris[2]).toBeLessThanOrEqual(60);
    expect(() => stadiumSeatGeometry(3 as 0)).toThrow();
  });
  it('installs one stadium-plastic program variant without textures', () => {
    const m = installStadiumSeat(new T.MeshStandardMaterial());
    expect(installStadiumSeat(m)).toBe(m);
    expect(m.customProgramCacheKey()).toContain('stadium-seat-v1');
    const shader = {
      vertexShader: T.ShaderLib.standard.vertexShader,
      fragmentShader: T.ShaderLib.standard.fragmentShader,
      uniforms: {},
    } as unknown as T.WebGLProgramParametersWithUniforms;
    m.onBeforeCompile(shader, {} as T.WebGLRenderer);
    expect(shader.vertexShader).toContain('attribute float seatPart');
    expect(shader.fragmentShader).toContain(
      'metalnessFactor = mix(metalnessFactor, .75, seatSteel)',
    );
    expect(m.map).toBeNull();
    m.dispose();
  });
});
