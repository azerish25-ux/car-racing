import { createHash } from 'node:crypto';
import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { TrackTerrainSurface } from '../src/simulation/offroad/course-terrain.ts';
import { inStandFootprint } from '../src/rendering/grandstand.ts';
import { tracksideRigs } from '../src/rendering/trackside.ts';
import { MxCourseDressing } from '../src/rendering/offroad/mx-course-dressing.ts';
import {
  MX_FURNITURE_LIMITS,
  mxFurnitureGround,
} from '../src/rendering/offroad/mx-trackside-furniture.ts';
import {
  MX_TRACKSIDE_MODELS,
  buildMxTracksideModel,
  mxTracksideParts,
} from '../src/rendering/offroad/mx-trackside-models.ts';

const fingerprint = (g: T.BufferGeometry) => {
  const hash = createHash('sha256');
  for (const name of ['position', 'normal', 'uv', 'color']) {
    const array = g.getAttribute(name).array;
    hash.update(Buffer.from(array.buffer, array.byteOffset, array.byteLength));
  }
  return hash.digest('hex');
};
function dispose(root: T.Object3D) {
  root.traverse((o) => {
    if (o instanceof T.Mesh) {
      o.geometry.dispose();
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
    }
  });
}

describe('original MX trackside model kit', () => {
  it.each(MX_TRACKSIDE_MODELS)(
    '%s has deterministic, finite, separately owned model variants',
    (kind) => {
      const counts: number[] = [];
      for (const detail of ['near', 'course'] as const) {
        const parts = mxTracksideParts(kind, detail),
          second = mxTracksideParts(kind, detail);
        let triangles = 0,
          minimumY = Infinity,
          normalError = 0;
        expect(parts.length).toBeGreaterThan(30);
        for (const [i, part] of parts.entries()) {
          const geometry = part.geometry,
            p = geometry.getAttribute('position');
          expect(geometry).not.toBe(second[i].geometry);
          expect(fingerprint(geometry)).toBe(fingerprint(second[i].geometry));
          for (const name of ['position', 'normal', 'uv', 'color']) {
            const attribute = geometry.getAttribute(name);
            expect(attribute.count).toBe(p.count);
            expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
          }
          const normal = geometry.getAttribute('normal');
          for (let j = 0; j < normal.count; j++)
            normalError = Math.max(
              normalError,
              Math.abs(Math.hypot(normal.getX(j), normal.getY(j), normal.getZ(j)) - 1),
            );
          minimumY = Math.min(minimumY, geometry.boundingBox!.min.y);
          triangles += p.count / 3;
          geometry.dispose();
          second[i].geometry.dispose();
        }
        expect(normalError).toBeLessThan(0.001);
        expect(minimumY).toBeCloseTo(0, 6);
        counts.push(triangles);
        const root = buildMxTracksideModel(kind, detail);
        expect(root.children.length).toBeLessThanOrEqual(5);
        expect(root.userData.partNames).toHaveLength(parts.length);
        expect(new T.Box3().setFromObject(root).min.y).toBeCloseTo(0, 6);
        dispose(root);
      }
      expect(counts[0]).toBeGreaterThan(2500);
      expect(counts[0]).toBeLessThan(6000);
      expect(counts[1]).toBeLessThan(counts[0] * 0.6);
    },
  );

  it('keeps upward roof panels and scissor links below the canopy hem', () => {
    const parts = mxTracksideParts('canopy');
    const roof = parts.filter((p) => p.name === 'Tensioned sewn canopy roof panel');
    expect(roof).toHaveLength(4);
    for (const part of roof) {
      const normals = part.geometry.getAttribute('normal');
      for (let i = 0; i < normals.count; i++) expect(normals.getY(i)).toBeGreaterThan(0);
    }
    const links = parts.filter((p) => p.name === 'Folding scissor-truss link');
    expect(links).toHaveLength(32);
    expect(Math.max(...links.map((p) => p.geometry.boundingBox!.max.y))).toBeLessThan(2.34);
    parts.forEach((p) => p.geometry.dispose());
  });

  it('keeps the marshal entry open and speaker grilles separate from their drivers', () => {
    const parts = mxTracksideParts('marshal-post');
    const root = buildMxTracksideModel('marshal-post');
    root.updateMatrixWorld(true);
    const ray = new T.Raycaster(new T.Vector3(2, 1.3, 0), new T.Vector3(-1, 0, 0), 0, 1.4);
    expect(ray.intersectObject(root, true)).toHaveLength(0);
    expect(parts.filter((p) => p.name === 'Open tread access step')).toHaveLength(4);
    expect(parts.filter((p) => p.name === 'Rolled inactive marshal flag')).toHaveLength(3);
    parts.forEach((p) => p.geometry.dispose());
    dispose(root);
    const speakers = mxTracksideParts('speaker-stack');
    const grille = speakers.filter((p) => p.name.includes('grille'));
    const drivers = speakers.filter((p) => p.name === 'Recessed woofer cone');
    expect(grille.length).toBeGreaterThan(50);
    expect(drivers).toHaveLength(2);
    expect(Math.min(...grille.map((p) => p.geometry.boundingBox!.min.z))).toBeGreaterThan(
      Math.max(...drivers.map((p) => p.geometry.boundingBox!.max.z)),
    );
    speakers.forEach((p) => p.geometry.dispose());
  });

  it.each(['valley-ridge-mx', 'arena-nord-sx'] as const)(
    '%s integrates complete models without changing terrain or blocking lanes',
    (id) => {
      const track = rigTrack(id),
        surface = Track.offroadOf(track) as TrackTerrainSurface;
      const before = surface.terrain.hash();
      const dressing = new MxCourseDressing(track),
        kit = dressing.trackside;
      const indoor = id === 'arena-nord-sx';
      expect(dressing.root.children).toContain(kit.root);
      expect(kit.stats).toEqual({
        canopy: indoor ? 0 : 4,
        'tool-trolley': indoor ? 2 : 4,
        'pressure-washer': indoor ? 2 : 4,
        'water-tank': indoor ? 2 : 4,
        'marshal-post': indoor ? 4 : 6,
        'speaker-stack': indoor ? 2 : 4,
      });
      expect(kit.plan.placements).toHaveLength(indoor ? 12 : 26);
      expect(kit.triangles).toBe(indoor ? 47584 : 102272);
      expect(kit.triangles).toBeLessThan(MX_FURNITURE_LIMITS.maximumTriangles);
      expect(kit.root.children).toHaveLength(5);
      expect(dressing.stats.canopies).toBe(indoor ? 0 : 4);
      const cameras = tracksideRigs(track),
        p = trackPoint();
      let minimumClearance = Infinity;
      for (const site of kit.plan.sites) {
        expect(inStandFootprint(track, site.x, site.z, site.radius + 0.7)).toBe(false);
        for (const camera of cameras)
          expect(
            Math.hypot(site.x - camera.position.x, site.z - camera.position.z),
          ).toBeGreaterThanOrEqual(site.radius + 2.4);
        // Independent dense station survey, rather than trusting the planner's booleans.
        for (let s = 0; s < track.length; s += 0.5) {
          track.at(s, p);
          const width = Math.max(
            track.boundaryAt(p, -1),
            track.boundaryAt(p, 1),
            surface.course.legalWidth(p.width, s, -1),
            surface.course.legalWidth(p.width, s, 1),
          );
          minimumClearance = Math.min(
            minimumClearance,
            Math.hypot(site.x - p.x, site.z - p.z) - width - site.radius,
          );
        }
      }
      expect(minimumClearance).toBeGreaterThanOrEqual(0.68);
      const templates = new Map(MX_TRACKSIDE_MODELS.map((kind) => [kind, mxTracksideParts(kind)]));
      let outside = 0,
        contactError = 0;
      for (const placement of kit.plan.placements) {
        const site = kit.plan.sites[placement.cluster];
        for (const part of templates.get(placement.kind)!) {
          const vertices = part.geometry.getAttribute('position');
          for (let i = 0; i < vertices.count; i++) {
            const v = new T.Vector3()
              .fromBufferAttribute(vertices, i)
              .applyMatrix4(placement.matrix);
            if (Math.hypot(v.x - site.x, v.z - site.z) > site.radius + 0.01) outside++;
            if (vertices.getY(i) < 0.005)
              contactError = Math.max(
                contactError,
                Math.abs(v.y - mxFurnitureGround(track, v.x, v.z)),
              );
          }
        }
      }
      templates.forEach((parts) => parts.forEach((part) => part.geometry.dispose()));
      expect(outside).toBe(0);
      expect(contactError).toBeLessThan(0.095);
      expect(surface.terrain.hash()).toBe(before);
      const resources: (T.BufferGeometry | T.Material)[] = [];
      for (const child of kit.root.children)
        if (child instanceof T.Mesh) resources.push(child.geometry, child.material as T.Material);
      const releases = resources.map(() => 0);
      resources.forEach((resource, i) => resource.addEventListener('dispose', () => releases[i]++));
      dressing.dispose();
      kit.dispose();
      expect(releases.every((count) => count === 1)).toBe(true);
      expect(kit.root.children).toHaveLength(0);
    },
  );
});
