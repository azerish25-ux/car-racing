import { describe, expect, it } from 'vitest';
import {
  IMPORT_LIMITS,
  importCreatorRoute,
  parseCreatorJson,
} from '../src/simulation/content-import.ts';

const route = {
  id: 'creator-loop',
  version: 1,
  closed: true,
  start: 'a',
  edges: [
    {
      id: 'a',
      kind: 'main',
      points: [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 100 },
      ],
      next: ['b'],
    },
    {
      id: 'b',
      kind: 'main',
      points: [
        { x: 0, y: 0, z: 100 },
        { x: 50, y: 0, z: 50 },
        { x: 0, y: 0, z: 0 },
      ],
      next: ['a'],
    },
  ],
  checkpoints: [{ edge: 'a', s: 50 }],
};
describe('WP56 sandboxed creator content', () => {
  it('accepts a valid route as inert data', () => {
    const result = importCreatorRoute(JSON.stringify(route));
    expect(result.ok).toBe(true);
  });
  it('rejects malicious, oversized, deep and malformed inputs with reasons', () => {
    expect(parseCreatorJson('{"__proto__":{"polluted":1}}')).toMatchObject({ ok: false });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(parseCreatorJson('x'.repeat(IMPORT_LIMITS.bytes + 1))).toMatchObject({ ok: false });
    expect(parseCreatorJson(`${'['.repeat(40)}${']'.repeat(40)}`)).toMatchObject({ ok: false });
    expect(parseCreatorJson('{bad json')).toMatchObject({ ok: false });
    expect(importCreatorRoute(42)).toMatchObject({ ok: false });
    const nan = structuredClone(route);
    (nan.edges[0].points[1] as Record<string, unknown>).x = 'NaN';
    const r = importCreatorRoute(JSON.stringify(nan));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/non-finite/);
    const code = { ...route, id: 'x', edges: [{ ...route.edges[0], kind: 'function(){}' }] };
    const c = importCreatorRoute(JSON.stringify(code));
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.errors.join()).toMatch(/unknown kind/);
  });
});
