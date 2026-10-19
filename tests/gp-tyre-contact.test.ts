import { describe, expect, it } from 'vitest';
import { Bike, EXPERT, NOVICE, type BikeInput } from '../src/simulation/bike.ts';
import { BikeVehicle } from '../src/simulation/bike-vehicle.ts';
import { DEFAULT_OPTIONS, DEFAULT_SETUP } from '../src/simulation/config.ts';
import { PHASE } from '../src/simulation/race.ts';
import { SURFACE, Track, trackPoint } from '../src/simulation/track.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { Simulation } from '../src/simulation/world.ts';

const DT = 1 / 240;
const control: BikeInput = {
  lean: 0,
  rider: 0,
  throttle: 0,
  frontBrake: 0,
  rearBrake: 0,
  drive: 0,
};

/** Use the real session adapter, drivetrain and tyre model, with a controlled
 * contact grip discontinuity. Track sampling is checked independently below. */
function contactStep(
  id: string,
  frontGrip: number,
  rearGrip: number,
  action: 'brake' | 'throttle',
) {
  const track = new Track();
  const bike = new BikeVehicle(0, 'medium', DEFAULT_SETUP, 'sport', VEHICLES[id]);
  bike.place(track, 120);
  bike.dynamics.speed = 35;
  bike.gear = 3;
  bike.rpm = 12000;
  bike.autoShift = false;
  bike.contacts[0].grip = bike.contacts[1].grip = frontGrip;
  bike.contacts[2].grip = bike.contacts[3].grip = rearGrip;
  bike.input[action] = 1;
  bike.step(DT, track);
  return bike;
}

describe('GP front and rear contact grip', () => {
  it.each(['gpr1', 'gpr2'])(
    '%s retains useful drive from a clean rear contact when the front crosses a low-grip patch',
    (id) => {
      const frontLow = contactStep(id, 0.35, 1, 'throttle');
      const rearLow = contactStep(id, 1, 0.35, 'throttle');
      const bothLow = contactStep(id, 0.35, 0.35, 'throttle');
      // Previously both arrangements reduced the driven tyre to the worse
      // contact: about 660 N regardless of which wheel had clean asphalt.
      expect(frontLow.dynamics.driveForce).toBeGreaterThan(rearLow.dynamics.driveForce * 2);
      expect(frontLow.speed).toBeGreaterThan(rearLow.speed);
      expect(rearLow.dynamics.driveForce).toBe(bothLow.dynamics.driveForce);
      for (const bike of [frontLow, rearLow, bothLow]) {
        const d = bike.dynamics;
        expect(d.grip).toBe(Math.min(d.frontGrip!, d.rearGrip!));
        expect(d.state).toBe('riding');
        expect(d.frontUse).toBeLessThanOrEqual(1);
        expect(d.rearUse).toBeLessThanOrEqual(1);
        expect(d.speed).toBeCloseTo(35 + d.longitudinal * DT, 12);
        expect(bike.tires[2].fx).toBe(d.driveForce);
      }
    },
  );

  it.each(['gpr1', 'gpr2'])(
    '%s keeps front braking available with a low-grip rear while respecting rear unloading',
    (id) => {
      const frontLow = contactStep(id, 0.35, 1, 'brake').dynamics;
      const rearLow = contactStep(id, 1, 0.35, 'brake').dynamics;
      expect(rearLow.frontBrakeForce).toBeGreaterThan(frontLow.frontBrakeForce * 2);
      expect(rearLow.speed).toBeLessThan(frontLow.speed);
      // The extra front deceleration must not grant the lightly loaded rear
      // a second force allowance; ABS reduces its service-brake workload.
      expect(rearLow.rearBrakeForce).toBeLessThan(frontLow.rearBrakeForce);
      for (const bike of [frontLow, rearLow]) {
        expect(bike.frontUse).toBeLessThanOrEqual(1);
        expect(bike.rearUse).toBeLessThanOrEqual(1);
        expect(bike.rearLoad).toBeGreaterThan(0);
        expect(bike.pitch).toBe(0);
        expect(bike.state).toBe('riding');
      }
    },
  );

  it('uses separately sampled real kerb and asphalt contacts and refreshes them after repositioning', () => {
    const track = new Track();
    const p = track.at(120, trackPoint());
    const bike = new BikeVehicle(0, 'medium', DEFAULT_SETUP, 'sport', VEHICLES.gpr1);
    // Nose across the actual strip, rear still on the racing surface. These
    // are production Track.sample results, not injected contact samples.
    bike.placeFree(
      track,
      p.x + p.nx * (p.width - 0.2),
      p.z + p.nz * (p.width - 0.2),
      Math.atan2(p.tx, p.tz) + 0.9,
      p.y,
    );
    expect(bike.contacts[0].surface).toBe(SURFACE.KERB);
    expect(bike.contacts[2].surface).toBe(SURFACE.ASPHALT);
    bike.dynamics.speed = 12;
    bike.input.throttle = 0.4;
    bike.step(DT, track);
    const kerbGrip = bike.dynamics.frontGrip!;
    expect(kerbGrip).toBeLessThan(bike.dynamics.rearGrip! * 0.97);
    expect(bike.dynamics.grip).toBe(kerbGrip);
    expect(bike.tires[0].surface).toBe(SURFACE.KERB);
    expect(bike.tires[2].surface).toBe(SURFACE.ASPHALT);

    bike.place(track, 120, 0);
    bike.step(DT, track);
    expect(bike.contacts[0].surface).toBe(SURFACE.ASPHALT);
    expect(bike.contacts[2].surface).toBe(SURFACE.ASPHALT);
    expect(bike.dynamics.frontGrip).toBeGreaterThan(kerbGrip * 1.03);
    expect(bike.dynamics.grip).toBe(Math.min(bike.dynamics.frontGrip!, bike.dynamics.rearGrip!));
  });

  it('lets rear tyre wear reduce rear drive without assigning that wear to the front tyre', () => {
    const run = (wornEnd: 'front' | 'rear') => {
      const track = new Track();
      const bike = new BikeVehicle(0, 'medium', DEFAULT_SETUP, 'sport', VEHICLES.gpr1);
      bike.place(track, 120);
      bike.dynamics.speed = 35;
      bike.gear = 3;
      bike.rpm = 12000;
      bike.autoShift = false;
      for (let i = 0; i < 4; i++) bike.tires[i].wear = i < 2 === (wornEnd === 'front') ? 0.98 : 0;
      bike.input.throttle = 1;
      bike.step(DT, track);
      return bike.dynamics;
    };
    const front = run('front');
    const rear = run('rear');
    expect(front.frontGrip).toBeLessThan(front.rearGrip!);
    expect(rear.rearGrip).toBeLessThan(rear.frontGrip!);
    expect(front.driveForce).toBeGreaterThan(rear.driveForce * 1.1);
    expect(front.leanLimit).toBeLessThan(0.8);
    expect(rear.leanLimit).toBeLessThan(0.8);
  });

  it.each(['sbk1000', 'ss600', 'nr900', 'cr750', 'mx450'])(
    'retains shared contact grip for %s',
    (id) => {
      const bike = contactStep(id, 0.35, 1, 'throttle');
      expect(bike.dynamics.frontGrip).toBeUndefined();
      expect(bike.dynamics.rearGrip).toBeUndefined();
      expect(bike.dynamics.grip).toBeLessThan(0.5);
    },
  );
});

