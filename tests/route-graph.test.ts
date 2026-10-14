import { describe, expect, it } from 'vitest';
import {
  RouteGraph,
  RouteProgress,
  validateRoute,
  type RoutePoint,
  type RouteSpec,
} from '../src/simulation/route-graph.ts';

const line = (a: RoutePoint, b: RoutePoint, n = 20): RoutePoint[] =>
  Array.from({ length: n + 1 }, (_, i) => ({
    x: a.x + ((b.x - a.x) * i) / n,
    y: a.y + ((b.y - a.y) * i) / n,
    z: a.z + ((b.z - a.z) * i) / n,
  }));
const P = (x: number, z: number, y = 0) => ({ x, y, z });
/** Square 400 m loop with a pit branch parallel to the start straight. */
const loop: RouteSpec = {
  id: 'square-with-pit',
  version: 1,
  closed: true,
  start: 'straight',
  edges: [
    { id: 'straight', kind: 'main', points: line(P(0, 0), P(0, 400)), next: ['back'] },
    {
      id: 'back',
      kind: 'main',
      points: [
        ...line(P(0, 400), P(400, 400)),
        ...line(P(400, 400), P(400, 0)).slice(1),
        ...line(P(400, 0), P(0, 0)).slice(1),
      ],
      next: ['straight', 'pit'],
    },
    {
      id: 'pit',
      kind: 'pit',
      points: line(P(0, 0), P(-30, 0.1)).concat(
        line(P(-30, 0.1), P(-30, 400)).slice(1),
        line(P(-30, 400), P(0, 400)).slice(1),
      ),
      next: ['back'],
    },
  ],
  checkpoints: [
    { edge: 'straight', s: 200 },
    { edge: 'back', s: 600 },
    { edge: 'back', s: 1150 },
  ],
};
function drive(progress: RouteProgress, path: RoutePoint[]) {
  for (const p of path) progress.update(p);
}
describe('WP11 route graph and legal progress', () => {
  it('reports why an invalid route is invalid', () => {
    const broken: RouteSpec = {
      ...loop,
      edges: [
        ...loop.edges,
        { id: 'island', kind: 'main', points: line(P(900, 0), P(900, 50)), next: ['nowhere'] },
      ],
    };
    const errors = validateRoute(broken);
    expect(errors.join()).toMatch(/unknown edge nowhere/);
    expect(errors.join()).toMatch(/island is disconnected/);
    expect(
      validateRoute({ ...loop, edges: [{ ...loop.edges[0], points: [P(0, 0), P(0, 0)] }] }).join(),
    ).toMatch(/zero-length/);
    expect(validateRoute(loop)).toEqual([]);
  });
  it('counts a lap only through every checkpoint, via the main road or the pit branch', () => {
    const graph = new RouteGraph(loop);
    const main = new RouteProgress(graph, 10);
    const lap = [
      ...line(P(0, 1), P(0, 399), 80),
      ...line(P(1, 400), P(400, 400), 80),
      ...line(P(400, 399), P(400, 1), 80),
      ...line(P(399, 0), P(1, 0), 80),
    ];
    drive(main, lap);
    drive(main, line(P(0, 1), P(0, 50), 10));
    expect(main.laps).toBe(1);
    expect(main.edge).toBe('straight');
    const pitting = new RouteProgress(graph, 10);
    drive(pitting, lap);
    drive(pitting, [...line(P(-1, 0), P(-30, 0.5), 10), ...line(P(-30, 1), P(-30, 399), 80)]);
    expect(pitting.edge).toBe('pit');
    expect(pitting.offRoute).toBe(false);
  });
  it('does not credit an infield shortcut', () => {
    const progress = new RouteProgress(new RouteGraph(loop), 10);
    drive(progress, line(P(0, 1), P(0, 200), 40));
    // Teleport across the infield to the far side of the back section.
    progress.update(P(400, 100));
    expect(progress.offRoute).toBe(true);
    expect(progress.edge).toBe('straight');
    expect(progress.s).toBeCloseTo(200, 0);
  });
  it('keeps the upper road over a bridge and finishes a point-to-point stage', () => {
    const stage: RouteSpec = {
      id: 'stage-with-bridge',
      version: 1,
      closed: false,
      start: 'climb',
      edges: [
        // A loop of road that passes over its own start 9 m higher.
        {
          id: 'climb',
          kind: 'stage',
          points: [
            ...line(P(-100, 0, 0), P(100, 0, 0)),
            ...line(P(100, 0, 0), P(100, 200, 4)).slice(1),
            ...line(P(100, 200, 4), P(0, 200, 9)).slice(1),
            ...line(P(0, 200, 9), P(0, -100, 9)).slice(1),
          ],
          next: [],
        },
      ],
      checkpoints: [{ edge: 'climb', s: 790 }],
    };
    const progress = new RouteProgress(new RouteGraph(stage), 10);
    drive(progress, line(P(-99, 0, 0.5), P(99, 0, 0.5), 60));
    const below = progress.s;
    drive(progress, [
      ...line(P(100, 1, 0.5), P(100, 199, 4.5), 60),
      ...line(P(99, 200, 4.5), P(1, 200, 9.5), 60),
      ...line(P(0, 199, 9.5), P(0, 1, 9.5), 60),
    ]);
    // Directly above the earlier lower-road position: progress keeps rising.
    progress.update(P(0, 0, 9.5));
    expect(progress.s).toBeGreaterThan(below + 400);
    drive(progress, line(P(0, -1, 9.5), P(0, -99, 9.5), 30));
    expect(progress.finished).toBe(true);
  });
});
