import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { finishDetailWeight, installCircuitFinish } from '../src/rendering/circuit-finish.ts';
import { crowdLodRanges } from '../src/rendering/crowd.ts';
import { DriverRig } from '../src/rendering/driver.ts';
import { GRANDSTANDS, buildGrandstand, inStandFootprint } from '../src/rendering/grandstand.ts';
import { TracksideDirector, tracksideRigs } from '../src/rendering/trackside.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';

function dispose(root: T.Object3D) {
  const geometries = new Set<T.BufferGeometry>(), materials = new Set<T.Material>();
  root.traverse((object) => {
    if (object instanceof T.InstancedMesh) object.dispose();
    if (!(object instanceof T.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    if (object.customDepthMaterial) materials.add(object.customDepthMaterial);
  });
  geometries.forEach((g) => g.dispose()); materials.forEach((m) => m.dispose());
}

describe('Phase 27 graphics closure', () => {
  it('keeps independently actuated instanced paddles at the exact original local poses', () => {
    const parent = new T.Group(), steering = new T.Group(); parent.add(steering);
    steering.position.set(0, 0.115, 0.22); steering.rotation.x = 0.12;
    const driver = new DriverRig(steering); parent.add(driver.root);
    const matrix = new T.Matrix4(), expected = new T.Matrix4(), pivot = new T.Object3D();
    expect(driver.paddles.count).toBe(2);
    expect(driver.paddles.frustumCulled).toBe(true);
    expect(driver.paddles.instanceMatrix.usage).toBe(T.DynamicDrawUsage);
    try {
      for (const [time, gear, mode] of [[1, 3, 1], [1.02, 4, 1], [1.04, 4, 1], [1.06, 3, 2], [0.4, 1, 0]]) {
        driver.update(time, gear, mode);
        driver.diagnostics().forEach((arm, index) => {
          pivot.position.set(arm.side * 0.104, 0, 0.041); pivot.rotation.y = arm.paddleRadians; pivot.updateMatrix();
          expected.copy(pivot.matrix).multiply(new T.Matrix4().makeTranslation(arm.side * 0.017, 0, 0));
          driver.paddles.getMatrixAt(index, matrix);
          matrix.elements.forEach((v, j) => expect(v).toBeCloseTo(expected.elements[j], 6));
          const p = driver.paddles.geometry.getAttribute('position');
          for (let i = 0; i < p.count; i++) {
            const vertex = new T.Vector3().fromBufferAttribute(p, i).applyMatrix4(matrix);
            expect(driver.paddles.boundingBox!.containsPoint(vertex)).toBe(true);
            expect(driver.paddles.boundingSphere!.containsPoint(vertex)).toBe(true);
          }
        });
        const held = Array.from(driver.paddles.instanceMatrix.array);
        driver.update(time, gear, mode);
        expect(Array.from(driver.paddles.instanceMatrix.array)).toEqual(held);
      }
      expect(driver.diagnostics().map((a) => a.paddleRadians)).toEqual([0, -0]);
    } finally { dispose(parent); }
  });

  it('places all permanent broadcast sites clear of stand canopies and protected road corridors', () => {
    const track = new Track('clear'), rigs = tracksideRigs(track), p = trackPoint();
    expect(rigs).toHaveLength(20); expect(rigs).toEqual(tracksideRigs(track));
    for (const rig of rigs) {
      const lateral = track.nearest(rig.position.x, rig.position.z, p);
      expect(Math.abs(lateral) - track.boundary(p.s, lateral < 0 ? -1 : 1)).toBeGreaterThan(2.5);
      expect(inStandFootprint(track, rig.position.x, rig.position.z, 0.8)).toBe(false);
    }
  });

  it('samples actual nearby canopy geometry across each broadcast shot and four aspects', () => {
    const track = new Track('clear'), stands = new T.Group(), crowds = new T.Group();
    const m = {
      concrete: new T.MeshStandardMaterial(), steel: new T.MeshStandardMaterial(),
      roof: new T.MeshStandardMaterial({ side: T.DoubleSide }), underside: new T.MeshStandardMaterial({ side: T.DoubleSide }),
      seats: new T.MeshStandardMaterial(), people: new T.MeshStandardMaterial(), sign: new T.MeshStandardMaterial(),
    };
    for (const site of GRANDSTANDS) buildGrandstand(track, stands, crowds, site, m);
    stands.updateMatrixWorld(true);
    const roofs: T.Object3D[] = [];
    stands.traverse((o) => { if (o instanceof T.Mesh && (o.material === m.roof || o.material === m.underside)) roofs.push(o); });
    const director = new TracksideDirector(track), p = trackPoint(), camera = new T.PerspectiveCamera();
    const ray = new T.Raycaster(); ray.near = 0.05; ray.far = 25;
    let samples = 0;
    try {
      for (const rig of director.rigs) for (const offset of [-0.32, 0, 0.32]) for (const aspect of [16 / 9, 4 / 3, 21 / 9, 9 / 16]) {
        track.at(rig.centerS + rig.coverageM * offset, p);
        director.reset(); director.update(p.s, new T.Vector3(p.x, p.y + 0.5, p.z), new T.Vector3(), 0, aspect);
        camera.position.copy(director.position); camera.lookAt(director.gaze);
        camera.aspect = aspect; camera.fov = director.fov; camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
        for (const x of [-0.95, -0.5, 0, 0.5, 0.95]) for (const y of [0, 0.45, 0.95]) {
          ray.setFromCamera(new T.Vector2(x, y), camera);
          expect(ray.intersectObjects(roofs, false), `camera ${rig.id}, offset ${offset}, aspect ${aspect}, ray ${x}/${y}`).toHaveLength(0);
          samples++;
        }
      }
      expect(samples).toBe(3600);
    } finally { dispose(stands); dispose(crowds); Object.values(m).forEach((material) => material.dispose()); }
  });

  it('band-limits world finish detail monotonically without changing fully resolved detail', () => {
    expect(finishDetailWeight(0)).toBe(1); expect(finishDetailWeight(0.35)).toBe(1);
    expect(finishDetailWeight(0.8)).toBeCloseTo(0.5, 12);
    expect(finishDetailWeight(1.25)).toBe(0); expect(finishDetailWeight(100)).toBe(0);
    let previous = 1;
    for (let i = 0; i <= 200; i++) {
      const weight = finishDetailWeight(i / 100);
      expect(weight).toBeLessThanOrEqual(previous); expect(weight).toBeGreaterThanOrEqual(0); previous = weight;
    }
    for (const value of [-1, NaN, Infinity]) expect(() => finishDetailWeight(value)).toThrow();
    for (const kind of ['grass', 'asphalt', 'concrete', 'paint', 'kerb'] as const) {
      const material = new T.MeshStandardMaterial(); installCircuitFinish(material, kind);
      expect(material.customProgramCacheKey()).toContain('circuit-finish-v2-filtered'); material.dispose();
    }
  });
});


it('hands off crowd levels without double-drawing or dropping a spectator and restores exact rewind weights', () => {
  const ranges = [new T.Vector2(), new T.Vector2(), new T.Vector2(), new T.Vector2()];
  for (const distance of [0, 45, 46, 50, 52, 55, 58, 100, 150, 218, 222, 230, 238, 242, 420, 430, 450, 470, 480, 600]) {
    crowdLodRanges(distance, ranges);
    const count = ranges.filter((r) => r.y > r.x).length;
    expect(count).toBe(distance > 46 && distance < 58 || distance > 218 && distance < 242 || distance > 420 && distance < 480 ? 2 : 1);
    for (let i = 0; i < 1024; i++) {
      const rank = i / 1024;
      expect(ranges.filter((r) => rank >= r.x && rank < r.y)).toHaveLength(1);
    }
  }
  crowdLodRanges(53.2, ranges); const before = ranges.map((r) => r.toArray());
  crowdLodRanges(240, ranges); crowdLodRanges(53.2, ranges);
  expect(ranges.map((r) => r.toArray())).toEqual(before);
  for (const distance of [NaN, Infinity, -1]) expect(() => crowdLodRanges(distance, ranges)).toThrow();
});
