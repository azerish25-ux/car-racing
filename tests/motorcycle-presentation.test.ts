import { describe, expect, it } from 'vitest';
import { motorcycleChase } from '../src/rendering/motorcycle-camera.ts';
import { menuPreview } from '../src/rendering/menu-preview.ts';
import { staticSag } from '../src/rendering/bike.ts';
import { bikeReadout } from '../src/ui/bike-readout.ts';
import { chassisLean } from '../src/simulation/bike-definitions.ts';
import {
  B,
  BIKE_BASE,
  F,
  R,
  RACE_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../src/simulation/protocol.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { VEHICLES, vehicleIndex } from '../src/simulation/vehicles.ts';
import { revLedThresholds } from '../src/ui/f1-hud.ts';

const track = new Track();
const o = carBase(0),
  b = o + BIKE_BASE;

describe('motorcycle presentation follows the selected machine and recorded pose', () => {
  it.each(['gpr1', 'gpr2', 'sbk1000', 'ss600'])(
    'showroom %s uses its own grounded bike, wheels and sag without creating motion',
    (id) => {
      const frame = menuPreview(track, track.length - 32, id);
      const def = VEHICLES[id],
        sag = staticSag(def),
        road = track.at(frame[o + F.S], trackPoint());
      expect(frame[o + RACE_BASE + R.VEHICLE]).toBe(vehicleIndex(id));
      expect(frame[o + F.Y] - road.y).toBeCloseTo(def.bike!.cgHeight, 5);
      expect(frame[b + B.FORK]).toBeCloseTo(sag.fork, 6);
      expect(frame[b + B.SHOCK]).toBeCloseTo(sag.shock, 6);
      expect(frame[o + WHEEL_BASE + W.RADIUS]).toBeCloseTo(def.bike!.frontWheelRadius, 6);
      expect(frame[o + WHEEL_BASE + 2 * WHEEL_STRIDE + W.RADIUS]).toBeCloseTo(
        def.bike!.rearWheelRadius,
        6,
      );
      expect(frame[o + F.BATTERY]).toBe(0);
      expect(frame[o + F.SPEED]).toBe(0);
      expect(frame[o + F.LAPS]).toBe(0);
      expect(frame.every(Number.isFinite)).toBe(true);
    },
  );

  it('shows chassis lean and independent front/rear tyre data, ignoring duplicated transport wheels', () => {
    const frame = menuPreview(track, undefined, 'gpr1');
    frame[b + B.LEAN] = 0.72;
    frame[b + B.REAR_BRAKE] = 0.42;
    frame[b + B.INTERVENTION] = 0.15;
    frame[o + WHEEL_BASE + W.CARCASS_TEMP] = 91;
    frame[o + WHEEL_BASE + W.WEAR] = 0.12;
    frame[o + WHEEL_BASE + 2 * WHEEL_STRIDE + W.CARCASS_TEMP] = 104;
    frame[o + WHEEL_BASE + 2 * WHEEL_STRIDE + W.WEAR] = 0.27;
    // Poison only the transport copies: the HUD must use the two real samples.
    frame[o + WHEEL_BASE + WHEEL_STRIDE + W.CARCASS_TEMP] = 999;
    frame[o + WHEEL_BASE + 3 * WHEEL_STRIDE + W.CARCASS_TEMP] = 999;
    const copy = frame.slice(),
      result = bikeReadout(frame)!;
    expect(result.lean).toBe(
      Math.round((chassisLean(frame[b + B.LEAN], VEHICLES.gpr1.bike!) * 180) / Math.PI),
    );
    expect(result.front).toEqual({ temperature: 91, life: 88, punctured: false });
    expect(result.rear).toEqual({ temperature: 104, life: 73, punctured: false });
    expect(result.rearBrake).toBe(42);
    expect(result.intervention).toBe(15);
    expect(bikeReadout(frame)).toEqual(result);
    expect(frame).toEqual(copy);
    frame[o + RACE_BASE + R.VEHICLE] = 0;
    expect(bikeReadout(frame)).toBeNull();
  });

  it('can seek between fallen, braking and clear frames without retaining an alert or electronics state', () => {
    const clear = menuPreview(track, undefined, 'gpr2');
    const fallen = clear.slice();
    fallen[b + B.STATE] = 3;
    fallen[b + B.INTERVENTION] = 0.6;
    expect(bikeReadout(fallen)?.state).toBe('RIDER DOWN');
    expect(bikeReadout(fallen)?.frontLoad).toBeNull();
    expect(bikeReadout(fallen)?.rearLoad).toBeNull();
    expect(bikeReadout(fallen)?.intervention).toBe(60);
    expect(bikeReadout(clear)?.state).toBe('RIDING');
    expect(bikeReadout(clear)?.intervention).toBe(0);
    expect(revLedThresholds(VEHICLES.ss600.spec.shiftRPM).at(-1)).toBeCloseTo(
      VEHICLES.ss600.spec.shiftRPM,
      -1,
    );
  });

  it('keeps chase framing finite, mirrors corner anticipation and holds a stable reduced-motion rig', () => {
    const left = motorcycleChase(45, 0.4, 0.8),
      right = motorcycleChase(45, 0.4, -0.8);
    expect(left.yaw).toBeGreaterThan(0);
    expect(left.yaw).toBeCloseTo(-right.yaw, 12);
    expect(left.distance + 45 * left.distancePerMS).toBeLessThan(3.5);
    expect(motorcycleChase(0, 0, 0.8).yaw).toBe(0);
    for (const speed of [NaN, -500, 0, 110, Infinity])
      expect(Object.values(motorcycleChase(speed, NaN, Infinity)).every(Number.isFinite)).toBe(
        true,
      );
    const still = motorcycleChase(0, 0, 0, true),
      fast = motorcycleChase(95, 1, 1, true);
    expect(fast.height).toBe(still.height);
    expect(fast.distancePerMS).toBe(0);
    expect(fast.heightPerMS).toBe(0);
    expect(fast.fovGain).toBe(0);
    expect(fast.yaw).toBe(0);
  });
});
