import * as T from 'three';
import { describe, expect, it } from 'vitest';
import {
  F,
  R,
  RACE_BASE,
  carBase,
  HEADER,
  CAR_STRIDE,
  H,
  W,
  WHEEL_BASE,
} from '../src/simulation/protocol.ts';
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
  mountEye,
  mountFov,
  type CabinLayout,
} from '../src/rendering/vehicle-bodies/cabin.ts';
import { sharedMaterials } from '../src/rendering/vehicle-bodies/materials.ts';
import {
  CABIN_DETAIL_DISTANCE,
  CABIN_GLASS_ORDER,
  cabinDetailDistance,
  type BuiltCabin,
} from '../src/rendering/vehicle-bodies/interior.ts';
import { cabinShiftLights, cabinReadout } from '../src/rendering/vehicle-bodies/cabin-display.ts';
import { COCKPIT_FOV } from '../src/rendering/options.ts';
import { bodyFrame } from '../src/rendering/vehicle-bodies/frame.ts';
import { festivalFormFor } from '../src/rendering/vehicle-bodies/festival-form.ts';

type Body = ReturnType<typeof buildVehicleBody>;
const catalogue = Object.values(VEHICLES).filter((d) => bodySheetFor(d));
const built = new Map<string, Body>();
const body = (def: VehicleDefinition) => {
  let b = built.get(def.id);
  if (!b) built.set(def.id, (b = buildVehicleBody(1, def, bodySheetFor(def)!)));
  return b;
};
/** Every catalogue body, plus the open-world production form of each road
 * car (FestivalCars builds those with `{ festival: true }`). */
const festivalBuilt = new Map<string, Body>();
const variants: { def: VehicleDefinition; label: string; make: () => Body }[] = [
  ...catalogue.map((def) => ({ def, label: def.id, make: () => body(def) })),
  ...catalogue
    .filter((def) => {
      const sheet = bodySheetFor(def);
      return sheet?.kind === 'closed' && !!festivalFormFor(def, sheet);
    })
    .map((def) => ({
      def,
      label: `${def.id} (festival form)`,
      make: () => {
        let b = festivalBuilt.get(def.id);
        if (!b)
          festivalBuilt.set(
            def.id,
            (b = buildVehicleBody(1, def, bodySheetFor(def)!, { festival: true })),
          );
        return b;
      },
    })),
];
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
/** Drawn triangles of the near LOD (world space) overlapping `box`; the
 * suspension links are posed at runtime between hub and chassis, so their
 * unposed unit geometry is left out. */
function trianglesNear(root: T.Object3D, box: T.Box3) {
  root.updateMatrixWorld(true);
  const out: T.Vector3[][] = [],
    bounds = new T.Box3();
  root.traverse((o) => {
    if (!(o instanceof T.Mesh) || !drawn(o, root) || o.name === 'Suspension link') return;
    const g = o.geometry as T.BufferGeometry;
    g.computeBoundingBox();
    if (!bounds.copy(g.boundingBox!).applyMatrix4(o.matrixWorld).intersectsBox(box)) return;
    const p = g.getAttribute('position'),
      index = g.index,
      count = index ? index.count : p.count;
    const ranges =
      Array.isArray(o.material) && g.groups.length
        ? g.groups.filter(
            (gr) => (o.material as T.Material[])[gr.materialIndex!]?.visible !== false,
          )
        : [{ start: 0, count }];
    for (const r of ranges)
      for (let k = r.start; k < r.start + r.count; k += 3) {
        const tri = [k, k + 1, k + 2].map((i) =>
          new T.Vector3()
            .fromBufferAttribute(p, index ? index.getX(i) : i)
            .applyMatrix4(o.matrixWorld),
        );
        if (bounds.setFromPoints(tri).intersectsBox(box)) out.push(tri);
      }
  });
  return out;
}
/** Whether any triangle reaches into a camera's near volume: the frustum
 * (vertical FOV deg, aspect) between the eye and `depth` m along the view,
 * by clipping each triangle against the volume's six planes. */
