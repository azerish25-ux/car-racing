import * as T from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BikeMaterials, staticSag, type BikePoseValues } from '../src/rendering/bike.ts';
import { DirtBikeModel } from '../src/rendering/offroad/dirt-bike-model.ts';
import {
  addMotocrossBrakeCaliper,
  MotocrossBrakeHose,
  MotocrossRearShock,
} from '../src/rendering/offroad/motocross-mechanics.ts';
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

function disposeGeometry(root: T.Object3D) {
  root.traverse((o) => {
    if (o instanceof T.Mesh) o.geometry.dispose();
  });
}

function pose(fork: number, shock: number, extra: Partial<BikePoseValues> = {}): BikePoseValues {
  return {
    fork,
    shock,
    steer: 0,
    frontRotation: 0,
    rearRotation: 0,
    chassisLean: 0,
    riderOffset: 0,
    tuck: 0,
    brake: 0,
    rearBrake: 0,
    discTemp: 0,
    compoundColour: 0xffffff,
    riding: false,
    ...extra,
  };
}

const transformedPoint = (point: T.Vector3, object: T.Object3D) =>
  point.clone().applyMatrix4(object.matrixWorld);

describe('motocross two-anchor suspension and brake geometry', () => {
  for (const id of ['mx250', 'mx450', 'sm450'])
    it.each(['high', 'mid'] as const)(
      `${id} %s keeps both shock eyes on their actual frame/arm mounts through full suspension travel`,
      (detail) => {
        const definition = VEHICLES[id],
          materials = new BikeMaterials(0),
          model = new DirtBikeModel(definition, 0, detail, materials, mudUniforms());
        const arm = model.root.getObjectByName('Motocross articulated swingarm')!,
          shock = model.root.getObjectByName('Motocross two-anchor telescoping rear shock')!,
          lower = model.root.getObjectByName('Motocross moving lower shock eye and piston')!,
          coil = model.root.getObjectByName(
            'Motocross constant-diameter suspension coil',
          ) as T.Mesh;
        const b = definition.bike!,
          armLength = Math.hypot(b.rearWheelRadius - b.cgHeight + 0.36, b.cgToRear - 0.15),
          mountOnArm = new T.Vector3(0, 0.04, -armLength * 0.35),
          mountOnFrame = new T.Vector3(0, -0.02, -0.29);
        const upperCast = new T.Box3(),
          lowerCast = new T.Box3();
        for (const group of [shock, lower]) {
          const inverse = group.matrixWorld.clone().invert();
          group.traverse((o) => {
            if (
              !(o instanceof T.Mesh) ||
              o.material !== (group === shock ? materials.aluminium : materials.steel)
            )
              return;
            const matrix = inverse.clone().multiply(o.matrixWorld),
              p = o.geometry.getAttribute('position');
            for (let i = 0; i < p.count; i++)
              (group === shock ? upperCast : lowerCast).expandByPoint(
                new T.Vector3().fromBufferAttribute(p, i).applyMatrix4(matrix),
              );
          });
        }
        try {
          let minLength = Infinity,
            maxLength = 0;
          model.root.rotation.set(0.28, 0.6, -0.48);
          model.root.position.set(20, 1.3, -10);
          for (const forkFraction of [0, 0.3, 0.7, 1])
            for (const shockFraction of [0, 0.3, 0.7, 1]) {
              model.pose(
                pose(b.forkTravel * forkFraction, b.shockTravel * shockFraction, { steer: 0.42 }),
              );
              model.root.updateMatrixWorld(true);
              const upperWorld = transformedPoint(mountOnFrame, model.sprung),
                lowerWorld = transformedPoint(mountOnArm, arm),
                length = upperWorld.distanceTo(lowerWorld);
              expect(shock.getWorldPosition(new T.Vector3()).distanceTo(upperWorld)).toBeLessThan(
                1e-9,
              );
              expect(lower.getWorldPosition(new T.Vector3()).distanceTo(lowerWorld)).toBeLessThan(
                1e-9,
              );
              expect(lower.position.y).toBeCloseTo(length, 10);
              expect(shock.scale.toArray()).toEqual([1, 1, 1]);
              expect(lower.scale.toArray()).toEqual([1, 1, 1]);
              // The actual fixed-length rod must overlap the actual cast body
              // even at diagonal combinations of full fork/rear travel.
              expect(length + lowerCast.min.y).toBeLessThan(upperCast.max.y - 0.002);
              expect(
                coil.geometry.boundingBox!.max.x - coil.geometry.boundingBox!.min.x,
              ).toBeCloseTo(0.078, 5);
              minLength = Math.min(minLength, length);
              maxLength = Math.max(maxLength, length);
            }
          expect(maxLength - minLength).toBeGreaterThan(0.09);
        } finally {
          model.dispose();
          materials.dispose();
        }
      },
    );

  it.each(['high', 'mid'] as const)(
    '%s changes spring pitch while preserving wire radius, outward normals, reusable buffers and exact seeks',
    (detail) => {
      const materials = new BikeMaterials(0),
        shock = new MotocrossRearShock(detail, materials),
        geometry = shock.coil.geometry,
        positions = geometry.getAttribute('position') as T.BufferAttribute,
        normals = geometry.getAttribute('normal'),
        rows = detail === 'high' ? 112 : 70,
        columns = detail === 'high' ? 6 : 5;
      const identity = [
        geometry,
        positions,
        normals,
        geometry.boundingBox,
        geometry.boundingSphere,
      ];
      try {
        for (const length of [0.23, 0.37, 0.43]) {
          shock.update(new T.Vector3(), new T.Vector3(0, length, 0));
          for (let row = 0; row <= rows; row++) {
            const t = row / rows,
              a = t * 7 * Math.PI * 2,
              centre = new T.Vector3(
                Math.cos(a) * 0.034,
                0.048 + t * (length - 0.086),
                Math.sin(a) * 0.034,
              );
            for (let column = 0; column <= columns; column++) {
              const index = row * (columns + 1) + column,
                p = new T.Vector3().fromBufferAttribute(positions, index),
                n = new T.Vector3().fromBufferAttribute(normals, index);
              expect(p.distanceTo(centre)).toBeCloseTo(0.005, 7);
              expect(n.length()).toBeCloseTo(1, 6);
              expect(geometry.boundingBox!.containsPoint(p)).toBe(true);
              expect(geometry.boundingSphere!.containsPoint(p)).toBe(true);
            }
          }
          // Raster culling must agree with the authored outward normals.
          const index = geometry.index!,
            a = new T.Vector3(),
            b = new T.Vector3(),
            c = new T.Vector3();
          for (let i = 0; i < index.count; i += 3) {
            a.fromBufferAttribute(positions, index.getX(i));
            b.fromBufferAttribute(positions, index.getX(i + 1));
            c.fromBufferAttribute(positions, index.getX(i + 2));
            const face = b.sub(a).cross(c.sub(a)),
              n = new T.Vector3().fromBufferAttribute(normals, index.getX(i));
            expect(face.dot(n)).toBeGreaterThan(0);
          }
        }
        shock.update(new T.Vector3(), new T.Vector3(0, 0.37, -0.04));
        const saved = [Array.from(positions.array), Array.from(normals.array)],
          version = positions.version;
        shock.update(new T.Vector3(), new T.Vector3(0, 0.37, -0.04));
        expect(positions.version).toBe(version);
        shock.update(new T.Vector3(), new T.Vector3(0, 0.24, -0.01));
        shock.update(new T.Vector3(), new T.Vector3(0, 0.37, -0.04));
        expect([Array.from(positions.array), Array.from(normals.array)]).toEqual(saved);
        expect([
          geometry,
          positions,
          normals,
          geometry.boundingBox,
          geometry.boundingSphere,
        ]).toEqual(identity);
      } finally {
        disposeGeometry(shock.root);
        materials.dispose();
      }
    },
  );

  for (const front of [true, false])
    it.each(['high', 'mid'] as const)(
      `${front ? 'front' : 'rear'} %s caliper has a real empty rotor throat and separate jaws`,
      (detail) => {
        const materials = new BikeMaterials(0),
          root = new T.Group(),
          offset = front ? 0.022 : 0,
          radius = front ? 0.131 : 0.117,
          axisX = front ? 0.056 : -0.06;
        const banjo = addMotocrossBrakeCaliper(root, front, detail, materials, offset);
        root.updateMatrixWorld(true);
        try {
          const ray = new T.Raycaster(),
            origin = new T.Vector3(),
            direction = new T.Vector3();
          for (let i = 0; i < 96; i++) {
            const a = (i / 96) * Math.PI * 2;
            for (const r of [radius * 0.8, radius * 0.93, radius])
              for (const sign of [-1, 1]) {
                origin.set(axisX, Math.sin(a) * r, offset + Math.cos(a) * r);
                direction.set(sign, 0, 0);
                ray.set(origin, direction);
                ray.far = 0.003;
                expect(ray.intersectObject(root, true)).toHaveLength(0);
              }
          }
          const angle = front ? Math.PI - 0.2 : -0.7,
            pad = new T.Vector3(0, 0, radius - 0.017).applyAxisAngle(new T.Vector3(1, 0, 0), angle);
          for (const sign of [-1, 1]) {
            ray.set(new T.Vector3(axisX, pad.y, offset + pad.z), new T.Vector3(sign, 0, 0));
            ray.far = 0.04;
            const hits = ray.intersectObject(root, true);
            expect(hits.length).toBeGreaterThan(1);
            expect(hits[0].distance).toBeGreaterThan(0.003);
            expect(hits[0].distance).toBeLessThan(0.008);
          }
          expect(new T.Box3().setFromObject(root, true).containsPoint(banjo)).toBe(true);
          let triangles = 0;
          root.traverse((o) => {
            if (o instanceof T.Mesh)
              triangles +=
                (o.geometry.index?.count ?? o.geometry.getAttribute('position').count) / 3;
          });
          expect(triangles).toBeLessThan(900);
        } finally {
          disposeGeometry(root);
          materials.dispose();
        }
      },
    );

  it('front hydraulic hose remains attached at both ends without per-frame allocations, paused uploads or replay drift', () => {
    const material = new T.MeshStandardMaterial(),
      hose = new MotocrossBrakeHose(material),
      geometry = hose.mesh.geometry,
      position = geometry.getAttribute('position') as T.BufferAttribute,
      normal = geometry.getAttribute('normal'),
      identity = [position, normal, geometry.boundingBox, geometry.boundingSphere];
    const centre = (row: number) => {
      const average = new T.Vector3();
      // The seam duplicates column zero; average only the five unique sides.
      for (let column = 0; column < 5; column++)
        average.add(new T.Vector3().fromBufferAttribute(position, row * 6 + column));
      return average.multiplyScalar(0.2);
    };
    try {
      for (const y of [-1.02, -0.92, -0.81, -0.7]) {
        hose.update(y);
        expect(centre(0).distanceTo(new T.Vector3(-0.054, 0.11, 0.05))).toBeLessThan(1e-8);
        expect(centre(18).distanceTo(new T.Vector3(0.123, y + 0.51, 0.035))).toBeLessThan(2e-8);
        for (let i = 0; i < position.count; i++) {
          const p = new T.Vector3().fromBufferAttribute(position, i);
          expect(geometry.boundingBox!.containsPoint(p)).toBe(true);
          expect(geometry.boundingSphere!.containsPoint(p)).toBe(true);
          expect(new T.Vector3().fromBufferAttribute(normal, i).length()).toBeCloseTo(1, 6);
        }
      }
      const saved = Array.from(position.array),
        version = position.version;
      hose.update(-0.7);
      expect(position.version).toBe(version);
      hose.update(-0.97);
      hose.update(-0.7);
      expect(Array.from(position.array)).toEqual(saved);
      expect([position, normal, geometry.boundingBox, geometry.boundingSphere]).toEqual(identity);
    } finally {
      disposeGeometry(hose.root);
      material.dispose();
    }
  });

  it.each(['mx250', 'mx450', 'sm450'])(
    '%s rear caliper follows suspension but never wheel spin or removed wheels',
    (id) => {
      const definition = VEHICLES[id],
        materials = new BikeMaterials(0),
        sag = staticSag(definition),
        model = new DirtBikeModel(definition, 0, 'high', materials, mudUniforms());
      const brake = model.root.getObjectByName('Motocross axle-mounted non-spinning rear brake')!,
        arm = model.root.getObjectByName('Motocross articulated swingarm')!;
      try {
        model.pose(pose(sag.fork, sag.shock));
        model.root.updateMatrixWorld(true);
        const saved = brake.matrixWorld.toArray();
        model.pose(
          pose(sag.fork, sag.shock, {
            rearRotation: 5,
            frontRotation: -3,
            rearWheelOut: 0.42,
            frontWheelDrop: 0.32,
          }),
        );
        model.root.updateMatrixWorld(true);
        expect(brake.matrixWorld.toArray()).toEqual(saved);
        model.pose(pose(sag.fork + 0.13, sag.shock + 0.1));
        model.root.updateMatrixWorld(true);
        expect(brake.matrixWorld.toArray()).not.toEqual(saved);
        expect(brake.rotation.x).toBe(arm.rotation.x);
        expect(brake.scale.toArray()).toEqual([1, 1, 1]);
        model.pose(pose(sag.fork, sag.shock));
        model.root.updateMatrixWorld(true);
        expect(brake.matrixWorld.toArray()).toEqual(saved);
      } finally {
        model.dispose();
        materials.dispose();
      }
    },
  );
});
