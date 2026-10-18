import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { mxAuthoredGeometry, type MxApparelPart } from '../src/rendering/offroad/authored-kit.ts';
import { mouldedPanel } from '../src/rendering/offroad/motocross-detail.ts';
import { mapUnprintedPlateBack } from '../src/rendering/offroad/number-plate-uv.ts';

function minimumFootprint(g: T.BufferGeometry) {
  const p = g.getAttribute('position'),
    uv = g.getAttribute('uv'),
    a = new T.Vector3(),
    b = new T.Vector3(),
    c = new T.Vector3();
  let minimum = Infinity,
    count = 0;
  for (let i = 0; i < (g.index?.count ?? p.count); i += 3) {
    const ia = g.index?.getX(i) ?? i,
      ib = g.index?.getX(i + 1) ?? i + 1,
      ic = g.index?.getX(i + 2) ?? i + 2;
    a.fromBufferAttribute(p, ia);
    b.fromBufferAttribute(p, ib);
    c.fromBufferAttribute(p, ic);
    if (b.sub(a).cross(c.sub(a)).lengthSq() < 1e-24) continue;
    count++;
    const determinant =
      (uv.getX(ib) - uv.getX(ia)) * (uv.getY(ic) - uv.getY(ia)) -
      (uv.getY(ib) - uv.getY(ia)) * (uv.getX(ic) - uv.getX(ia));
    minimum = Math.min(minimum, Math.abs(determinant));
  }
  expect(count).toBeGreaterThan(20);
  return minimum;
}

describe('motocross finite anisotropic texture footprints', () => {
  it.each(['torso', 'upper-arm', 'forearm', 'thigh', 'shin'] as MxApparelPart[])(
    'gives every visible %s triangle, including its caps, a nonzero UV area at both detail levels',
    (part) => {
      for (const detail of ['high', 'mid'] as const) {
        const g = mxAuthoredGeometry(part, detail);
        expect(minimumFootprint(g)).toBeGreaterThan(1e-8);
        g.dispose();
      }
    },
  );

  it('keeps front number graphics, positions and normals unchanged while uncollapsing the reverse and bevels', () => {
    const g = mouldedPanel(
      [
        [-0.138, 0.143],
        [0.138, 0.143],
        [0.155, 0.065],
        [0.119, -0.13],
        [0, -0.167],
        [-0.119, -0.13],
      ],
      0.008,
      0.005,
    );
    const original = g.clone(),
      p = g.getAttribute('position'),
      n = g.getAttribute('normal'),
      uv = g.getAttribute('uv'),
      before = original.getAttribute('uv');
    mapUnprintedPlateBack(g);
    expect(p.array).toEqual(original.getAttribute('position').array);
    expect(n.array).toEqual(original.getAttribute('normal').array);
    expect(g.groups).toEqual(original.groups);
    expect(minimumFootprint(g)).toBeGreaterThan(1e-8);
    let front = 0,
      back = 0;
    for (let i = 0; i < p.count; i++) {
      if (n.getZ(i) >= 0.5) {
        front++;
        expect(uv.getX(i)).toBe(before.getX(i));
        expect(uv.getY(i)).toBe(before.getY(i));
      } else {
        back++;
        expect(uv.getX(i)).toBeGreaterThanOrEqual(4 / 512 - 1e-7);
        expect(uv.getX(i)).toBeLessThanOrEqual(12 / 512 + 1e-7);
        expect(uv.getY(i)).toBeGreaterThanOrEqual(0.36 - 1e-7);
        expect(uv.getY(i)).toBeLessThanOrEqual(0.64 + 1e-7);
      }
    }
    expect(front).toBeGreaterThan(0);
    expect(back).toBeGreaterThan(front);
    original.dispose();
    g.dispose();
  });

  it('rejects shared face vertices rather than overwriting the front graphic through an index', () => {
    const g = new T.BoxGeometry();
    expect(() => mapUnprintedPlateBack(g)).toThrow('separate face corners');
    g.dispose();
  });
});
