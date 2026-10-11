import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import * as T from 'three';
import {
  DriverAsset,
  loadDriverAsset,
  validateDriverDocument,
} from '../src/rendering/driver-asset.ts';
import { DriverRig } from '../src/rendering/driver.ts';
import manifest from '../src/rendering/apx01-driver.manifest.json';
import { studioHookKeys } from '../src/rendering/studio/shader-hooks.ts';

const bytes = new Uint8Array(readFileSync('src/rendering/apx01-driver.glb.gz'));
const raw = new Uint8Array(gunzipSync(bytes));
const doc = () =>
  JSON.parse(
    new TextDecoder().decode(raw.subarray(20, 20 + new DataView(raw.buffer).getUint32(12, true))),
  );
function wheel() {
  const w = new T.Group();
  w.position.set(0, 0.115, 0.22);
  w.rotation.x = 0.12;
  return w;
}
function points(rig: DriverRig) {
  rig.root.updateMatrixWorld(true);
  return rig.skin!.sleeves.map((m) => {
    m.skeleton.update();
    const p = m.geometry.getAttribute('position'),
      v = new T.Vector3(),
      out: number[] = [];
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      m.applyBoneTransform(i, v);
      out.push(v.x, v.y, v.z);
    }
    return out;
  });
}
function clean(rig: DriverRig, w: T.Group) {
  const gs = new Set<T.BufferGeometry>(),
    ms = new Set<T.Material>(),
    ts = new Set<T.Texture>(),
    ss = new Set<T.Skeleton>();
  for (const root of [rig.root, w])
    root.traverse((o) => {
      if (o instanceof T.Mesh) {
        gs.add(o.geometry);
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) ms.add(m);
      }
      if (o instanceof T.SkinnedMesh) ss.add(o.skeleton);
    });
  for (const m of ms) for (const v of Object.values(m)) if (v instanceof T.Texture) ts.add(v);
  gs.forEach((g) => g.dispose());
  ms.forEach((m) => m.dispose());
  ts.forEach((t) => t.dispose());
  ss.forEach((s) => s.dispose());
}
describe('Blender-authored coupled driver', () => {
  it('validates the independent skin contract and both static-host encodings', async () => {
    expect(() => validateDriverDocument(doc())).not.toThrow();
    for (const input of [bytes, raw]) {
      const asset = await DriverAsset.decode(input);
      expect(asset.diagnostics()).toMatchObject({
        loaded: true,
        skinnedSleeves: 2,
        joints: 9,
        sha256: manifest.sha256,
        finalArtApproved: false,
      });
      expect(asset.triangles).toBeLessThan(20000);
      asset.dispose();
      expect(asset.diagnostics().loaded).toBe(false);
    }
  });
  it('rejects external resources, unknown roles, cyclic hierarchies and unbounded skin data', () => {
    for (const mutate of [
      (d: ReturnType<typeof doc>) => {
        d.buffers[0].uri = 'elsewhere.bin';
      },
      (d: ReturnType<typeof doc>) => {
        d.images = [{ uri: 'elsewhere.png' }];
      },
      (d: ReturnType<typeof doc>) => {
        d.nodes[11].children.push(11);
      },
      (d: ReturnType<typeof doc>) => {
        d.nodes[12].extras.apex_character_role = 'unknown';
      },
      (d: ReturnType<typeof doc>) => {
        d.skins[0].joints.pop();
      },
      (d: ReturnType<typeof doc>) => {
        d.accessors[0].count = 10000000;
      },
      (d: ReturnType<typeof doc>) => {
        d.meshes[0].primitives[0].targets = [{}];
      },
    ]) {
      const d = doc();
      mutate(d);
      expect(() => validateDriverDocument(d)).toThrow('driver contract');
    }
  });
  it('fails corrupt, oversized, aborted and HTTP-error assets rather than selecting legacy art', async () => {
    const corrupt = bytes.slice();
    corrupt[120] ^= 1;
    await expect(DriverAsset.decode(corrupt)).rejects.toThrow('integrity');
    const controller = new AbortController();
    controller.abort();
    await expect(DriverAsset.decode(bytes, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    await expect(
      loadDriverAsset(
        () => false,
        vi.fn(async () => new Response('', { status: 404 })) as typeof fetch,
        '/asset',
      ),
    ).rejects.toThrow('HTTP 404');
    await expect(
      loadDriverAsset(
        () => false,
        vi.fn(async () => new Response(new Uint8Array(manifest.bytes + 1))) as typeof fetch,
        '/asset',
      ),
    ).rejects.toThrow('exceeds budget');
    await expect(
      loadDriverAsset(() => true, vi.fn() as typeof fetch, '/asset'),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('keeps continuous sleeves inside their culling envelope through rapid full-lock countersteering and loads', async () => {
    const asset = await DriverAsset.decode(bytes),
      w = wheel(),
      rig = new DriverRig(w, asset);
    asset.dispose();
    const storage = rig.skin!.sleeves.map((m) => m.geometry.getAttribute('position').array);
    const cuffTargets = new Map<number, number[]>();
    for (const m of rig.skin!.sleeves) {
      const names = m.skeleton.bones.map((b) => b.name),
        j = m.geometry.getAttribute('skinIndex'),
        weights = m.geometry.getAttribute('skinWeight');
      const ids: number[] = [];
      for (let i = 0; i < j.count; i++)
        for (let k = 0; k < 4; k++)
          if (
            names[j.getComponent(i, k)].startsWith('Cuff_') &&
            weights.getComponent(i, k) > 0.99999
          )
            ids.push(i);
      cuffTargets.set(m.id, ids);
      expect(ids.length).toBeGreaterThan(30);
    }
    for (let frame = 0; frame < 57; frame++) {
      const angle = frame < 37 ? -1.4 + (frame * 2.8) / 36 : frame % 2 ? 1.4 : -1.4;
      w.rotation.z = angle;
      rig.update(
        frame / 60,
        frame > 20 ? 5 : 4,
        frame > 40 ? 2 : 1,
        Math.sin(frame) * 5,
        Math.cos(frame) * 6,
        (frame % 7) - 2,
      );
      const posed = points(rig);
      for (const [i, m] of rig.skin!.sleeves.entries()) {
        expect(m.geometry.getAttribute('position').array).toBe(storage[i]);
        const p = posed[i],
          v = new T.Vector3();
        for (let k = 0; k < p.length; k += 3) {
          v.set(p[k], p[k + 1], p[k + 2]);
          expect(m.boundingBox!.containsPoint(v)).toBe(true);
        }
        const ids = cuffTargets.get(m.id)!;
        // End ring + its cap centre have symmetrical weights and follow the
        // wheel cuff exactly; no skin stretch can hide a disconnected wrist.
        const centre = new T.Vector3();
        const restPositions = m.geometry.getAttribute('position');
        const label = m.name.startsWith('r_') ? 'R' : 'L',
          r = new T.Vector3(...(manifest.rest[label].wrist as [number, number, number]));
        let nearest = ids[0],
          distance = Infinity;
        for (const id of ids) {
          v.fromBufferAttribute(restPositions, id);
          const d = v.distanceTo(r);
          if (d < distance) {
            distance = d;
            nearest = id;
          }
        }
        centre.fromArray(p, nearest * 3);
        const diagnostic = rig.diagnostics().find((a) => a.side === (label === 'R' ? -1 : 1))!;
        expect(
          centre.distanceTo(new T.Vector3(...(diagnostic.wrist as [number, number, number]))),
        ).toBeLessThan(1e-6);
        expect(diagnostic.authoredSkin).toBe(true);
        expect(diagnostic.reachable).toBe(true);
      }
    }
    clean(rig, w);
  });
  it('reconstructs identical suit vertices after a replay seek, transforms correctly, and isolates two cars', async () => {
    const asset = await DriverAsset.decode(bytes),
      wa = wheel(),
      wb = wheel(),
      a = new DriverRig(wa, asset),
      b = new DriverRig(wb, asset);
    const parent = new T.Group();
    parent.add(a.root, wa);
    wa.rotation.z = 0.71;
    a.update(10, 5, 1, 3, -4, 2);
    const before = points(a),
      bBefore = points(b);
    for (let i = 0; i < 60; i++) {
      wa.rotation.z = Math.sin(i) * 1.4;
      a.update(10 + i / 60, 6, 2, -3, 2, 3);
    }
    wa.rotation.z = 0.71;
    a.update(10, 5, 1, 3, -4, 2);
    expect(points(a)).toEqual(before);
    expect(points(b)).toEqual(bBefore);
    parent.position.set(1200, 7, -350);
    parent.rotation.set(0.12, 1.9, -0.08);
    parent.updateMatrixWorld(true);
    const transformed = points(a);
    for (let m = 0; m < before.length; m++)
      for (let i = 0; i < before[m].length; i++)
        // glTF weights are Float32. At a 1.2 km origin their normalization
        // residual must remain sub-millimetre, not a nanometre-level promise.
        expect(Math.abs(transformed[m][i] - before[m][i])).toBeLessThan(0.0001);
    const ga = a.skin!.sleeves[0].geometry,
      gb = b.skin!.sleeves[0].geometry;
    expect(ga).not.toBe(gb);
    expect(a.skin!.sleeves[0].skeleton).not.toBe(b.skin!.sleeves[0].skeleton);
    asset.dispose();
    clean(a, wa);
    clean(b, wb);
  });
  it('dresses the authored suit in the team kit (the recolour hook survives instancing)', async () => {
    const asset = await DriverAsset.decode(bytes),
      w = wheel(),
      rig = new DriverRig(w, asset, { primary: 0x1b2a8e, secondary: 0x101418, accent: 0xf2d24a });
    const suit = rig.skin!.sleeves[0].material as T.Material;
    expect(studioHookKeys(suit)).toContain('team-suit-v1');
    expect(suit.customProgramCacheKey()).toContain('team-suit-v1');
    asset.dispose();
    clean(rig, w);
  });
});
