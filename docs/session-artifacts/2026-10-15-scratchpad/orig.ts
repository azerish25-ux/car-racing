import { describe, expect, it } from 'vitest';
import {
  LapTracker,
  RaceDirector,
  PHASE,
  FINISH_GRACE_SECONDS,
  outsideTrack,
} from '../src/simulation/race.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { Track } from '../src/simulation/track.ts';
import { Vehicle } from '../src/simulation/vehicle.ts';
import { stoppingTarget } from '../src/simulation/ai.ts';
import { Simulation } from '../src/simulation/world.ts';
import { F, carBase } from '../src/simulation/protocol.ts';

describe('timing and four-wheel boundaries', () => {
  it('interpolates sector crossings and preserves all three completed sectors', () => {
    const lap = new LapTracker(1000, 990);
    for (let distance = 1; distance <= 1015; distance++)
      lap.update((990 + distance) % 1000, distance / 100, false);
    expect(lap.completed).toBe(1);
    expect(lap.last).toBeCloseTo(10, 10);
    for (const sector of lap.lastSectors) expect(sector).toBeCloseTo(10 / 3, 10);
    expect(lap.lastSectors.reduce((a, b) => a + b)).toBeCloseTo(lap.last, 10);
    expect(lap.lapTime).toBeCloseTo(0.05, 10);
    expect(lap.lastValid).toBe(true);
  });
  it('records invalid-lap sectors without turning that lap into a best lap', () => {
    const lap = new LapTracker(1000, 990);
    for (let distance = 1; distance <= 1015; distance++)
      lap.update((990 + distance) % 1000, distance / 100, distance === 500);
    expect(lap.completed).toBe(1);
    expect(lap.lastSectors[2]).toBeGreaterThan(0);
    expect(lap.best).toBe(0);
    expect(lap.lastValid).toBe(false);
    expect(lap.valid).toBe(true);
  });
  it('does not award teleport progress and rejects a reversed clock', () => {
    const lap = new LapTracker(1000, 100);
    const initial = lap.distance;
    lap.update(400, 1, false);
    expect(lap.distance).toBe(initial);
    expect(lap.valid).toBe(false);
    expect(() => lap.update(401, 0.5, false)).toThrow();
  });
  it('uses each tire footprint and local width, including the outer paint line', () => {
    const car = new Vehicle(0);
    for (const surface of car.contacts) {
      surface.width = 8;
      surface.lateral = 8.4;
    }
    expect(outsideTrack(car)).toBe(true);
    car.contacts[2].lateral = 8.18; // Rear tread still overlaps the line.
    expect(outsideTrack(car)).toBe(false);
    car.contacts[2].lateral = 8.2;
    expect(outsideTrack(car)).toBe(true);
    car.contacts[0].width = 9; // One local ribbon is wider; not a chassis-centre test.
    expect(outsideTrack(car)).toBe(false);
    car.contacts[0].width = 8;
    car.inPit = true;
    expect(outsideTrack(car)).toBe(false);
  });
  it('exports the completed third sector after crossing the line', () => {
    const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'practice', opponents: 0 });
    const lap = sim.race.laps[0];
    lap.lastSectors.splice(0, 3, 21, 22, 23);
    const frame = sim.makeFrame();
    expect(frame[carBase(0) + F.SECTOR_3]).toBe(23);
  });
});

function finishingField() {
  const track = new Track();
  const cars = [new Vehicle(0), new Vehicle(1)];
  for (const car of cars) car.place(track, track.length - 2);
  const race = new RaceDirector(cars, track, { ...DEFAULT_OPTIONS, laps: 2, mode: 'race' });
  race.phase = PHASE.RACING;
  race.time = race.greenAt + 100;
  for (const lap of race.laps) {
    lap.active = true;
    lap.completed = 1;
    lap.nextGate = 0;
    lap.lastTime = 100;
    lap.lapStart = 40;
    lap.sector = 2;
    lap.sectorStart = 80;
    lap.sectors.splice(0, 3, 20, 20, 0);
  }
  return { cars, race, track };
}

