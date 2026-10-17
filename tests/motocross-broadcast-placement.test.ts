import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { circuitDefinition } from '../src/simulation/circuits.ts';
import { Track, surfaceSample } from '../src/simulation/track.ts';
import { TrackTerrainSurface } from '../src/simulation/offroad/course-terrain.ts';
import {
  buildTrackInfrastructure,
  trackInfrastructurePlan,
} from '../src/rendering/track-infrastructure.ts';
import { tracksideRigs } from '../src/rendering/trackside.ts';
import { inStandFootprint } from '../src/rendering/grandstand.ts';
import { Stadium } from '../src/rendering/offroad/stadium.ts';

type Point = { x: number; z: number };
type Triangle = readonly [Point, Point, Point];

/** Independent geometry check: triangles of the complete legal ribbon,
 * built from the public terrain course, rather than the planner's circles. */
function legalTriangles(track: Track): Triangle[] {
  const surface = Track.offroadOf(track) as TrackTerrainSurface;
  const rows = track.points.map((point) =>
    ([-1, 1] as const).map((side) => {
      const lateral = surface.course.legalWidth(point.width, point.s, side) * side;
      return { x: point.x + point.nx * lateral, z: point.z + point.nz * lateral };
    }),
  );
  return rows.slice(1).flatMap((b, i) => {
    const a = rows[i];
    return [
      [a[0], a[1], b[0]],
      [a[1], b[1], b[0]],
    ] as Triangle[];
  });
}

/** Exact separating-axis test between one projected triangle and the
 * enclosing rectangle derived from the ACTUAL generated camera meshes. */
function meetsBox(triangle: Triangle, min: Point, max: Point) {
  const [a, b, c] = triangle;
  if (Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)) < 1e-10) return false;
  const axes = [
    [1, 0],
    [0, 1],
    [a.z - b.z, b.x - a.x],
    [b.z - c.z, c.x - b.x],
    [c.z - a.z, a.x - c.x],
  ];
  const centre = { x: (min.x + max.x) / 2, z: (min.z + max.z) / 2 },
    half = { x: (max.x - min.x) / 2, z: (max.z - min.z) / 2 };
  return axes.every(([x, z]) => {
    const values = triangle.map((p) => p.x * x + p.z * z),
      middle = centre.x * x + centre.z * z,
      radius = half.x * Math.abs(x) + half.z * Math.abs(z);
    return Math.max(...values) >= middle - radius && Math.min(...values) <= middle + radius;
  });
}

function projectedTriangles(mesh: T.Mesh): Triangle[] {
  const positions = mesh.geometry.getAttribute('position'),
    index = mesh.geometry.index,
    count = index?.count ?? positions.count,
    triangles: Triangle[] = [];
  for (let i = 0; i < count; i += 3) {
    const triangle = [0, 1, 2].map((k) =>
      new T.Vector3()
        .fromBufferAttribute(positions, index ? index.getX(i + k) : i + k)
        .applyMatrix4(mesh.matrixWorld),
    );
    triangles.push(triangle as [T.Vector3, T.Vector3, T.Vector3]);
  }
  return triangles;
}

