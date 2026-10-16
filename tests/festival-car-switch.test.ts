import * as T from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FestivalCars } from '../src/rendering/open-world/festival-cars.ts';
import { PresentedFrame } from '../src/rendering/frame-state.ts';
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
import type { FormulaCar } from '../src/rendering/car.ts';
import { hasSpecularIBL } from '../src/rendering/studio/ibl-energy.ts';
import { tyreLetteringAtlas } from '../src/rendering/studio/tyre-letters.ts';

// Geometry/state-only canvas, following race-finish.test.ts. FormulaCar is
// real; these no-op drawing methods do not provide rendered-image evidence.
function stubCanvas() {
  class Canvas {
    width = 300;
    height = 150;
    getContext() {
      const noop = () => {};
      return new Proxy(
        {
          canvas: this,
          measureText: () => ({ width: 40 }),
          createLinearGradient: () => ({ addColorStop: noop }),
          createRadialGradient: () => ({ addColorStop: noop }),
          createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
          getImageData: (_x: number, _y: number, w: number, h: number) => ({
            data: new Uint8ClampedArray(w * h * 4),
          }),
        },
        { get: (target, key) => Reflect.get(target, key) ?? noop },
      );
    }
  }
  vi.stubGlobal('document', { createElement: () => new Canvas() });
  vi.stubGlobal('HTMLCanvasElement', Canvas);
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function snapshot(id: string, time: number, position: readonly number[], yaw: number) {
  const frame = new Float32Array(HEADER + CAR_STRIDE),
    o = carBase(0);
  const q = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), yaw);
  frame[H.CARS] = 1;
  frame[H.TIME] = time;
  frame.set(position, o + F.X);
  frame.set(q.toArray(), o + F.QX);
  frame[o + RACE_BASE + R.VEHICLE] = vehicleIndex(id);
  frame[o + F.FRONT_HEALTH] = frame[o + F.REAR_HEALTH] = 1;
  frame[o + F.GEAR] = 1;
  for (let w = 0; w < 4; w++) {
    const p = o + WHEEL_BASE + w * WHEEL_STRIDE;
    frame[p + W.LENGTH] = 0.3;
    frame[p + W.RADIUS] = VEHICLES[id].spec.wheelRadius;
    frame[p + W.PRESSURE] = 155;
    frame[p + W.LOAD] = 2000;
  }
  return frame;
}

function expectPose(root: T.Object3D, frame: Float32Array) {
  const o = carBase(0);
  expect(root.position.toArray()).toEqual(Array.from(frame.subarray(o + F.X, o + F.X + 3)));
  expect(root.quaternion.toArray()).toEqual(Array.from(frame.subarray(o + F.QX, o + F.QX + 4)));
}

function watchResources(root: T.Object3D) {
  const resources = new Set<T.BufferGeometry | T.Material | T.Texture | T.InstancedMesh>();
  root.traverse((node) => {
    if (!(node instanceof T.Mesh)) return;
    resources.add(node.geometry);
    if (node instanceof T.InstancedMesh) resources.add(node);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      resources.add(material);
      for (const value of Object.values(material))
        if (value instanceof T.Texture) resources.add(value);
    }
  });
  return { resources, disposals: [...resources].map((resource) => vi.spyOn(resource, 'dispose')) };
}

