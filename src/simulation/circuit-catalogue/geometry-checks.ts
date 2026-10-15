import { mod } from '../../core/math.ts';
import { racingLineFor } from '../racing-line.ts';
import { ROUTE_LAYER_GAP, trackPoint, type Track } from '../track.ts';

/** Road-surface separation a crossing needs: car height, structure depth
 * and headroom (m). */
export const BRIDGE_CLEARANCE = 6.5;
/** Pit straights must be straighter than this curvature (1/m). */
export const PIT_STRAIGHT_CURVATURE = 1 / 150;

export interface GeometryReport {
  errors: string[];
  /** Smallest horizontal gap between non-adjacent same-layer stations minus
   * the barrier distances facing each other (m); >= 0 means no overlap. */
  minimumMargin: number;
  crossings: { s: number; other: number; clearance: number }[];
  maximumGradient: number;
  maximumBank: number;
  /** Sharpest crest as a vertical radius (m); Infinity when there is none. */
  minimumCrestRadius: number;
}

/** Physical consistency of a built track (WP29 content validation):
 * - separate sections of the same road layer never overlap their barrier
 *   corridors (that would let progress snap to the wrong road);
 * - every self-crossing is a bridge with real headroom;
 * - the paddock straight is straight enough for the pit lane template;
 * - the racing line solves to finite offsets inside the road. */
export function trackGeometryReport(track: Track): GeometryReport {
  const at = `circuit ${track.circuit.id}`,
    errors: string[] = [],
    step = 4,
    count = Math.floor(track.length / step),
    p = trackPoint();
  const xs = new Float64Array(count),
    zs = new Float64Array(count),
    ys = new Float64Array(count),
    nx = new Float64Array(count),
    nz = new Float64Array(count),
    left = new Float64Array(count),
    right = new Float64Array(count);
  let maximumGradient = 0,
    maximumBank = 0;
  for (let i = 0; i < count; i++) {
    track.at(i * step, p);
    xs[i] = p.x;
    zs[i] = p.z;
    ys[i] = p.y;
    nx[i] = p.nx;
    nz[i] = p.nz;
    left[i] = track.boundaryAt(p, -1);
    right[i] = track.boundaryAt(p, 1);
    maximumGradient = Math.max(maximumGradient, Math.abs(p.gradient));
    maximumBank = Math.max(maximumBank, Math.abs(p.bank));
  }
  const cell = 48,
    grid = new Map<string, number[]>();
  for (let i = 0; i < count; i++) {
    const key = `${Math.floor(xs[i] / cell)},${Math.floor(zs[i] / cell)}`,
      list = grid.get(key);
    if (list) list.push(i);
    else grid.set(key, [i]);
  }
  let minimumMargin = Infinity,
    worst = '';
  for (let i = 0; i < count; i++) {
    const gx = Math.floor(xs[i] / cell),
      gz = Math.floor(zs[i] / cell);
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++)
        for (const j of grid.get(`${gx + dx},${gz + dz}`) ?? []) {
          if (j <= i) continue;
          const ds = Math.min((j - i) * step, track.length - (j - i) * step);
          const ddx = xs[j] - xs[i],
            ddz = zs[j] - zs[i],
            d = Math.hypot(ddx, ddz);
          // Locally connected (the same corner) or on another road layer.
          if (ds < Math.max(150, 4 * d)) continue;
          if (Math.abs(ys[j] - ys[i]) > ROUTE_LAYER_GAP) continue;
          const towardJ = ddx * nx[i] + ddz * nz[i],
            towardI = -ddx * nx[j] - ddz * nz[j];
          const bi = towardJ < 0 ? left[i] : right[i],
            bj = towardI < 0 ? left[j] : right[j],
            margin = d - bi - bj;
          if (margin < minimumMargin) {
            minimumMargin = margin;
            worst = `${(i * step).toFixed(0)} m and ${(j * step).toFixed(0)} m`;
          }
        }
  }
  if (minimumMargin < -0.5)
    errors.push(
      `${at}: barrier corridors of separate sections overlap by ${(-minimumMargin).toFixed(1)} m at ${worst}`,
    );
  // Self-crossings: a bridge needs headroom.
  const crossings: GeometryReport['crossings'] = [];
  for (let i = 0; i < count; i++) {
    const a = i,
      b = (i + 1) % count;
    const gx = Math.floor(xs[i] / cell),
      gz = Math.floor(zs[i] / cell);
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++)
        for (const c of grid.get(`${gx + dx},${gz + dz}`) ?? []) {
          if (c <= i + 1) continue;
          const d = (c + 1) % count;
          const ds = Math.min((c - i) * step, track.length - (c - i) * step);
          if (ds < 120) continue;
          const den = (xs[b] - xs[a]) * (zs[d] - zs[c]) - (zs[b] - zs[a]) * (xs[d] - xs[c]);
          if (Math.abs(den) < 1e-9) continue;
          const t = ((xs[c] - xs[a]) * (zs[d] - zs[c]) - (zs[c] - zs[a]) * (xs[d] - xs[c])) / den,
            u = ((xs[c] - xs[a]) * (zs[b] - zs[a]) - (zs[c] - zs[a]) * (xs[b] - xs[a])) / den;
          if (t < 0 || t > 1 || u < 0 || u > 1) continue;
          const ya = ys[a] + (ys[b] - ys[a]) * t,
            yc = ys[c] + (ys[d] - ys[c]) * u,
            clearance = Math.abs(yc - ya);
          crossings.push({ s: (i + t) * step, other: (c + u) * step, clearance });
          if (clearance < BRIDGE_CLEARANCE)
            errors.push(
              `${at}: roads cross at ${((i + t) * step).toFixed(0)} m / ${((c + u) * step).toFixed(0)} m with only ${clearance.toFixed(1)} m headroom`,
            );
        }
  }
  // Paddock straight for the pit-lane template.
  const pit = track.pit;
  // The lane is nearly merged in the last 25 m at either end.
  for (let s = 25 - pit.divergeStart; s <= pit.mergeEnd - 25; s += 5) {
    track.at(mod(s, track.length), p);
    if (Math.abs(p.curvature) > PIT_STRAIGHT_CURVATURE) {
      errors.push(
        `${at}: pit straight bends (radius ${(1 / Math.abs(p.curvature)).toFixed(0)} m) at ${s.toFixed(0)} m from the line`,
      );
      break;
    }
  }
  // Vertical curvature: crests (negative second derivative) as a radius.
  let minimumCrestRadius = Infinity;
  for (let i = 0; i < count; i++) {
    const curvature =
      (ys[(i + 1) % count] - 2 * ys[i] + ys[(i - 1 + count) % count]) / (step * step);
    if (curvature < 0) minimumCrestRadius = Math.min(minimumCrestRadius, -1 / curvature);
  }
  // Racing line: finite and inside the road everywhere.
  const line = racingLineFor(track);
  for (let i = 0; i < line.count; i++) {
    const offset = line.offsets[i];
    track.at(i * line.step, p);
    if (!Number.isFinite(offset) || Math.abs(offset) > p.width + 1e-3) {
      errors.push(`${at}: racing line leaves the road at ${(i * line.step).toFixed(0)} m`);
      break;
    }
  }
  return {
    errors,
    minimumMargin,
    crossings,
    maximumGradient,
    maximumBank,
    minimumCrestRadius,
  };
}
