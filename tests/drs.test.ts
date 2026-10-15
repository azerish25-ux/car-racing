import { describe, expect, it } from 'vitest';
import { aero, type AeroForces } from '../src/simulation/aero.ts';
import { CIRCUITS } from '../src/simulation/circuits.ts';
import {
  COMPOUNDS,
  DEFAULT_OPTIONS,
  DEFAULT_SETUP,
  VEHICLE,
  controls,
} from '../src/simulation/config.ts';
import { PIT_CHOICES, selectedPitCompound } from '../src/ui/race-day-hud.ts';
import {
  DRS,
  DRS_STATE,
  DrsControl,
  gridDrs,
  OVERTAKE,
  crossed,
  onArc,
  type DrsContext,
} from '../src/simulation/drs.ts';
import { H, R, RACE_BASE, carBase } from '../src/simulation/protocol.ts';
import { Simulation } from '../src/simulation/world.ts';
import { EVENTS } from '../src/simulation/events.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { eventCard } from '../src/ui/event-cards.ts';
import type { Vehicle } from '../src/simulation/vehicle.ts';
import { DEFAULT_BINDINGS, validateBindings } from '../src/input/bindings.ts';
import { defaultButtonActions, validateButtonActions } from '../src/input/button-actions.ts';
import { DEFAULT_SETTINGS } from '../src/storage/data.ts';

const forces = (): AeroForces => ({ front: 0, rear: 0, floor: 0, drag: 0, wake: 0 });
type Stub = Pick<
  Vehicle,
  's' | 'inPit' | 'retired' | 'finishTime' | 'brake' | 'drsRequest' | 'drsOpen'
>;
const stub = (s: number): Stub => ({
  s,
  inPit: false,
  retired: false,
  finishTime: 0,
  brake: 0,
  drsRequest: false,
  drsOpen: false,
});
const context = (over: Partial<DrsContext> = {}): DrsContext => ({
  racing: true,
  leaderLaps: 2,
  water: 0,
  neutralised: false,
  yellow: () => false,
  ...over,
});
const LENGTH = 2972.7;
const AUREL_ZONE = CIRCUITS.aurel.drsZones;

/** Drive stub cars at constant speeds for `seconds`, stepping the control. */
function run(
  control: DrsControl,
  cars: Stub[],
  speeds: number[],
  seconds: number,
  ctx: DrsContext,
  t0 = 0,
  each?: (time: number) => void,
) {
  const dt = 1 / 120;
  let time = t0;
  for (let tick = 0; tick < seconds * 120; tick++) {
    time += dt;
    cars.forEach((c, i) => (c.s = (c.s + speeds[i] * dt) % LENGTH));
    control.update(dt, time, cars as Vehicle[], ctx);
    each?.(time);
  }
  return time;
}

