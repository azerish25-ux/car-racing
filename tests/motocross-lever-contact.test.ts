import * as T from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BikeMaterials, staticSag } from '../src/rendering/bike.ts';
import { DirtBikeModel } from '../src/rendering/offroad/dirt-bike-model.ts';
import { mudUniforms } from '../src/rendering/offroad/mud.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';

beforeAll(() => {
  const ctx = new Proxy(
    {},
    {
      get: (_, key) => (key === 'measureText' ? () => ({ width: 10 }) : () => undefined),
      set: () => true,
    },
  );
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
  });
});
afterAll(() => vi.unstubAllGlobals());

/** Recover disconnected solids from the actual merged steering aluminium.
 * No marker, source regex or duplicate procedural lever is used as the thing
 * being tested. Coincident seam vertices are joined at one-micrometre precision. */
function aluminiumSolids(steer: T.Object3D, material: T.Material) {
  steer.updateWorldMatrix(true, true);
  const inverse = steer.matrixWorld.clone().invert(),
    matrix = new T.Matrix4();
  const triangles: T.Triangle[] = [],
    parents: number[] = [],
    atVertex = new Map<string, number>();
  const find = (id: number): number =>
    parents[id] === id ? id : (parents[id] = find(parents[id]));
  steer.traverse((o) => {
    if (!(o instanceof T.Mesh) || o.material !== material) return;
    matrix.multiplyMatrices(inverse, o.matrixWorld);
    const p = o.geometry.getAttribute('position'),
      index = o.geometry.index;
    for (let k = 0; k < (index?.count ?? p.count); k += 3) {
      const id = triangles.length,
        points: T.Vector3[] = [];
      parents.push(id);
      for (let j = 0; j < 3; j++) {
        const point = new T.Vector3()
          .fromBufferAttribute(p, index ? index.getX(k + j) : k + j)
          .applyMatrix4(matrix);
        points.push(point);
        const key = point
          .toArray()
          .map((n) => Math.round(n * 1e6))
          .join(',');
        const other = atVertex.get(key);
        if (other === undefined) atVertex.set(key, id);
        else parents[find(id)] = find(other);
      }
      triangles.push(new T.Triangle(points[0], points[1], points[2]));
    }
  });
  const groups = new Map<number, { triangles: T.Triangle[]; box: T.Box3 }>();
  triangles.forEach((triangle, i) => {
    const key = find(i),
      group = groups.get(key) ?? { triangles: [], box: new T.Box3() };
    group.triangles.push(triangle);
    for (const p of [triangle.a, triangle.b, triangle.c]) group.box.expandByPoint(p);
    groups.set(key, group);
  });
  return [...groups.values()].map((group) => ({
    ...group,
    centre: group.box.getCenter(new T.Vector3()),
    size: group.box.getSize(new T.Vector3()),
  }));
}

describe('MX lever terminal contact on actual production aluminium triangles', () => {
  for (const id of ['mx250', 'mx450'])
    for (const side of [-1, 1])
      it(`${id} ${side > 0 ? 'left' : 'right'} terminal intersects its blade through neutral, steered and braking poses`, () => {
        const definition = VEHICLES[id],
          materials = new BikeMaterials(0);
        const model = new DirtBikeModel(definition, 0, 'high', materials, mudUniforms());
        try {
          const steer = model.onboardControls.parent!,
            solids = aluminiumSolids(steer, materials.aluminium);
          const balls = solids.filter(
            (s) =>
              side * s.centre.x > 0.34 &&
              Math.abs(s.centre.y - 0.28) < 1e-5 &&
              s.size.toArray().every((n) => Math.abs(n - 0.012) < 1e-5),
          );
          const blades = solids.filter(
            (s) =>
              side * s.centre.x > 0.25 &&
              side * s.centre.x < 0.33 &&
              Math.abs(s.centre.y - 0.28) < 1e-5 &&
              Math.abs(s.size.y - 0.008) < 1e-5 &&
              s.size.x > 0.12 &&
              s.size.x < 0.16,
          );
          expect(balls).toHaveLength(1);
          expect(blades).toHaveLength(1);
          const ball = balls[0],
            blade = blades[0],
            sag = staticSag(definition);
          const triangle = new T.Triangle(),
            closest = new T.Vector3();
          const distanceToBlade = (point: T.Vector3) => {
            let distance = Infinity;
            for (const t of blade.triangles) {
              triangle.a.copy(t.a).applyMatrix4(steer.matrixWorld);
              triangle.b.copy(t.b).applyMatrix4(steer.matrixWorld);
              triangle.c.copy(t.c).applyMatrix4(steer.matrixWorld);
              // A fully rounded 8 mm blade has collapsed bevel faces. They
              // cover no surface and cannot enter the closest-point division.
              if (triangle.getArea() < 1e-14) continue;
              triangle.closestPointToPoint(point, closest);
              distance = Math.min(distance, closest.distanceTo(point));
            }
            return distance;
          };
          for (const pose of [
            { steer: 0, fork: 0, shock: 0 },
            { steer: 0.27, fork: -0.025, shock: 0.015 },
            { steer: -0.18, fork: 0.09, shock: -0.022 },
          ]) {
            model.pose({
              fork: sag.fork + pose.fork,
              shock: sag.shock + pose.shock,
              steer: pose.steer,
              frontRotation: 0,
              rearRotation: 0,
              chassisLean: 0,
              riderOffset: 0,
              tuck: 0,
              brake: 0.9,
              rearBrake: 0,
              discTemp: 0,
              compoundColour: 0xffffff,
              riding: false,
            });
            model.root.rotation.set(0.08, 0.7, -0.25);
            model.root.position.set(7, 1.2, -4);
            model.root.updateMatrixWorld(true);
            const world = ball.centre.clone().applyMatrix4(steer.matrixWorld);
            expect(distanceToBlade(world)).toBeLessThan(0.006 - 0.0005);
            // The previous authored ball centre is a negative control: the
            // same real blade must reject that visibly detached placement.
            const old = new T.Vector3(side * 0.37, 0.28, -0.06 + 0.085).applyMatrix4(
              steer.matrixWorld,
            );
            expect(distanceToBlade(old)).toBeGreaterThan(0.006 + 0.01);
          }
        } finally {
          model.dispose();
          materials.dispose();
        }
      });
});
