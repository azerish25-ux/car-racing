import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import {
  decodeStreetTransport,
  parseStreetKit,
  STREET_BUDGETS,
  STREET_KIT,
  StreetDetails,
} from '../src/rendering/open-world/street-details.ts';
import { openWorld } from '../src/simulation/open-world/world.ts';
import { regionStructures } from '../src/simulation/open-world/placement.ts';

const world = openWorld(),
  structures = regionStructures(world);
const raw = async () => new Uint8Array(await readFile('public/models/solvane/street-kit.glb'));
const packed = async () => new Uint8Array(await readFile('public/models/solvane/street-kit.bin'));
const make = async () => new StreetDetails(await parseStreetKit(await raw()), world, structures);
function cameraAt() {
  const camera = new T.PerspectiveCamera(70, 16 / 9, 0.1, 2000);
  camera.position.set(560, 7.5, -2608);
  camera.lookAt(560, 6, -2540);
  camera.updateMatrixWorld();
  return camera;
}

describe('Solvane native street construction R2', () => {
  it('authenticates compressed transport and exactly restores the source GLB', async () => {
    expect(await decodeStreetTransport(await packed())).toEqual(await raw());
    expect(STREET_KIT.bytes).toBeLessThan(180_000);
    expect(STREET_KIT.gzip.bytes).toBeLessThan(55_000);
  });
  it('rejects corrupt and truncated compressed transport before expansion', async () => {
    const bytes = await packed();
    await expect(decodeStreetTransport(bytes.slice(0, -1))).rejects.toThrow(/integrity/);
    bytes[bytes.length - 2] ^= 1;
    await expect(decodeStreetTransport(bytes)).rejects.toThrow(/integrity/);
  });
  it('retains six named templates, finite unit normals and matching physical bounds', async () => {
    const source = await parseStreetKit(await raw());
    expect(Object.keys(STREET_KIT.templates)).toHaveLength(6);
    for (const [name, record] of Object.entries(STREET_KIT.templates)) {
      const root = source.getObjectByName(name)!;
      expect(root, name).toBeDefined();
      let triangles = 0,
        meshes = 0;
      root.traverse((node) => {
        if (!(node instanceof T.Mesh)) return;
        meshes++;
        triangles += (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3;
        const normal = node.geometry.attributes.normal;
        for (let i = 0; i < normal.count; i++)
          expect(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i))).toBeCloseTo(1, 2);
        // Meshes with a material cannot use a missing texture path.
        const material = node.material as T.MeshStandardMaterial;
        expect(material.map).toBeNull();
        expect(material.roughness).toBeGreaterThan(0);
      });
      expect(triangles).toBe(record.triangles);
      expect(meshes).toBe(record.draws);
      const box = new T.Box3().setFromObject(root);
      for (let i = 0; i < 3; i++) {
        expect(box.min.getComponent(i)).toBeCloseTo(record.bounds.min[i], 4);
        expect(box.max.getComponent(i)).toBeCloseTo(record.bounds.max[i], 4);
      }
    }
    const kit = new StreetDetails(source, world, structures);
    kit.dispose();
  });
  it('honours typed-array byte offsets and rejects invalid/modified GLBs', async () => {
    const data = await raw(),
      padded = new Uint8Array(data.length + 42);
    padded.set(data, 19);
    const kit = new StreetDetails(
      await parseStreetKit(padded.subarray(19, 19 + data.length)),
      world,
      [],
    );
    kit.dispose();
    await expect(parseStreetKit(data.subarray(0, 24))).rejects.toThrow();
    const html = new Uint8Array(data.length);
    html.set(new TextEncoder().encode('<html>'));
    await expect(parseStreetKit(html)).rejects.toThrow(/Invalid/);
    data[data.length - 1] ^= 1;
    await expect(parseStreetKit(data)).rejects.toThrow(/integrity/);
  });
  it('uses geometric silhouettes even on Low, with per-kind instance limits at every tier', async () => {
    const kit = await make(),
      camera = cameraAt();
    try {
      expect(kit.stats.planned).toBeGreaterThan(300);
      let visible = 0;
      for (const tier of ['low', 'medium', 'high', 'ultra', 'low'] as const) {
        kit.update(camera, tier, 0);
        const budget = STREET_BUDGETS[tier];
        expect(kit.stats.nearInstances).toBeLessThanOrEqual(budget.near * 3);
        expect(kit.stats.farInstances).toBeLessThanOrEqual(budget.far * 3);
        if (tier === 'low') expect(kit.stats.nearInstances).toBe(0);
        expect(kit.stats.draws).toBeLessThanOrEqual(15);
        visible += kit.stats.farInstances + kit.stats.nearInstances;
        kit.root.traverse((node) => {
          if (!(node instanceof T.InstancedMesh)) return;
          expect(node.count).toBeLessThanOrEqual(node.instanceMatrix.count);
          expect(
            Array.from(node.instanceMatrix.array.subarray(0, node.count * 16)).every(
              Number.isFinite,
            ),
          ).toBe(true);
          for (let i = 0; i < node.count; i++) {
            const m = new T.Matrix4();
            node.getMatrixAt(i, m);
            expect(m.determinant()).toBeGreaterThan(0);
          }
        });
      }
      expect(visible).toBeGreaterThan(0);
    } finally {
      kit.dispose();
    }
  });
  it('does not compound wet darkening and restores the original dry finish exactly', async () => {
    const kit = await make(),
      camera = cameraAt();
    const materials = new Set<T.MeshStandardMaterial>();
    kit.root.traverse((node) => {
      if (node instanceof T.Mesh) materials.add(node.material as T.MeshStandardMaterial);
    });
    const snapshot = () =>
      Array.from(materials, (m) => [m.color.r, m.color.g, m.color.b, m.roughness]);
    const dry = snapshot();
    kit.update(camera, 'high', 1);
    const wet = snapshot();
    kit.update(camera, 'high', 1);
    expect(snapshot()).toEqual(wet);
    expect(wet).not.toEqual(dry);
    kit.update(camera, 'high', 0);
    expect(snapshot()).toEqual(dry);
    kit.dispose();
  });
  it('replaces stale instances on travel and produces identical held-frame transforms', async () => {
    const kit = await make(),
      camera = cameraAt();
    kit.update(camera, 'medium');
    const matrices = () =>
      kit.root.children
        .filter((x): x is T.InstancedMesh => x instanceof T.InstancedMesh)
        .map((mesh) => [mesh.count, ...mesh.instanceMatrix.array.slice(0, mesh.count * 16)]);
    const before = matrices();
    kit.update(camera, 'medium');
    expect(matrices()).toEqual(before);
    camera.position.set(30000, 0, 30000);
    camera.lookAt(31000, 0, 30000);
    kit.update(camera, 'medium');
    expect(kit.stats.draws).toBe(0);
    expect(kit.stats.nearInstances + kit.stats.farInstances).toBe(0);
    kit.dispose();
  });
  it('disposes all shared resources and matrix buffers exactly once', async () => {
    const kit = await make(),
      resources = new Set<T.BufferGeometry | T.Material | T.InstancedMesh>();
    kit.root.traverse((node) => {
      if (!(node instanceof T.InstancedMesh)) return;
      resources.add(node);
      resources.add(node.geometry);
      for (const material of Array.isArray(node.material) ? node.material : [node.material])
        resources.add(material);
    });
    const spies = Array.from(resources, (r) => vi.spyOn(r, 'dispose'));
    kit.dispose();
    kit.dispose();
    kit.update(cameraAt(), 'ultra');
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
    expect(kit.root.children).toHaveLength(0);
    expect(kit.stats.loaded).toBe(false);
  });
  it('downloads packed bytes on the application origin and supports browsers without native gzip', async () => {
    for (const compressed of [true, false]) {
      const data = compressed ? await packed() : await raw();
      const fetcher = vi.fn(async (input: string | URL | Request) => {
        const base = 'https://test.invalid/e2e/fixtures/horizon-session.html';
        const requested = new URL(String(input), base);
        expect(requested.origin).toBe('https://test.invalid');
        expect(requested.pathname).toBe(`/models/solvane/street-kit.${compressed ? 'bin' : 'glb'}`);
        return new Response(data, { headers: { 'content-length': String(data.length) } });
      });
      if (!compressed) vi.stubGlobal('DecompressionStream', undefined);
      vi.stubGlobal('fetch', fetcher);
      try {
        const kit = await StreetDetails.load(world, structures, () => false);
        expect(kit.stats.loaded).toBe(true);
        kit.dispose();
      } finally {
        vi.unstubAllGlobals();
      }
    }
  });
  it('does not fetch an already cancelled session or attach a load cancelled during transport', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    try {
      await expect(StreetDetails.load(world, structures, () => true)).rejects.toMatchObject({
        name: 'AbortError',
      });
      expect(fetcher).not.toHaveBeenCalled();
      let cancelled = false;
      const data = await packed();
      fetcher.mockImplementation(async () => {
        cancelled = true;
        return new Response(data);
      });
      await expect(StreetDetails.load(world, structures, () => cancelled)).rejects.toMatchObject({
        name: 'AbortError',
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