describe('DRS zones and rules', () => {
  it('places the zones on the measured straights', () => {
    expect(AUREL_ZONE).toEqual([{ detect: 2180, start: 2300, end: 470 }]);
    expect(CIRCUITS.vellamar.drsZones).toEqual([
      { detect: 3330, start: 3420, end: 640 },
      { detect: 1800, start: 1900, end: 2720 },
    ]);
    expect(onArc(2400, 2300, 470, LENGTH)).toBe(true);
    expect(onArc(100, 2300, 470, LENGTH)).toBe(true);
    expect(onArc(600, 2300, 470, LENGTH)).toBe(false);
    expect(crossed(2970, 3, 0.5, LENGTH)).toBe(true);
    expect(crossed(2170, 2181, 2180, LENGTH)).toBe(true);
    expect(crossed(2181, 2190, 2180, LENGTH)).toBe(false);
  });

  it('applies the aero deltas with the flap open', () => {
    const closed = forces(),
      open = forces();
    aero(70, DEFAULT_SETUP, 0.05, 0.07, 1, 1, 1, 0, 0, closed);
    aero(70, DEFAULT_SETUP, 0.05, 0.07, 1, 1, 1, 0, 0, open, 1);
    expect(open.rear / closed.rear).toBeCloseTo(1 - DRS.rearLoss, 10);
    expect(open.drag / closed.drag).toBeCloseTo(1 - DRS.dragLoss, 10);
    expect(open.front).toBe(closed.front);
    expect(open.floor).toBe(closed.floor);
  });

  it('makes a car within 1.0 s at detection eligible, not the car ahead', () => {
    const control = new DrsControl(AUREL_ZONE, LENGTH, 2, [2150, 2150 - 0.8 * 70]);
    const cars = [stub(2150), stub(2150 - 0.8 * 70)];
    run(control, cars, [70, 70], 2.5, context());
    // Both are past the detection line; the follower crossed 0.8 s later.
    expect(control.eligibleZone[1]).toBe(0);
    expect(control.eligibleZone[0]).toBe(-1);
    // Into the zone: available, then open on request.
    run(control, cars, [70, 70], 2.5, context(), 2.5);
    expect(cars[1].s).toBeGreaterThan(2300);
    expect(control.state[1]).toBe(DRS_STATE.AVAILABLE);
    expect(control.state[0]).toBe(DRS_STATE.OFF);
    cars[1].drsRequest = true;
    run(control, cars, [70, 70], 0.1, context(), 5);
    expect(control.state[1]).toBe(DRS_STATE.OPEN);
    expect(cars[1].drsOpen).toBe(true);
    // The brake closes it; it stays closed until requested again.
    cars[1].brake = 0.3;
    run(control, cars, [70, 70], 0.05, context(), 5.1);
    expect(control.state[1]).toBe(DRS_STATE.AVAILABLE);
    cars[1].brake = 0;
    run(control, cars, [70, 70], 0.2, context(), 5.15);
    expect(control.state[1]).toBe(DRS_STATE.AVAILABLE);
    // Request again: open until the end of the zone, then off and ineligible.
    cars[1].drsRequest = true;
    let openUntil = 0;
    run(control, cars, [70, 70], 25, context(), 5.35, () => {
      if (control.state[1] === DRS_STATE.OPEN) openUntil = cars[1].s;
    });
    expect(openUntil).toBeLessThan(470);
    expect(openUntil).toBeGreaterThan(470 - 2);
    expect(control.eligibleZone[1]).toBe(-1);
    expect(control.state[1]).toBe(DRS_STATE.OFF);
  });

  it('needs the gap under 1.0 s, race lap 3, a dry track and no yellow or safety car', () => {
    const follow = (gap: number, ctx: DrsContext) => {
      // The follower crosses detection (2180) at 1.86 s, the leader gap s earlier.
      const control = new DrsControl(AUREL_ZONE, LENGTH, 2, [2050 + gap * 70, 2050]);
      const cars = [stub(2050 + gap * 70), stub(2050)];
      run(control, cars, [70, 70], 4, ctx);
      cars[1].drsRequest = true;
      run(control, cars, [70, 70], 0.1, ctx, 4);
      return control.state[1];
    };
    expect(follow(0.9, context())).toBe(DRS_STATE.OPEN);
    expect(follow(1.1, context())).toBe(DRS_STATE.OFF);
    expect(follow(0.9, context({ leaderLaps: 1 }))).toBe(DRS_STATE.OFF);
    expect(follow(0.9, context({ water: DRS.wetLimit + 0.01 }))).toBe(DRS_STATE.OFF);
    expect(follow(0.9, context({ yellow: (car) => car === 1 }))).toBe(DRS_STATE.OFF);
    expect(follow(0.9, context({ neutralised: true }))).toBe(DRS_STATE.OFF);
    // Practice and time trial: free use whatever the gap, still not in the wet.
    expect(follow(5, context({ racing: false, leaderLaps: 0 }))).toBe(DRS_STATE.OPEN);
    expect(follow(5, context({ racing: false, water: 0.5 }))).toBe(DRS_STATE.OFF);
  });
});

