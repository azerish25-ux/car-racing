import { describe, expect, it } from 'vitest';
import {
  BIKE_SETUP_KEYS,
  ENGINE_BRAKE_MAPS,
  TRACTION_MAPS,
  WHEELIE_MAPS,
  bikeParameters,
  bikeSetupParameters,
  dampingFirmness,
} from '../src/simulation/bike-definitions.ts';
import { BikeVehicle } from '../src/simulation/bike-vehicle.ts';
import {
  DEFAULT_SETUP,
  SETUP_LIMITS,
  validateSetup,
  type Setup,
} from '../src/simulation/config.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { SURFACE, Track, trackPoint } from '../src/simulation/track.ts';
import { VEHICLES, setupFor, vehicleDefinition } from '../src/simulation/vehicles.ts';
import { SETUP_EFFECTS, exposedValues, presetEffects } from '../src/career/economy.ts';
import { SETUP_LABELS, setupRows } from '../src/ui/setup-page.ts';

const BIKE_KEYS = new Set<keyof Setup>(BIKE_SETUP_KEYS.electronic);
const bikes = Object.values(VEHICLES).filter((v) => v.dynamicsKind === 'bike');
const cars = Object.values(VEHICLES).filter((v) => v.dynamicsKind !== 'bike');
const GPR1 = vehicleDefinition('gpr1');

/** A bike on the Aurel straight at `speed` in `gear`, after `seconds` at `throttle`. */
function ride(
  setup: Partial<Setup>,
  speed: number,
  gear: number,
  throttle: number,
  seconds: number,
) {
  const track = new Track();
  const bike = new BikeVehicle(0, 'medium', { ...DEFAULT_SETUP, ...setup }, 'sport', GPR1);
  bike.place(track, 120);
  bike.dynamics.speed = speed;
  bike.gear = gear;
  bike.autoShift = false;
  bike.input.throttle = throttle;
  for (let t = 0; t < seconds; t += 1 / 120) bike.step(1 / 120, track);
  return bike;
}

describe('motorcycle setup: what each machine exposes', () => {
  it('shows bikes their own parameters and cars none of them', () => {
    for (const bike of bikes) {
      expect(bike.setupKeys.length, bike.id).toBeGreaterThan(0);
      for (const key of bike.setupKeys) expect(BIKE_KEYS.has(key), `${bike.id}:${key}`).toBe(true);
    }
    for (const car of cars)
      for (const key of car.setupKeys) expect(BIKE_KEYS.has(key), `${car.id}:${key}`).toBe(false);
    expect(GPR1.setupKeys).toEqual(BIKE_SETUP_KEYS.electronic);
    expect(vehicleDefinition('nr900').setupKeys).toEqual(BIKE_SETUP_KEYS.roadster);
    expect(vehicleDefinition('cr750').setupKeys).toEqual(BIKE_SETUP_KEYS.classic);
    expect(vehicleDefinition('mx250').setupKeys).toEqual(BIKE_SETUP_KEYS.offroad);
    // The classic and the dirt bikes carry no rider-aid electronics.
    for (const id of ['cr750', 'mx450', 'mx250', 'sm450'])
      for (const map of ['tractionMap', 'wheelieMap', 'engineBrakeMap'] as const)
        expect(vehicleDefinition(id).setupKeys).not.toContain(map);
  });
  it('builds the garage page from setupFor: a bike sees preload, damping, damper, gearing and maps', () => {
    const rows = setupRows(GPR1, validateSetup({ ...DEFAULT_SETUP, frontWing: 0.9, gearing: 1.5 }));
    expect(rows.map((r) => r.key)).toEqual([...BIKE_SETUP_KEYS.electronic]);
    expect(rows.find((r) => r.key === 'gearing')!.value).toBe(1.08); // clamped as the session will
    expect(rows.find((r) => r.key === 'tractionMap')).toMatchObject({ min: 1, max: 6, step: 1 });
    expect(rows.find((r) => r.key === 'engineBrakeMap')).toMatchObject({ min: 0, max: 3, step: 1 });
    expect(rows.find((r) => r.key === 'frontDamping')!.step).toBe(0.05);
    for (const row of rows) expect(row.label).toBe(SETUP_LABELS[row.key]);
    expect(setupRows(vehicleDefinition('cr750'), DEFAULT_SETUP).map((r) => r.key)).toEqual([
      'rearPreload',
      'frontDamping',
      'rearDamping',
      'gearing',
    ]);
    // The Formula car keeps its full chassis page and never shows a bike row.
    const apx = setupRows(vehicleDefinition('apx01'), DEFAULT_SETUP).map((r) => r.key);
    expect(apx).toContain('frontWing');
    expect(apx.some((k) => BIKE_KEYS.has(k))).toBe(false);
  });
  it('validates, saves and explains the new parameters like every other setup value', () => {
    for (const key of BIKE_KEYS) {
      expect(SETUP_LIMITS[key][0]).toBeLessThanOrEqual(DEFAULT_SETUP[key]);
      expect(SETUP_LIMITS[key][1]).toBeGreaterThanOrEqual(DEFAULT_SETUP[key]);
      expect(SETUP_EFFECTS[key].name.length).toBeGreaterThan(3);
    }
    expect(validateSetup({ tractionMap: 9, rearPreload: -1 })).toMatchObject({
      tractionMap: 6,
      rearPreload: -0.005,
    });
    const values = exposedValues(GPR1, { ...DEFAULT_SETUP, tractionMap: 5 });
    expect(Object.keys(values).sort()).toEqual([...BIKE_SETUP_KEYS.electronic].sort());
    expect(presetEffects(GPR1, values).join(' ')).toMatch(/Traction control map up/);
  });
});

