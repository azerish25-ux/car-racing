import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { F, R, RACE_BASE, carBase, HEADER, CAR_STRIDE, H } from '../src/simulation/protocol.ts';
import { VEHICLES, vehicleIndex, type VehicleDefinition } from '../src/simulation/vehicles.ts';
import { bodySheetFor } from '../src/rendering/vehicle-bodies/body-sheet.ts';
import { buildVehicleBody, VehicleBodies } from '../src/rendering/vehicle-bodies/index.ts';
import {
  CABIN_FOV,
  CABIN_MOTION_LIMIT,
  cabinDirection,
  cabinEye,
  cabinFor,
  cabinFov,
  mountFov,
  type CabinLayout,
} from '../src/rendering/vehicle-bodies/cabin.ts';
import {
  CABIN_DETAIL_DISTANCE,
  CABIN_GLASS_ORDER,
  type BuiltCabin,
} from '../src/rendering/vehicle-bodies/interior.ts';
import { cabinShiftLights, cabinReadout } from '../src/rendering/vehicle-bodies/cabin-display.ts';
import { COCKPIT_FOV } from '../src/rendering/options.ts';
import { bodyFrame } from '../src/rendering/vehicle-bodies/frame.ts';

type Body = ReturnType<typeof buildVehicleBody>;
const catalogue = Object.values(VEHICLES).filter((d) => bodySheetFor(d));
const built = new Map<string, Body>();
const body = (def: VehicleDefinition) => {
  let b = built.get(def.id);
  if (!b) built.set(def.id, (b = buildVehicleBody(1, def, bodySheetFor(def)!)));
  return b;
};
/** Visible-in-scene test that ignores the root's own LOD switch. */
const drawn = (o: T.Object3D, root: T.Object3D) => {
  for (let p: T.Object3D | null = o; p && p !== root; p = p.parent) if (!p.visible) return false;
  return true;
};
/** First drawn hit of a ray against a LOD group (front faces as the
 * materials' sides allow, like the renderer). */
function firstHit(root: T.Object3D, origin: T.Vector3, dir: T.Vector3, far = 10) {
  root.updateMatrixWorld(true);
  const ray = new T.Raycaster(origin, dir.clone().normalize(), 0, far);
  return ray.intersectObject(root, true).find((h) => drawn(h.object, root)) ?? null;
}
/** The cockpit as the driver sees it: helmet hidden, detail shown. */
function cockpitView(b: Body) {
  const cabin = b.lods[0].cabin!;
  cabin.head.visible = false;
  cabin.detail.visible = true;
  for (const part of cabin.wheelDetail) part.visible = true;
  return cabin;
}
const v3 = (p: readonly [number, number, number]) => new T.Vector3(...p);
/** Nearest drawn triangle of the near LOD to a point (m). */
function clearance(root: T.Object3D, point: T.Vector3) {
  root.updateMatrixWorld(true);
  const tri = new T.Triangle(),
    a = new T.Vector3(),
    b = new T.Vector3(),
    c = new T.Vector3(),
    q = new T.Vector3(),
    box = new T.Box3();
  let best = Infinity,
    name = '';
  root.traverse((o) => {
    if (!(o instanceof T.Mesh) || !drawn(o, root)) return;
    const g = o.geometry as T.BufferGeometry;
    g.computeBoundingBox();
    box.copy(g.boundingBox!).applyMatrix4(o.matrixWorld).expandByScalar(0.1);
    if (!box.containsPoint(point)) return;
    const p = g.getAttribute('position'),
      index = g.index;
    const count = index ? index.count : p.count;
    const ranges =
      Array.isArray(o.material) && g.groups.length
        ? g.groups.filter(
            (gr) => (o.material as T.Material[])[gr.materialIndex!]?.visible !== false,
          )
        : [{ start: 0, count }];
    for (const r of ranges)
      for (let k = r.start; k < r.start + r.count; k += 3) {
        const i0 = index ? index.getX(k) : k,
          i1 = index ? index.getX(k + 1) : k + 1,
          i2 = index ? index.getX(k + 2) : k + 2;
        tri.set(
          a.fromBufferAttribute(p, i0).applyMatrix4(o.matrixWorld),
          b.fromBufferAttribute(p, i1).applyMatrix4(o.matrixWorld),
          c.fromBufferAttribute(p, i2).applyMatrix4(o.matrixWorld),
        );
        const d = tri.closestPointToPoint(point, q).distanceTo(point);
        if (d < best) [best, name] = [d, o.name];
      }
  });
  return { distance: best, name };
}
const isGlass = (h: T.Intersection | null) => {
  if (!h) return false;
  const m = h.object as T.Mesh;
  const material = Array.isArray(m.material)
    ? m.material[h.face?.materialIndex ?? 0]
    : (m.material as T.Material);
  return !!material?.userData.vehicleGlass;
};

