import { describe, expect, it } from 'vitest';
import { COMPOUNDS, controls, DEFAULT_SETUP } from '../src/simulation/config.ts';
import { MX_250, MX_450, SM_450 } from '../src/simulation/offroad/dirt-bikes.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import type { VehicleDefinition } from '../src/simulation/vehicles.ts';

const DT = 1 / 240;

/** A warm, moving player grabs both brakes and asks for lean on the actual
 * Valley Ridge start straight. Only the initial speed is set: brake demand,
 * load transfer, tyre utilisation and the fall all come from production
 * steps with Raw assists. Never inject utilisation or call a private solver. */
function brakeIntoRecovery(definition: VehicleDefinition) {
  const track = rigTrack('valley-ridge-mx'),
    bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, 'raw', definition);
  bike.place(track, 45);
  bike.dynamics.speed = 28;
  bike.gear = definition.spec.gearRatios.length - 2;
  Object.assign(bike.input, { ...controls(), brake: 1, clutch: 1, steer: 1 });
  const initialSurface = bike.tires[2].surfaceTemp;
  let peakRearDemand = 0,
    peakFrontBrake = 0,
    peakRearBrake = 0,
    peakCarcass = 0,
    peakSurface = 0,
    groundedBrakeSteps = 0;
  for (let i = 0; i < 4 / DT && bike.riding; i++) {
    bike.step(DT, track);
    peakRearDemand = Math.max(peakRearDemand, bike.dynamics.rearUse);
    peakFrontBrake = Math.max(peakFrontBrake, bike.dynamics.frontBrakeForce);
    peakRearBrake = Math.max(peakRearBrake, bike.dynamics.rearBrakeForce);
    if (bike.riding && !bike.airborne && bike.dynamics.frontBrakeForce > 0)
      groundedBrakeSteps++;
    for (const tire of bike.tires) {
      peakCarcass = Math.max(peakCarcass, tire.carcassTemp);
      peakSurface = Math.max(peakSurface, tire.surfaceTemp);
    }
  }
  return {
    bike,
    track,
    initialSurface,
    peakRearDemand,
    peakFrontBrake,
    peakRearBrake,
    peakCarcass,
    peakSurface,
    groundedBrakeSteps,
  };
}

describe('off-road thermal integration with full brake-force utilisation', () => {
  it.each([MX_250, MX_450, SM_450])(
    '$id bounds real Raw braking heat and stops contact heating through recovery',
    (definition) => {
      const run = brakeIntoRecovery(definition),
        { bike, track } = run;
      expect(bike.dynamics.assists.abs).toBe(false);
      expect(run.groundedBrakeSteps).toBeGreaterThan(0);
      expect(run.peakFrontBrake).toBeGreaterThan(100);
      expect(run.peakRearBrake).toBeGreaterThan(100);
      // Exercise the unloaded rear's actual full braking demand, including
      // the value added by the shared MotoGP force-circle reporting change.
      expect(run.peakRearDemand).toBeGreaterThan(1.5);
      expect(bike.riding).toBe(false);
      expect(bike.dynamics.crashes).toBe(1);
      expect(run.peakSurface).toBeGreaterThan(run.initialSurface);
      expect(run.peakCarcass).toBeLessThan(120);
      expect(run.peakSurface).toBeLessThan(140);

      Object.assign(bike.input, controls());
      // With no tyre contact work, passive exchange can approach the warm
      // carcass equilibrium or redistribute existing heat. It cannot exceed
      // both temperatures at the fall and that equilibrium. This envelope
      // checks the physical outcome without copying the integration formula.
      const ceilings = bike.tires.map((tire) =>
          Math.max(tire.carcassTemp, tire.surfaceTemp, COMPOUNDS[tire.compound].ideal - 4),
        ),
        wear = bike.tires.map((tire) => tire.wear),
        states = new Set<string>();
      for (let i = 0; i < 2 / DT; i++) {
        bike.step(DT, track);
        states.add(bike.dynamics.state);
        expect(bike.riding).toBe(false);
        for (let wheel = 0; wheel < bike.tires.length; wheel++) {
          const tire = bike.tires[wheel];
          expect(tire.fx).toBe(0);
          expect(tire.fy).toBe(0);
          expect(tire.energy).toBe(0);
          expect(tire.wear).toBe(wear[wheel]);
          expect(tire.carcassTemp).toBeLessThanOrEqual(ceilings[wheel] + 1e-8);
          expect(tire.surfaceTemp).toBeLessThanOrEqual(ceilings[wheel] + 1e-8);
          expect(Number.isFinite(tire.carcassTemp + tire.surfaceTemp)).toBe(true);
        }
      }
      expect(states.has('separated')).toBe(true);
    },
  );
});