describe('motorcycle setup: physical effect', () => {
  it('is the calibrated machine, bit for bit, at the default setup', () => {
    for (const bike of bikes) {
      const base = bikeParameters(bike),
        set = bikeSetupParameters(base, bike, setupFor(bike, DEFAULT_SETUP, DEFAULT_SETUP));
      expect(set).toEqual({
        ...base,
        wheelieLimit: base.wheelieLimit,
        wheelieKeep: 0.2,
        tractionMargin: 0.92,
        rollDamping: 1.2,
      });
    }
    expect(TRACTION_MAPS[3]).toBe(0.92);
    expect(WHEELIE_MAPS[3]).toEqual({ limit: 1, keep: 0.2 });
    expect(ENGINE_BRAKE_MAPS[0]).toBe(0);
    expect(dampingFirmness(0.5)).toBe(1);
  });
  it('maps preload, damper, damping and the rider-aid maps onto the dynamics core', () => {
    const at = (setup: Partial<Setup>) =>
      bikeSetupParameters(
        bikeParameters(GPR1),
        GPR1,
        setupFor(GPR1, { ...DEFAULT_SETUP, ...setup }, DEFAULT_SETUP),
      );
    const base = at({});
    expect(at({ frontPreload: 0.01, rearPreload: 0.01 }).cgHeight).toBeCloseTo(
      base.cgHeight + 0.01,
      9,
    );
    expect(at({ steeringDamper: 1 }).steerRate).toBeLessThan(base.steerRate);
    expect(at({ steeringDamper: 0 }).steerRate).toBeGreaterThan(base.steerRate);
    expect(at({ frontDamping: 1, rearDamping: 1 }).rollDamping).toBeCloseTo(2.4, 9);
    expect(at({ tractionMap: 6 }).tractionMargin).toBeLessThan(
      at({ tractionMap: 1 }).tractionMargin!,
    );
    expect(at({ wheelieMap: 5 }).wheelieLimit).toBeLessThan(at({ wheelieMap: 1 }).wheelieLimit!);
    expect(at({ wheelieMap: 5 }).wheelieKeep).toBeGreaterThan(at({ wheelieMap: 1 }).wheelieKeep!);
    // A machine that does not expose a key cannot be set through it.
    const classic = vehicleDefinition('cr750');
    const c = bikeSetupParameters(
      bikeParameters(classic),
      classic,
      setupFor(classic, { ...DEFAULT_SETUP, tractionMap: 6, frontPreload: 0.01 }, DEFAULT_SETUP),
    );
    expect(c.tractionMargin).toBe(0.92);
    expect(c.cgHeight).toBe(bikeParameters(classic).cgHeight);
  });
  it('shorter gearing pulls harder and revs higher at the same road speed', () => {
    const short = ride({ gearing: 1.08 }, 30, 3, 1, 0.1),
      long = ride({ gearing: 0.92 }, 30, 3, 1, 0.1),
      calibrated = ride({}, 30, 3, 1, 0.1);
    expect(short.rpm).toBeGreaterThan(calibrated.rpm);
    expect(calibrated.rpm).toBeGreaterThan(long.rpm);
    expect(short.dynamics.speed).toBeGreaterThan(long.dynamics.speed);
  });
  it('engine braking slows a closed-throttle bike only when a map asks for it', () => {
    const free = ride({}, 40, 4, 0, 1),
      strong = ride({ engineBrakeMap: 3 }, 40, 4, 0, 1);
    expect(strong.dynamics.speed).toBeLessThan(free.dynamics.speed - 0.3);
    expect(strong.dynamics.state).toBe('riding');
  });
  it('preload takes sag out of the fork and shock (recorded travel)', () => {
    const soft = ride({}, 20, 2, 0.2, 0.5),
      wound = ride({ frontPreload: 0.008, rearPreload: 0.008 }, 20, 2, 0.2, 0.5);
    expect(wound.fork).toBeLessThan(soft.fork - 0.005);
    expect(wound.shock).toBeLessThan(soft.shock - 0.005);
  });
  it('the dirt bike chassis takes preload and damping on its own springs', () => {
    const MX = vehicleDefinition('mx450');
    const track = new Track();
    const make = (setup: Partial<Setup>) => {
      const bike = new DirtBikeVehicle(0, 'medium', { ...DEFAULT_SETUP, ...setup }, 'sport', MX);
      bike.place(track, 120);
      return bike;
    };
    expect(make({ rearPreload: 0.01 }).compressionRear).toBeLessThan(
      make({}).compressionRear - 0.009,
    );
  });
  it('dirt bike damping clicks change how the springs take and settle a hit', () => {
    // Riding at 10 m/s on the flat, the chassis is dropped onto its springs
    // at 1.5 m/s: firmer damping compresses less and settles sooner.
    const MX = vehicleDefinition('mx450');
    const track = new Track();
    const hit = (click: number) => {
      const bike = new DirtBikeVehicle(
        0,
        'medium',
        { ...DEFAULT_SETUP, frontDamping: click, rearDamping: click },
        'sport',
        MX,
      );
      bike.place(track, 120);
      bike.dynamics.speed = 10;
      bike.autoShift = false;
      bike.input.throttle = 0.3;
      for (let t = 0; t < 0.5; t += 1 / 120) bike.step(1 / 120, track);
      const rest = bike.compressionRear;
      bike.vy = -1.5;
      const travel: number[] = [];
      for (let t = 0; t < 0.8; t += 1 / 120) {
        bike.step(1 / 120, track);
        travel.push(bike.compressionRear);
      }
      expect(bike.dynamics.state).toBe('riding');
      return {
        peak: Math.max(...travel),
        // Distance from rest summed after the first quarter second.
        settle: travel.slice(30).reduce((sum, c) => sum + Math.abs(c - rest), 0),
      };
    };
    const soft = hit(0),
      calibrated = hit(0.5),
      firm = hit(1);
    expect(firm.peak).toBeLessThan(calibrated.peak - 0.01);
    expect(calibrated.peak).toBeLessThan(soft.peak - 0.01);
    expect(firm.settle).toBeLessThan(calibrated.settle * 0.8);
    expect(calibrated.settle).toBeLessThan(soft.settle * 0.8);
  });
  it('road bike damping: the fork follows a load step more slowly and kerbs grip less when firmer', () => {
    const at = (click: number) => ({ frontDamping: click, rearDamping: click });
    // Hard braking from 40 m/s: 50 ms later a softer fork has dived further.
    const dive = (click: number) => {
      const bike = ride(at(click), 40, 4, 0.3, 0.5);
      const track = new Track();
      bike.input.throttle = 0;
      bike.input.brake = 1;
      for (let t = 0; t < 0.05; t += 1 / 120) bike.step(1 / 120, track);
      return bike.fork;
    };
    expect(dive(0)).toBeGreaterThan(dive(0.5) + 0.004);
    expect(dive(0.5)).toBeGreaterThan(dive(1) + 0.004);
    // On the kerb band beside the Aurel straight: a firm click skips over
    // the strips (less grip), a soft one follows them; off the kerb the
    // click does not change the grip.
    const grip = (click: number, kerb: boolean) => {
      const track = new Track();
      const bike = new BikeVehicle(0, 'medium', { ...DEFAULT_SETUP, ...at(click) }, 'sport', GPR1);
      bike.place(track, 120, kerb ? track.at(120, trackPoint()).width + 0.5 : 0);
      bike.dynamics.speed = 30;
      bike.gear = 3;
      bike.autoShift = false;
      bike.input.throttle = 0.5;
      bike.step(1 / 120, track);
      bike.step(1 / 120, track);
      expect(bike.contacts[0].surface).toBe(kerb ? SURFACE.KERB : SURFACE.ASPHALT);
      return bike.dynamics.grip;
    };
    expect(grip(1, true)).toBeLessThan(grip(0.5, true) - 0.03);
    expect(grip(0, true)).toBeGreaterThan(grip(0.5, true) + 0.03);
    expect(grip(1, false)).toBe(grip(0.5, false));
    expect(grip(0, false)).toBe(grip(0.5, false));
  });
  it('dirt bike gearing holds in the air: no rpm step at take-off, the limiter through the same ratio', () => {
    const MX = vehicleDefinition('mx450');
    const track = new Track();
    for (const gearing of [0.92, 1, 1.08]) {
      const bike = new DirtBikeVehicle(0, 'medium', { ...DEFAULT_SETUP, gearing }, 'sport', MX);
      bike.place(track, 120);
      bike.dynamics.speed = 15;
      bike.gear = 3;
      bike.autoShift = false;
      bike.input.throttle = 0.4;
      for (let t = 0; t < 0.5; t += 1 / 120) bike.step(1 / 120, track);
      // Thrown upward off its springs: both wheels leave the ground.
      bike.vy = 3.5;
      let before = bike.rpm;
      for (let k = 0; k < 60 && !bike.airborne; k++) {
        before = bike.rpm;
        bike.step(1 / 120, track);
      }
      expect(bike.airborne, `gearing ${gearing}`).toBe(true);
      expect(bike.rpm / before, `gearing ${gearing}`).toBeCloseTo(1, 2);
      // Full throttle in the air: the rear wheel stops at the limiter
      // speed of the geared drive, the same ratio the ground path uses.
      bike.input.throttle = 1;
      let spin = 0;
      for (let k = 0; k < 600 && bike.airborne; k++) {
        bike.step(1 / 120, track);
        if (bike.airborne) spin = Math.max(spin, bike.rearSpin);
      }
      const spec = MX.spec,
        ratio = spec.gearRatios[bike.gear + 1] * spec.finalDrive * gearing;
      expect(spin, `gearing ${gearing}`).toBeCloseTo((spec.limiterRPM * Math.PI) / 30 / ratio, 6);
    }
  });
});
