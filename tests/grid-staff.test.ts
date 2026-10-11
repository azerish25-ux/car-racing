import { expect, it } from 'vitest';
import * as T from 'three';
import {
  GRID_STANCES,
  GridPreparationView,
  gridStaffPose,
} from '../src/rendering/grid-preparation.ts';
import { CUFF } from '../src/rendering/pit-crew.ts';
import { CREW_BONES, CREW_REST } from '../src/rendering/people-asset.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { H, carBase } from '../src/simulation/protocol.ts';
import { Simulation } from '../src/simulation/world.ts';

it('gives each grid staff member a stance and slow idle motion on race time', () => {
  const stances = new Set<number>();
  for (let person = 0; person < 24; person++) {
    const a = gridStaffPose(person, 0.3),
      b = gridStaffPose(person, 0.3);
    // Pause, replay and seek reproduce the same pose.
    expect(b).toEqual(a);
    stances.add(a.stance);
    let hipRange = 0,
      swayRange = 0;
    const first = gridStaffPose(person, 0);
    for (let t = 0; t <= 20; t += 0.25) {
      const pose = gridStaffPose(person, t);
      expect(pose.stance).toBe(first.stance);
      hipRange = Math.max(hipRange, Math.abs(pose.hip - first.hip));
      swayRange = Math.max(swayRange, Math.abs(pose.sway - first.sway));
      expect(Math.abs(pose.headYaw)).toBeLessThanOrEqual(0.25);
      expect(Math.abs(pose.lean - 0.04)).toBeLessThanOrEqual(0.012);
    }
    // Breathing and weight shift are visible but small (millimetres to ~2 cm).
    expect(hipRange).toBeGreaterThan(0.002);
    expect(hipRange).toBeLessThanOrEqual(0.008 + 1e-9);
    expect(swayRange).toBeGreaterThan(0.005);
    expect(swayRange).toBeLessThanOrEqual(0.024 + 1e-9);
  }
  expect(stances.size).toBe(GRID_STANCES.length);
  expect(() => gridStaffPose(-1, 0)).toThrow('Invalid grid staff pose');
  expect(() => gridStaffPose(0, NaN)).toThrow('Invalid grid staff pose');
});

it('poses every grid staff member reachably, with gloves on the posed wrists', () => {
  const sim = new Simulation({ ...DEFAULT_OPTIONS, opponents: 5 }),
    frame = sim.makeFrame();
  const view = new GridPreparationView(),
    camera = new T.Vector3().fromArray(frame, carBase(0));
  view.update(frame, camera);
  const staff = view.diagnostics().staff;
  expect(staff).toBeGreaterThanOrEqual(6);
  const poses = view.poses();
  expect(poses).toHaveLength(staff);
  expect(poses.every((p) => p.reachable)).toBe(true);
  const meshes = view.root.children.filter(
    (o): o is T.InstancedMesh => o instanceof T.InstancedMesh,
  );
  const [, , bodies, ...rest] = meshes;
  const heads = rest.filter((m) => m.geometry.getAttribute('headPerson'));
  const [left, right] = rest.filter((m) => !m.geometry.getAttribute('headPerson'));
  const headCount = heads.reduce((n, m) => n + m.count, 0);
  expect([headCount, left.count, right.count]).toEqual([staff, staff, staff]);
  // Each glove's cuff lands on its wrist joint: the bone matrices place the
  // rest wrist where the glove expects it.
  const glove = new T.Matrix4(),
    body = new T.Matrix4(),
    bone = new T.Matrix4();
  const data = (view as unknown as { boneData: Float32Array }).boneData;
  const wristRest = [CREW_REST[5], CREW_REST[8]];
  for (let i = 0; i < staff; i++) {
    bodies.getMatrixAt(i, body);
    for (const [hand, mesh] of [left, right].entries()) {
      mesh.getMatrixAt(i, glove);
      const cuff = CUFF.clone().applyMatrix4(glove);
      bone.fromArray(data, (i * CREW_BONES + (hand === 0 ? 5 : 8)) * 16);
      const wrist = wristRest[hand].clone().applyMatrix4(bone).applyMatrix4(body);
      expect(cuff.distanceTo(wrist)).toBeLessThan(1e-4);
    }
  }
  // The same race time gives the same bones (idle breathing is covered by
  // gridStaffPose above). Once the start sequence runs, the grid is empty.
  const before = data.slice(0, staff * CREW_BONES * 16);
  view.update(frame, camera);
  expect(data.slice(0, staff * CREW_BONES * 16)).toEqual(before);
  frame[H.TIME] += 0.5;
  view.update(frame, camera);
  expect(view.diagnostics().staff).toBe(0);
  view.root.traverse((o) => {
    if (o instanceof T.Mesh) {
      o.geometry.dispose();
      for (const m of [o.material].flat()) m.dispose();
    }
  });
});
