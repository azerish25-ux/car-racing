import * as T from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BikeMaterials, BikeShells, bikeOnboardFov, staticSag } from '../src/rendering/bike.ts';
import { DirtBikeModel } from '../src/rendering/offroad/dirt-bike-model.ts';
import { mudUniforms } from '../src/rendering/offroad/mud.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { inspectMotocrossCockpit } from '../e2e/fixtures/motocross-cockpit-contract.ts';

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

describe('Motocross production onboard visibility', () => {
  for (const id of ['mx250', 'mx450', 'sm450'])
    it(`${id}: clears the number plate and rider while keeping real controls in view`, () => {
      const definition = VEHICLES[id],
        materials = new BikeMaterials(0),
        model = new DirtBikeModel(definition, 0, 'high', materials, mudUniforms()),
        sag = staticSag(definition),
        shells = new BikeShells(),
        direction = new T.Vector3(),
        camera = new T.PerspectiveCamera(58, 16 / 10, 0.03, 1000);
      model.rider.setFirstPerson(true, true);
      try {
        for (const aspect of [4 / 3, 16 / 10, 21 / 9])
          for (const pose of [
            { standing: 0, body: 0, brake: 0, lean: 0, steer: 0, load: 0, speed: 0 },
            { standing: 1, body: 0.7, brake: 0, lean: 0, steer: 0.12, load: -0.035, speed: 25 },
            {
              standing: 1,
              body: -0.8,
              brake: 0.9,
              lean: 0.35,
              steer: -0.18,
              load: 0.09,
              speed: 30,
            },
            { standing: 0.4, body: 0, brake: 0.2, lean: -0.55, steer: 0.3, load: 0.025, speed: 30 },
          ]) {
            model.pose({
              fork: sag.fork + pose.load,
              shock: sag.shock - pose.load * 0.25,
              steer: pose.steer,
              frontRotation: 1,
              rearRotation: 2,
              chassisLean: pose.lean,
              riderOffset: 0,
              tuck: 0,
              brake: pose.brake,
              rearBrake: 0,
              discTemp: 200,
              compoundColour: 0xffffff,
              riding: true,
              standing: pose.standing,
              body: pose.body,
            });
            model.root.position.set(17, 0.86, -11);
            model.root.rotation.set(0.06, 0.7, -pose.lean, 'YXZ');
            shells.onboard(model.root, camera.position, direction, false, definition);
            camera.up.set(0, 1, 0).applyQuaternion(model.root.quaternion);
            camera.lookAt(camera.position.clone().add(direction));
            camera.aspect = aspect;
            camera.fov = bikeOnboardFov(pose.speed, definition);
            camera.updateProjectionMatrix();
            const result = inspectMotocrossCockpit(model, camera),
              context = JSON.stringify({ id, aspect, pose, result });
            expect(result.visibleControls, context).toBe(3);
            expect(result.clearForwardSamples, context).toBe(15);
            expect(result.headVisible).toBe(false);
            expect(result.torsoVisible).toBe(false);
            expect(result.handsVisible).toEqual([true, true]);
            for (const [x, y] of result.sleeveEntries)
              expect(y < -0.95 || Math.abs(x) > 0.98, context).toBe(true);
            for (const control of result.controls) {
              const [x, y, z] = control.ndc;
              expect(Math.abs(x), context).toBeLessThan(0.95);
              expect(Math.abs(y), context).toBeLessThan(0.95);
              expect(z).toBeGreaterThan(-1);
              expect(z).toBeLessThan(1);
            }
          }
        // The old GP socket is a negative control: these rays must detect
        // its opaque MX number-board obstruction, not merely camera state.
        if (id !== 'sm450') {
          shells.onboard(model.root, camera.position, direction, false, VEHICLES.gpr1);
          camera.lookAt(camera.position.clone().add(direction));
          expect(inspectMotocrossCockpit(model, camera).clearForwardSamples).toBeLessThan(15);
        }
        model.rider.setFirstPerson(false);
        expect(model.rider.root.getObjectByName('Rider head and helmet')!.visible).toBe(true);
        expect(model.rider.root.getObjectByName('Rider torso')!.visible).toBe(true);
        const arms = ['left', 'right'].flatMap((side) =>
            ['upper arm', 'forearm'].map(
              (part) => model.rider.root.getObjectByName(`Motocross ${side} ${part}`)!,
            ),
          ),
          exterior = arms.map((arm) => [...arm.position.toArray(), ...arm.quaternion.toArray()]);
        model.rider.setFirstPerson(true, true);
        expect(
          arms.map((arm) => [...arm.position.toArray(), ...arm.quaternion.toArray()]),
        ).not.toEqual(exterior);
        model.rider.setFirstPerson(false);
        expect(arms.map((arm) => [...arm.position.toArray(), ...arm.quaternion.toArray()])).toEqual(
          exterior,
        );
        for (const side of ['left', 'right'])
          expect(model.rider.root.getObjectByName(`Motocross ${side} upper arm`)!.visible).toBe(
            true,
          );
      } finally {
        model.dispose();
        materials.dispose();
      }
    });
});
