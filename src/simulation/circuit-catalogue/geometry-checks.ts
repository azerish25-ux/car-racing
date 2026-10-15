import { clamp, mod } from '../../core/math.ts';
import { racingLineFor } from '../racing-line.ts';
import { ROUTE_LAYER_GAP, SURFACE, surfaceSample, trackPoint, type Track } from '../track.ts';

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

/** What a motorcycle-safe circuit needs (GAME_DESIGN §2 road motorcycles):
 * a rider who falls slides into gravel or onto asphalt, not grass, with a
 * distant barrier at every corner; kerbs are the low flat profile (no raised
 * sausage elements); no walls close by, tunnels or street frontage. */
export const BIKE_SAFETY = Object.freeze({
  /** Corners tighter than this (m) need gravel or asphalt run-off outside. */
  cornerRadius: 250,
  /** Barrier face beyond the asphalt edge outside such corners (m). */
  cornerBarrier: 10,
  /** Barrier face beyond the asphalt edge anywhere else (m). */
  barrier: 6,
  /** Highest kerb rise above the road plane (m). */
  kerbHeight: 0.05,
  /** Steepest banking (slope). */
  maxBank: 0.27,
  /** A violation shorter than this (m) is a corner-transition artefact of the
   * spline (run-off and barrier tables change at segment ends). */
  tolerance: 16,
});
export interface BikeSafetyReport {
  errors: string[];
  /** Metres of lap inside corners tighter than BIKE_SAFETY.cornerRadius. */
  cornerMetres: number;
  /** Closest barrier beyond the asphalt outside those corners (m). */
  minimumCornerBarrier: number;
  /** Closest barrier beyond the asphalt anywhere (m). */
  minimumBarrier: number;
  /** Metres of tight corner whose outside run-off is grass. */
  grassOutsideMetres: number;
  /** Measured kerb rise above the road plane (m). */
  maximumKerbHeight: number;
  coveredMetres: number;
  streetFrontage: boolean;
}
/** Measure a built track against BIKE_SAFETY from the same run-off, barrier
 * and kerb data that contact and collision read. */
export function bikeSafetyReport(track: Track): BikeSafetyReport {
  const at = `circuit ${track.circuit.id}`,
    errors: string[] = [],
    step = 4,
    count = Math.floor(track.length / step),
    p = trackPoint(),
    sample = surfaceSample(),
    limit = 1 / BIKE_SAFETY.cornerRadius;
  let cornerMetres = 0,
    minimumCornerBarrier = Infinity,
    minimumBarrier = Infinity,
    grassOutsideMetres = 0,
    maximumKerbHeight = 0,
    coveredMetres = 0,
    maximumBank = 0;
  const runs = { grass: 0, corner: 0, barrier: 0 },
    worst = { grass: 0, corner: 0, barrier: 0 },
    where = { grass: 0, corner: 0, barrier: 0 };
  const run = (key: keyof typeof runs, bad: boolean, s: number) => {
    runs[key] = bad ? runs[key] + step : 0;
    if (runs[key] > worst[key]) {
      worst[key] = runs[key];
      where[key] = s;
    }
  };
  const q = trackPoint();
  for (let i = 0; i < count; i++) {
    const s = i * step;
    track.at(s, p);
    maximumBank = Math.max(maximumBank, Math.abs(p.bank));
    if (track.isCovered(s)) coveredMetres += step;
    const left = track.boundaryAt(p, -1) - p.width,
      right = track.boundaryAt(p, 1) - p.width;
    minimumBarrier = Math.min(minimumBarrier, left, right);
    run('barrier', Math.min(left, right) < BIKE_SAFETY.barrier, s);
    const corner = Math.abs(p.curvature) > limit,
      outside = p.curvature < 0 ? 1 : -1,
      gap = outside > 0 ? right : left;
    let grass = false;
    if (corner) {
      cornerMetres += step;
      minimumCornerBarrier = Math.min(minimumCornerBarrier, gap);
      grass = track.runoffSurface(p, outside * (p.width + 6)) === SURFACE.GRASS;
      if (grass) grassOutsideMetres += step;
    }
    run('grass', corner && grass, s);
    run('corner', corner && gap < BIKE_SAFETY.cornerBarrier, s);
    // Kerb band: rise of the contact surface above the road plane.
    if (i % 8 === 0)
      for (const side of [-1, 1])
        for (let across = 0.05; across < 1.1; across += 0.1) {
          const l = side * (p.width + across);
          track.sample(p.x + p.nx * l, p.z + p.nz * l, sample, p.y);
          track.at(sample.s, q);
          maximumKerbHeight = Math.max(
            maximumKerbHeight,
            sample.height - (q.y + q.bank * clamp(sample.lateral, -12, 12)),
          );
        }
  }
  const tolerance = BIKE_SAFETY.tolerance;
  if (worst.grass > tolerance)
    errors.push(
      `${at}: not bike-safe: ${worst.grass} m of corner with grass run-off outside near ${where.grass.toFixed(0)} m`,
    );
  if (worst.corner > tolerance)
    errors.push(
      `${at}: not bike-safe: corner barrier closer than ${BIKE_SAFETY.cornerBarrier} m for ${worst.corner} m near ${where.corner.toFixed(0)} m`,
    );
  if (worst.barrier > tolerance)
    errors.push(
      `${at}: not bike-safe: barrier closer than ${BIKE_SAFETY.barrier} m for ${worst.barrier} m near ${where.barrier.toFixed(0)} m`,
    );
  if (maximumKerbHeight > BIKE_SAFETY.kerbHeight)
    errors.push(`${at}: not bike-safe: kerbs rise ${(maximumKerbHeight * 1000).toFixed(0)} mm`);
  if (maximumBank > BIKE_SAFETY.maxBank) errors.push(`${at}: not bike-safe: banking too steep`);
  if (coveredMetres > 0) errors.push(`${at}: not bike-safe: tunnels`);
  const streetFrontage = !!track.circuit.catalogue?.dressing.facades.length;
  if (streetFrontage) errors.push(`${at}: not bike-safe: street frontage beside the road`);
  return {
    errors,
    cornerMetres,
    minimumCornerBarrier,
    minimumBarrier,
    grassOutsideMetres,
    maximumKerbHeight,
    coveredMetres,
    streetFrontage,
  };
}
