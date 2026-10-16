import * as T from 'three';
import { describe, expect, it, vi } from 'vitest';
import { VEHICLES, vehicleIndex } from '../src/simulation/vehicles.ts';
import { CAR_STRIDE, F, HEADER, R, RACE_BASE, carBase } from '../src/simulation/protocol.ts';
import { bodySheetFor, type ClosedSheet } from '../src/rendering/vehicle-bodies/body-sheet.ts';
import { bodyFrame } from '../src/rendering/vehicle-bodies/frame.ts';
import { ClosedBodyModel } from '../src/rendering/vehicle-bodies/closed-body.ts';
import { buildVehicleBody, VehicleBodies } from '../src/rendering/vehicle-bodies/index.ts';
import { sharedMaterials } from '../src/rendering/vehicle-bodies/materials.ts';
import {
  festivalDetailFor,
  festivalExhaustGeometry,
  festivalFasciaCap,
  festivalFasciaOpenings,
} from '../src/rendering/vehicle-bodies/festival-detail.ts';

function modelFor(id: string) {
  const def = VEHICLES[id];
  const sheet = bodySheetFor(def) as ClosedSheet;
  return new ClosedBodyModel(bodyFrame(def), sheet, [
    sheet.wheels.width[0] / 2,
    sheet.wheels.width[1] / 2,
  ]);
}
function hits(mesh: T.Object3D, x: number, y: number, z: number, forward: number) {
  mesh.updateMatrixWorld(true);
  return new T.Raycaster(
    new T.Vector3(x, y, z),
    new T.Vector3(0, 0, forward),
    0,
    3,
  ).intersectObject(mesh, true);
}