describe('festival garage presentation', () => {
  it('poses a road body from the current holder after using and reusing a Formula car', () => {
    stubCanvas();
    const cars = new FestivalCars();
    const formulaFrame = snapshot('apx01', 1, [12, 1.2, -5], 0.2);
    try {
      cars.update(formulaFrame, formulaFrame, formulaFrame, 1, 1 / 60, 0);
      const formula = cars.root.getObjectByName('Formula 1')!;
      expect(formula).toBeDefined();
      expect(formula.visible).toBe(true);
      expectPose(formula, formulaFrame);

      const a = snapshot('rh3', 2, [34, 1.6, 55], 1);
      const b = snapshot('rh3', 2.1, [40, 2.4, 65], 1.3);
      const presented = new PresentedFrame().sample(a, b, 0.4);
      cars.update(a, b, presented, 0.4, 1 / 60, 0);
      expect(cars.bodies.count).toBe(1);
      const road = cars.bodies.root.children[0];
      expect(road.visible).toBe(true);
      expect(formula.visible).toBe(false);
      expectPose(road, presented);
      expectPose(cars.subject()!, presented);
      expect(cars.reflectivePaint.every(hasSpecularIBL)).toBe(true);

      const moved = snapshot('rh3', 2.2, [50, 3, 85], 1.5);
      cars.update(moved, moved, moved, 1, 1 / 60, 0);
      expect(cars.bodies.root.children[0]).toBe(road);
      expectPose(road, moved);

      const back = snapshot('apx01', 3, [-20, 2, 100], -0.5);
      cars.update(back, back, back, 1, 1 / 60, 0);
      expect(cars.root.getObjectByName('Formula 1')).toBe(formula);
      expect(formula.visible).toBe(true);
      expect(road.visible).toBe(false);
      expectPose(formula, back);

      const again = snapshot('rh3', 4, [120, 1, -30], -1);
      cars.update(again, again, again, 1, 1 / 60, 0);
      expect(formula.visible).toBe(false);
      expect(road.visible).toBe(true);
      expectPose(road, again);
    } finally {
      cars.dispose();
    }
  });

  it('selects rival Formula LODs from camera distance and the selected quality', () => {
    stubCanvas();
    const cars = new FestivalCars();
    const frame = new Float32Array(HEADER + 2 * CAR_STRIDE);
    frame.set(snapshot('rh3', 1, [0, 1, 0], 0));
    frame[H.CARS] = 2;
    frame.set(snapshot('apx01', 1, [50, 1, 0], 0).subarray(HEADER), carBase(1));
    const camera = new T.PerspectiveCamera();
    camera.position.set(0, 1, 0);
    try {
      cars.update(frame, frame, frame, 1, 1 / 60, 0, camera, false, 'low');
      const formula = (cars as unknown as { formula: Map<number, FormulaCar> }).formula.get(1)!;
      expect(formula.lodLevel).toBe(1);
      cars.update(frame, frame, frame, 1, 1 / 60, 0, camera, false, 'high');
      expect(formula.lodLevel).toBe(0);
      frame[carBase(1) + F.X] = 400;
      cars.update(frame, frame, frame, 1, 1 / 60, 0, camera, false, 'high');
      expect(formula.lodLevel).toBe(2);
      camera.position.x = 390;
      cars.update(frame, frame, frame, 1, 1 / 60, 0, camera, false, 'low');
      expect(formula.lodLevel).toBe(0);
    } finally {
      cars.dispose();
    }
  });

  it('releases every procedural Formula resource once and preserves shared atlases and borrowed feeds', () => {
    stubCanvas();
    const cars = new FestivalCars(),
      other = new FestivalCars();
    const frame = snapshot('apx01', 1, [12, 1.2, -5], 0.2);
    const externalProbe = new T.Texture(),
      externalFeed = new T.Texture();
    try {
      cars.update(frame, frame, frame, 1, 1 / 60, 0);
      other.update(frame, frame, frame, 1, 1 / 60, 0);
      const formula = (cars as unknown as { formula: Map<number, FormulaCar> }).formula.get(0)!;
      const owned = watchResources(formula.root);
      const otherOwned = watchResources(other.root.getObjectByName('Formula 1')!);
      const atlas = tyreLetteringAtlas()!;
      const borrowed = [externalProbe, externalFeed, atlas].map((texture) =>
        vi.spyOn(texture, 'dispose'),
      );
      expect(
        [...owned.resources].filter((resource) => resource instanceof T.Texture).length,
      ).toBeGreaterThanOrEqual(7);
      expect(owned.resources.has(formula.display)).toBe(true);
      expect(owned.resources.has(formula.identityTexture)).toBe(true);
      expect(owned.resources.has(atlas)).toBe(false);
      formula.paint.envMap = externalProbe;
      (formula.mirrors[0].material as T.MeshStandardMaterial).map = externalFeed;

      // Cached Formula and its resources survive a round trip through the garage.
      const road = snapshot('rh3', 2, [40, 1, 20], 0.7);
      cars.update(road, road, road, 1, 1 / 60, 0);
      cars.update(frame, frame, frame, 1, 1 / 60, 0);
      expect(cars.root.getObjectByName('Formula 1')).toBe(formula.root);
      for (const disposal of owned.disposals) expect(disposal).not.toHaveBeenCalled();
      cars.clear();
      cars.clear();
      expect(cars.subject()).toBeNull();
      expect(cars.bodies.count).toBe(0);
      expect(cars.reflectivePaint).toHaveLength(0);
      expect(cars.root.getObjectByName('Formula 1')).toBeUndefined();
      for (const disposal of owned.disposals) expect(disposal).toHaveBeenCalledTimes(1);
      for (const disposal of [...otherOwned.disposals, ...borrowed])
        expect(disposal).not.toHaveBeenCalled();

      // A new entry starts with independent resources and is also fully releasable.
      cars.update(frame, frame, frame, 1, 1 / 60, 0);
      const fresh = cars.root.getObjectByName('Formula 1')!;
      expect(fresh).not.toBe(formula.root);
      const freshOwned = watchResources(fresh);
      cars.dispose();
      cars.dispose();
      for (const disposal of freshOwned.disposals) expect(disposal).toHaveBeenCalledTimes(1);
      for (const disposal of [...otherOwned.disposals, ...borrowed])
        expect(disposal).not.toHaveBeenCalled();
    } finally {
      cars.dispose();
      other.dispose();
      externalProbe.dispose();
      externalFeed.dispose();
    }
  });
});
