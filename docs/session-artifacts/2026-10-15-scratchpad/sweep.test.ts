import { expect, it } from 'vitest';
import * as T from 'three';
import { bikeStandLift, servicePhaseAt, BIKE_PIT_SERVICE } from '../src/simulation/pit-service.ts';
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
import { vehicleIndex, vehicleDefinition } from '../src/simulation/vehicles.ts';
import { PitCrewView } from '../src/rendering/pit-crew.ts';
import { BikeServicePose, bikeServiceGeometry } from '../src/rendering/bike-pit-service.ts';
it('sweeps every bike through its service with reachable crews and wheels above the floor', () => {
  const bad: string[] = [];
  for (const vehicle of ['gpr1', 'sbk1000', 'cr750', 'mx450', 'sm450']) {
    const def = vehicleDefinition(vehicle),
      pose = new BikeServicePose();
    const crew = new PitCrewView();
    for (let c = 0; c < BIKE_PIT_SERVICE.ends[3]; c += 0.1) {
      const phase = servicePhaseAt(BIKE_PIT_SERVICE, c),
        lift = bikeStandLift(phase, c);
      pose.set(bikeServiceGeometry(def), phase, c, lift);
      const g = pose.geometry;
      const frontBottom = pose.mounted[0].y - g.frontRadius,
        rearBottom = pose.mounted[1].y - g.rearRadius;
      if (frontBottom < pose.floor - 1e-6 || rearBottom < pose.floor - 1e-6)
        bad.push(`${vehicle} ${c.toFixed(1)} wheel below floor ${frontBottom.toFixed(3)} ${rearBottom.toFixed(3)} floor ${pose.floor}`);
      const frame = new Float32Array(HEADER + CAR_STRIDE);
      frame[H.CARS] = 1;
      const o = carBase(0);
      frame[o + RACE_BASE + R.VEHICLE] = vehicleIndex(vehicle);
      frame[o + F.QW] = 1;
      frame[o + F.Y] = g.height;
      frame[o + F.IN_PIT] = 1;
      frame[o + F.PIT_PHASE] = phase;
      frame[o + F.PIT_CLOCK] = c;
      frame[o + F.JACK_HEIGHT] = lift;
      for (let w = 0; w < 4; w++) frame[o + WHEEL_BASE + w * WHEEL_STRIDE + W.LENGTH] = 0.3;
      crew.update(frame, new T.Vector3(3, 1.5, 0));
      for (const r of crew.diagnostics().roles)
        if (!r.reachable[0] || !r.reachable[1] || !r.feetReachable.every(Boolean) || r.wristError > 1e-5 || !r.planted.some(Boolean))
          bad.push(`${vehicle} ${c.toFixed(1)} ${r.role} w${r.wheel}`);
    }
    crew.dispose();
  }
  expect(bad).toEqual([]);
});
