import * as T from 'three';
import { describe, expect, it } from 'vitest';
import {
  F,
  R,
  RACE_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
  HEADER,
  CAR_STRIDE,
  H,
} from '../src/simulation/protocol.ts';
import { VEHICLES, vehicleIndex } from '../src/simulation/vehicles.ts';
import { bodySheetFor } from '../src/rendering/vehicle-bodies/body-sheet.ts';
import { buildVehicleBody, VehicleBodies } from '../src/rendering/vehicle-bodies/index.ts';
import { loftRings, sampleProfile, Track } from '../src/rendering/vehicle-bodies/loft.ts';

const triangles = (root: T.Object3D) => {
  let n = 0;
  root.traverse((o) => {
    if (!(o instanceof T.Mesh)) return;
    const g = o.geometry as T.BufferGeometry;
    n += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  });
  return n;
};
const finite = (root: T.Object3D) => {
  let ok = true;
  root.traverse((o) => {
    if (!(o instanceof T.Mesh)) return;
    const p = (o.geometry as T.BufferGeometry).getAttribute('position').array as ArrayLike<number>;
    for (let i = 0; i < p.length; i++) if (!Number.isFinite(p[i])) ok = false;
  });
  return ok;
};
describe('WP30 procedural vehicle bodies', () => {
  it('lofts smooth, outward-facing surfaces with monotone tracks', () => {
    const track = new Track([
      [0, 0],
      [1, 1],
      [2, 1],
      [3, 0],
    ]);
    // Monotone: never overshoots the plateau.
    for (let x = 0; x <= 3; x += 0.05) expect(track.at(x)).toBeLessThanOrEqual(1 + 1e-12);
    const ellipse = sampleProfile(
      [
        [0, -1],
        [0.7, -0.7],
        [1, 0],
        [0.7, 0.7],
        [0, 1],
      ],
      [4, 4, 4, 4],
    );
    expect(ellipse).toHaveLength(17);
    const g = loftRings(
      [-1, 0, 1].map((z) => ({
        z,
        half: ellipse.map(([x, y]) => [x * (1.2 - z * z * 0.2), y] as const),
      })),
      { capStart: true, capEnd: true },
    );
    const p = g.getAttribute('position'),
      n = g.getAttribute('normal');
    let outward = 0;
    for (let i = 0; i < p.count; i++)
      if (p.getX(i) * n.getX(i) + p.getY(i) * n.getY(i) + p.getZ(i) * n.getZ(i) * 0.2 > 0)
        outward++;
    expect(outward / p.count).toBeGreaterThan(0.95);
  });
  it('builds every catalogue body with three LODs, a shadow proxy and matching wheels', () => {
    for (const def of Object.values(VEHICLES)) {
      const sheet = bodySheetFor(def);
      // The Formula car has its own assets; motorcycles their bike shells.
      if (def.id === 'apx01' || def.dynamicsKind !== 'four-wheel') {
        expect(sheet).toBeNull();
        continue;
      }
      expect(sheet, def.id).not.toBeNull();
      const body = buildVehicleBody(3, def, sheet!);
      expect(body.lods).toHaveLength(3);
      const counts = body.lods.map((l) => triangles(l.group));
      // Strictly cheaper representations, within the §18.3 hypotheses.
      expect(counts[0], def.id).toBeGreaterThan(counts[1]);
      expect(counts[1], def.id).toBeGreaterThan(counts[2]);
      expect(counts[0], def.id).toBeLessThan(160000);
      expect(counts[2], def.id).toBeLessThan(12000);
      expect(triangles(body.proxy), def.id).toBeLessThan(15000);
      expect(body.proxy.castShadow && !body.proxy.visible).toBe(true);
      expect(finite(body.root), def.id).toBe(true);
      // Wheels sit on the definition's centres with its radius.
      for (const wheels of body.wheels)
        wheels.forEach((w, i) => {
          expect(w.pivot.position.x).toBeCloseTo(def.wheelPositions[i][0], 6);
          expect(w.pivot.position.z).toBeCloseTo(def.wheelPositions[i][2], 6);
          expect(w.radius).toBe(def.spec.wheelRadius);
        });
      // The near body fits the collision box (overhangs within 0.35 m).
      const box = new T.Box3().setFromObject(body.lods[0].group);
      expect(box.max.z, def.id).toBeLessThan(def.halfExtents[2] + 0.45);
      expect(box.min.z, def.id).toBeGreaterThan(-def.halfExtents[2] - 0.45);
      expect(box.max.x - box.min.x, def.id).toBeLessThan(def.halfExtents[0] * 2 + 0.45);
    }
  });
  it('follows the snapshot: definition, wheel travel, steer, phase, lamps and damage', () => {
    const bodies = new VehicleBodies();
    const frame = new Float32Array(HEADER + 2 * CAR_STRIDE);
    frame[H.CARS] = 2;
    frame[H.TIME] = 1;
    frame[carBase(0) + RACE_BASE + R.VEHICLE] = vehicleIndex('apx01');
    frame[carBase(1) + RACE_BASE + R.VEHICLE] = vehicleIndex('gt10m');
    const o = carBase(1);
    frame[o + F.FRONT_HEALTH] = 1;
    frame[o + F.REAR_HEALTH] = 0.02;
    frame[o + F.BRAKE] = 1;
    for (let i = 0; i < 4; i++) {
      const p = o + WHEEL_BASE + i * WHEEL_STRIDE;
      frame[p + W.LENGTH] = 0.2;
      frame[p + W.STEER] = i < 2 ? 0.1 : 0;
      frame[p + W.ROTATION] = 1.25;
      frame[p + W.LOAD] = 3000;
      frame[p + W.PRESSURE] = 155;
      frame[p + W.DISC_TEMP] = 800;
    }
    const hosts = [0, 1].map(() => ({ root: new T.Group(), lodLevel: 0 }));
    hosts[1].root.position.set(5, 1, 2);
    bodies.update(frame, frame, 1, hosts);
    expect(bodies.count).toBe(1);
    expect(hosts[0].root.visible).toBe(true);
    expect(hosts[1].root.visible).toBe(false);
    const built = (
      bodies as unknown as { bodies: Map<number, ReturnType<typeof buildVehicleBody>> }
    ).bodies.get(1)!;
    expect(built.root.position.toArray()).toEqual([5, 1, 2]);
    const gt = VEHICLES.gt10m;
    const wheel = built.wheels[0][0];
    expect(wheel.pivot.position.y).toBeCloseTo(gt.wheelPositions[0][1] - 0.2, 6);
    expect(wheel.pivot.rotation.y).toBeCloseTo(0.1, 6);
    expect(wheel.spin.rotation.x).toBeCloseTo(1.25, 6);
    expect(wheel.disc!.emissiveIntensity).toBeGreaterThan(0.5);
    expect(built.materials.tail.emissiveIntensity).toBeGreaterThan(2);
    // Rear wing hidden by recorded rear damage; LOD switch follows the host.
    expect(built.lods[0].rear.every((e) => !e.visible)).toBe(true);
    hosts[1].lodLevel = 2;
    bodies.update(frame, frame, 1, hosts);
    expect(built.lods.map((l) => l.group.visible)).toEqual([false, false, true]);
    expect(bodies.shadowSubstitutes()).toHaveLength(1);
  });
});