describe('Festival vehicle exterior construction', () => {
  it('cuts real fascia apertures while keeping their painted perimeter closed', () => {
    for (const id of ['rh3', 'rs5', 'rg63', 'rp6', 'sc7', 'gt10m']) {
      const model = modelFor(id);
      for (const detail of [0, 1] as const)
        for (const rear of [false, true]) {
          const sign = rear ? -1 : 1;
          const z = rear ? model.zRear : model.zFront;
          const geometry = festivalFasciaCap(model, detail, rear);
          const mesh = new T.Mesh(geometry, new T.MeshBasicMaterial());
          for (const opening of festivalFasciaOpenings(model, rear)) {
            expect(
              hits(mesh, opening.x, opening.y, z + sign, -sign),
              `${id} LOD${detail} aperture`,
            ).toHaveLength(0);
            expect(
              hits(mesh, opening.x, opening.y + opening.height * 0.69, z + sign, -sign).length,
              `${id} LOD${detail} fascia bridge`,
            ).toBeGreaterThan(0);
          }
          geometry.dispose();
          (mesh.material as T.Material).dispose();
        }
    }
  });

  it('lets a front-view ray reach the recessed radiator rather than a painted blocking face', () => {
    for (const id of ['rh3', 'rs5', 'rp6', 'sc7']) {
      const model = modelFor(id);
      const body = buildVehicleBody(0, VEHICLES[id], bodySheetFor(VEHICLES[id])!);
      for (const opening of festivalFasciaOpenings(model)) {
        // Probe between decorative grille bars rather than directly at a
        // truck's central chrome crossbar.
        const hit = hits(
          body.lods[0].group,
          opening.x + opening.width * 0.11,
          opening.y + opening.height * 0.21,
          model.zFront + 1,
          -1,
        )[0];
        expect(hit, `${id} radiator exists`).toBeDefined();
        expect(hit.point.z, `${id} real recessed opening`).toBeLessThan(model.zFront - 0.007);
        expect(hit.point.z, `${id} bounded duct depth`).toBeGreaterThan(
          model.zFront - opening.depth - 0.02,
        );
      }
    }
  });

  it('builds open exhaust bores with a solid metallic lip and inner wall', () => {
    const radius = 0.05;
    const geometry = festivalExhaustGeometry(radius, 0.15);
    const mesh = new T.Mesh(geometry, new T.MeshBasicMaterial({ side: T.DoubleSide }));
    expect(hits(mesh, 0, 0, -1, 1)).toHaveLength(0);
    expect(hits(mesh, radius * 0.9, 0, -1, 1).length).toBeGreaterThan(0);
    expect(hits(mesh, radius * 1.1, 0, -1, 1)).toHaveLength(0);
  });

  it('terminates rear cooling apertures inside a dark duct at chase-view angles', () => {
    for (const id of ['eh3', 'sc7', 'rg63', 'gt10m']) {
      const model = modelFor(id);
      const body = buildVehicleBody(0, VEHICLES[id], bodySheetFor(VEHICLES[id])!);
      for (const detail of [0, 1] as const) {
        const root = body.lods[detail].group;
        let linerHits = 0;
        root.updateMatrixWorld(true);
        for (const opening of festivalFasciaOpenings(model, true)) {
          for (const x of [-0.45, -0.21, 0.04, 0.37, 0.45])
            for (const y of [-0.4, -0.2, 0, 0.2, 0.4])
              for (const slope of [0, 0.4, 0.9]) {
                const at = new T.Vector3(
                  opening.x + x * opening.width,
                  opening.y + y * opening.height,
                  model.zRear,
                );
                const direction = new T.Vector3(0, -slope, 1).normalize();
                const ray = new T.Raycaster(
                  at.clone().addScaledVector(direction, -0.2),
                  direction,
                  0,
                  0.5,
                );
                const hit = ray.intersectObject(root, true)[0];
                expect(hit, `${id} LOD${detail} rear duct at ${x}/${y}/${slope}`).toBeDefined();
                expect(
                  hit.point.z,
                  `${id} rear duct closes before the engine/cabin`,
                ).toBeLessThanOrEqual(model.zRear + opening.depth + 0.015);
                if ((hit.object as T.Mesh).material === sharedMaterials.plastic()) linerHits++;
              }
        }
        if (festivalFasciaOpenings(model, true).length) expect(linerHits).toBeGreaterThan(0);
      }
    }
  });

  it('keeps all optical emitters on the existing lamp materials and batches the extra finish roles', () => {
    const def = VEHICLES.rh3;
    const body = buildVehicleBody(0, def, bodySheetFor(def)!);
    const roles = new Map<string, number>();
    let heads = 0,
      tails = 0;
    body.lods[0].group.traverse((o) => {
      if (!(o instanceof T.Mesh)) return;
      if (o.material === body.materials.head) heads++;
      if (o.material === body.materials.tail) tails++;
      for (const material of Array.isArray(o.material) ? o.material : [o.material]) {
        if (material.name.startsWith('Festival '))
          roles.set(material.name, (roles.get(material.name) ?? 0) + 1);
        if (material.userData.vehicleLampLens) {
          expect(material.transparent).toBe(true);
          expect(material.depthWrite).toBe(false);
          expect(o.castShadow).toBe(false);
        }
      }
    });
    expect(heads).toBe(1);
    expect(tails).toBe(1);
    expect(roles.size).toBe(3);
    expect([...roles.values()].every((count) => count === 1)).toBe(true);
    expect(body.lods[0].group.userData.festivalBodyDetail).toBeDefined();
    expect(body.lods[1].group.userData.festivalBodyDetail).toBeDefined();
    expect(body.lods[2].group.userData.festivalBodyDetail).toBeUndefined();
    expect(festivalDetailFor(VEHICLES.apx01, modelFor('rh3').s)).toBe(false);
  });

  it('releases replaced and cleared cars once while preserving other cars and shared finishes', () => {
    type Body = ReturnType<typeof buildVehicleBody>;
    type Resource = T.BufferGeometry | T.Material | T.Texture;
    const ownedResources = (body: Body) => {
      const { paint, accent, helmet, head, tail, board } = body.materials;
      const resources = new Set<Resource>([paint, accent, helmet, head, tail, board]);
      if (board.map) resources.add(board.map);
      const display = body.lods[0].cabin?.display;
      if (display) resources.add(display.material);
      body.root.traverse((object) => {
        if (object instanceof T.Mesh) resources.add(object.geometry);
      });
      for (const wheels of body.wheels)
        for (const wheel of wheels) {
          for (const material of Array.isArray(wheel.tyre.material)
            ? wheel.tyre.material
            : [wheel.tyre.material])
            resources.add(material);
          if (wheel.disc) resources.add(wheel.disc);
        }
      for (const material of Array.isArray(body.proxy.material)
        ? body.proxy.material
        : [body.proxy.material])
        resources.add(material);
      return resources;
    };
    const watch = (resources: Set<Resource>) =>
      [...resources].map((resource) => vi.spyOn(resource, 'dispose'));
    const bodies = new VehicleBodies();
    const built = (bodies as unknown as { bodies: Map<number, Body> }).bodies;
    const frame = new Float32Array(HEADER + 2 * CAR_STRIDE);
    for (let id = 0; id < 2; id++) {
      frame[carBase(id) + RACE_BASE + R.VEHICLE] = vehicleIndex(id === 0 ? 'rh3' : 'rg63');
      frame[carBase(id) + F.FRONT_HEALTH] = 1;
      frame[carBase(id) + F.REAR_HEALTH] = 1;
    }
    const hosts = [0, 1].map(() => ({ root: new T.Group(), lodLevel: 0 }));
    const externalReflection = new T.Texture();
    try {
      bodies.update(frame, frame, 1, hosts);
      const first = built.get(0)!,
        other = built.get(1)!;
      // Browser number boards own a CanvasTexture; use a texture here to
      // exercise that ownership without a browser or renderer.
      first.materials.board.map = new T.Texture();
      first.materials.paint.envMap = externalReflection;
      const firstResources = ownedResources(first),
        otherResources = ownedResources(other);
      const shared = new Set<Resource>([first.materials.suit, externalReflection]);
      for (const body of [first, other])
        body.root.traverse((object) => {
          if (!(object instanceof T.Mesh)) return;
          for (const material of Array.isArray(object.material)
            ? object.material
            : [object.material])
            if (!firstResources.has(material) && !otherResources.has(material))
              shared.add(material);
        });
      const firstDisposals = watch(firstResources),
        otherDisposals = watch(otherResources),
        sharedDisposals = watch(shared);
      bodies.showFeedDetail(() => 1);
      frame[carBase(0) + RACE_BASE + R.VEHICLE] = vehicleIndex('rs5');
      bodies.update(frame, frame, 1, hosts);
      bodies.restoreFeedDetail();
      expect(bodies.count).toBe(2);
      expect(first.root.parent).toBeNull();
      for (const disposal of firstDisposals) expect(disposal).toHaveBeenCalledTimes(1);
      for (const disposal of otherDisposals) expect(disposal).not.toHaveBeenCalled();
      for (const disposal of sharedDisposals) expect(disposal).not.toHaveBeenCalled();
      const replacement = built.get(0)!;
      expect(replacement.materials.paint).not.toBe(first.materials.paint);
      const replacementDisposals = watch(ownedResources(replacement));
      bodies.showFeedDetail(() => 2);
      bodies.clear();
      bodies.clear();
      bodies.restoreFeedDetail();
      expect(bodies.count).toBe(0);
      expect(bodies.root.children).toHaveLength(0);
      expect(built.size).toBe(0);
      expect(bodies.cabinOf(0)).toBeNull();
      expect(bodies.mirrorsFor(0)).toBeNull();
      for (const disposal of [...firstDisposals, ...otherDisposals, ...replacementDisposals])
        expect(disposal).toHaveBeenCalledTimes(1);
      for (const disposal of sharedDisposals) expect(disposal).not.toHaveBeenCalled();
      bodies.update(frame, frame, 1, hosts);
      expect(bodies.count).toBe(2);
      expect(built.get(0)!.materials.paint).not.toBe(replacement.materials.paint);
      bodies.clear();
      for (const disposal of sharedDisposals) expect(disposal).not.toHaveBeenCalled();
    } finally {
      bodies.clear();
      vi.restoreAllMocks();
      externalReflection.dispose();
    }
  });
});
