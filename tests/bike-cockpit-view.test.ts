import * as T from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BikeMaterials, BikeModel, BikeShells, staticSag } from '../src/rendering/bike.ts';
import { bikeFirstPersonView, bikeInstrumentReadout } from '../src/rendering/bike-cockpit.ts';
import { tcamFov } from '../src/rendering/cockpit-framing.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { Simulation } from '../src/simulation/world.ts';
import { inspectBikeCockpit } from '../e2e/fixtures/bike-cockpit-contract.ts';

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

describe('GP cockpit real-camera contract', () => {
  it('does not mislabel corrupt gear samples as reverse', () => {
    for (const gear of [undefined, NaN, Infinity, -Infinity])
      expect(bikeInstrumentReadout({ gear }, 16000).gear).toBe('N');
  });
  it('restores the helmet for menu, tail, broadcast and orbit views', () => {
    expect(bikeFirstPersonView('cockpit', false, false)).toBe(true);
    expect(bikeFirstPersonView('cockpit', true, false, 'cockpit')).toBe(true);
    for (const mode of ['chase', 'pod', 'trackside'])
      expect(bikeFirstPersonView(mode, false, false)).toBe(false);
    expect(bikeFirstPersonView('cockpit', true, false)).toBe(false);
    expect(bikeFirstPersonView('cockpit', false, true)).toBe(false);
    expect(bikeFirstPersonView('cockpit', false, false, 'orbit')).toBe(false);
  });
  it('switches only the followed helmet, including all LODs, and restores the rest', () => {
    const sim = new Simulation({
      ...DEFAULT_OPTIONS,
      mode: 'practice',
      opponents: 1,
      vehicles: ['gpr1', 'gpr2'],
    });
    const frame = sim.makeFrame(),
      shells = new BikeShells();
    const cars = [0, 1].map(() => ({ root: new T.Object3D() }));
    cars[1].root.position.x = 4;
    const camera = new T.PerspectiveCamera(60, 16 / 9, 0.03, 1000);
    try {
      shells.update(frame, frame, 1, cars, camera, 'high', 0);
      const heads: T.Object3D[] = [];
      shells.root.traverse((o) => {
        if (o.name === 'Rider head and helmet') heads.push(o);
      });
      expect(heads).toHaveLength(6);
      shells.setFirstPerson(0);
      expect(heads.slice(0, 3).every((h) => !h.visible)).toBe(true);
      expect(heads.slice(3).every((h) => h.visible)).toBe(true);
      shells.setFirstPerson(1);
      expect(heads.slice(0, 3).every((h) => h.visible)).toBe(true);
      expect(heads.slice(3).every((h) => !h.visible)).toBe(true);
      shells.setFirstPerson(-1);
      expect(heads.every((h) => h.visible)).toBe(true);
      expect(frame).toEqual(sim.makeFrame());
    } finally {
      shells.disposeAll();
    }
  });
  for (const id of ['gpr1', 'gpr2', 'sbk1000', 'ss600'])
    it(`${id}: keeps the real display facing the lens, in frame and unobstructed through riding poses`, () => {
      const definition = VEHICLES[id],
        materials = new BikeMaterials(0);
      const model = new BikeModel(definition, 0, 'high', materials, true);
      const sag = staticSag(definition),
        shells = new BikeShells();
      model.rider.setFirstPerson(true);
      const camera = new T.PerspectiveCamera(60, 16 / 9, 0.03, 1000);
      const direction = new T.Vector3();
      let samples = 0;
      try {
        for (const aspect of [4 / 3, 16 / 10, 16 / 9, 21 / 9])
          for (const lean of [-1, 0, 1])
            for (const load of [-1, 0, 1]) {
              model.pose({
                fork: sag.fork + load * 0.025,
                shock: sag.shock - load * 0.008,
                steer: lean * 0.18,
                frontRotation: 1,
                rearRotation: 2,
                chassisLean: lean,
                riderOffset: lean * 0.2,
                tuck: load < 0 ? 1 : 0.5,
                brake: load > 0 ? 0.9 : 0,
                rearBrake: 0,
                discTemp: 450,
                compoundColour: 0xffffff,
                riding: true,
                speed: 45,
                gear: 4,
                rpm: 12200,
              });
              model.root.position.set(17, 0.62, -11);
              model.root.rotation.set(0.06, 0.7, -lean, 'YXZ');
              shells.onboard(model.root, camera.position, direction);
              camera.up.set(0, 1, 0).applyQuaternion(model.root.quaternion);
              camera.lookAt(camera.position.clone().add(direction));
              camera.aspect = aspect;
              camera.fov = tcamFov(load > 0 ? 0 : 90);
              camera.updateProjectionMatrix();
              const result = inspectBikeCockpit(model.root, camera);
              expect(result.facing).toBeGreaterThan(0.7);
              for (const [x, y, z] of result.corners) {
                expect(Math.abs(x)).toBeLessThan(0.95);
                expect(Math.abs(y)).toBeLessThan(0.95);
                expect(z).toBeGreaterThan(-1);
                expect(z).toBeLessThan(1);
              }
              expect(
                result.visibleSamples,
                JSON.stringify({ id, aspect, lean, load, result }),
              ).toBe(9);
              samples++;
            }
        expect(samples).toBe(36);
      } finally {
        model.dispose();
        materials.dispose();
      }
    });
});