describe('GP contact force and integration invariants', () => {
  const parameters = new BikeVehicle(0, 'medium', DEFAULT_SETUP, 'sport', VEHICLES.gpr1).dynamics.p;

  it('preserves the exact shared-grip trajectory when both contact coefficients are equal', () => {
    const shared = new Bike(NOVICE, parameters);
    const split = new Bike(NOVICE, parameters);
    shared.speed = split.speed = 35;
    for (let i = 0; i < 5 / DT; i++) {
      const t = i * DT;
      shared.grip = split.grip = 0.7 + 0.15 * Math.sin(t);
      split.frontGrip = split.rearGrip = split.grip;
      const input = {
        ...control,
        lean: 0.5 * Math.sin(t * 2),
        rider: 0.5 * Math.sin(t * 2),
        throttle: t < 2 ? 0.3 : 0,
        drive: t < 2 ? 1300 : 0,
        frontBrake: t > 2 ? 0.4 : 0,
        rearBrake: t > 2 ? 0.2 : 0,
        engineBrake: t > 2 ? 350 : 0,
      };
      shared.step(input, DT);
      split.step(input, DT);
      if (i % 30 === 0) {
        // Normalize only the environment-input fields. All integrated state,
        // forces, interventions and crash/recovery clocks must match exactly.
        expect({ ...split, frontGrip: undefined, rearGrip: undefined }).toEqual({
          ...shared,
          frontGrip: undefined,
          rearGrip: undefined,
        });
      }
    }
    expect(split.state).toBe('riding');
    expect(split.speed).toBe(shared.speed);
  });

  it.each([
    [1, 0.35],
    [0.35, 1],
    [0.65, 0.4],
    [0.4, 0.65],
  ])(
    'keeps trail braking and coast torque inside each circle at front %s / rear %s',
    (front, rear) => {
      for (const dt of [1 / 120, 1 / 240]) {
        for (const lean of [0, 0.6, 1]) {
          const bike = new Bike(NOVICE, parameters);
          bike.speed = 35;
          bike.grip = Math.min(front, rear);
          bike.frontGrip = front;
          bike.rearGrip = rear;
          const corner = { ...control, lean, rider: lean };
          for (let i = 0; i < 4 / dt; i++)
            bike.step({ ...corner, drive: parameters.drag * bike.speed ** 2 }, dt);
          const entrySpeed = bike.speed;
          expect(bike.state).toBe('riding');
          for (let i = 0; i < 1 / dt; i++) {
            bike.step({ ...corner, frontBrake: 1, rearBrake: 0.3, engineBrake: 800 }, dt);
            expect(bike.state).toBe('riding');
            expect(bike.frontUse).toBeLessThanOrEqual(1.001);
            expect(bike.rearUse).toBeLessThanOrEqual(1.001);
            expect(bike.engineBrakeForce).toBeLessThanOrEqual(bike.rearBrakeForce);
            expect(bike.rearSlip).toBe(0);
          }
          expect(bike.speed).toBeLessThan(entrySpeed - 1);
        }
      }
    },
  );

  it('does not hide a raw rider locking the rear wheel on its own low-grip patch', () => {
    const bike = new Bike({ ...EXPERT, lean: true }, parameters);
    bike.speed = 35;
    bike.grip = bike.rearGrip = 0.35;
    bike.frontGrip = 1;
    bike.step({ ...control, rearBrake: 1 }, DT);
    expect(bike.rearSlip).toBeGreaterThan(0);
    expect(bike.rearUse).toBeGreaterThan(1);
    expect(bike.rearBrakeForce).toBeGreaterThan(0);
    expect(bike.frontBrakeForce).toBe(0);
  });

  it.each([
    [1, 0.35],
    [0.35, 1],
  ])(
    'rolls on the throttle while picking up from a corner at front %s / rear %s',
    (front, rear) => {
      const bike = new Bike(NOVICE, parameters);
      bike.speed = 35;
      bike.grip = Math.min(front, rear);
      bike.frontGrip = front;
      bike.rearGrip = rear;
      for (let i = 0; i < 4 / DT; i++)
        bike.step(
          { ...control, lean: 0.6, rider: 0.6, drive: parameters.drag * bike.speed ** 2 },
          DT,
        );
      const entrySpeed = bike.speed;
      for (let i = 0; i < 2 / DT; i++) {
        const progress = (i * DT) / 2;
        const lean = 0.6 * (1 - progress);
        const throttle = 0.2 + 0.8 * progress;
        bike.step({ ...control, lean, rider: lean, throttle, drive: 4000 * throttle }, DT);
        expect(bike.state).toBe('riding');
        expect(bike.frontUse).toBeLessThanOrEqual(1.001);
        expect(bike.rearUse).toBeLessThanOrEqual(1.001);
        expect(bike.rearSlip).toBe(0);
      }
      expect(bike.speed).toBeGreaterThan(entrySpeed + 2);
    },
  );
});

