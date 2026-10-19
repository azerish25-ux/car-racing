import { describe, expect, it } from 'vitest';
import {
  B,
  BIKE_BASE,
  CAR_STRIDE,
  F,
  HEADER,
  O,
  OFFROAD_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../src/simulation/protocol.ts';
import { motocrossBrakeHeldInFlight } from '../src/ui/motocross-brake-cue.ts';

function packet(wheel = 0) {
  const frame = new Float32Array(HEADER + CAR_STRIDE),
    base = carBase(0);
  frame[base + F.SPEED] = 15;
  frame[base + OFFROAD_BASE + O.AIRBORNE] = 1;
  frame[base + OFFROAD_BASE + O.AIR_TIME] = 0.5;
  const w = base + WHEEL_BASE + wheel * WHEEL_STRIDE;
  const brake = base + (wheel === 0 ? F.BRAKE : BIKE_BASE + B.REAR_BRAKE);
  frame[brake] = 0.8;
  frame[w + W.RADIUS] = 0.34;
  frame[w + W.OMEGA] = 2;
  return { frame, base, w, brake };
}

describe('motocross airborne brake-release cue', () => {
  it.each([0, 2])(
    'reads a genuinely braked wheel %s and clears immediately when released',
    (wheel) => {
      const p = packet(wheel);
      expect(motocrossBrakeHeldInFlight(p.frame)).toBe(true);
      p.frame[p.brake] = 0;
      expect(motocrossBrakeHeldInFlight(p.frame)).toBe(false);
    },
  );
  it('does not warn for a useful short pitch-control tap while the wheel still rolls', () => {
    const p = packet();
    p.frame[p.w + W.OMEGA] = 40;
    expect(motocrossBrakeHeldInFlight(p.frame)).toBe(false);
  });
  it.each(['ground', 'hop', 'slow', 'invalid-radius', 'invalid-spin', 'invalid-pedal'])(
    'ignores %s samples',
    (kind) => {
      const p = packet();
      if (kind === 'ground') p.frame[p.base + OFFROAD_BASE + O.AIRBORNE] = 0;
      if (kind === 'hop') p.frame[p.base + OFFROAD_BASE + O.AIR_TIME] = 0.1;
      if (kind === 'slow') p.frame[p.base + F.SPEED] = 2;
      if (kind === 'invalid-radius') p.frame[p.w + W.RADIUS] = 0;
      if (kind === 'invalid-spin') p.frame[p.w + W.OMEGA] = NaN;
      if (kind === 'invalid-pedal') p.frame[p.brake] = NaN;
      expect(motocrossBrakeHeldInFlight(p.frame)).toBe(false);
    },
  );
});