function dispose(root: T.Object3D) {
  const geometries = new Set<T.BufferGeometry>(),
    materials = new Set<T.Material>();
  root.traverse((object) => {
    if (!(object instanceof T.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material])
      materials.add(material);
    if (object instanceof T.InstancedMesh) object.dispose();
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  root.clear();
}

describe('complete dirt-venue replay-camera hardware', () => {
  it.each(['valley-ridge-mx', 'arena-nord-sx'] as const)(
    '%s keeps all 20 actual bases, posts, platforms, rails and heads outside every legal lane',
    (id) => {
      const track = new Track('clear', false, undefined, circuitDefinition(id)),
        plan = trackInfrastructurePlan(track),
        rigs = tracksideRigs(track),
        root = new T.Group(),
        safety = new T.MeshStandardMaterial(),
        lanes = legalTriangles(track),
        stadium = id === 'arena-nord-sx' ? new Stadium(track) : null;
      try {
        // The same fallback branch used by the complete production renderer
        // outside Aurel. No synthetic boxes stand in for the actual hardware.
        buildTrackInfrastructure(track, root, safety, plan);
        root.updateMatrixWorld(true);
        stadium?.root.updateMatrixWorld(true);
        const seating = stadium
          ? projectedTriangles(
              stadium.root.getObjectByName('Arena concrete seating decks') as T.Mesh,
            )
          : [];
        expect(plan.cameras).toHaveLength(20);
        expect(plan.cameras.every((site) => site.supported)).toBe(true);
        const rows = [];
        for (const site of plan.cameras) {
          const camera = root.getObjectByName(`Replay camera infrastructure ${site.rigId}`)!;
          expect(camera?.visible).toBe(true);
          const inverse = camera.matrixWorld.clone().invert(),
            bounds = new T.Box3(),
            vertices: T.Vector3[] = [],
            contact = surfaceSample();
          let meshes = 0,
            nearestGap = Infinity;
          camera.traverse((object) => {
            if (!(object instanceof T.Mesh)) return;
            meshes++;
            const positions = object.geometry.getAttribute('position');
            for (let i = 0; i < positions.count; i++) {
              const world = new T.Vector3()
                .fromBufferAttribute(positions, i)
                .applyMatrix4(object.matrixWorld);
              vertices.push(world);
              bounds.expandByPoint(world.clone().applyMatrix4(inverse));
              track.sample(world.x, world.z, contact);
              nearestGap = Math.min(nearestGap, Math.abs(contact.lateral) - contact.width);
            }
          });
          expect(meshes).toBe(7);
          expect(nearestGap).toBeGreaterThan(0.5);
          const min = { x: bounds.min.x - 0.4, z: bounds.min.z - 0.4 },
            max = { x: bounds.max.x + 0.4, z: bounds.max.z + 0.4 },
            local = (p: Point) => {
              const v = new T.Vector3(p.x, 0, p.z).applyMatrix4(inverse);
              return { x: v.x, z: v.z };
            },
            intersects = (triangles: readonly Triangle[]) =>
              triangles.some((triangle) =>
                meetsBox(triangle.map(local) as unknown as Triangle, min, max),
              );
          expect(
            intersects(lanes),
            `Rig ${site.rigId}: full mesh envelope and 0.4 m band cross a legal lane`,
          ).toBe(false);
          expect(
            intersects(seating),
            `Rig ${site.rigId}: full mesh envelope crosses actual SX seating`,
          ).toBe(false);
          expect(vertices.some((p) => inStandFootprint(track, p.x, p.z, 0.4))).toBe(false);

          // The real optical group is at the same world position the replay
          // director uses; all twenty have physical supports, not floating heads.
          const optical = camera.children.find((object) => object instanceof T.Group)!;
          expect(
            optical.getWorldPosition(new T.Vector3()).distanceTo(rigs[site.rigId!].position),
          ).toBeLessThan(1e-8);
          const base = camera.children[0] as T.Mesh,
            positions = base.geometry.getAttribute('position'),
            normals = base.geometry.getAttribute('normal');
          let foundationVertices = 0;
          for (let i = 0; i < positions.count; i++) {
            if (normals.getY(i) > -0.5) continue;
            const world = new T.Vector3()
              .fromBufferAttribute(positions, i)
              .applyMatrix4(base.matrixWorld);
            track.sample(world.x, world.z, contact);
            expect(contact.height - world.y).toBeGreaterThan(0.005);
            expect(contact.height - world.y).toBeLessThan(0.04);
            foundationVertices++;
          }
          expect(foundationVertices).toBeGreaterThanOrEqual(4);
          rows.push({
            rig: site.rigId,
            nearestLegalVertexGapM: nearestGap,
            actualVertices: vertices.length,
          });
        }
        console.info(
          'MX_CAMERA_FOOTPRINT ' +
            JSON.stringify({ venue: id, minimumExpandedEnvelopeClearanceM: 0.4, rigs: rows }),
        );
      } finally {
        dispose(root);
        safety.dispose();
        if (stadium) {
          stadium.dispose();
          dispose(stadium.root);
        }
      }
    },
  );
});
