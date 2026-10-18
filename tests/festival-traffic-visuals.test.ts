import * as T from 'three';
import { describe, expect, it } from 'vitest';
import {
  TrafficCars,
  TRAFFIC_BODIES,
  TRAFFIC_CAPACITY,
  TRAFFIC_SHAPES,
  trafficBodiesFor,
  trafficBodyGeometry,
  trafficBodyOf,
  trafficPaint,
} from '../src/rendering/traffic-cars.ts';
import {
  TF,
  TRAFFIC_FLAG,
  TRAFFIC_HEADER,
  TRAFFIC_STRIDE,
} from '../src/simulation/open-world/ambient-traffic.ts';
import { VEHICLES, vehicleIndex, type VehicleDefinition } from '../src/simulation/vehicles.ts';

const machines = Object.values(VEHICLES).filter((v) => v.classId === 'road');
type Pose = {
  id: number;
  machine: VehicleDefinition;
  x: number;
  z: number;
  yaw?: number;
  brake?: number;
  flags?: number;
};
function block(poses: Pose[]) {
  const data = new Float32Array(TRAFFIC_HEADER + poses.length * TRAFFIC_STRIDE);
  data[0] = poses.length;
  for (let i = 0; i < poses.length; i++) {
    const p = poses[i],
      offset = TRAFFIC_HEADER + i * TRAFFIC_STRIDE;
    data[offset + TF.ID] = p.id;
    data[offset + TF.VEHICLE] = vehicleIndex(p.machine.id);
    data[offset + TF.X] = p.x;
    data[offset + TF.Y] = 3;
    data[offset + TF.Z] = p.z;
    data[offset + TF.QY] = Math.sin((p.yaw ?? 0) / 2);
    data[offset + TF.QW] = Math.cos((p.yaw ?? 0) / 2);
    data[offset + TF.BRAKE] = p.brake ?? 0;
    data[offset + TF.FLAGS] = p.flags ?? 0;
  }
  return data;
}
const meshes = (cars: TrafficCars) =>
  cars.root.children.filter((m): m is T.InstancedMesh => m instanceof T.InstancedMesh);
/** Only the triangles of one per-vertex finish (paint: trafficFinish.x = 1). */
function paintOnly(geometry: T.BufferGeometry) {
  const position = geometry.getAttribute('position'),
    finish = geometry.getAttribute('trafficFinish');
  const kept: number[] = [];
  for (let i = 0; i < position.count; i += 3)
    if (finish.getX(i) === 1)
      for (let k = 0; k < 3; k++)
        kept.push(position.getX(i + k), position.getY(i + k), position.getZ(i + k));
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(kept, 3));
  return g;
}

