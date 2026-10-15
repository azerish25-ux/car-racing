import { describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { BikeVehicle } from '../src/simulation/bike-vehicle.ts';
import { DEFAULT_OPTIONS, DEFAULT_SETUP } from '../src/simulation/config.ts';
import {
  BIKE_PIT_SERVICE,
  CAR_PIT_SERVICE,
  bikeStandLift,
  carServiceClock,
  pitServicePlan,
  servicePhaseAt,
} from '../src/simulation/pit-service.ts';
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
import { updatePit } from '../src/simulation/race.ts';
import { Track } from '../src/simulation/track.ts';
import { Vehicle } from '../src/simulation/vehicle.ts';
import { vehicleDefinition, vehicleIndex } from '../src/simulation/vehicles.ts';
import { Simulation } from '../src/simulation/world.ts';
import {
  BIKE_FRONT_WHEEL,
  BIKE_REAR_WHEEL,
  BikeServicePose,
  BikeServiceRig,
  BikeWheelTask,
  bikeServiceGeometry,
} from '../src/rendering/bike-pit-service.ts';
import { BikeShells } from '../src/rendering/bike.ts';
import { pitPhaseLabel } from '../src/ui/f1-hud.ts';
import { PIT_CREW_PER_BIKE, PIT_CREW_PER_CAR, PitCrewView } from '../src/rendering/pit-crew.ts';

const GPR1 = vehicleDefinition('gpr1');

/** Serve a stopped entrant in its box at a fixed step; returns phase changes. */
function serve(car: Vehicle, track: Track) {
  car.inPit = true;
  car.pitPhase = 1;
  car.s = track.boxS(car.id);
  car.lateral = track.boxLateral();
  car.speed = 0;
  const changes: [number, number][] = [];
  let last = car.pitPhase;
  for (let i = 0; i < 1200 && car.pitPhase !== 6; i++) {
    updatePit(car, track, 0.01);
    if (car.pitPhase !== last) changes.push([car.pitPhase, Math.round(car.pitClock * 100) / 100]);
    last = car.pitPhase;
  }
  return changes;
}

describe('motorcycle pit service: simulation timing', () => {
  it('times a bike stop on the stand plan and a car stop on the unchanged jack plan', () => {
    expect(pitServicePlan(GPR1)).toBe(BIKE_PIT_SERVICE);
    expect(pitServicePlan(vehicleDefinition('apx01'))).toBe(CAR_PIT_SERVICE);
    expect(CAR_PIT_SERVICE.ends).toEqual([0.8, 2.2, 3.5, 5.2]);
    expect(BIKE_PIT_SERVICE.crew).toBeLessThan(CAR_PIT_SERVICE.crew);
    // The HUD names the bike's own service steps; the car's text is unchanged.
    expect(pitPhaseLabel(2)).toBe('STOPPED · CAR JACKED');
    expect(pitPhaseLabel(2, pitServicePlan(GPR1))).toBe('STOPPED · ON STANDS');
    expect(pitPhaseLabel(3, pitServicePlan(GPR1))).toBe('WHEELS OUT');
    const track = new Track();
    const car = new Vehicle(0);
    car.nextCompound = 'wet';
    const carChanges = serve(car, track);
    expect(carChanges.map(([phase]) => phase)).toEqual([2, 3, 4, 5, 6]);
    // Within one 10 ms step of each boundary (the clock accumulates steps).
    [0, 0.8, 2.2, 3.5, 5.2].forEach((end, i) =>
      expect(Math.abs(carChanges[i][1] - end)).toBeLessThanOrEqual(0.0101),
    );
    expect(car.tires.every((t) => t.compound === 'wet')).toBe(true);

    const bike = new BikeVehicle(0, 'medium', DEFAULT_SETUP, 'sport', GPR1);
    bike.nextCompound = 'wet';
    const bikeChanges = serve(bike, track);
    expect(bikeChanges.map(([phase]) => phase)).toEqual([2, 3, 4, 5, 6]);
    [0, ...BIKE_PIT_SERVICE.ends].forEach((end, i) =>
      expect(Math.abs(bikeChanges[i][1] - end)).toBeLessThanOrEqual(0.0101),
    );
    expect(bikeChanges[4][1] - carChanges[4][1]).toBeGreaterThan(2.5);
    // Both tyres change, so the compound the HUD shows is on both contacts.
    expect(bike.tires.every((t) => t.compound === 'wet')).toBe(true);
    expect(bike.pitStops).toBe(1);
  });
  it('lifts the bike on its stands only inside the service and maps onto the car clock', () => {
    expect(bikeStandLift(1, 0)).toBe(0);
    expect(bikeStandLift(2, 0.2)).toBe(0);
    expect(bikeStandLift(3, 2)).toBeCloseTo(BIKE_PIT_SERVICE.liftHeight, 9);
    expect(bikeStandLift(4, 5)).toBeCloseTo(BIKE_PIT_SERVICE.liftHeight, 9);
    expect(bikeStandLift(5, 7.6)).toBe(0);
    expect(bikeStandLift(6, 9)).toBe(0);
    // Phase boundaries of the bike plan land on the car plan's.
    BIKE_PIT_SERVICE.ends.forEach((end, i) =>
      expect(carServiceClock(BIKE_PIT_SERVICE, end)).toBeCloseTo(CAR_PIT_SERVICE.ends[i], 9),
    );
    for (let clock = 0; clock < 9; clock += 0.05) {
      const phase = servicePhaseAt(BIKE_PIT_SERVICE, clock);
      expect(Math.min(phase, 6)).toBe(
        Math.min(servicePhaseAt(CAR_PIT_SERVICE, carServiceClock(BIKE_PIT_SERVICE, clock)), 6),
      );
    }
    expect(carServiceClock(CAR_PIT_SERVICE, 3.3)).toBe(3.3);
    expect(() => carServiceClock(BIKE_PIT_SERVICE, NaN)).toThrow();
  });
});

function bikeFrame(phase: number, clock: number, lift: number, vehicle = 'gpr1') {
  const frame = new Float32Array(HEADER + CAR_STRIDE);
  frame[H.CARS] = 1;
  frame[H.TIME] = 10;
  const o = carBase(0);
  frame[o + RACE_BASE + R.VEHICLE] = vehicleIndex(vehicle);
  frame[o + F.QW] = 1;
  frame[o + F.Y] = 0.62;
  frame[o + F.IN_PIT] = 1;
  frame[o + F.PIT_PHASE] = phase;
  frame[o + F.PIT_CLOCK] = clock;
  frame[o + F.JACK_HEIGHT] = lift;
  for (let wheel = 0; wheel < 4; wheel++)
    frame[o + WHEEL_BASE + wheel * WHEEL_STRIDE + W.LENGTH] = 0.3;
  return frame;
}

describe('motorcycle pit service: crew presentation', () => {
  it('draws nine bike actors (stands, two wheel trios, release) instead of fifteen', () => {
    const crew = new PitCrewView();
    try {
      for (const [phase, clock] of [
        [2, 0.6],
        [3, 2.4],
        [4, 4.4],
        [4, 6.2],
        [5, 7.5],
      ] as const) {
        crew.update(bikeFrame(phase, clock, bikeStandLift(phase, clock)), new T.Vector3(3, 1.5, 0));
        expect(crew.activeCrews).toBe(1);
        expect(crew.activeActors).toBe(PIT_CREW_PER_BIKE);
        const summary = crew.summary();
        expect(summary.unreachableArms).toBe(0);
        expect(summary.maxWristError).toBeLessThan(1e-5);
        expect(summary.unsupportedActors).toBe(0);
        const roles = crew.diagnostics().roles;
        const count = (role: string) => roles.filter((r) => r.role === role).length;
        expect([count('gun'), count('remove'), count('install')]).toEqual([2, 2, 2]);
        expect([count('front-jack'), count('rear-jack'), count('release')]).toEqual([1, 1, 1]);
        // Wheel crews work the two motorcycle wheel slots only.
        expect(new Set(roles.filter((r) => r.wheel >= 0).map((r) => r.wheel))).toEqual(
          new Set([BIKE_FRONT_WHEEL, BIKE_REAR_WHEEL]),
        );
        // Everyone stands on the floor beside a 2 m machine, not around a car.
        for (const r of roles) {
          expect(r.floorY).toBeCloseTo(-GPR1.bike!.cgHeight, 6);
          expect(Math.abs(r.root[12])).toBeLessThan(1.9);
          expect(Math.abs(r.root[14])).toBeLessThan(2.9);
        }
        for (const object of crew.root.children) {
          const batch = object as T.InstancedMesh;
          if (batch.instanceMatrix)
            expect([...batch.instanceMatrix.array].every(Number.isFinite)).toBe(true);
        }
      }
      // Released: no crew.
      crew.update(bikeFrame(6, 8.2, 0), new T.Vector3(3, 1.5, 0));
      expect(crew.activeActors).toBe(0);
    } finally {
      crew.dispose();
    }
  });
  it('serves a mixed field: a car keeps its fifteen-person crew beside a bike', () => {
    const frame = bikeFrame(3, 2.4, bikeStandLift(3, 2.4));
    const two = new Float32Array(HEADER + 2 * CAR_STRIDE);
    two.set(frame);
    two[H.CARS] = 2;
    const o = carBase(1);
    two[o + RACE_BASE + R.VEHICLE] = vehicleIndex('apx01');
    two[o + F.QW] = 1;
    two[o + F.X] = 8;
    two[o + F.Y] = 0.75;
    two[o + F.IN_PIT] = 1;
    two[o + F.PIT_PHASE] = 3;
    two[o + F.PIT_CLOCK] = 1.9;
    two[o + F.JACK_HEIGHT] = 0.19;
    for (let wheel = 0; wheel < 4; wheel++)
      two[o + WHEEL_BASE + wheel * WHEEL_STRIDE + W.LENGTH] = 0.3;
    const crew = new PitCrewView();
    try {
      crew.update(two, new T.Vector3(4, 1.5, 0));
      expect(crew.activeCrews).toBe(2);
      expect(crew.actorCountFor(0)).toBe(PIT_CREW_PER_BIKE);
      expect(crew.actorCountFor(1)).toBe(PIT_CREW_PER_CAR);
    } finally {
      crew.dispose();
    }
  });
  it('carries each wheel where the carrier route holds it, and rolls the rear out backwards', () => {
    const geometry = bikeServiceGeometry(GPR1),
      pose = new BikeServicePose(),
      task = new BikeWheelTask(),
      rig = new BikeServiceRig(geometry);
    try {
      // Mid-removal: the mounted rear wheel is out of the swingarm, the front
      // has dropped out of the fork, the stands hold the lift.
      pose.set(geometry, 3, 3.7, bikeStandLift(3, 3.7));
      expect(pose.out).toBeGreaterThan(0.99);
      expect(pose.mounted[1].z).toBeCloseTo(pose.hubs[1].z - 0.3, 6);
      expect(pose.mounted[0].y).toBeLessThan(pose.hubs[0].y - 0.07);
      expect(pose.hubs[1].y).toBeCloseTo(geometry.rearRadius - geometry.height + pose.lift, 9);
      // The stand handle is pushed down at full lift, raised at none.
      const lowered = pose.rearStand.grip.y;
      pose.set(geometry, 2, 0.1, 0);
      expect(pose.rearStand.grip.y).toBeGreaterThan(lowered + 0.2);
      rig.update(pose, task, new T.Vector3(), new T.Quaternion());
      expect(rig.root.visible).toBe(true);
      expect(rig.parts).toEqual({ tubes: 12, rollers: 4, spares: 2 });
      for (const clock of [0.5, 2.2, 3.7, 4.2, 6, 7.4]) {
        const phase = servicePhaseAt(BIKE_PIT_SERVICE, clock);
        pose.set(geometry, phase, clock, bikeStandLift(phase, clock));
        rig.update(pose, task, new T.Vector3(), new T.Quaternion());
        for (const wheel of [BIKE_FRONT_WHEEL, BIKE_REAR_WHEEL]) {
          const carrier = new BikeWheelTask()
            .bind(pose)
            .set(phase < 4 ? 'install' : 'remove', wheel, phase, pose.carClock, 0, 0, pose.floor);
          expect(rig.spareCentre(wheel).distanceTo(carrier.center)).toBeLessThan(1e-9);
        }
      }
      rig.update(null, task, new T.Vector3(), new T.Quaternion());
      expect(rig.root.visible).toBe(false);
    } finally {
      rig.dispose();
    }
  });
  it('lifts the presented bike by the recorded stand height and shows its stands only in service', () => {
    // Canvas textures (paint, carbon, plates) are stubbed: poses are measured.
    const ctx = new Proxy(
      {},
      {
        get: (_, key) =>
          key === 'createLinearGradient' || key === 'createRadialGradient'
            ? () => ({ addColorStop: () => undefined })
            : key === 'measureText'
              ? () => ({ width: 10 })
              : () => undefined,
        set: () => true,
      },
    );
    vi.stubGlobal('document', {
      createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
    });
    const shells = new BikeShells();
    const car = { root: new T.Object3D() };
    car.root.position.set(0, 0.62, 0);
    const camera = new T.PerspectiveCamera(58, 16 / 9, 0.1, 1000);
    camera.position.set(4, 1.5, 0);
    const lift = bikeStandLift(3, 2.4);
    const service = bikeFrame(3, 2.4, lift);
    shells.update(service, service, 1, [car], camera, 'high', 0);
    const rig = shells.serviceRig(0)!;
    expect(rig.root.visible).toBe(true);
    const model = shells.root.children.find((c) => c.visible && c !== rig.root)!;
    expect(model.position.y).toBeCloseTo(0.62 + lift, 6);
    const racing = bikeFrame(0, 0, 0);
    racing[carBase(0) + F.IN_PIT] = 0;
    shells.update(racing, racing, 1, [car], camera, 'high', 0);
    expect(rig.root.visible).toBe(false);
    expect(shells.root.children.find((c) => c.visible && c !== rig.root)!.position.y).toBeCloseTo(
      0.62,
      6,
    );
    vi.unstubAllGlobals();
  });
});

describe('motorcycle pit service: production session', () => {
  it('serves a real bike stop through the bike crew to release', () => {
    const simulation = new Simulation({
      ...DEFAULT_OPTIONS,
      mode: 'practice',
      opponents: 0,
      vehicles: ['gpr1'],
    });
    simulation.autoPlayer = true;
    simulation.cars[0].pitRequested = true;
    simulation.cars[0].nextCompound = 'soft';
    const crew = new PitCrewView(),
      seen = new Map<number, number>();
    try {
      for (let tick = 0; tick < 240 * 120; tick++) {
        simulation.step(1 / 120);
        const bike = simulation.cars[0];
        if (bike.pitPhase < 2) continue;
        if (!seen.has(bike.pitPhase)) seen.set(bike.pitPhase, bike.pitClock);
        if (tick % 15 !== 0 && bike.pitPhase !== 6) continue;
        const frame = simulation.makeFrame();
        crew.update(
          frame,
          new T.Vector3(
            frame[carBase(0) + F.X] + 4,
            frame[carBase(0) + F.Y] + 2,
            frame[carBase(0) + F.Z],
          ),
        );
        if (bike.pitPhase === 6) {
          expect(crew.activeActors).toBe(0);
          break;
        }
        if (Math.abs(frame[carBase(0) + F.SPEED]) <= 0.5) {
          expect(crew.activeActors).toBe(PIT_CREW_PER_BIKE);
          expect(crew.summary().unreachableArms).toBe(0);
          // Recorded by the bike's own step, one service tick behind the clock.
          expect(
            Math.abs(
              frame[carBase(0) + F.JACK_HEIGHT] - bikeStandLift(bike.pitPhase, bike.pitClock),
            ),
          ).toBeLessThan(0.002);
        }
      }
      expect([...seen.keys()]).toEqual([2, 3, 4, 5, 6]);
      expect(seen.get(6)).toBeGreaterThanOrEqual(8);
      expect(simulation.cars[0].pitStops).toBe(1);
      expect(simulation.cars[0].tires.every((t) => t.compound === 'soft')).toBe(true);
    } finally {
      crew.dispose();
    }
  }, 120000);
});