describe('DRS and ERS overtake in the simulation', () => {
  it('opens the player flap only on request, moving it over 0.15 s, and publishes R.DRS', () => {
    const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'practice', opponents: 0 });
    sim.autoPlayer = true;
    const car = sim.cars[0];
    car.place(sim.track, 2050, 0);
    const frame = sim.makeFrame();
    const r = carBase(0) + RACE_BASE;
    let sawOpen = false,
      flapAtOpen = -1,
      noRequestOpen = false;
    for (let tick = 0; tick < 60 * 120 && !sawOpen; tick++) {
      // Benchmark rule: without a request the flap never opens.
      sim.step(1 / 120);
      if (car.drsOpen) noRequestOpen = true;
      if (sim.race.drs.state[0] === DRS_STATE.AVAILABLE && car.brake < 0.05) {
        sim.setInput({ ...controls(), drs: true });
        sim.step(1 / 120);
        sim.writeFrame(frame);
        sawOpen = frame[r + R.DRS] === DRS_STATE.OPEN;
        sim.step(1 / 120); // The flap starts moving on the next physics step.
        flapAtOpen = car.drsFlap;
      }
    }
    expect(noRequestOpen).toBe(false);
    expect(sawOpen).toBe(true);
    expect(frame[H.DRS_ENABLED]).toBe(1);
    expect(flapAtOpen).toBeGreaterThan(0);
    expect(flapAtOpen).toBeLessThan(0.1);
    for (let tick = 0; tick < 18; tick++) sim.step(1 / 120);
    if (car.drsOpen) expect(car.drsFlap).toBe(1);
  });

  it('keeps DRS off for a car built without the flap, on any grid and in the HUD', () => {
    // Unit: the unfitted follower is within 1.0 s and asks for the flap.
    const control = new DrsControl(AUREL_ZONE, LENGTH, 2, [2150, 2150 - 0.8 * 70], [true, false]);
    const cars = [stub(2150), stub(2150 - 0.8 * 70)];
    run(
      control,
      cars,
      [70, 70],
      5,
      context({ leaderLaps: 3 }),
      0,
      () => (cars[1].drsRequest = true),
    );
    expect(control.eligibleZone[1]).toBe(-1);
    expect(control.state[1]).toBe(DRS_STATE.OFF);
    expect(cars[1].drsOpen).toBe(false);
    // Simulation: the FE-4 practice benchmark that opens the APX-01's flap.
    const sim = new Simulation({
      ...DEFAULT_OPTIONS,
      mode: 'practice',
      opponents: 0,
      vehicles: ['fe4'],
    });
    sim.autoPlayer = true;
    const car = sim.cars[0];
    expect(car.definition.drs).toBe(false);
    car.place(sim.track, 2050, 0);
    const frame = sim.makeFrame();
    const r = carBase(0) + RACE_BASE;
    let state = 0;
    for (let tick = 0; tick < 20 * 120; tick++) {
      sim.setInput({ ...controls(), drs: true });
      sim.step(1 / 120);
      sim.writeFrame(frame);
      state = Math.max(state, frame[r + R.DRS]);
    }
    expect(sim.race.drs.enabled).toBe(true);
    expect(sim.race.drsActive).toBe(false);
    expect(state).toBe(DRS_STATE.OFF);
    expect(frame[H.DRS_ENABLED]).toBe(0);
    // Event cards and the setup line state DRS per grid.
    const entry = EVENTS.find((e) => e.id === 'vellamar-entry-formula-sprint')!,
      feeder = EVENTS.find((e) => e.id === 'aurel-feeder-formula-sprint')!;
    expect(entry.ruleset).toBe(feeder.ruleset);
    expect(eventCard(entry, 0)).toMatch(/DRS off/);
    expect(eventCard(feeder, 0)).toMatch(/DRS on/);
    expect(gridDrs(true, [VEHICLES.fe4, VEHICLES.fr3])).toBe(true);
    expect(gridDrs(true, [VEHICLES.fe4])).toBe(false);
    expect(gridDrs(false, [VEHICLES.fr3])).toBe(false);
  });

  it('gives a 4 s overtake boost once the battery allows it', () => {
    const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'practice', opponents: 0 });
    const car = sim.cars[0];
    car.battery = VEHICLE.maxBatteryJ * (OVERTAKE.minBattery - 0.01);
    sim.setInput({ ...controls(), overtake: true });
    expect(car.overtakeClock).toBe(0);
    car.battery = VEHICLE.maxBatteryJ * 0.5;
    sim.setInput({ ...controls(), overtake: true });
    expect(car.overtakeClock).toBe(OVERTAKE.seconds);
    for (let tick = 0; tick < 120; tick++) sim.step(1 / 120);
    expect(car.overtakeClock).toBeCloseTo(OVERTAKE.seconds - 1, 6);
    const frame = sim.makeFrame();
    expect(frame[carBase(0) + RACE_BASE + R.OVERTAKE]).toBeCloseTo(OVERTAKE.seconds - 1, 4);
  });

  it('binds DRS to F and overtake to O, falling back to a free key for saved bindings', () => {
    expect(DEFAULT_BINDINGS.drs).toBe('KeyF');
    expect(DEFAULT_BINDINGS.overtake).toBe('KeyO');
    const saved = { ...DEFAULT_BINDINGS } as Record<string, string>;
    delete saved.drs;
    delete saved.overtake;
    saved.camera = 'KeyF';
    const migrated = validateBindings(saved);
    expect(migrated.drs).toBe('KeyV');
    expect(migrated.overtake).toBe('KeyO');
    const pad = defaultButtonActions(true) as Record<string, number>;
    delete pad.drs;
    delete pad.overtake;
    const actions = validateButtonActions(pad, structuredClone(DEFAULT_SETTINGS).mapping);
    expect(actions.drs).toBe(-1);
    expect(actions.overtake).toBe(-1);
  });
});

describe('pit strategy', () => {
  it('fits the compound picked on the STRATEGY page and counts laps on the set', () => {
    const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'race', opponents: 1 });
    const frame = sim.makeFrame();
    const r = carBase(0) + RACE_BASE;
    expect(frame[r + R.NEXT_COMPOUND]).toBe(-1);
    sim.requestPit('soft');
    sim.writeFrame(frame);
    expect(sim.cars[0].nextCompound).toBe('soft');
    expect(frame[r + R.NEXT_COMPOUND]).toBe(Object.keys(COMPOUNDS).indexOf('soft'));
    sim.requestPit();
    sim.writeFrame(frame);
    expect(frame[r + R.NEXT_COMPOUND]).toBe(-1);
    expect(frame[r + R.TYRE_AGE_LAPS]).toBe(0);
    const hud = { dataset: { pitCompound: 'hard' } } as unknown as HTMLElement;
    expect(selectedPitCompound(hud)).toBe('hard');
    hud.dataset.pitCompound = 'auto';
    expect(selectedPitCompound(hud)).toBeUndefined();
    hud.dataset.pitCompound = 'slick';
    expect(selectedPitCompound(hud)).toBeUndefined();
    expect(PIT_CHOICES).toEqual(['auto', 'soft', 'medium', 'hard', 'intermediate', 'wet']);
  });
});
