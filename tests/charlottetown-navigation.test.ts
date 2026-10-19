import { describe, expect, it } from 'vitest';
import { CampusNavigator } from '../src/simulation/open-world/charlottetown/navigation.ts';
import {
  CHARLOTTETOWN_ROUTE as route,
  CHARLOTTETOWN_STATIONS as stations,
} from '../src/simulation/open-world/charlottetown/region.ts';
const navigator = new CampusNavigator(route, stations);
const heading = (i: number, reverse = false) =>
  Math.atan2(route[i + 1][0] - route[i][0], route[i + 1][1] - route[i][1]) +
  (reverse ? Math.PI : 0);

describe('Street-following campus directions', () => {
  it.each([
    [0, 'Maloney Drive', 'Queen Street', 'right'],
    [12, 'Queen Street', 'Kent Street', 'left'],
    [43, 'Kent Street', 'Weymouth Street', 'right'],
    [60, 'Weymouth Street', 'Holland College', 'arrive'],
  ] as const)(
    'does not mirror the instruction at route vertex %s',
    (i, street, nextStreet, turn) => {
      const cue = navigator.sample(...route[i], heading(i), 30);
      expect(cue).toMatchObject({
        valid: true,
        street,
        nextStreet,
        turn,
        offRoute: false,
        wrongWay: false,
      });
      expect(cue.distanceToTurn).toBeGreaterThan(0);
    },
  );
  it.each([
    [60, 'Weymouth Street', 'Kent Street', 'left'],
    [52, 'Kent Street', 'Queen Street', 'right'],
    [20, 'Queen Street', 'Maloney Drive', 'left'],
    [3, 'Maloney Drive', 'Maloney Drive', 'arrive'],
  ] as const)(
    'reverses street order AND turn direction at vertex %s',
    (i, street, nextStreet, turn) => {
      expect(navigator.sample(...route[i], heading(i, true), 30, 'return')).toMatchObject({
        street,
        nextStreet,
        turn,
        wrongWay: false,
      });
    },
  );
  it('counts all 100 stations monotonically without inventing photograph availability', () => {
    let progress = -1;
    for (const station of stations) {
      const cue = navigator.sample(station.x, station.z, 0, 0);
      expect(cue.reference).toBe(station.id);
      expect(cue.progress).toBeGreaterThan(progress);
      expect(cue.routeDistance).toBeLessThan(0.01);
      const reverse = navigator.sample(station.x, station.z, 0, 0, 'return');
      expect(cue.progress + reverse.progress).toBeCloseTo(1, 8);
      progress = cue.progress;
    }
    expect(navigator.length).toBeGreaterThan(1704);
    expect(navigator.length).toBeLessThan(1708);
  });
  it('detects wrong-way travel but does not nag at rest, off-route, or at the destination', () => {
    const i = 25;
    expect(navigator.sample(...route[i], heading(i) + Math.PI, 30).wrongWay).toBe(true);
    expect(navigator.sample(...route[i], heading(i) + Math.PI, 0).wrongWay).toBe(false);
    const off = navigator.sample(route[i][0] + 100, route[i][1], heading(i) + Math.PI, 30);
    expect(off.offRoute).toBe(true);
    expect(off.wrongWay).toBe(false);
    expect(navigator.sample(...route.at(-1)!, 0, 30)).toMatchObject({
      arrived: true,
      wrongWay: false,
    });
  });
  it('recognizes either destination and refuses distant arrival by projection alone', () => {
    expect(navigator.sample(...route[0], heading(0), 0)).toMatchObject({
      arrived: false,
      reference: 1,
    });
    expect(navigator.sample(...route[0], 0, 0, 'return')).toMatchObject({
      arrived: true,
      reference: 1,
      destination: 'Maloney Drive',
    });
    expect(navigator.sample(...route.at(-1)!, 0, 0)).toMatchObject({
      arrived: true,
      reference: 100,
      remaining: 0,
    });
    const end = route.at(-1)!;
    expect(navigator.sample(end[0] - 100, end[1] - 100, 0, 0).arrived).toBe(false);
  });
  it('rejects changed route indexing and contains invalid physics samples', () => {
    expect(() => new CampusNavigator(route.slice(1), stations)).toThrow(
      'versioned 62-vertex route',
    );
    for (const v of [NaN, Infinity, -Infinity]) {
      const cue = navigator.sample(v, 0, 0, 0);
      expect(cue.valid).toBe(false);
      expect(cue.progress).toBe(0);
      expect(Number.isFinite(cue.remaining)).toBe(true);
    }
  });
  it('does not mutate geography when jumping between travel points', () => {
    const before = JSON.stringify(route);
    for (const i of [1, 60, 20, 0, 52]) navigator.sample(...route[i], heading(i), 10);
    expect(JSON.stringify(route)).toBe(before);
  });
});
