import { describe, expect, it } from 'vitest';
import { scoreEvents } from '../src/core/scoring.ts';
import { classifyStage, competitor, observeStage } from '../src/core/stage-rules.ts';
import {
  RouteGraph,
  RouteProgress,
  type RoutePoint,
  type RouteSpec,
} from '../src/simulation/route-graph.ts';

describe('WP48 explainable, farm-resistant scoring', () => {
  const action = (time: number, kind = 'drift', quality = 1, duration = 2, valid = true) => ({
    time,
    kind,
    quality,
    duration,
    valid,
  });
  it('explains every point and decays repetition of one safe action', () => {
    const farmed = scoreEvents(Array.from({ length: 10 }, (_, i) => action(i * 30, 'drift')));
    const varied = scoreEvents([action(0, 'drift'), action(1.5, 'whip'), action(3, 'scrub')]);
    expect(farmed.lines.every((l) => l.reason.includes('×'))).toBe(true);
    expect(varied.lines[2].combo).toBeGreaterThan(1);
    // Rapid repetition of one kind is worth progressively less.
    const repeated = scoreEvents([action(0), action(1), action(2), action(3)]);
    expect(repeated.lines.map((l) => l.repetition)).toEqual([
      1,
      0.6,
      0.36,
      expect.closeTo(0.216, 6),
    ]);
    expect(repeated.total).toBe(repeated.lines.reduce((s, l) => s + l.points, 0));
  });
  it('a bailout scores nothing and resets the combo', () => {
    const result = scoreEvents([
      action(0),
      action(1, 'whip'),
      action(2, 'scrub', 1, 2, false),
      action(3, 'whip'),
    ]);
    expect(result.lines[2].points).toBe(0);
    expect(result.lines[2].reason).toMatch(/bailout/);
    expect(result.lines[3].combo).toBe(1.25);
  });
});

const line = (a: RoutePoint, b: RoutePoint, n = 20): RoutePoint[] =>
  Array.from({ length: n + 1 }, (_, i) => ({
    x: a.x + ((b.x - a.x) * i) / n,
    y: 0,
    z: a.z + ((b.z - a.z) * i) / n,
  }));
const P = (x: number, z: number) => ({ x, y: 0, z });
/** Rallycross loop: main corner or a longer joker branch between the same nodes. */
const rallycross: RouteSpec = {
  id: 'rx',
  version: 1,
  closed: true,
  start: 'start',
  edges: [
    { id: 'start', kind: 'main', points: line(P(0, 0), P(0, 200)), next: ['corner', 'joker'] },
    {
      id: 'corner',
      kind: 'main',
      points: [
        ...line(P(0, 200), P(100, 200)).slice(0),
        ...line(P(100, 200), P(100, 0)).slice(1),
        ...line(P(100, 0), P(0, 0)).slice(1),
      ],
      next: ['start'],
    },
    {
      id: 'joker',
      kind: 'joker',
      points: [
        ...line(P(0, 200), P(-60, 260)),
        ...line(P(-60, 260), P(100, 260)).slice(1),
        ...line(P(100, 260), P(100, 0)).slice(1),
        ...line(P(100, 0), P(0, 0)).slice(1),
      ],
      next: ['start'],
    },
  ],
  checkpoints: [{ edge: 'start', s: 150 }],
};
function driveLap(c: ReturnType<typeof competitor>, viaJoker: boolean, t0: number) {
  const path = [
    ...line(P(0, 1), P(0, 199), 60),
    ...(viaJoker
      ? [
          ...line(P(-1, 201), P(-60, 259), 30),
          ...line(P(-59, 260), P(99, 260), 60),
          ...line(P(100, 259), P(100, 1), 80),
        ]
      : [...line(P(1, 200), P(99, 200), 30), ...line(P(100, 199), P(100, 1), 60)]),
    ...line(P(99, 0), P(1, 0), 30),
  ];
  path.forEach((p, i) => {
    c.progress.update(p);
    observeStage(c, t0 + i * 0.3, 'joker');
  });
}
describe('WP42 rallycross joker and stage classification', () => {
  it('penalises a missing joker and classifies with explained reasons', () => {
    const graph = new RouteGraph(rallycross);
    const a = competitor(1, new RouteProgress(graph, 10)),
      b = competitor(2, new RouteProgress(graph, 10));
    driveLap(a, false, 0);
    driveLap(a, true, 100);
    driveLap(b, false, 0);
    driveLap(b, false, 90);
    a.finishTime = 210;
    b.finishTime = 190;
    expect(a.jokers).toBe(1);
    expect(b.jokers).toBe(0);
    const result = classifyStage([a, b], { required: 1, penaltySeconds: 30 });
    expect(result[0].id).toBe(1);
    expect(result[1].reason).toMatch(/joker taken 0\/1/);
    expect(a.splits.length).toBeGreaterThanOrEqual(2);
  });
});
