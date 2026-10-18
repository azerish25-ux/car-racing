import * as T from 'three';
import { describe, expect, it, vi } from 'vitest';
import { FestivalCars } from '../src/rendering/open-world/festival-cars.ts';
import {
  FESTIVAL_LAMPS,
  FESTIVAL_PAINT,
  festivalRoadGlass,
  installFestivalFinish,
  platePlacement,
  runningLightMaterial,
} from '../src/rendering/open-world/festival-car-finish.ts';
import {
  PLATE,
  PLATE_SLOTS,
  plateText,
  plateUv,
} from '../src/rendering/open-world/festival-plates.ts';
import { PresentedFrame } from '../src/rendering/frame-state.ts';
import { bodySheetFor, type ClosedSheet } from '../src/rendering/vehicle-bodies/body-sheet.ts';
import { ClosedBodyModel } from '../src/rendering/vehicle-bodies/closed-body.ts';
import { bodyFrame } from '../src/rendering/vehicle-bodies/frame.ts';
import { buildVehicleBody, VehicleBodies } from '../src/rendering/vehicle-bodies/index.ts';
import { sharedMaterials } from '../src/rendering/vehicle-bodies/materials.ts';
import {
  CAR_STRIDE,
  F,
  H,
  HEADER,
  R,
  RACE_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../src/simulation/protocol.ts';
import { VEHICLES, vehicleIndex } from '../src/simulation/vehicles.ts';

function modelFor(id: string) {
  const def = VEHICLES[id];
  const sheet = bodySheetFor(def) as ClosedSheet;
  return new ClosedBodyModel(bodyFrame(def), sheet, [
    sheet.wheels.width[0] / 2,
    sheet.wheels.width[1] / 2,
  ]);
}
const named = (root: T.Object3D, name: string) => {
  const out: T.Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof T.Mesh && o.name === name) out.push(o);
  });
  return out;
};
const ROAD = Object.values(VEHICLES).filter((v) => v.classId === 'road');

