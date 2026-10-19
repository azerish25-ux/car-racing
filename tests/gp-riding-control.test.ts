import { describe, expect, it } from 'vitest';
import { mod } from '../src/core/math.ts';
import { Bike, BIKE, NOVICE } from '../src/simulation/bike.ts';
import { BikeVehicle } from '../src/simulation/bike-vehicle.ts';
import { BikeAIDriver, gpPassingLateralScale } from '../src/simulation/bike-ai.ts';
import {
  GP_ENGINE_BRAKE_RELEASE_THROTTLE,
  gpEngineBrakingGain,
} from '../src/simulation/gp-engine-braking.ts';
import { DEFAULT_OPTIONS, DEFAULT_SETUP } from '../src/simulation/config.ts';
import { TrafficPlanner, personality } from '../src/simulation/traffic.ts';
import { Track } from '../src/simulation/track.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { Simulation } from '../src/simulation/world.ts';

const DT = 1 / 240;

describe('GP coast-to-power control', () => {
  const riding = (throttle: number, id = 'gpr1', map = 3) => {
    const track = new Track();
    const bike = new BikeVehicle(
      0,
      'medium',
      { ...DEFAULT_SETUP, engineBrakeMap: map },
      'sport',
      VEHICLES[id],
    );
    bike.place(track, 120);
    bike.dynamics.speed = 40;
    bike.gear = 3;
    bike.autoShift = false;
    bike.rpm = Math.min(12000, bike.spec.shiftRPM);
    bike.input.throttle = throttle;
    bike.step(DT, track);
    return bike;
  };

  it('removes the rear-force jump across the old 2% throttle boundary in both GP machines', () => {
    for (const id of ['gpr1', 'gpr2']) {
      const below = riding(0.0199, id).dynamics;
      const above = riding(0.0201, id).dynamics;
      expect(below.engineBrakeForce).toBeGreaterThan(300);
      expect(above.engineBrakeForce).toBeGreaterThan(300);
      // A tiny trigger correction must no longer drop hundreds of newtons
      // of rear coast torque and abruptly move the load back onto the rear.
      expect(Math.abs(above.longitudinal - below.longitudinal)).toBeLessThan(0.02);
      expect(Math.abs(above.frontLoad - below.frontLoad)).toBeLessThan(1);
    }
  });

  it('rolls smoothly into positive drive, with no residual braking past the blend', () => {
    const speeds = [0, 0.02, 0.04, 0.06, 0.08, 0.1, 0.12, 0.2].map(
      (throttle) => riding(throttle).dynamics.speed,
    );
    for (let i = 1; i < speeds.length; i++) expect(speeds[i]).toBeGreaterThan(speeds[i - 1]);
    const open = riding(GP_ENGINE_BRAKE_RELEASE_THROTTLE).dynamics;
    expect(open.engineBrakeForce).toBe(0);
    expect(open.driveForce).toBeGreaterThan(300);
    expect(riding(0, 'gpr1', 0).dynamics.engineBrakeForce).toBe(0);
  });

  it.each([1, 0.4])(
    'shares the rear grip budget while rolling on through a braked corner at grip %s',
    (grip) => {
      const bike = new Bike(NOVICE, {
        ...BIKE,
        engineBrakeReleaseThrottle: GP_ENGINE_BRAKE_RELEASE_THROTTLE,
      });
      bike.speed = 35;
      bike.grip = grip;
      for (let i = 0; i < 4 / DT; i++)
        bike.step(
          {
            lean: 0.6,
            rider: 0.6,
            throttle: 0.2,
            frontBrake: 0,
            rearBrake: 0,
            drive: BIKE.drag * bike.speed * bike.speed,
          },
          DT,
        );
      for (let i = 0; i < 1 / DT; i++) {
        const throttle = i * DT * GP_ENGINE_BRAKE_RELEASE_THROTTLE;
        bike.step(
          {
            lean: 0.6,
            rider: 0.6,
            throttle,
            frontBrake: 0.25,
            rearBrake: 0.15,
            drive: 2000 * throttle,
            engineBrake: 800 * gpEngineBrakingGain(throttle),
          },
          DT,
        );
        expect(bike.state).toBe('riding');
        expect(bike.frontUse).toBeLessThanOrEqual(1.01);
        expect(bike.rearUse).toBeLessThanOrEqual(1.01);
        expect(bike.engineBrakeForce).toBeLessThanOrEqual(bike.rearBrakeForce);
      }
    },
  );

  it('keeps other motorcycles on their existing closed-throttle map', () => {
    for (const id of ['sbk1000', 'ss600', 'nr900']) {
      expect(riding(0.02, id).dynamics.engineBrakeForce).toBeGreaterThan(0);
      expect(riding(0.0201, id).dynamics.engineBrakeForce).toBe(0);
      expect(riding(0, id).dynamics.p.engineBrakeReleaseThrottle).toBeUndefined();
    }
  });

  it('bounds invalid controls and is stateless when seeking back to an earlier throttle sample', () => {
    expect(gpEngineBrakingGain(0)).toBe(1);
    expect(gpEngineBrakingGain(0.12)).toBe(0);
    const midpoint = gpEngineBrakingGain(0.06);
    for (const throttle of [-1, 2, NaN, Infinity, -Infinity]) {
      const gain = gpEngineBrakingGain(throttle);
      expect(Number.isFinite(gain)).toBe(true);
      expect(gain).toBeGreaterThanOrEqual(0);
      expect(gain).toBeLessThanOrEqual(1);
    }
    expect(gpEngineBrakingGain(0.06)).toBe(midpoint);
  });
});

