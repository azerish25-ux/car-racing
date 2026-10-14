import { ROUTE_LIMITS, validateRoute, type RouteSpec } from './route-graph.ts';

/** Untrusted creator content import (WP56, masterplan §22.6). Imported data
 * is parsed as inert JSON only (never evaluated), bounded in bytes and
 * nesting, stripped of prototype-polluting keys, coerced to the known shape
 * and validated by the same contract as authored content. A rejection names
 * the reason; nothing partial is accepted. */
export const IMPORT_LIMITS = Object.freeze({ bytes: 2_000_000, depth: 8 });
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);
export type ImportResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };
function depthOf(value: unknown, depth = 0): number {
  if (depth > IMPORT_LIMITS.depth + 1 || !value || typeof value !== 'object') return depth;
  let max = depth;
  for (const child of Object.values(value)) max = Math.max(max, depthOf(child, depth + 1));
  return max;
}
export function parseCreatorJson(text: unknown): ImportResult<unknown> {
  if (typeof text !== 'string') return { ok: false, errors: ['Content must be JSON text'] };
  if (new TextEncoder().encode(text).length > IMPORT_LIMITS.bytes)
    return { ok: false, errors: [`Content exceeds ${IMPORT_LIMITS.bytes} bytes`] };
  let polluted = false;
  let value: unknown;
  try {
    value = JSON.parse(text, (key, v) => {
      if (FORBIDDEN.has(key)) {
        polluted = true;
        return undefined;
      }
      return v;
    });
  } catch (error) {
    return {
      ok: false,
      errors: [`Not valid JSON: ${error instanceof Error ? error.message : error}`],
    };
  }
  if (polluted) return { ok: false, errors: ['Forbidden key (__proto__/prototype/constructor)'] };
  if (depthOf(value) > IMPORT_LIMITS.depth)
    return { ok: false, errors: [`Nesting deeper than ${IMPORT_LIMITS.depth}`] };
  return { ok: true, value };
}
const str = (v: unknown, max = ROUTE_LIMITS.idLength) =>
  typeof v === 'string' && v.length > 0 && v.length <= max ? v : null;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
/** Import a creator route: inert parse, shape coercion, then validateRoute. */
export function importCreatorRoute(text: unknown): ImportResult<RouteSpec> {
  const parsed = parseCreatorJson(text);
  if (!parsed.ok) return parsed;
  const r = parsed.value as Record<string, unknown>;
  const errors: string[] = [];
  if (!r || typeof r !== 'object' || Array.isArray(r))
    return { ok: false, errors: ['Route must be an object'] };
  const edges = Array.isArray(r.edges) ? r.edges : [];
  if (edges.length > ROUTE_LIMITS.edges) return { ok: false, errors: ['Too many edges'] };
  const spec: RouteSpec = {
    id: str(r.id) ?? '',
    version: Number.isInteger(r.version) ? (r.version as number) : 0,
    closed: r.closed === true,
    start: str(r.start) ?? '',
    edges: edges.map((e: Record<string, unknown>, i: number) => {
      const points = Array.isArray(e?.points)
        ? e.points.slice(0, ROUTE_LIMITS.pointsPerEdge + 1)
        : [];
      const kind = ['main', 'pit', 'joker', 'stage'].includes(e?.kind as string)
        ? (e.kind as 'main')
        : null;
      if (!kind) errors.push(`Edge ${i}: unknown kind`);
      return {
        id: str(e?.id) ?? '',
        kind: kind ?? 'main',
        points: points.map((p: Record<string, unknown>) => ({
          x: num(p?.x) ?? NaN,
          y: num(p?.y) ?? NaN,
          z: num(p?.z) ?? NaN,
        })),
        next: Array.isArray(e?.next) ? e.next.map((n: unknown) => str(n) ?? '').slice(0, 16) : [],
      };
    }),
    checkpoints: (Array.isArray(r.checkpoints) ? r.checkpoints : [])
      .slice(0, ROUTE_LIMITS.checkpoints + 1)
      .map((c: Record<string, unknown>) => ({ edge: str(c?.edge) ?? '', s: num(c?.s) ?? -1 })),
  };
  if (!spec.id) errors.push('Route id missing or too long');
  if (spec.version < 1) errors.push('Route version must be a positive integer');
  errors.push(...validateRoute(spec));
  return errors.length ? { ok: false, errors } : { ok: true, value: spec };
}
