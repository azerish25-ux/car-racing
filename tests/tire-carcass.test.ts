import { expect, it } from 'vitest';
import * as T from 'three';
import { TireCarcass, tireDeflection } from '../src/rendering/tire-carcass.ts';
function fixture() {
  const tread = new T.MeshStandardMaterial(),
    markings = new T.MeshBasicMaterial();
  const tire = new TireCarcass(0.155, tread, markings);
  const meshes = tire.root.children as T.Mesh[];
  const original = meshes.map((m) => Float32Array.from(m.geometry.getAttribute('position').array));
  const dispose = () => {
    for (const m of meshes) m.geometry.dispose();
    tread.dispose();
    markings.dispose();
  };
  return { tire, meshes, original, dispose };
}
it('load/pressure deflection is monotonic, bounded, and leaves clearance above a fixed rim', () => {
  expect(tireDeflection(0.335, 0, 155)).toBe(0);
  expect(tireDeflection(0.335, 2000, 155)).toBeLessThan(tireDeflection(0.335, 5000, 155));
  expect(tireDeflection(0.335, 3000, 120)).toBeGreaterThan(tireDeflection(0.335, 3000, 200));
  expect(tireDeflection(0.335, 1e9, 12)).toBe(0.022);
  expect(tireDeflection(0.258, 5000, 12)).toBeLessThan(0.007);
});
it.each([0, 0.17, 1.3, Math.PI, 20.7, -5.1])(
  'the contact patch stays under the axle at wheel phase %f',
  (phase) => {
    const { tire, meshes, original, dispose } = fixture();
    try {
      tire.update(phase, 0.335, 7000, 155);
      let lowest = Infinity,
        flatVertices = 0,
        crown = 0;
      meshes.forEach((m, n) => {
        const position = m.geometry.getAttribute('position'),
          normals = m.geometry.getAttribute('normal');
        for (let i = 0; i < position.count; i++) {
          const x = position.getX(i),
            y = position.getY(i),
            z = position.getZ(i),
            axleY = y * Math.cos(phase) - z * Math.sin(phase),
            oldRadial = Math.hypot(original[n][i * 3 + 1], original[n][i * 3 + 2]);
          lowest = Math.min(lowest, axleY);
          crown = Math.max(crown, axleY);
          if (Math.abs(axleY + 0.335) < 1e-6) flatVertices++;
          expect([x, y, z].every(Number.isFinite)).toBe(true);
          expect(Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i))).toBeCloseTo(1, 4);
          expect(Math.hypot(y, z)).toBeGreaterThanOrEqual(0.24499);
          if (oldRadial < 0.24501) {
            expect(x).toBeCloseTo(original[n][i * 3], 6);
            expect(y).toBeCloseTo(original[n][i * 3 + 1], 6);
            expect(z).toBeCloseTo(original[n][i * 3 + 2], 6);
          }
        }
      });
      expect(lowest).toBeCloseTo(-0.335, 6);
      expect(flatVertices).toBeGreaterThan(2);
      expect(crown).toBeGreaterThan(0.345);
    } finally {
      dispose();
    }
  },
);
it('puncture changes rubber but preserves bead radius; replay rewinds are history independent', () => {
  const { tire, meshes, dispose } = fixture();
  try {
    tire.update(0.4, 0.258, 3000, 12, 0.5);
    const punctured = meshes.map((m) =>
      Float32Array.from(m.geometry.getAttribute('position').array),
    );
    for (let i = 0; i < 20; i++) tire.update(i, 0.335, 2000 + i * 100, 160, 0);
    tire.update(0.4, 0.258, 3000, 12, 0.5);
    meshes.forEach((m, i) =>
      expect(m.geometry.getAttribute('position').array).toEqual(punctured[i]),
    );
    const versions = meshes.map(
      (m) => (m.geometry.getAttribute('position') as T.BufferAttribute).version,
    );
    tire.update(0.4, 0.258, 3000, 12, 0.5);
    expect(
      meshes.map((m) => (m.geometry.getAttribute('position') as T.BufferAttribute).version),
    ).toEqual(versions);
    expect(() => tire.update(NaN, 0.335, 1, 155)).toThrow('Non-finite');
  } finally {
    dispose();
  }
});
it.each([0, 0.83, 2.9, -4.4])(
  'the allocation-free deformation is bit-identical to the reference at phase %f',
  (phase) => {
    const { tire, meshes, original, dispose } = fixture();
    try {
      const radius = 0.334,
        load = 6500,
        pressure = 150;
      tire.update(phase, radius, load, pressure);
      const BEAD = 0.245,
        NOMINAL = 0.335,
        deflection = tireDeflection(radius, load, pressure),
        free = radius + deflection,
        sn = Math.sin(phase),
        cs = Math.cos(phase);
      meshes.forEach((m, n) => {
        // Reference: the per-vertex formula and three's computeVertexNormals.
        const reference = new T.BufferGeometry();
        reference.setIndex(m.geometry.index);
        const p = new Float32Array(original[n].length);
        for (let i = 0; i < p.length / 3; i++) {
          const x = original[n][3 * i],
            y = original[n][3 * i + 1],
            z = original[n][3 * i + 2],
            radial = Math.hypot(y, z),
            weight = Math.min(1, Math.max(0, (radial - BEAD) / (NOMINAL - BEAD))),
            scale = 1 + ((free - NOMINAL) * weight) / Math.max(BEAD, radial),
            rollingY = (y * cs - z * sn) * scale,
            rollingZ = (y * sn + z * cs) * scale,
            bottom = Math.max(rollingY, -radius),
            bulge = Math.max(0, -rollingY / Math.max(0.01, free)) ** 4 * weight * deflection * 0.35;
          p[3 * i] = x + Math.sign(x) * bulge;
          p[3 * i + 1] = bottom * cs + rollingZ * sn;
          p[3 * i + 2] = -bottom * sn + rollingZ * cs;
        }
        reference.setAttribute('position', new T.BufferAttribute(p, 3));
        reference.computeVertexNormals();
        expect(Array.from(m.geometry.getAttribute('position').array)).toEqual(Array.from(p));
        // Seam vertices are re-averaged afterwards; every other normal is three's.
        const keyOf = (i: number) =>
          `${Math.round(original[n][i * 3] * 1e6)},${Math.round(original[n][i * 3 + 1] * 1e6)},${Math.round(original[n][i * 3 + 2] * 1e6)}`;
        const shared = new Map<string, number>();
        for (let i = 0; i < p.length / 3; i++)
          shared.set(keyOf(i), (shared.get(keyOf(i)) ?? 0) + 1);
        const normal = m.geometry.getAttribute('normal'),
          expected = reference.getAttribute('normal');
        let compared = 0;
        for (let i = 0; i < p.length / 3; i++) {
          if (shared.get(keyOf(i))! > 1) continue;
          expect([normal.getX(i), normal.getY(i), normal.getZ(i)]).toEqual([
            expected.getX(i),
            expected.getY(i),
            expected.getZ(i),
          ]);
          compared++;
        }
        expect(compared).toBeGreaterThan(0);
      });
    } finally {
      dispose();
    }
  },
);