describe('GP passing corridors', () => {
  const traffic = (id = 'gpr1') => {
    const track = new Track();
    const rider = new BikeVehicle(0, 'medium', DEFAULT_SETUP, 'sport', VEHICLES[id]);
    const other = new BikeVehicle(1, 'medium', DEFAULT_SETUP, 'sport', VEHICLES.gpr2);
    rider.place(track, 120, 0);
    other.place(track, 124, 2.4);
    for (const bike of [rider, other]) {
      bike.speed = bike.dynamics.speed = 45;
      bike.body.velocity.set(bike.trackPosition.tx * 45, 0, bike.trackPosition.tz * 45);
    }
    return { track, rider, other, cars: [rider, other] };
  };

  it('allows parallel upright motorcycles to race instead of braking for a car-sized corridor', () => {
    const { track, rider, cars } = traffic();
    const scale = gpPassingLateralScale(rider, track, cars);
    const plan = (lateralScale: number) =>
      new TrafficPlanner().evaluate(
        rider,
        cars,
        track,
        10,
        8,
        personality(4417, 0),
        false,
        0,
        false,
        () => 0,
        lateralScale,
      );
    const gp = plan(scale);
    const car = plan(1);
    expect(gp.offset).toBeCloseTo(0, 6);
    expect(gp.speedLimit).toBeGreaterThan(rider.speed);
    expect(car.speedLimit).toBeLessThan(rider.speed);
    // The corridor still exceeds the two physical upright bike half-widths
    // by more than a metre; the planner never reduces its stopping horizon.
    expect(
      2.75 * scale - cars[0].definition.halfExtents[0] - cars[1].definition.halfExtents[0],
    ).toBeGreaterThan(1);
  });

  it('reserves full lateral room for a leaning rider alongside and an approaching corner', () => {
    const { track, rider, other, cars } = traffic();
    other.dynamics.lean = -0.8;
    expect(gpPassingLateralScale(rider, track, cars)).toBe(1);
    other.dynamics.lean = 0;
    rider.place(track, 500);
    rider.dynamics.speed = 45;
    expect(gpPassingLateralScale(rider, track, [rider])).toBeGreaterThan(0.95);
  });

  it('does not relax the follow limit for a bike directly ahead, or bypass a yellow flag', () => {
    const { track, rider, other, cars } = traffic();
    other.place(track, 128, 0);
    other.speed = other.dynamics.speed = 30;
    other.body.velocity.set(other.trackPosition.tx * 30, 0, other.trackPosition.tz * 30);
    const scale = gpPassingLateralScale(rider, track, cars);
    const plan = new TrafficPlanner().evaluate(
      rider,
      cars,
      track,
      10,
      8,
      personality(4417, 0),
      true,
      0,
      false,
      () => 0,
      scale,
    );
    expect(plan.speedLimit).toBeLessThan(other.speed);
  });

  it('retains the original road and off-road class behavior outside the GP prototypes', () => {
    for (const id of ['sbk1000', 'ss600', 'cr750', 'mx450']) {
      const { track, rider, cars } = traffic(id);
      expect(gpPassingLateralScale(rider, track, cars)).toBe(1);
    }
  });

  it('retains symmetric avoidance rules in mixed GP/superbike grids', () => {
    const { track, rider, cars } = traffic();
    const superbike = new BikeVehicle(2, 'medium', DEFAULT_SETUP, 'sport', VEHICLES.sbk1000);
    superbike.place(track, 145, -2.4);
    expect(gpPassingLateralScale(rider, track, [...cars, superbike])).toBe(1);
  });

  it('completes a real catch-and-pass without contact and reproduces the same snapshot', () => {
    const chase = () => {
      const sim = new Simulation({
        ...DEFAULT_OPTIONS,
        mode: 'practice',
        ruleset: 'gp-motorcycle',
        circuit: 'poggio-alto',
        opponents: 1,
        vehicles: ['gpr1', 'gpr2'],
        seed: 4417,
      });
      sim.autoPlayer = true;
      sim.race.time = sim.race.greenAt + 1;
      const bikes = sim.cars as BikeVehicle[];
      for (const bike of bikes) {
        bike.place(sim.track, sim.track.length - 400 + bike.id * 26, 0);
        bike.dynamics.speed = bike.speed = 55;
        bike.gear = 4;
        bike.rpm = 12000;
      }
      sim.ai[0] = new BikeAIDriver(bikes[0], 1, 4417);
      sim.ai[1] = new BikeAIDriver(bikes[1], 0.85, 4417);
      // A rider cruising on the straight is an actual slower target. Both
      // bikes retain production steering, physics, flags and collision code.
      const leadUpdate = sim.ai[1].update.bind(sim.ai[1]);
      sim.ai[1].update = (dt, track, cars, race) => {
        leadUpdate(dt, track, cars, race);
        bikes[1].input.throttle = Math.min(bikes[1].input.throttle, 0.25);
      };
      let passAt: number | null = null,
        minimumGap = Infinity,
        impact = 0;
      for (let i = 0; i < 18 * 120; i++) {
        sim.step(1 / 120);
        const [rider, other] = bikes;
        minimumGap = Math.min(
          minimumGap,
          Math.sqrt(rider.body.position.distanceSq(other.body.position)),
        );
        impact = Math.max(impact, rider.impact, other.impact);
        const gap =
          mod(other.s - rider.s + sim.track.length / 2, sim.track.length) - sim.track.length / 2;
        if (gap < -6.5 && passAt === null) passAt = i / 120;
      }
      return {
        passAt,
        minimumGap,
        impact,
        crashes: bikes.map((bike) => bike.dynamics.crashes),
        frame: sim.makeFrame(),
      };
    };
    const first = chase();
    expect(first.passAt).not.toBeNull();
    expect(first.passAt!).toBeLessThan(18);
    expect(first.minimumGap).toBeGreaterThan(2);
    expect(first.impact).toBe(0);
    expect(first.crashes).toEqual([0, 0]);
    const repeated = chase();
    expect(repeated.frame).toEqual(first.frame);
    expect(repeated.passAt).toBe(first.passAt);
  }, 30000);
});