describe('whole-field classification', () => {
  it('keeps the simulation racing after the first finish, then applies time penalties', () => {
    const { cars, race } = finishingField();
    race.laps[1].penalty = 5;
    cars[1].s = 2;
    race.step(0.1);
    expect(cars[1].finishTime).toBeCloseTo(105.05, 7);
    expect(cars[0].finishTime).toBe(0);
    expect(race.phase).toBe(PHASE.RACING);
    expect(race.flag).toBe('CHEQUERED');
    cars[0].s = 2;
    race.step(0.1);
    expect(race.phase).toBe(PHASE.FINISHED);
    expect(race.order).toEqual([0, 1]);
    expect(race.laps.map((l) => l.completed)).toEqual([2, 2]);
    const final = cars[1].finishTime;
    race.step(1);
    expect(cars[1].finishTime).toBe(final);
  });
  it('classifies a lapped car on its next finish crossing rather than waiting for extra laps', () => {
    const { cars, race } = finishingField();
    race.laps[0].completed = 0;
    cars[1].s = 2;
    race.step(0.1);
    cars[0].s = 2;
    race.step(0.1);
    expect(race.phase).toBe(PHASE.FINISHED);
    expect(race.order).toEqual([1, 0]);
    expect(race.laps[0].completed).toBe(1);
    expect(cars[0].finishTime).toBeGreaterThan(0);
  });
  it('resolves same-tick first crossings by time, not vehicle-array order', () => {
    const { cars, race, track } = finishingField();
    race.laps[0].lastS = track.length - 3;
    race.laps[1].lastS = track.length - 1;
    cars[0].s = 1;
    cars[1].s = 3;
    race.step(0.1);
    expect(race.finishStartedAt).toBeCloseTo(100.025, 7);
    expect(race.order).toEqual([1, 0]);
  });
  it('marks a timed-out competitor DNF without manufacturing a finishing time', () => {
    const { cars, race } = finishingField();
    cars[1].s = 2;
    race.step(0.1);
    for (let i = 0; i < FINISH_GRACE_SECONDS; i++) race.step(1);
    expect(race.phase).toBe(PHASE.FINISHED);
    expect(cars[0].retired).toBe(true);
    expect(cars[0].finishTime).toBe(0);
  });
  it('ends an all-retired race without inventing a winner', () => {
    const { cars, race } = finishingField();
    cars.forEach((car) => (car.retired = true));
    race.step(0.1);
    expect(race.phase).toBe(PHASE.FINISHED);
    expect(cars.every((car) => car.finishTime === 0)).toBe(true);
  });
});
it('reserves pedal-response distance in the pit stopping target', () => {
  for (const distance of [0, 0.1, 1, 5, 30, 100]) {
    const v = stoppingTarget(distance, 3, 0.8);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v * 0.8 + (v * v) / 6).toBeCloseTo(distance, 9);
  }
});
it('a missed pit box becomes a physical drive-through, never a reverse into the queue', () => {
  const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'practice', opponents: 0 });
  const car = sim.cars[0];
  car.place(sim.track, 110, 24.1);
  car.inPit = true;
  car.pitPhase = 1;
  car.pitRequested = true;
  sim.race.time += 1;
  sim.ai[0].update(1 / 120, sim.track, sim.cars, sim.race);
  expect(car.pitPhase).toBe(6);
  expect(car.pitRequested).toBe(true);
  expect(car.pitStops).toBe(0);
  expect(car.input.reverse).toBe(false);
});
it('raised pit jack feet retain a finite support polygon on the sloped lane', () => {
  const track = new Track();
  const car = new Vehicle(0);
  car.place(track, 123, 24.1);
  car.inPit = true;
  car.input.brake = 1;
  for (let tick = 0; tick < 240 * 3; tick++) car.step(1 / 240, track);
  car.pitPhase = 3;
  const start = { ...car.body.position };
  for (let tick = 0; tick < 240 * 5; tick++) car.step(1 / 240, track);
  expect(Math.hypot(car.body.position.x - start.x, car.body.position.z - start.z)).toBeLessThan(
    0.1,
  );
  expect(car.body.position.y - start.y).toBeGreaterThan(0.06);
  expect(car.body.omega.length()).toBeLessThan(0.01);
  expect(car.body.position.finite()).toBe(true);
}, 10000);