describe('festival vehicle finish', () => {
  it('formats Japanese plates with invented places, kana and padded serials', () => {
    const seen = new Set<string>();
    for (let slot = 0; slot < PLATE_SLOTS.plain; slot++) {
      const text = plateText(slot);
      expect(text.kei).toBe(slot >= PLATE_SLOTS.white);
      expect(text.cls).toMatch(/^\d{2,3}$/);
      expect(text.kana).toMatch(/^[ぁ-ん]$/);
      expect(text.serial).toMatch(/^(\d\d-\d\d|・{1,3}\d{1,3})$/);
      expect(
        text.serial.replace(/[-・]/g, '').length + (text.serial.match(/・/g)?.length ?? 0),
      ).toBe(4);
      // No real registration office names (e.g. 品川, 横浜, 練馬, なにわ).
      expect(['品川', '横浜', '練馬', 'なにわ', '足立', '湘南']).not.toContain(text.place);
      seen.add(`${text.place}${text.cls}${text.kana}${text.serial}`);
    }
    expect(seen.size).toBe(PLATE_SLOTS.plain);
    const [u0, v0, u1, v1] = plateUv(5);
    expect(u1 - u0).toBeCloseTo(0.25, 6);
    expect(v1 - v0).toBeCloseTo(0.125, 6);
  });

  it('mounts front and rear plates on every road body, on its end faces and clear of the tail lamps', () => {
    for (const def of ROAD) {
      const model = modelFor(def.id),
        { f, s } = model;
      const rear = platePlacement(model, true),
        front = platePlacement(model, false);
      expect(rear, `${def.id} rear plate`).not.toBeNull();
      expect(rear!.z).toBeLessThan(model.zRear);
      expect(rear!.z).toBeGreaterThan(model.zRear - 0.03);
      // Above the road, below the tail-lamp row, inside the body width.
      expect(rear!.y - PLATE.height / 2).toBeGreaterThan(f.y(s.floor));
      expect(rear!.y + PLATE.height / 2).toBeLessThan(
        Math.min(f.y(s.tail) - 0.13, model.topY(model.zRear) - 0.06),
      );
      expect(model.sideX(model.zRear, rear!.y)).toBeGreaterThan(PLATE.width / 2);
      // A front plate wherever the nose face is taller than the plate.
      const nose = model.ring(model.zFront, 0).half.map((p) => p[1]);
      const room = Math.max(...nose) - Math.max(Math.min(...nose), f.y(s.floor));
      if (room > PLATE.height + 0.06) expect(front, `${def.id} front plate`).not.toBeNull();
      if (!front) continue;
      // Behind / ahead of the end faces by the bracket offset only.
      expect(front!.z).toBeGreaterThan(model.zFront);
      expect(front!.z).toBeLessThan(model.zFront + 0.03);
      expect(front!.y - PLATE.height / 2).toBeGreaterThan(f.y(s.floor));
    }
  });

  it('adds plates and LED running lights to the near LODs of road cars only', () => {
    const road = buildVehicleBody(0, VEHICLES.eh3, bodySheetFor(VEHICLES.eh3)!);
    installFestivalFinish(road, 0);
    for (const [detail, lod] of road.lods.entries()) {
      const plates = named(lod.group, 'Festival registration plates'),
        drl = named(lod.group, 'Festival LED running lights');
      expect(plates).toHaveLength(detail < 2 ? 1 : 0);
      expect(drl).toHaveLength(detail < 2 ? 1 : 0);
      for (const mesh of [...plates, ...drl]) expect(mesh.castShadow).toBe(false);
      if (detail < 2) {
        expect(drl[0].material).toBe(runningLightMaterial());
        // Front and rear slabs: twelve faces each, one rear face lit.
        const lit = plates[0].geometry.getAttribute('plateLit');
        let litVertices = 0;
        for (let i = 0; i < lit.count; i++) litVertices += lit.getX(i);
        expect(litVertices).toBe(4);
      }
    }
    // Classic round lamps keep their halogen look; race classes carry no plates.
    const classic = buildVehicleBody(1, VEHICLES.rg63, bodySheetFor(VEHICLES.rg63)!);
    installFestivalFinish(classic, 1);
    expect(named(classic.root, 'Festival LED running lights')).toHaveLength(0);
    expect(named(classic.root, 'Festival registration plates')).toHaveLength(2);
    const racer = buildVehicleBody(2, VEHICLES.gt10m, bodySheetFor(VEHICLES.gt10m)!);
    installFestivalFinish(racer, 2);
    expect(named(racer.root, 'Festival registration plates')).toHaveLength(0);
    // The shared body library (circuit renderer) installs nothing by itself.
    const circuit = buildVehicleBody(3, VEHICLES.eh3, bodySheetFor(VEHICLES.eh3)!);
    expect(named(circuit.root, 'Festival registration plates')).toHaveLength(0);
    expect(named(circuit.root, 'Festival LED running lights')).toHaveLength(0);
    // Darker festival glazing replaces the shared road glass on this body only.
    const uses = (root: T.Object3D, material: T.Material) => {
      let n = 0;
      root.traverse((o) => {
        if (!(o instanceof T.Mesh)) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material])
          if (m === material) n++;
      });
      return n;
    };
    expect(uses(road.root, sharedMaterials.roadGlass())).toBe(0);
    expect(uses(road.root, festivalRoadGlass())).toBeGreaterThan(0);
    expect(uses(circuit.root, sharedMaterials.roadGlass())).toBeGreaterThan(0);
    expect(uses(circuit.root, festivalRoadGlass())).toBe(0);
    expect(festivalRoadGlass().userData.vehicleGlass).toBe('road');
    // Clear-coated paint with the base sheen under the coat; circuit untouched.
    expect(road.materials.paint.userData.paintFinish).toBe('metallic');
    expect(road.materials.paint.specularIntensity).toBeCloseTo(
      FESTIVAL_PAINT.metallic.specularIntensity,
      6,
    );
    expect(road.materials.paint.clearcoat).toBe(1);
    expect(road.materials.paint.clearcoatRoughness).toBeCloseTo(
      FESTIVAL_PAINT.clearcoatRoughness,
      6,
    );
    expect(circuit.materials.paint.specularIntensity).toBe(1);
    expect(circuit.materials.paint.clearcoatRoughness).toBeCloseTo(0.04, 6);
    // Lacquered festival rims on every LOD; the circuit keeps the shared alloy.
    const rimsOf = (root: T.Object3D) =>
      named(root, 'Rim').map((m) => (m.material as T.Material).name);
    expect(rimsOf(road.root).length).toBe(12);
    expect(rimsOf(road.root).every((n) => n.startsWith('Festival lacquered rim'))).toBe(true);
    expect(rimsOf(circuit.root).some((n) => n.startsWith('Festival'))).toBe(false);
  });

  it('drives open-road lamp levels: running tail bars by day, a brake flare, night levels', () => {
    const cars = new FestivalCars();
    const frame = (brake: number) => {
      const out = new Float32Array(HEADER + CAR_STRIDE),
        o = carBase(0);
      out[H.CARS] = 1;
      out[H.TIME] = 1;
      out[o + F.QW] = 1;
      out[o + RACE_BASE + R.VEHICLE] = vehicleIndex('rh3');
      out[o + F.FRONT_HEALTH] = out[o + F.REAR_HEALTH] = 1;
      out[o + F.BRAKE] = brake;
      for (let w = 0; w < 4; w++) {
        const p = o + WHEEL_BASE + w * WHEEL_STRIDE;
        out[p + W.LENGTH] = 0.3;
        out[p + W.RADIUS] = VEHICLES.rh3.spec.wheelRadius;
        out[p + W.PRESSURE] = 155;
      }
      return out;
    };
    const presented = new PresentedFrame();
    const draw = (brake: number, night: number) => {
      const f = frame(brake);
      cars.update(f, f, presented.sample(f, f, 1), 1, 1 / 60, night);
    };
    let tail: T.MeshStandardMaterial | null = null;
    const bodies = cars.bodies as unknown as {
      bodies: Map<number, { materials: { tail: T.MeshStandardMaterial } }>;
    };
    draw(0, 0);
    tail = bodies.bodies.get(0)!.materials.tail;
    const halos = named(cars.root, 'Festival lamp halos');
    expect(halos.length).toBe(2);
    const halo = halos[0].material as T.ShaderMaterial;
    expect(halos[1].material).toBe(halo);
    // No halo by day without braking; a red glow at night and a flare braking.
    expect(halo.visible).toBe(false);
    expect(tail.emissiveIntensity).toBeCloseTo(FESTIVAL_LAMPS.tailDay, 6);
    expect(runningLightMaterial().emissiveIntensity).toBeCloseTo(FESTIVAL_LAMPS.drlDay, 6);
    draw(0.8, 0);
    expect(tail.emissiveIntensity).toBeCloseTo(FESTIVAL_LAMPS.brake, 6);
    expect(halo.visible).toBe(true);
    expect(halo.uniforms.haloHead.value).toBe(0);
    draw(0, 1);
    expect(tail.emissiveIntensity).toBeCloseTo(FESTIVAL_LAMPS.tailNight, 6);
    expect(halo.uniforms.haloTail.value).toBeCloseTo(FESTIVAL_LAMPS.haloTail, 6);
    expect(halo.uniforms.haloHead.value).toBeCloseTo(FESTIVAL_LAMPS.haloHead, 6);
    // Red lenses stay below the level where ACES turns them orange-white.
    expect(FESTIVAL_LAMPS.brake).toBeLessThanOrEqual(8);
    expect(runningLightMaterial().emissiveIntensity).toBeCloseTo(FESTIVAL_LAMPS.drlNight, 6);
    expect(named(cars.root, 'Festival registration plates').length).toBeGreaterThan(0);
    // A plain body library (the circuit's) keeps its own lamp levels.
    const circuit = new VehicleBodies();
    const f = frame(0);
    circuit.update(f, f, 1, [{ root: new T.Group(), lodLevel: 0 }], false);
    const own = (circuit as unknown as typeof bodies).bodies.get(0)!.materials.tail;
    expect(own.emissiveIntensity).toBeCloseTo(0.55, 6);
    circuit.clear();
    const disposed = vi.spyOn(halo, 'dispose');
    cars.dispose();
    expect(disposed).toHaveBeenCalledTimes(1);
  });
});