function intrudesNearVolume(
  triangles: T.Vector3[][],
  eye: T.Vector3,
  view: T.Vector3,
  fov: number,
  aspect: number,
  depth: number,
) {
  const right = new T.Vector3().crossVectors(view, new T.Vector3(0, 1, 0)).normalize(),
    up = new T.Vector3().crossVectors(right, view),
    tv = Math.tan((fov * Math.PI) / 360),
    th = tv * aspect,
    d = new T.Vector3();
  const planes = [
    (p: number[]) => p[2],
    (p: number[]) => depth - p[2],
    (p: number[]) => th * p[2] - p[0],
    (p: number[]) => th * p[2] + p[0],
    (p: number[]) => tv * p[2] - p[1],
    (p: number[]) => tv * p[2] + p[1],
  ];
  for (const tri of triangles) {
    let poly = tri.map((v) => {
      d.copy(v).sub(eye);
      return [d.dot(right), d.dot(up), d.dot(view)];
    });
    for (const plane of planes) {
      const next: number[][] = [];
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i],
          b = poly[(i + 1) % poly.length],
          ga = plane(a),
          gb = plane(b);
        if (ga >= 0) next.push(a);
        if (ga >= 0 !== gb >= 0) next.push(a.map((x, k) => x + ((b[k] - x) * ga) / (ga - gb)));
      }
      poly = next;
      if (!poly.length) break;
    }
    if (poly.length >= 3) return true;
  }
  return false;
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
    for (const { def, label, make } of variants) {
      const layout = cabinFor(def)!,
        b = make(),
        root = b.lods[0].group;
      expect(layout, label).not.toBeNull();
      expect(cabinFor(VEHICLES.apx01)).toBeNull();
      cockpitView(b);
      const eye = v3(layout.eye);
      // Inside the machine's collision box, ahead of the seat back and behind
      // the steering wheel.
      expect(Math.abs(eye.x), label).toBeLessThan(def.halfExtents[0]);
      expect(Math.abs(eye.z), label).toBeLessThan(def.halfExtents[2]);
      expect(layout.wheel.centre[2] - eye.z, label).toBeGreaterThan(0.25);
      expect(layout.wheel.centre[1], label).toBeLessThan(eye.y - 0.2);
      // Nothing drawn within the camera's near plane (0.045 m) of the eye.
      const near = clearance(root, eye);
      expect(near.distance, `${label} ${near.name}`).toBeGreaterThan(0.05);
      // Something to sit on below the eye: the driver's body or the seat.
      const down = firstHit(root, eye, new T.Vector3(0, -1, 0), 1.2);
      expect(down, label).not.toBeNull();
      const gaze = cabinDirection(layout.cockpit, new T.Vector3());
      const ahead = firstHit(root, eye, gaze, 6);
      if (layout.family === 'closed') {
        // Roofed: under the roof (the headliner or cage), enclosed at the sides
        // and behind, and looking out through the windscreen.
        const up = firstHit(root, eye, new T.Vector3(0, 1, 0), 0.5);
        expect(up, label).not.toBeNull();
        expect(layout.roof! - eye.y, label).toBeGreaterThan(0.08);
        for (const x of [-1, 1])
          expect(
            firstHit(root, eye, new T.Vector3(x, 0, 0), def.halfExtents[0] * 2),
            label,
          ).not.toBeNull();
        expect(firstHit(root, eye, new T.Vector3(0, 0, -1), 1.5), label).not.toBeNull();
        expect(isGlass(ahead), `${label} sees ${ahead?.object.name}`).toBe(true);
        expect(ahead!.distance, label).toBeGreaterThan(0.3);
        // The level horizon is seen through the windscreen too.
        const level = firstHit(root, eye, new T.Vector3(0, 0, 1), 6);
        expect(isGlass(level), `${label} level ${level?.object.name}`).toBe(true);
      } else {
        // Open cockpits: nothing directly in front of the eyes, and the eyes
        // above the cockpit rim (a sideways ray at eye height escapes).
        expect(ahead === null || ahead.distance > 0.3, `${label} ${ahead?.object.name}`).toBe(true);
      }
    }
  });
  it('mounts the onboard camera by family and sets lenses per class', () => {
    for (const { def, label, make } of variants) {
      const layout = cabinFor(def)!;
      const roofed = layout.family === 'closed';
      const kind =
        layout.family === 'open-wheel'
          ? 'airbox'
          : layout.family === 'buggy' || (roofed && layout.race)
            ? 'roof'
            : 'bonnet';
      expect(layout.mount.kind, label).toBe(kind);
      // The mount is outside the cabin: above the roof, the bonnet or the airbox.
      const b = make(),
        root = b.lods[0].group;
      const below = firstHit(root, v3(layout.mount.eye), new T.Vector3(0, -1, 0), 1);
      if (layout.family !== 'kart') {
        expect(below, label).not.toBeNull();
        expect(below!.distance, label).toBeGreaterThan(0.03);
      }
      if (layout.mount.kind === 'roof' && roofed)
        expect(layout.mount.eye[1], label).toBeGreaterThan(layout.roof!);
      // Class lenses: the Formula default widened for closed cars, karts most.
      expect(cabinFov(layout, COCKPIT_FOV.default)).toBe(layout.cockpit.fov);
      expect(layout.cockpit.fov).toBeGreaterThanOrEqual(COCKPIT_FOV.default);
      expect(cabinFov(layout, COCKPIT_FOV.default + 6)).toBe(layout.cockpit.fov + 6);
      expect(cabinFov(layout, Number.NaN)).toBe(layout.cockpit.fov);
      expect(mountFov(layout, 80)).toBe(layout.mount.fov + 4);
    }
    // The mounted camera is bolted to the car: its inertial offset is bounded.
    const g = cabinFor(VEHICLES.bg2)!,
      bounded = mountEye(g, new T.Vector3(-5, 5, -5), new T.Vector3());
    expect(bounded.x - g.mount.eye[0]).toBeCloseTo(-CABIN_MOTION_LIMIT[0], 9);
    expect(bounded.y - g.mount.eye[1]).toBeCloseTo(CABIN_MOTION_LIMIT[1], 9);
    expect(bounded.z - g.mount.eye[2]).toBeCloseTo(-CABIN_MOTION_LIMIT[2], 9);
    expect(() => mountEye(g, new T.Vector3(0, NaN, 0), new T.Vector3())).toThrow();
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
  it('keeps every onboard mount clear of the bodywork across its whole lens and motion', () => {
    // Nothing drawn may reach within 6 cm of the lens anywhere in the view
    // (near plane 0.045 m), at the speed-widened lens on a 21:9 screen, from
    // every corner of the bounded camera motion: a buggy's roof camera once
    // sat 1 cm behind its light bar, a kart's nose camera behind the wheel rim
    // and a no-airbox single-seater's inside the headrest bulkhead.
    const L = CABIN_MOTION_LIMIT;
    for (const { def, label, make } of variants) {
      const layout = cabinFor(def)!,
        b = make(),
        root = b.lods[0].group,
        cabin = b.lods[0].cabin!;
      // The onboard view: the helmet drawn, the followed car's detail shown.
      cabin.head.visible = true;
      cabin.detail.visible = true;
      for (const part of cabin.wheelDetail) part.visible = true;
      const eye = v3(layout.mount.eye),
        view = cabinDirection(layout.mount, new T.Vector3()).normalize(),
        triangles = trianglesNear(
          root,
          new T.Box3(eye.clone().subScalar(0.25), eye.clone().addScalar(0.25)),
        ),
        at = new T.Vector3(),
        motion = new T.Vector3();
      for (const x of [-1, 0, 1])
        for (const y of [-1, 0, 1])
          for (const z of [-1, 0, 1]) {
            mountEye(layout, motion.set(x * L[0] * 2, y * L[1] * 2, z * L[2] * 2), at);
            expect(
              intrudesNearVolume(triangles, at, view, mountFov(layout, 1e3), 21 / 9, 0.06),
              `${label} mount ${x},${y},${z}`,
            ).toBe(false);
          }
    }
    // The reported buggy: the roof camera sits ahead of the light bar.
    const buggy = cabinFor(VEHICLES.bg2)!,
      zCockpit = bodyFrame(VEHICLES.bg2).z(
        (bodySheetFor(VEHICLES.bg2) as { cockpit: number }).cockpit,
      );
    expect(buggy.mount.eye[2] - CABIN_MOTION_LIMIT[2]).toBeGreaterThan(zCockpit + 0.54 + 0.03);
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
  it('scales cabin cost with the detail tier and draws rear-view feeds at feed detail', () => {
    const bodies = new VehicleBodies();
    const frame = new Float32Array(HEADER + 3 * CAR_STRIDE);
    frame[H.CARS] = 3;
    frame[H.TIME] = 1;
    for (let i = 0; i < 3; i++) {
      frame[carBase(i) + RACE_BASE + R.VEHICLE] = vehicleIndex('gt8f');
      frame[carBase(i) + F.FRONT_HEALTH] = 1;
      frame[carBase(i) + F.REAR_HEALTH] = 1;
    }
    frame[carBase(1) + WHEEL_BASE + W.STEER] = 0.2;
    const hosts = [0, 1, 2].map(() => ({ root: new T.Group(), lodLevel: 0 }));
    hosts[1].root.position.set(2, 0, -6);
    hosts[2].root.position.set(-3, 0, 8);
    const camera = new T.Vector3(0.3, 0.5, -0.4);
    const cabin = (id: number) => bodies.cabinOf(id)!;
    // Low tier: the followed car's cabin detail only, even for a car alongside.
    expect(cabinDetailDistance('low')).toBe(0);
    expect(cabinDetailDistance('medium')).toBe(CABIN_DETAIL_DISTANCE);
    expect(cabinDetailDistance('high')).toBe(CABIN_DETAIL_DISTANCE);
    const view = (quality: 'low' | 'medium' | 'high') => ({
      follow: 0,
      cockpit: true,
      camera,
      detailDistance: cabinDetailDistance(quality),
    });
    bodies.update(frame, frame, 1, hosts, false, view('low'));
    expect(cabin(0).detail.visible).toBe(true);
    expect(cabin(1).detail.visible).toBe(false);
    expect(cabin(2).detail.visible).toBe(false);
    bodies.update(frame, frame, 1, hosts, false, view('medium'));
    expect(cabin(1).detail.visible).toBe(true);
    expect(cabin(2).detail.visible).toBe(true);
    // A rear-view feed pass: the rival behind at the feed's coarse LOD, no
    // cabin detail anywhere; the main view comes back afterwards.
    const lods = (id: number) =>
      (bodies as unknown as { bodies: Map<number, Body> }).bodies.get(id)!.lods;
    bodies.showFeedDetail((position) => (position.z < 0 ? 2 : 0));
    expect(lods(1).map((l) => l.group.visible)).toEqual([false, false, true]);
    expect(lods(2).map((l) => l.group.visible)).toEqual([true, false, false]);
    for (const id of [0, 1, 2]) expect(cabin(id).detail.visible).toBe(false);
    expect(cabin(0).wheelDetail.every((o) => !o.visible)).toBe(true);
    bodies.restoreFeedDetail();
    for (const id of [0, 1, 2]) {
      expect(lods(id).map((l) => l.group.visible)).toEqual([true, false, false]);
      expect(cabin(id).detail.visible).toBe(true);
    }
    // The feed's LOD is posed on the next update (no stale wheel set), and a
    // feed never draws a finer LOD than the main view.
    const steer = (id: number, level: number) =>
      (bodies as unknown as { bodies: Map<number, Body> }).bodies.get(id)!.wheels[level][0].pivot
        .rotation.y;
    bodies.update(frame, frame, 1, hosts, false, view('medium'));
    expect(steer(1, 2)).toBeCloseTo(0.2, 6);
    expect(steer(1, 1)).toBe(0);
    hosts[2].lodLevel = 1;
    bodies.update(frame, frame, 1, hosts, false, view('medium'));
    bodies.showFeedDetail(() => 0);
    expect(lods(2).map((l) => l.group.visible)).toEqual([false, true, false]);
    bodies.restoreFeedDetail();
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
      // Clear enough to drive behind; the race/road comparison is below.
      expect(1 - m.opacity).toBeGreaterThan(0.75);
      expect(m).toBe(layout.race ? sharedMaterials.glass() : sharedMaterials.roadGlass());
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
    // Road glazing (laminated, green-tinted) transmits less than race
    // polycarbonate, and the two are distinct materials.
    const race = sharedMaterials.glass(),
      road = sharedMaterials.roadGlass();
    expect(road).not.toBe(race);
    expect(1 - road.opacity).toBeLessThan(1 - race.opacity);
    expect(road.userData.vehicleGlass).toBe('road');
    expect(race.userData.vehicleGlass).toBe('race');
    expect(cabinFor(VEHICLES.rh3)!.race).toBe(false);
    expect(cabinFor(VEHICLES.gt8f)!.race).toBe(true);
  });
  it('keeps solid interior trim in the shadow proxy: only glazing and the cabin lid admit light', () => {
    // The buggy's two seats sit in an open space frame at every LOD: they
    // must keep casting (they share the interior finish with the cabin, but
    // not the lid's light-admitting tag).
    const def = VEHICLES.bg2,
      b = body(def),
      zCockpit = bodyFrame(def).z((bodySheetFor(def) as { cockpit: number }).cockpit),
      floor = bodyFrame(def).y(0.36);
    expect(sharedMaterials.cabinLid()).not.toBe(sharedMaterials.interior());
    expect(sharedMaterials.cabinLid().userData.cabinLid).toBe(true);
    expect(sharedMaterials.interior().userData.cabinLid).toBeUndefined();
    const proxy = b.proxy,
      material = proxy.material as T.Material;
    proxy.updateMatrixWorld(true);
    material.side = T.DoubleSide;
    for (const x of [-0.28, 0.28]) {
      const hits = new T.Raycaster(
        new T.Vector3(x, 5, zCockpit - 0.05),
        new T.Vector3(0, -1, 0),
        0,
        10,
      ).intersectObject(proxy);
      // The seat cushion (centre floor + 0.08, 0.12 thick) is in the proxy.
      expect(
        hits.some((h) => Math.abs(h.point.y - (floor + 0.08)) < 0.08),
        `bg2 seat at x = ${x}: ${hits.map((h) => h.point.y.toFixed(3))}`,
      ).toBe(true);
    }
    material.side = T.FrontSide;
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
