import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  AUREL_VEGETATION as M,
  TREE_VARIANTS,
  decodeAurelVegetation,
  vegetationDocument,
  vegetationLod,
  loadAurelVegetation,
} from '../src/rendering/aurel-vegetation.ts';
import {
  aurelVegetationPlan,
  orchardPlan,
  ORCHARD_PLOTS,
  ORCHARD_SPACING,
  plantingClearance,
  crownRadius,
  treeSeed,
} from '../src/rendering/aurel-vegetation-plan.ts';
import { alphaCoverage, preserveCoverage } from '../src/rendering/foliage-mipmaps.ts';
import { CANOPY_VOLUME } from '../src/rendering/canopy-volume.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { VELLAMAR } from '../src/simulation/circuits.ts';
import { vegetationPlan, grovePlan } from '../src/rendering/landscape.ts';
import { terrainFor } from '../src/rendering/terrain.ts';
import { detailDistance } from '../src/rendering/view-detail.ts';

const bytes = () => new Uint8Array(readFileSync('public/' + M.url));
const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const loader = () =>
  new GLTFLoader().register(() => ({
    name: 'CPU_geometry_only',
    loadTexture: () => Promise.resolve(new T.DataTexture(new Uint8Array([96, 128, 72, 255]), 1, 1)),
  }));
const decode = () => decodeAurelVegetation(bytes(), loader());

describe('A51-A54 original asset library', () => {
  it('retains matching native source, exporter and all six complete three-tier families', () => {
    expect(hash(readFileSync(M.author))).toBe(M.sourceSHA256);
    expect(hash(readFileSync(M.editable))).toBe(M.editableSHA256);
    expect(hash(bytes())).toBe(M.sha256);
    const doc = vegetationDocument(bytes());
    expect(doc.nodes).toHaveLength(66);
    expect(doc.meshes).toHaveLength(36);
    expect(doc.images).toHaveLength(3);
    expect(M.textureSizes).toContainEqual([1024, 1024]);
    for (const v of TREE_VARIANTS) {
      const t = M.triangles[v];
      expect(t[0]).toBeLessThan(1600);
      expect(t[0]).toBeGreaterThan(t[1]);
      expect(t[1]).toBeGreaterThan(t[2]);
      expect(t[2]).toBeLessThanOrEqual(80);
    }
    expect(M.finalArtApproved).toBe(false);
  });
  it('rejects truncation, malformed headers and same-size corruption before texture decoding', async () => {
    expect(() => vegetationDocument(bytes().slice(0, -1))).toThrow('byte count');
    const header = bytes();
    header[0] = 0;
    expect(() => vegetationDocument(header)).toThrow('header');
    const corrupt = bytes();
    corrupt[corrupt.length - 9] ^= 1;
    const parse = vi.spyOn(loader(), 'parseAsync');
    await expect(
      decodeAurelVegetation(corrupt, { parseAsync: parse } as unknown as GLTFLoader),
    ).rejects.toThrow('integrity');
    expect(parse).not.toHaveBeenCalled();
  });
  it('decodes finite indexed metre geometry, padded UVs and normalized normals for every tier', async () => {
    const kit = await decode();
    try {
      for (const variant of TREE_VARIANTS) {
        const parts = kit.templates.get(variant)!;
        expect(parts).toHaveLength(2);
        for (const part of parts) {
          const g = part.geometry,
            normal = g.getAttribute('normal'),
            uv = g.getAttribute('uv');
          expect(g.index).not.toBeNull();
          expect(g.boundingBox!.min.y).toBeGreaterThan(-0.03);
          for (const name of ['position', 'normal', 'uv'])
            expect(Array.from(g.getAttribute(name).array).every(Number.isFinite)).toBe(true);
          for (let i = 0; i < normal.count; i++)
            expect(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i))).toBeCloseTo(1, 4);
          for (let i = 0; i < uv.count; i++) {
            expect(uv.getX(i)).toBeGreaterThanOrEqual(0);
            expect(uv.getX(i)).toBeLessThanOrEqual(1);
            expect(uv.getY(i)).toBeGreaterThanOrEqual(0);
            expect(uv.getY(i)).toBeLessThanOrEqual(1);
          }
          if (part.foliage) {
            expect(part.material.transparent).toBe(false);
            expect(part.material.alphaTest).toBe(0.45);
            expect(part.material.map).toBe(kit.depth.map);
            expect(part.material.map).toBe(kit.distance.map);
            expect(part.material.map!.userData.foliageAlphaCutoff).toBe(0.45);
          }
        }
        // The near tier adds an inner crown shell: every exported leaf card
        // twice on LOD0 (bark unchanged); the far tiers are the exported ones.
        const leaves = parts.find((p) => p.foliage)!;
        for (let level = 0; level < 3; level++)
          expect(parts.reduce((n, p) => n + p.ranges[level].count / 3, 0)).toBe(
            M.triangles[variant][level] +
              (level < CANOPY_VOLUME.shellLevels ? leaves.ranges[level].count / 6 : 0),
          );
        // Baked crown occlusion, rim and clump streams for both paired forms.
        for (const name of ['canopy', 'treeCanopy']) {
          const canopy = leaves.geometry.getAttribute(name);
          expect(canopy.itemSize).toBe(3);
          expect(canopy.count).toBe(leaves.geometry.getAttribute('position').count);
          for (let i = 0; i < canopy.count; i++) {
            expect(canopy.getX(i)).toBeGreaterThanOrEqual(CANOPY_VOLUME.aoFloor * 0.74 - 1e-6);
            expect(canopy.getX(i)).toBeLessThanOrEqual(1);
            expect(Math.abs(canopy.getZ(i))).toBeLessThanOrEqual(1);
          }
        }
      }
    } finally {
      kit.dispose();
    }
  });
  it('bounds downloads and honors cancellation without invoking a decoder', async () => {
    const fetcher = vi.fn();
    await expect(
      loadAurelVegetation(() => true, 'https://asset.invalid/tree', fetcher),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).not.toHaveBeenCalled();
    await expect(
      loadAurelVegetation(
        () => false,
        'https://asset.invalid/tree',
        async () => new Response(new Uint8Array(M.bytes + 1)),
      ),
    ).rejects.toThrow('byte budget');
    await expect(
      loadAurelVegetation(
        () => false,
        'https://asset.invalid/tree',
        async () => new Response(new Uint8Array(100)),
      ),
    ).rejects.toThrow('Truncated');
  });
});