describe('GP contact grip in production races', () => {
  it.each([
    { circuit: 'aurel' as const, weather: 'clear' as const, seed: 3303 },
    { circuit: 'poggio-alto' as const, weather: 'clear' as const, seed: 30101 },
    { circuit: 'poggio-alto' as const, weather: 'rain' as const, seed: 30101 },
  ])(
    'classifies all eight GP riders at $circuit in $weather without a contact or crash',
    async (race) => {
      const sim = new Simulation({
        ...DEFAULT_OPTIONS,
        ...race,
        mode: 'race',
        ruleset: 'gp-motorcycle',
        laps: 2,
        opponents: 7,
        vehicles: Array.from({ length: 8 }, (_, i) => (i % 2 ? 'gpr2' : 'gpr1')),
      });
      sim.autoPlayer = true;
      let impact = 0;
      // A 10.49 km two-lap wet race takes roughly 550 simulated seconds;
      // this limit covers the real course without weakening classification.
      for (let i = 0; i < 700 * 120 && sim.race.phase !== PHASE.FINISHED; i++) {
        sim.step(1 / 120);
        for (const bike of sim.cars) impact = Math.max(impact, bike.impact);
        if (i % (60 * 120) === 0) await new Promise<void>((resolve) => setImmediate(resolve));
      }
      expect(sim.race.phase).toBe(PHASE.FINISHED);
      expect(impact).toBe(0);
      for (const bike of sim.cars as BikeVehicle[]) {
        expect(bike.dynamics.crashes).toBe(0);
        expect(bike.finishTime).toBeGreaterThan(0);
        expect(bike.retired).toBe(false);
        expect(sim.race.laps[bike.id].completed).toBe(2);
        expect(sim.race.laps[bike.id].penalty).toBe(0);
      }
      expect(sim.makeFrame().every(Number.isFinite)).toBe(true);
    },
    120000,
  );
});