describe('cars loose ends: per-vehicle cabins', () => {
  it('derives a cockpit eye inside every catalogue cabin, clear of the near plane', () => {
    expect(catalogue.length).toBeGreaterThanOrEqual(40);
    for (const def of catalogue) {
      const layout = cabinFor(def)!,
        b = body(def),
        root = b.lods[0].group;
      expect(layout, def.id).not.toBeNull();
      expect(cabinFor(VEHICLES.apx01)).toBeNull();
      cockpitView(b);
      const eye = v3(layout.eye);
      // Inside the machine's collision box, ahead of the seat back and behind
      // the steering wheel.
      expect(Math.abs(eye.x), def.id).toBeLessThan(def.halfExtents[0]);
      expect(Math.abs(eye.z), def.id).toBeLessThan(def.halfExtents[2]);
      expect(layout.wheel.centre[2] - eye.z, def.id).toBeGreaterThan(0.25);
      expect(layout.wheel.centre[1], def.id).toBeLessThan(eye.y - 0.2);
      // Nothing drawn within the camera's near plane (0.045 m) of the eye.
      const near = clearance(root, eye);
      expect(near.distance, `${def.id} ${near.name}`).toBeGreaterThan(0.05);
      // Something to sit on below the eye: the driver's body or the seat.
      const down = firstHit(root, eye, new T.Vector3(0, -1, 0), 1.2);
      expect(down, def.id).not.toBeNull();
      const gaze = cabinDirection(layout.cockpit, new T.Vector3());
      const ahead = firstHit(root, eye, gaze, 6);
      if (layout.family === 'closed') {
        // Roofed: under the roof (the headliner or cage), enclosed at the sides
        // and behind, and looking out through the windscreen.
        const up = firstHit(root, eye, new T.Vector3(0, 1, 0), 0.5);
        expect(up, def.id).not.toBeNull();
        expect(layout.roof! - eye.y, def.id).toBeGreaterThan(0.08);
        for (const x of [-1, 1])
          expect(
            firstHit(root, eye, new T.Vector3(x, 0, 0), def.halfExtents[0] * 2),
            def.id,
          ).not.toBeNull();
        expect(firstHit(root, eye, new T.Vector3(0, 0, -1), 1.5), def.id).not.toBeNull();
        expect(isGlass(ahead), `${def.id} sees ${ahead?.object.name}`).toBe(true);
        expect(ahead!.distance, def.id).toBeGreaterThan(0.3);
        // The level horizon is seen through the windscreen too.
        const level = firstHit(root, eye, new T.Vector3(0, 0, 1), 6);
        expect(isGlass(level), `${def.id} level ${level?.object.name}`).toBe(true);
      } else {
        // Open cockpits: nothing directly in front of the eyes, and the eyes
        // above the cockpit rim (a sideways ray at eye height escapes).
        expect(ahead === null || ahead.distance > 0.3, `${def.id} ${ahead?.object.name}`).toBe(
          true,
        );
      }
    }
  });
  it('mounts the onboard camera by family and sets lenses per class', () => {
    for (const def of catalogue) {
      const layout = cabinFor(def)!;
      const roofed = layout.family === 'closed';
      const kind =
        layout.family === 'open-wheel'
          ? 'airbox'
          : layout.family === 'buggy' || (roofed && layout.race)
            ? 'roof'
            : 'bonnet';
      expect(layout.mount.kind, def.id).toBe(kind);
      // The mount is outside the cabin: above the roof, the bonnet or the airbox.
      const b = body(def),
        root = b.lods[0].group;
      const below = firstHit(root, v3(layout.mount.eye), new T.Vector3(0, -1, 0), 1);
      if (layout.family !== 'kart') {
        expect(below, def.id).not.toBeNull();
        expect(below!.distance, def.id).toBeGreaterThan(0.03);
      }
      if (layout.mount.kind === 'roof' && roofed)
        expect(layout.mount.eye[1], def.id).toBeGreaterThan(layout.roof!);
      // Class lenses: the Formula default widened for closed cars, karts most.
      expect(cabinFov(layout, COCKPIT_FOV.default)).toBe(layout.cockpit.fov);
      expect(layout.cockpit.fov).toBeGreaterThanOrEqual(COCKPIT_FOV.default);
      expect(cabinFov(layout, COCKPIT_FOV.default + 6)).toBe(layout.cockpit.fov + 6);
      expect(cabinFov(layout, Number.NaN)).toBe(layout.cockpit.fov);
      expect(mountFov(layout, 80)).toBe(layout.mount.fov + 4);
    }
    const lens = (id: string) => cabinFor(VEHICLES[id])!.cockpit.fov;
    expect(lens('jf2')).toBe(COCKPIT_FOV.default);
    expect(lens('sk125')).toBe(CABIN_FOV.kart);
    expect(lens('hy9')).toBe(CABIN_FOV.prototype);
    expect(lens('gt8f')).toBe(CABIN_FOV.gt);
    expect(lens('dx8')).toBe(CABIN_FOV.truck);
    expect(lens('sk125')).toBeGreaterThan(lens('gt8f'));
    expect(lens('gt8f')).toBeGreaterThan(lens('hy9'));
    expect(lens('rl2')).toBeGreaterThan(lens('tc1'));
    // Different machines, different eyes: a truck sits far higher above the
    // road than a GT, a GT higher than a kart.
    const eyeAboveRoad = (id: string) =>
      cabinFor(VEHICLES[id])!.eye[1] - bodyFrame(VEHICLES[id]).ground;
    expect(eyeAboveRoad('dx8') - eyeAboveRoad('gt8f')).toBeGreaterThan(0.5);
    expect(eyeAboveRoad('gt8f') - eyeAboveRoad('sk125')).toBeGreaterThan(0.15);
    expect(eyeAboveRoad('hy9')).toBeLessThan(eyeAboveRoad('rh3'));
    // The bounded seat motion keeps the eye in the cabin.
    const out = cabinEye(cabinFor(VEHICLES.gt8f)!, new T.Vector3(5, -5, 5), new T.Vector3());
    const e = cabinFor(VEHICLES.gt8f)!.eye;
    expect(out.x - e[0]).toBeCloseTo(CABIN_MOTION_LIMIT[0], 9);
    expect(out.y - e[1]).toBeCloseTo(-CABIN_MOTION_LIMIT[1], 9);
    expect(out.z - e[2]).toBeCloseTo(CABIN_MOTION_LIMIT[2], 9);
    expect(() =>
      cabinEye(cabinFor(VEHICLES.gt8f)!, new T.Vector3(NaN, 0, 0), new T.Vector3()),
    ).toThrow();
  });
  it('builds interiors only at LOD0, with a cage in roofed race cars', () => {
    const names = (root: T.Object3D) => {
      const out: string[] = [];
      root.traverse((o) => out.push(o.name));
      return out.join('|');
    };
    for (const def of catalogue) {
      const b = body(def),
        layout = cabinFor(def)!,
        cabin = b.lods[0].cabin as BuiltCabin;
      expect(cabin, def.id).toBeDefined();
      expect(b.lods[1].cabin).toBeUndefined();
      expect(b.lods[2].cabin).toBeUndefined();
      for (const far of [b.lods[1].group, b.lods[2].group])
        expect(names(far), def.id).not.toMatch(/Cabin detail|Steering|Driver head|Mirror glass/);
      expect(cabin.detail.parent).toBe(b.lods[0].group);
      expect(cabin.head.children.length, def.id).toBeGreaterThan(0);
      expect(cabin.steering.children.length, def.id).toBeGreaterThan(0);
      expect(layout.cage).toBe(
        layout.family === 'closed' && layout.race && layout.style !== 'prototype',
      );
      if (
        layout.family === 'closed' ||
        layout.family === 'open-cockpit' ||
        layout.family === 'open-wheel'
      )
        expect(cabin.mirrors.length, def.id).toBe(2);
    }
  });
  it('pays for cabin detail only on the followed car and close rivals, turns the wheel, and hides the own helmet', () => {
    const bodies = new VehicleBodies();
    const frame = new Float32Array(HEADER + 3 * CAR_STRIDE);
    frame[H.CARS] = 3;
    frame[H.TIME] = 1;
    frame[carBase(0) + RACE_BASE + R.VEHICLE] = vehicleIndex('gt8f');
    frame[carBase(1) + RACE_BASE + R.VEHICLE] = vehicleIndex('gt8f');
    frame[carBase(2) + RACE_BASE + R.VEHICLE] = vehicleIndex('jf2');
    frame[carBase(0) + F.STEER] = 0.1;
    for (let i = 0; i < 3; i++) {
      frame[carBase(i) + F.FRONT_HEALTH] = 1;
      frame[carBase(i) + F.REAR_HEALTH] = 1;
    }
    const hosts = [0, 1, 2].map(() => ({ root: new T.Group(), lodLevel: 0 }));
    hosts[1].root.position.set(0, 0, 40);
    hosts[2].root.position.set(3, 0, 6);
    const camera = new T.Vector3(0.3, 0.5, -0.4);
    bodies.update(frame, frame, 1, hosts, false, { follow: 0, cockpit: true, camera });
    const cabin = (id: number) => bodies.cabinOf(id)!;
    expect(cabin(0).detail.visible).toBe(true);
    expect(cabin(0).head.visible).toBe(false);
    expect(cabin(0).glass.length).toBeGreaterThan(0);
    expect(cabin(0).glass.every((g) => g.renderOrder === CABIN_GLASS_ORDER)).toBe(true);
    expect(cabin(0).steering.rotation.z).toBeCloseTo(
      -0.1 * cabinFor(VEHICLES.gt8f)!.wheel.ratio,
      5,
    );
    // A rival 40 m away keeps its near body but not its cabin detail.
    expect(camera.distanceTo(hosts[1].root.position)).toBeGreaterThan(CABIN_DETAIL_DISTANCE);
    expect(cabin(1).detail.visible).toBe(false);
    expect(cabin(1).head.visible).toBe(true);
    expect(cabin(1).glass.every((g) => g.renderOrder === 0)).toBe(true);
    // A rival alongside shows its cabin; nothing of it is sorted as the own glass.
    expect(cabin(2).detail.visible).toBe(true);
    expect(cabin(2).wheelDetail.every((o) => o.visible)).toBe(true);
    expect(bodies.mirrorsFor(0)!.surfaces).toHaveLength(2);
    expect(bodies.mirrorsFor(0)!.root.visible).toBe(true);
    // Chase view of the same car: the helmet returns, the glass sorts normally.
    bodies.update(frame, frame, 1, hosts, false, { follow: 0, cockpit: false, camera });
    expect(cabin(0).head.visible).toBe(true);
    expect(cabin(0).glass.every((g) => g.renderOrder === 0)).toBe(true);
    // Count what a far rival draws against the followed car.
    const draws = (id: number) => {
      const root = (bodies as unknown as { bodies: Map<number, Body> }).bodies.get(id)!.lods[0]
        .group;
      let n = 0;
      root.traverse((o) => {
        if (!(o instanceof T.Mesh) || !drawn(o, root)) return;
        n += Array.isArray(o.material) ? (o.geometry as T.BufferGeometry).groups.length : 1;
      });
      return n;
    };
    expect(draws(0) - draws(1)).toBeGreaterThanOrEqual(6);
    // LOD1: no cabin at all.
    hosts[1].lodLevel = 1;
    bodies.update(frame, frame, 1, hosts, false, { follow: 1, cockpit: true, camera });
    expect(cabin(1).detail.visible).toBe(false);
    expect(bodies.mirrorsFor(1)).toBeNull();
  });
  it('glazes with the library glass: premultiplied Fresnel transmission, double-sided, no shadow', () => {
    for (const id of ['gt8f', 'rh3', 'tc1', 'hy9']) {
      const def = VEHICLES[id],
        b = body(def),
        layout = cabinFor(def)!;
      const glass = b.lods[0].cabin!.glass.find((g) => g.name === 'Cabin glass')!;
      expect(glass, id).toBeDefined();
      const groups = (glass.geometry as T.BufferGeometry).groups;
      expect(groups.length).toBeGreaterThan(0);
      const m = (glass.material as T.Material[])[
        groups[0].materialIndex!
      ] as T.MeshPhysicalMaterial;
      expect(m.userData.library).toBe('glass');
      expect(m.userData.vehicleGlass).toBe(layout.race ? 'race' : 'road');
      expect(m.transparent && !m.depthWrite).toBe(true);
      expect([m.blending, m.blendSrc, m.blendDst]).toEqual([
        T.CustomBlending,
        T.OneFactor,
        T.OneMinusSrcAlphaFactor,
      ]);
      expect(m.side).toBe(T.DoubleSide);
      expect(m.forceSinglePass).toBe(true);
      // Road glazing is a little darker than race polycarbonate.
      expect(1 - m.opacity).toBeGreaterThan(0.75);
      expect(glass.castShadow).toBe(false);
      // The opaque greenhouse carries no glass triangles of its own.
      const house = b.lods[0].group.getObjectByName('Greenhouse') as T.Mesh;
      for (const g of (house.geometry as T.BufferGeometry).groups)
        expect(g.materialIndex).not.toBe(1);
      // The shadow proxy leaves the glazing and the cabin lid out: a ray down
      // through the windscreen falls through to the floor.
      const proxy = b.proxy;
      proxy.updateMatrixWorld(true);
      const zw = layout.dash!.front - 0.2;
      const ray = new T.Raycaster(
        new T.Vector3(0, layout.roof! + 1, zw),
        new T.Vector3(0, -1, 0),
        0,
        5,
      );
      const material = proxy.material as T.Material;
      material.side = T.DoubleSide;
      const hits = ray.intersectObject(proxy);
      material.side = T.FrontSide;
      expect(hits.length, id).toBeGreaterThan(0);
      expect(hits[0].point.y, id).toBeLessThan(layout.cell!.floor + 0.05);
    }
    expect(VEHICLES.rh3.classId).toBe('road');
  });
  it('drives the instruments from the snapshot on the machine engine scale', () => {
    const engine = { idleRPM: 1000, shiftRPM: 8000, limiterRPM: 8500 };
    expect(cabinShiftLights(0, engine)).toBe(0);
    expect(cabinShiftLights(8000 * 0.82, engine)).toBe(1);
    expect(cabinShiftLights(8000, engine)).toBe(10);
    expect(cabinShiftLights(Number.NaN, engine)).toBe(0);
    const frame = new Float32Array(HEADER + CAR_STRIDE),
      o = carBase(0);
    frame[o + F.RPM] = 4750;
    frame[o + F.GEAR] = 3;
    frame[o + F.SPEED] = 40;
    const v = cabinReadout(frame, o, engine);
    expect(v.revs).toBeCloseTo(0.5, 6);
    expect(v.gear).toBe('3');
    expect(v.speed).toBe(144);
    // Every cabin is scaled to its own engine.
    const layouts: CabinLayout[] = catalogue.map((d) => cabinFor(d)!);
    expect(new Set(layouts.map((l) => l.id)).size).toBe(catalogue.length);
  });
});