describe('integrated Aurel planting', () => {
  const track = new Track('clear'),
    plan = aurelVegetationPlan(track);
  it('is stable across weather/replays, bounded and uses all six distinct forms', () => {
    expect(aurelVegetationPlan(track)).toEqual(plan);
    expect(aurelVegetationPlan(new Track('rain'))).toEqual(plan);
    expect(new Set(plan.map((t) => t.variant)).size).toBe(6);
    expect(
      plan.filter((t) => t.layer === 'near' || t.layer === 'orchard').length,
    ).toBeLessThanOrEqual(650);
    expect(plan.filter((t) => t.layer === 'grove').length).toBeLessThanOrEqual(900);
    expect(plan.filter((t) => t.layer === 'treeline').length).toBe(
      grovePlan(track).treeline.length,
    );
    expect(plan.length).toBeGreaterThan(1800);
  });
  it('retains unchanged eligible scatter positions and checks complete crowns against every protected footprint', () => {
    const old = vegetationPlan(track),
      clear = plantingClearance(track),
      p = trackPoint();
    for (const tree of plan) {
      expect(clear(tree)).toBe(true);
      const l = track.nearest(tree.x, tree.z, p),
        corridor = tree.layer === 'grove' || tree.layer === 'treeline' ? 60 : 14;
      expect(Math.abs(l) - crownRadius(tree)).toBeGreaterThanOrEqual(
        track.boundary(p.s, l < 0 ? -1 : 1) + corridor - 1e-6,
      );
      if (tree.layer === 'near') {
        const original = old.find((o) => o.x === tree.x && o.z === tree.z)!;
        expect(original).toBeDefined();
        expect(tree.y).toBe(original.y);
      } else expect(tree.y).toBe(terrainFor(track).height(tree.x, tree.z));
    }
  });
  it('makes two straight managed row plots, real row-end variants and no overlapping scatter', () => {
    const orchard = orchardPlan(track),
      p = trackPoint();
    expect(orchard).toHaveLength(66);
    for (const tree of orchard) {
      const plot = ORCHARD_PLOTS[tree.plot!];
      track.at(plot.station, p);
      const dx = tree.x - p.x,
        dz = tree.z - p.z;
      expect(dx * p.tx + dz * p.tz).toBeCloseTo((tree.column! - 5) * ORCHARD_SPACING.along, 5);
      expect(dx * p.nx + dz * p.nz).toBeCloseTo(
        plot.lateral - tree.row! * ORCHARD_SPACING.across,
        5,
      );
      expect(tree.variant.endsWith('row-end')).toBe(tree.column === 0 || tree.column === 10);
      for (const n of plan.filter((t) => t.layer === 'near'))
        expect(Math.hypot(tree.x - n.x, tree.z - n.z)).toBeGreaterThan(
          crownRadius(tree) + crownRadius(n) + 2,
        );
    }
  });
  it('respects extra recovery-route exclusions for foreground, groves and treelines, without changing Vellamar', () => {
    const blocked = aurelVegetationPlan(track, undefined, (x, z, padding) => x > 0 && z > -padding);
    expect(blocked.length).toBeLessThan(plan.length);
    expect(blocked.every((t) => t.x <= 0 || t.z <= -Math.max(8, crownRadius(t) + 2))).toBe(true);
    const coast = new Track('clear', false, undefined, VELLAMAR);
    expect(orchardPlan(coast)).toEqual([]);
    expect(() => aurelVegetationPlan(coast)).toThrow('not been authored');
    expect(treeSeed(12.25, -80)).toBe(treeSeed(12.25, -80));
  });
});

