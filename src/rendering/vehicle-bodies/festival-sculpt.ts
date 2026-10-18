import type { Pt } from './loft.ts';

/** Concave surfacing of the festival production form (festival-form.ts):
 * side scoops ahead of a mid-engined car's rear wheels, gills behind the
 * front wheels and real shut-line grooves on the near LOD. Each is a
 * displacement of the lofted section samples along their inward normal, so
 * the surface stays one watertight loft; leading edges get their own pairs
 * of stations a fraction of a millimetre apart, so the normals break into a
 * crisp lip instead of a rolled dent. Measured on refs 013, 014, 018, 019,
 * 037, 090 and 097 (docs/production/fh6-r4/vehicle-fidelity-r3.md). */
export interface Recess {
  kind: 'scoop' | 'gill' | 'groove';
  /** Leading (front) edge and rear end stations, car frame z (front > rear). */
  front: number;
  rear: number;
  /** Vertical band (car frame y) at the leading edge. */
  lo: number;
  hi: number;
  /** Greatest inward displacement (m). */
  depth: number;
  /** Band edge falloff (m). */
  soft: number;
}
/** Length (m) of a recess's leading wall along the car. */
export const RECESS_EDGE = 0.0012;
/** Spacing (m) of the crease twin of each edge station. */
const TWIN = 0.0002;
const smooth01 = (t: number) => t * t * (3 - 2 * t);

/** Along-car share of the depth (0..1) and the scoop's run parameter. */
function along(r: Recess, z: number): [number, number] {
  if (z > r.front || z < r.rear) return [0, 0];
  if (z > r.front - RECESS_EDGE) return [(r.front - z) / RECESS_EDGE, 0];
  if (r.kind === 'gill') return [z < r.rear + RECESS_EDGE ? (z - r.rear) / RECESS_EDGE : 1, 0];
  // A scoop is deepest behind its lip; its floor runs out to the haunch.
  const t = (r.front - RECESS_EDGE - z) / (r.front - RECESS_EDGE - r.rear);
  return [(1 - t) ** 1.6, t];
}
/** Inward displacement (m) of the surface at (z, y). */
export function recessAt(r: Recess, z: number, y: number) {
  if (r.kind === 'groove')
    return Math.abs(z - r.front) < 1e-6 && y > r.lo && y < r.hi ? r.depth : 0;
  const [a, t] = along(r, z);
  if (a <= 0) return 0;
  // A scoop's band rises and narrows toward its rear end (toward the haunch):
  // a wedge whose upper edge runs nearly level under the shoulder.
  const centre = (r.lo + r.hi) / 2 + (r.kind === 'scoop' ? (r.hi - r.lo) * 0.24 * t : 0),
    half = ((r.hi - r.lo) / 2) * (r.kind === 'scoop' ? 1 - 0.52 * t : 1),
    d = Math.abs(y - centre);
  if (d >= half) return 0;
  const across = d <= half - r.soft ? 1 : smooth01((half - d) / r.soft);
  return r.depth * a * across;
}
/** Whether `z` lies on the floor of a (non-groove) recess, behind its lip. */
export function onRecessFloor(r: Recess, z: number) {
  return r.kind !== 'groove' && z < r.front - RECESS_EDGE && z > r.rear;
}
/** Move the samples `from`..`to` of a half section inward by the recesses
 * at station z, along each sample's outward normal (taken between its
 * nearest distinct neighbours, so the two copies of a crease move together). */
export function displaceSection(
  recesses: readonly Recess[],
  z: number,
  half: Pt[],
  from: number,
  to: number,
) {
  const active = recesses.filter((r) =>
    r.kind === 'groove' ? Math.abs(z - r.front) < 1e-6 : z <= r.front && z >= r.rear,
  );
  if (!active.length) return;
  const moves: [number, number, number][] = [];
  for (let k = Math.max(1, from); k <= Math.min(half.length - 2, to); k++) {
    const [x, y] = half[k];
    let d = 0;
    for (const r of active) d = Math.max(d, recessAt(r, z, y));
    if (d <= 0) continue;
    let a = k - 1,
      b = k + 1;
    while (a > 0 && half[a][0] === x && half[a][1] === y) a--;
    while (b < half.length - 1 && half[b][0] === x && half[b][1] === y) b++;
    const tx = half[b][0] - half[a][0],
      ty = half[b][1] - half[a][1],
      l = Math.hypot(tx, ty) || 1;
    moves.push([k, x - (ty / l) * d, y + (tx / l) * d]);
  }
  for (const [k, x, y] of moves) half[k] = [x, y];
}
/** Extra loft stations for the recess edges: a crisp lip (twin stations a
 * fraction of a millimetre apart) on the near LOD, the edge itself on the
 * mid LOD; shut-line grooves only on the near LOD. */
export function recessStations(recesses: readonly Recess[], detail: number) {
  const out: number[] = [];
  for (const r of recesses) {
    if (r.kind === 'groove') {
      if (detail === 0) out.push(r.front - 0.0015, r.front, r.front + 0.0015);
      continue;
    }
    if (detail > 1) continue;
    const edges: [number, number][] = [
      [r.front, 1],
      [r.front - RECESS_EDGE, -1],
    ];
    if (r.kind === 'gill') edges.push([r.rear + RECESS_EDGE, 1], [r.rear, -1]);
    for (const [z, outward] of edges) {
      out.push(z);
      if (detail === 0) out.push(z + outward * TWIN);
    }
  }
  return out;
}
/** Merge extra stations into a sorted list, dropping base stations closer
 * than 0.8 mm to an extra one (no slivers). */
export function mergeStations(base: readonly number[], extra: readonly number[]) {
  if (!extra.length) return [...base];
  const kept = base.filter((z) => extra.every((e) => Math.abs(z - e) > 0.0008));
  return [...kept, ...extra].sort((a, b) => a - b);
}
