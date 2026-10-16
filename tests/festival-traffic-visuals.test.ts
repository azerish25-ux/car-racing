import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { TrafficCars, TRAFFIC_CAPACITY } from '../src/rendering/traffic-cars.ts';
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
const batches = (cars: TrafficCars) =>
  cars.root.children.filter((m): m is T.InstancedMesh => m instanceof T.InstancedMesh);

describe('festival traffic visual geometry', () => {
  it('keeps four bounded material batches with real wheel cutouts and finite curved geometry', () => {
    const cars = new TrafficCars(),
      meshes = batches(cars),
      bounds = new T.Box3();
    expect(meshes).toHaveLength(4);
    let triangles = 0;
    for (const mesh of meshes) {
      triangles += mesh.geometry.getAttribute('position').count / 3;
      bounds.union(mesh.geometry.boundingBox!);
      for (const attr of Object.values(mesh.geometry.attributes))
        for (const n of attr.array) expect(Number.isFinite(n)).toBe(true);
    }
    expect(triangles).toBeLessThan(6000);
    // Same 4.5 m nominal body; existing small tyre/bumper overhang retained.
    expect(Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x))).toBeLessThan(0.95);
    expect(bounds.min.y).toBeGreaterThanOrEqual(-0.721);
    expect(bounds.max.y).toBeLessThan(0.721);
    expect(Math.max(Math.abs(bounds.min.z), Math.abs(bounds.max.z))).toBeLessThan(2.291);
    const body = new T.Mesh(cars.bodies.geometry, cars.bodies.material);
    body.updateMatrixWorld();
    for (const side of [-1, 1])
      for (const z of [-1.47, 0, 1.47]) {
        const ray = new T.Raycaster(new T.Vector3(side * 2, -0.2, z), new T.Vector3(-side, 0, 0));
        const hits = ray.intersectObject(body);
        if (z === 0) expect(hits.length).toBeGreaterThan(0);
        else expect(hits).toHaveLength(0);
      }
    const glass = meshes.find((mesh) => mesh.name.includes('glazing'))!;
    const hardware = meshes.find((mesh) => mesh.name.includes('wheels'))!;
    expect(glass.material).not.toBe(cars.bodies.material);
    expect(hardware.material).not.toBe(cars.bodies.material);
    // Neither fixed dark glazing nor neutral tyres inherits body paint.
    expect(glass.instanceColor).toBeNull();
    expect(hardware.instanceColor).toBeNull();
    cars.dispose();
  });

  it('poses every batch from the same id-matched snapshot and keeps lamp-state mapping', () => {
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
    const matrix = new T.Matrix4(),
      position = new T.Vector3(),
      orientation = new T.Quaternion(),
      scale = new T.Vector3();
    for (const mesh of batches(cars)) {
      expect(mesh.count).toBe(2);
      for (let i = 0; i < 2; i++) {
        mesh.getMatrixAt(i, matrix);
        matrix.decompose(position, orientation, scale);
        const def = i === 0 ? machines[1] : machines[0];
        expect(position.x).toBeCloseTo(i === 0 ? 22 : 2, 5);
        expect(position.y).toBeCloseTo(3, 5);
        expect(position.z).toBeCloseTo(i === 0 ? 10 : 6, 5);
        const yaw = i === 0 ? Math.PI / 8 : 0;
        expect(
          Math.abs(
            orientation.dot(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), yaw)),
          ),
        ).toBeCloseTo(1, 5);
        expect(scale.x).toBeCloseTo(def.halfExtents[0] / 0.92, 5);
        expect(scale.y).toBeCloseTo(Math.max(0.5, def.halfExtents[1]) / 0.72, 5);
        expect(scale.z).toBeCloseTo(def.halfExtents[2] / 2.25, 5);
      }
    }
    const colour = new T.Color();
    cars.lamps.getColorAt(0, colour);
    expect(colour.r).toBeCloseTo(3, 5);
    cars.lamps.getColorAt(1, colour);
    expect(colour.r).toBeCloseTo(2.6, 5);
    cars.dispose();
  });

  it('keeps the existing capacity, clears all batches on an absent block and disposes owned assets', () => {
    const cars = new TrafficCars(),
      meshes = batches(cars);
    const full = block(
      Array.from({ length: TRAFFIC_CAPACITY + 3 }, (_, i) => ({
        id: i,
        machine: machines[0],
        x: i * 10,
        z: 0,
      })),
    );
    cars.update(null, full, 1, 1, 0);
    expect(cars.count).toBe(TRAFFIC_CAPACITY);
    for (const mesh of meshes) expect(mesh.count).toBe(TRAFFIC_CAPACITY);
    cars.update(null, null, 1, 1, 0);
    expect(cars.count).toBe(0);
    for (const mesh of meshes) expect(mesh.count).toBe(0);
    let geometryDisposals = 0,
      materialDisposals = 0;
    for (const mesh of meshes) {
      mesh.geometry.addEventListener('dispose', () => geometryDisposals++);
      (mesh.material as T.Material).addEventListener('dispose', () => materialDisposals++);
    }
    cars.dispose();
    expect(geometryDisposals).toBe(4);
    expect(materialDisposals).toBe(4);
    expect(cars.root.children).toHaveLength(0);
  });
});