describe('instanced tier continuity and ownership', () => {
  it('uses stable draw-range wrappers and shared attributes through a full lap, long lenses, reverse seeks and density changes', async () => {
    const kit = await decode(),
      group = new T.Group(),
      track = new Track('clear'),
      p = trackPoint();
    kit.build(track, group);
    const meshes = kit.chunks.flatMap((c) => c.meshes),
      gs = meshes.map((m) => m.geometry),
      ids = gs.map((g) => [g.index, g.getAttribute('position'), g.getAttribute('normal')]),
      matrices = meshes.map((m) => m.instanceMatrix.array.slice());
    const camera = new T.PerspectiveCamera(58, 16 / 9, 0.1, 4000);
    const seen = new Set<number>();
    try {
      expect(meshes.length).toBeLessThan(440);
      expect(meshes.length).toBeGreaterThan(50);
      for (let lap = 0; lap < 3; lap++) {
        for (const fov of [58, 14, 64]) {
          camera.fov = fov;
          for (let i = 0; i < 24; i++) {
            track.at(((lap % 2 ? 23 - i : i) / 24) * track.length, p);
            camera.position.set(p.x, p.y + 2, p.z);
            camera.lookAt(p.x + p.tx * 20, p.y, p.z + p.tz * 20);
            camera.updateMatrixWorld();
            kit.update(camera, 'medium');
            for (const c of kit.chunks) {
              seen.add(c.level);
              for (let part = 0; part < c.meshes.length; part++)
                expect(c.meshes[part].geometry.drawRange).toEqual(
                  c.templates[part].ranges[c.level],
                );
            }
          }
        }
      }
      expect(seen).toEqual(new Set([0, 1, 2]));
      meshes.forEach((m, i) => {
        m.count = Math.floor(m.userData.fullCount / 2);
        expect(m.geometry).toBe(gs[i]);
        expect(m.geometry.index).toBe(ids[i][0]);
        expect(m.geometry.getAttribute('position')).toBe(ids[i][1]);
        expect(m.geometry.getAttribute('normal')).toBe(ids[i][2]);
        expect(m.instanceMatrix.array).toEqual(matrices[i]);
      });
      expect(() => kit.build(track, group)).toThrow('already installed');
    } finally {
      kit.dispose();
    }
    expect(group.children).toHaveLength(0);
    kit.dispose();
  });
  it('uses the actual inspection/reflection camera without poisoning the main camera hysteresis', async () => {
    const kit = await decode();
    kit.build(new Track('clear'), new T.Group());
    try {
      const camera = new T.PerspectiveCamera(58, 16 / 9),
        reflection = new T.PerspectiveCamera(90, 1),
        c = kit.chunks.find((c) => c.layer === 'near')!;
      camera.position.copy(c.sphere.center).add(new T.Vector3(0, 0, c.sphere.radius + 15));
      camera.updateMatrixWorld();
      kit.update(camera, 'high');
      const main = c.level;
      expect(main).toBe(0);
      reflection.position.copy(c.sphere.center).add(new T.Vector3(0, 0, 3000));
      reflection.updateMatrixWorld();
      const mesh = c.meshes[0];
      const renderer = {
        getCurrentViewport: (out: T.Vector4) => out.set(0, 0, 128, 128),
        getDrawingBufferSize: (out: T.Vector2) => out.set(1280, 720),
      } as T.WebGLRenderer;
      mesh.onBeforeRender(
        renderer,
        {} as T.Scene,
        reflection,
        mesh.geometry,
        mesh.material as T.Material,
        null as never,
      );
      expect(c.level).toBe(main);
      expect(mesh.geometry.drawRange).toEqual(c.templates[0].ranges[2]);
      mesh.onBeforeRender(
        renderer,
        {} as T.Scene,
        camera,
        mesh.geometry,
        mesh.material as T.Material,
        null as never,
      );
      expect(mesh.geometry.drawRange).toEqual(c.templates[0].ranges[main]);
    } finally {
      kit.dispose();
    }
  });
  it('releases instantiated buffers, template buffers and shadow materials once', async () => {
    const kit = await decode();
    kit.build(new Track('clear'), new T.Group());
    const geometries = [...kit.templates.values()]
        .flatMap((p) => p.map((p) => p.geometry))
        .concat(kit.chunks.flatMap((c) => c.meshes.map((m) => m.geometry))),
      calls = [...new Set(geometries)].map((g) => vi.spyOn(g, 'dispose')),
      depth = vi.spyOn(kit.depth, 'dispose');
    kit.dispose();
    kit.dispose();
    for (const spy of calls) expect(spy).toHaveBeenCalledTimes(1);
    expect(depth).toHaveBeenCalledTimes(1);
  });
  it('retains useful lens-aware hysteresis without relaxing tiers', () => {
    expect(vegetationLod(54, 0)).toBe(0);
    expect(vegetationLod(59, 0)).toBe(0);
    expect(vegetationLod(66, 0)).toBe(1);
    expect(vegetationLod(52, 1)).toBe(1);
    expect(vegetationLod(44, 1)).toBe(0);
    expect(vegetationLod(detailDistance(120, 14), 2)).toBeLessThan(vegetationLod(120, 2));
    expect(() => vegetationLod(NaN)).toThrow();
    expect(() => vegetationLod(-1)).toThrow();
  });
});

describe('small-leaf alpha mip coverage', () => {
  it('preserves the nearest representable coverage without changing RGB or filling transparent holes', () => {
    const pixels = new Uint8ClampedArray([
      71, 103, 40, 0, 71, 103, 40, 32, 71, 103, 40, 74, 71, 103, 40, 100,
    ]);
    expect(alphaCoverage(pixels, 0.45)).toBe(0);
    expect(preserveCoverage(pixels, 0.5, 0.45)).toBe(0.5);
    expect(pixels[3]).toBe(0);
    for (let i = 0; i < pixels.length; i += 4)
      expect([...pixels.slice(i, i + 3)]).toEqual([71, 103, 40]);
  });
  it('does not make a mostly transparent terminal texel into an opaque rectangular card', () => {
    const pixel = new Uint8ClampedArray([71, 103, 40, 30]);
    expect(preserveCoverage(pixel, 0.2, 0.45)).toBe(0);
    expect(() => preserveCoverage(new Uint8ClampedArray(0), 0.2, 0.45)).toThrow();
  });
});