describe('festival traffic visual geometry', () => {
  it('builds every Japanese body type finite, grounded, inside its plan and with open wheel arches', () => {
    let triangles = 0;
    for (const body of TRAFFIC_BODIES) {
      const s = TRAFFIC_SHAPES[body],
        geometry = trafficBodyGeometry(body);
      for (const attr of Object.values(geometry.attributes))
        for (const n of attr.array) expect(Number.isFinite(n)).toBe(true);
      const count = geometry.getAttribute('position').count / 3;
      triangles += count;
      expect(count, `${body} triangles`).toBeLessThan(5000);
      const bounds = geometry.boundingBox!;
      // Mirrors may stand a hand's width proud of the flanks, as on the road.
      expect(Math.max(-bounds.min.x, bounds.max.x), `${body} width`).toBeLessThan(
        s.width / 2 + 0.07,
      );
      expect(bounds.min.y, `${body} ground`).toBeGreaterThanOrEqual(-0.001);
      expect(bounds.max.y, `${body} roof`).toBeLessThan(s.cabin.roofY + 0.05);
      expect(Math.max(-bounds.min.z, bounds.max.z), `${body} length`).toBeLessThan(
        s.length / 2 + 0.06,
      );
      // Real cutouts: a ray just above the axle passes the paint, the door stops it.
      const paint = new T.Mesh(paintOnly(geometry), new T.MeshBasicMaterial());
      for (const side of [-1, 1]) {
        for (const z of s.axles) {
          const ray = new T.Raycaster(
            new T.Vector3(side * 2, s.wheel + 0.12, z),
            new T.Vector3(-side, 0, 0),
          );
          expect(ray.intersectObject(paint), `${body} arch ${z}`).toHaveLength(0);
        }
        const door = new T.Raycaster(
          new T.Vector3(side * 2, s.wheel + 0.12, (s.axles[0] + s.axles[1]) / 2),
          new T.Vector3(-side, 0, 0),
        );
        expect(door.intersectObject(paint).length, `${body} door`).toBeGreaterThan(0);
      }
      // Glass, rubber and trim never take the instance paint.
      const colour = geometry.getAttribute('color'),
        finish = geometry.getAttribute('trafficFinish');
      let tyres = 0;
      for (let i = 0; i < colour.count; i++)
        if (finish.getY(i) > 0.8) {
          tyres++;
          expect(finish.getX(i)).toBe(0);
        }
      expect(tyres, `${body} tyres`).toBeGreaterThan(0);
      paint.geometry.dispose();
      geometry.dispose();
    }
    expect(triangles).toBeLessThan(TRAFFIC_BODIES.length * 4500);
  });

  it('draws each machine as a body whose real plan fits its collision footprint', () => {
    for (const def of Object.values(VEHICLES).filter((v) =>
      ['road', 'street'].includes(String(v.classId)),
    )) {
      const options = trafficBodiesFor(def);
      expect(options.length).toBeGreaterThan(0);
      const [hx, , hz] = def.halfExtents;
      for (const body of options) {
        const s = TRAFFIC_SHAPES[body];
        // Stretched in plan at most ~35% and never compressed below 80%.
        expect((hz * 2) / s.length, `${def.id} ${body} length`).toBeLessThan(1.36);
        expect((hz * 2) / s.length).toBeGreaterThan(0.8);
        expect((hx * 2) / s.width, `${def.id} ${body} width`).toBeLessThan(1.36);
        expect((hx * 2) / s.width).toBeGreaterThan(0.8);
      }
    }
    // The long pickup chassis is a cab-over light truck, the roadster a kei.
    expect(trafficBodiesFor(VEHICLES.rp6)).toContain('truck');
    expect(trafficBodiesFor(VEHICLES.rd2).some((b) => b === 'kei' || b === 'keiTruck')).toBe(true);
    // Japanese road colours: white, pearl, silver, grey and black dominate.
    const neutral = new Set([0xe8e9e4, 0xf3f3ef, 0xa7abaf, 0x6d7175, 0x111315]);
    let share = 0;
    for (let id = 0; id < 2000; id++) if (neutral.has(trafficPaint(id))) share++;
    expect(share / 2000).toBeGreaterThan(0.6);
    expect(share / 2000).toBeLessThan(0.85);
  });

  it('poses every car from the same id-matched snapshot on the road and keeps lamp-state mapping', () => {
    const cars = new TrafficCars();
    const older = block([
      { id: 7, machine: machines[0], x: 0, z: 4 },
      { id: 42, machine: machines[1], x: 20, z: 8 },
    ]);
    const newer = block([
      { id: 42, machine: machines[1], x: 28, z: 16, yaw: Math.PI / 2, flags: TRAFFIC_FLAG.HAZARD },
      { id: 7, machine: machines[0], x: 8, z: 12, brake: 0.6 },
    ]);
    cars.update(older, newer, 0.25, 0, 0);
    expect(cars.count).toBe(2);
    const matrix = new T.Matrix4(),
      position = new T.Vector3(),
      orientation = new T.Quaternion(),
      scale = new T.Vector3();
    for (let k = 0; k < 2; k++) {
      const slot = cars.slotOf(k)!,
        def = k === 0 ? machines[1] : machines[0],
        id = k === 0 ? 42 : 7,
        s = TRAFFIC_SHAPES[slot.batch.body];
      expect(slot.batch.body).toBe(trafficBodyOf(id, def));
      slot.batch.mesh.getMatrixAt(slot.instance, matrix);
      matrix.decompose(position, orientation, scale);
      expect(position.x).toBeCloseTo(k === 0 ? 22 : 2, 5);
      // The wheels stand on the road under the collision box centre.
      expect(position.y).toBeCloseTo(3 - Math.max(0.5, def.halfExtents[1]), 5);
      expect(position.z).toBeCloseTo(k === 0 ? 10 : 6, 5);
      const yaw = k === 0 ? Math.PI / 8 : 0;
      expect(
        Math.abs(orientation.dot(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), yaw))),
      ).toBeCloseTo(1, 5);
      expect(scale.x).toBeCloseTo((def.halfExtents[0] * 2) / s.width, 5);
      expect(scale.y).toBeCloseTo(1, 5);
      expect(scale.z).toBeCloseTo((def.halfExtents[2] * 2) / s.length, 5);
      // The contact shade sits under the same car.
      cars.contact.getMatrixAt(k, matrix);
      expect(new T.Vector3().setFromMatrixPosition(matrix).distanceTo(position)).toBeLessThan(1e-5);
    }
    // Daylight: no halo draw.
    expect(cars.halos.visible).toBe(false);
    expect(cars.lampsOf(0)![2]).toBeCloseTo(3, 5);
    expect(cars.lampsOf(1)![1]).toBeCloseTo(2.6, 5);
    const pose = new T.Matrix4();
    expect(cars.poseOf(1, pose)).toBe(true);
    expect(cars.poseOf(2, pose)).toBe(false);
    cars.dispose();
  });

  it('keeps the existing capacity, clears all batches on an absent block and disposes owned assets', () => {
    const cars = new TrafficCars(),
      all = meshes(cars);
    // One instanced draw per body type, the ground contact and the halos.
    expect(all).toHaveLength(TRAFFIC_BODIES.length + 2);
    const full = block(
      Array.from({ length: TRAFFIC_CAPACITY + 3 }, (_, i) => ({
        id: i,
        machine: machines[i % machines.length],
        x: i * 10,
        z: 0,
      })),
    );
    cars.update(null, full, 1, 1, 0);
    expect(cars.count).toBe(TRAFFIC_CAPACITY);
    expect(cars.batches.reduce((n, b) => n + b.mesh.count, 0)).toBe(TRAFFIC_CAPACITY);
    expect(cars.contact.count).toBe(TRAFFIC_CAPACITY);
    // Night (1): four lamp halos per car.
    expect(cars.halos.count).toBe(TRAFFIC_CAPACITY * 4);
    expect(cars.halos.visible).toBe(true);
    cars.update(null, null, 1, 1, 0);
    expect(cars.count).toBe(0);
    for (const mesh of all) {
      expect(mesh.count).toBe(0);
      expect(mesh.visible).toBe(false);
    }
    let geometryDisposals = 0,
      materialDisposals = 0;
    for (const mesh of all) {
      mesh.geometry.addEventListener('dispose', () => geometryDisposals++);
      (mesh.material as T.Material).addEventListener('dispose', () => materialDisposals++);
    }
    cars.dispose();
    expect(geometryDisposals).toBe(all.length);
    expect(materialDisposals).toBe(all.length);
    expect(cars.root.children).toHaveLength(0);
  });
});
