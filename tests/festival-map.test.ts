import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { mapToWorld, minimapHeading, minimapPoint, worldToMap } from '../src/ui/festival-map.ts';

const SIZE = 440,
  RANGE = 650;
/** Screen x (NDC) of a world point seen by a chase camera behind a car at
 * the origin facing `forward` (the festival renderer's view). */
function chaseView(forward: T.Vector3, point: T.Vector3) {
  const camera = new T.PerspectiveCamera(60, 16 / 9, 0.1, 2000);
  camera.position.copy(forward).multiplyScalar(-8).add(new T.Vector3(0, 3, 0));
  camera.lookAt(forward.clone().multiplyScalar(10));
  camera.updateMatrixWorld();
  return point.clone().project(camera);
}

describe('festival map projection', () => {
  it('shows the world as the 3D view does: what is on the left of the car is left of the minimap arrow', () => {
    for (const angle of [0, 0.7, Math.PI / 2, 2.4, Math.PI, -1.2]) {
      const forward = new T.Vector3(Math.sin(angle), 0, Math.cos(angle)),
        left = new T.Vector3(0, 1, 0).cross(forward),
        heading = minimapHeading(forward.x, forward.z);
      // Ahead-left in the world...
      const target = forward.clone().multiplyScalar(10).addScaledVector(left, 5);
      expect(chaseView(forward, target).x).toBeLessThan(0);
      // ...is ahead-left on the heading-up minimap (arrow at the centre, up).
      const [sx, sy] = minimapPoint(target.x, target.z, 0, 0, heading, SIZE, RANGE);
      expect(sx).toBeLessThan(SIZE / 2 - 0.5);
      expect(sy).toBeLessThan(SIZE / 2 - 0.5);
      // Straight ahead is straight up.
      const [ax, ay] = minimapPoint(forward.x * 50, forward.z * 50, 0, 0, heading, SIZE, RANGE);
      expect(ax).toBeCloseTo(SIZE / 2, 6);
      expect(ay).toBeLessThan(SIZE / 2);
    }
  });
  it('draws the north-up world map with east on the left, as seen facing north', () => {
    const [cx] = worldToMap(0, 0),
      [ex] = worldToMap(100, 0),
      [, ny] = worldToMap(0, 100),
      [, cy] = worldToMap(0, 0);
    expect(ex).toBeLessThan(cx);
    expect(ny).toBeLessThan(cy);
    expect(chaseView(new T.Vector3(0, 0, 1), new T.Vector3(100, 0, 300)).x).toBeLessThan(0);
    const [x, z] = mapToWorld(...worldToMap(1234, -567));
    expect(x).toBeCloseTo(1234, 6);
    expect(z).toBeCloseTo(-567, 6);
  });
  it('keeps the finding case: a car facing +x sees (10, 0, -5) ahead-left on screen and on the minimap', () => {
    const forward = new T.Vector3(1, 0, 0),
      point = new T.Vector3(10, 0, -5);
    expect(chaseView(forward, point).x).toBeLessThan(0);
    const [sx, sy] = minimapPoint(10, -5, 0, 0, minimapHeading(1, 0), SIZE, RANGE);
    expect(sx).toBeLessThan(SIZE / 2);
    expect(sy).toBeLessThan(SIZE / 2);
  });
});
