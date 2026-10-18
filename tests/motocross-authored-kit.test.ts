import * as T from 'three';
import { describe, expect, it } from 'vitest';
import kit from '../src/rendering/assets/mx-authored-kit.mesh.json';
import { mxAuthoredGeometry, type MxAuthoredPart } from '../src/rendering/offroad/authored-kit.ts';
import { buildMotocrossBoundary, MX_BOUNDARY } from '../src/rendering/offroad/mx-boundary.ts';
import { Stadium } from '../src/rendering/offroad/stadium.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';

const parts: MxAuthoredPart[] = ['torso', 'upper-arm', 'forearm', 'thigh', 'shin', 'safety-pad'];
describe('original Blender-authored motocross kit', () => {
  it.each(parts)(
    '%s has bounded indexed high/mid geometry, unit normals and independently owned buffers',
    (part) => {
      const high = mxAuthoredGeometry(part),
        mid = mxAuthoredGeometry(part, 'mid');
      expect(high.index!.count).toBeGreaterThan(mid.index!.count);
      for (const g of [high, mid]) {
        const p = g.getAttribute('position'),
          n = g.getAttribute('normal'),
          uv = g.getAttribute('uv');
        expect(p.count).toBe(n.count);
        expect(p.count).toBe(uv.count);
        expect(g.index!.count % 3).toBe(0);
        expect(g.boundingSphere!.radius).toBeLessThan(1.25);
        for (const value of p.array) expect(Number.isFinite(value)).toBe(true);
        for (const index of g.index!.array) expect(index).toBeLessThan(p.count);
        for (let i = 0; i < n.count; i++)
          expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 3);
        // Do not import mirrored or mostly inside-out triangles into shadow maps.
        const a = new T.Vector3(),
          b = new T.Vector3(),
          c = new T.Vector3(),
          face = new T.Vector3(),
          avg = new T.Vector3();
        let reversed = 0,
          considered = 0;
        for (let i = 0; i < g.index!.count; i += 3) {
          const ia = g.index!.getX(i),
            ib = g.index!.getX(i + 1),
            ic = g.index!.getX(i + 2);
          a.fromBufferAttribute(p, ia);
          b.fromBufferAttribute(p, ib);
          c.fromBufferAttribute(p, ic);
          face.crossVectors(b.sub(a), c.sub(a));
          if (face.lengthSq() < 1e-16) continue;
          avg
            .fromBufferAttribute(n, ia)
            .add(new T.Vector3().fromBufferAttribute(n, ib))
            .add(new T.Vector3().fromBufferAttribute(n, ic));
          considered++;
          if (face.dot(avg) < 0) reversed++;
        }
        expect(considered).toBeGreaterThan(100);
        expect(reversed).toBe(0);
      }
      const another = mxAuthoredGeometry(part);
      expect(another.getAttribute('position').array).not.toBe(high.getAttribute('position').array);
      high.getAttribute('position').setX(0, 999);
      expect(another.getAttribute('position').getX(0)).not.toBe(999);
      for (const g of [high, mid, another]) g.dispose();
    },
  );

  it('keeps readable, non-mirrored UV orientation on every exterior pad face', () => {
    const pad = mxAuthoredGeometry('safety-pad', 'mid');
    const uv = pad.getAttribute('uv'),
      indices = pad.index!;
    for (let i = 0; i < indices.count; i += 3) {
      const a = indices.getX(i),
        b = indices.getX(i + 1),
        c = indices.getX(i + 2);
      const determinant =
        (uv.getX(b) - uv.getX(a)) * (uv.getY(c) - uv.getY(a)) -
        (uv.getY(b) - uv.getY(a)) * (uv.getX(c) - uv.getX(a));
      expect(determinant).toBeGreaterThan(0);
    }
    pad.dispose();
  });

  it('keeps the collision envelope and bounds the repeated pad cost', () => {
    const pad = mxAuthoredGeometry('safety-pad', 'mid');
    expect(pad.index!.count / 3).toBeLessThanOrEqual(256);
    const size = pad.boundingBox!.getSize(new T.Vector3());
    for (const [observed, expected] of [
      [size.x, MX_BOUNDARY.width],
      [size.y, MX_BOUNDARY.height],
      [size.z, MX_BOUNDARY.length],
    ])
      expect(observed).toBeCloseTo(expected, 5);
    expect(kit.authoring.thirdPartyAssets).toBe(false);
    expect(kit.authoring.source).toBe('authoring/motocross/build_kit.py');
    pad.dispose();
  });

  it.each(['arena-nord-sx', 'valley-ridge-mx'] as const)(
    'uses two shared pad batches with maps, not one draw per pad in %s',
    (circuit) => {
      const root = buildMotocrossBoundary(rigTrack(circuit));
      expect(root.children.length).toBe(2);
      const [a, b] = root.children as T.InstancedMesh<T.BufferGeometry, T.MeshStandardMaterial>[];
      expect(a.geometry).toBe(b.geometry);
      expect(a.geometry.userData.authoring).toBe('authoring/motocross/build_kit.py');
      expect(a.count + b.count).toBeGreaterThan(100);
      for (const mesh of [a, b]) {
        expect(mesh.material.normalMap).toBeInstanceOf(T.Texture);
        expect(mesh.material.roughnessMap).toBeInstanceOf(T.Texture);
        mesh.material.normalMap?.dispose();
        mesh.material.roughnessMap?.dispose();
        mesh.material.map?.dispose();
        mesh.material.dispose();
        mesh.dispose();
      }
      a.geometry.dispose();
    },
  );

  it('adds seated chairs and architecture without extra dynamic lights or exceeding 15 meshes', () => {
    const stadium = new Stadium(rigTrack('arena-nord-sx'));
    const chairs = stadium.root.getObjectByName(
      'Moulded stadium chairs (instanced)',
    ) as T.InstancedMesh;
    expect(chairs.count).toBe(stadium.crowd.count);
    expect(chairs.count).toBeGreaterThan(1000);
    expect(stadium.root.userData.concoursePortals).toBeGreaterThan(10);
    expect(stadium.root.getObjectByName('Arena service walls and acoustic cladding')).toBeTruthy();
    let meshes = 0,
      lights = 0;
    stadium.root.traverse((o) => {
      if (o instanceof T.Mesh) meshes++;
      if (o instanceof T.Light) lights++;
    });
    expect(meshes).toBeLessThanOrEqual(15);
    expect(lights).toBe(0);
    stadium.dispose();
    expect(stadium.root.children).toHaveLength(0);
  });
});
