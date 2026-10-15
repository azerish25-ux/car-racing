import { clamp, mod } from '../../core/math.ts';
import type { CircuitDefinition, DrsZone, PitLaneDefinition } from '../circuits.ts';
import {
  RUNOFF,
  type BarrierKind,
  type BarrierSpan,
  type CatalogueCircuitId,
  type CatalogueGroup,
  type CatalogueMeta,
  type LapSpan,
  type RouteCrossing,
  type RunoffCode,
  type RunoffKind,
  type VenueSpan,
  type VenueTheme,
} from './venue-data.ts';

/** Which side of the road a segment property applies to. `in`/`out` follow
 * the segment's own turn (for a straight: the next corner's turn). */
export type SideSpec = 'left' | 'right' | 'both' | 'in' | 'out';
export interface BarrierSpec {
  kind?: BarrierKind;
  /** Distance of the barrier face beyond the asphalt edge (m). */
  offset?: number;
  side?: SideSpec;
}
/** One authored piece of centreline: a straight (`s` metres) or an arc of
 * radius `r` turning `turn` degrees (+ left, - right). Elevation is the road
 * height at the END of the segment; width and banking hold along it. */
export interface Segment {
  s?: number;
  r?: number;
  turn?: number;
  /** Named corner at the arc's middle (boards, guides, minimap). */
  name?: string;
  y?: number;
  /** Half-width (m) along the segment. */
  w?: number;
  /** Banking (degrees) along the segment, raising the outside of the turn. */
  bank?: number;
  runoff?: RunoffKind | Partial<Record<SideSpec, RunoffKind>>;
  barrier?: BarrierSpec | readonly BarrierSpec[];
  /** Roofed (tunnel): rain cannot reach the road. */
  tunnel?: boolean;
  facades?: SideSpec;
  rock?: SideSpec;
  drop?: SideSpec;
  stands?: SideSpec;
  /** Part of a DRS straight (consecutive flagged segments merge). */
  drs?: boolean;
}
export interface CircuitSpec {
  id: CatalogueCircuitId;
  name: string;
  short: string;
  group: CatalogueGroup;
  venue: string;
  venueName: string;
  layout: string;
  description: string;
  theme: VenueTheme;
  night?: boolean;
  seaLevel?: number | null;
  /** Initial heading (degrees, mathematical: 0 = +x east, 90 = +z north). */
  heading?: number;
  /** Net turning of the lap: +1 anticlockwise, -1 clockwise, 0 figure-eight. */
  winding: 1 | -1 | 0;
  path: readonly Segment[];
  /** Scale the closed layout to this lap length (m). */
  length?: number;
  referenceLength?: number;
  /** Elevation at the start line (m). */
  y0?: number;
  halfWidth: number;
  /** Elevation smoothing half-window (m): vertical curves span ~2x this. */
  elevationSmoothing?: number;
  bankSmoothing?: number;
  /** Drainage cross-fall slope on straights. */
  crossFall?: number;
  barrier: { kind: BarrierKind; offset: number };
  /** Default run-off: straights, then corner outside/inside. */
  runoff?: { straight?: RunoffKind; outside?: RunoffKind; inside?: RunoffKind };
  pit: PitLaneDefinition;
  /** Drive the authored path the other way round. */
  reverse?: boolean;
  variantOf?: string;
}
export type CatalogueCircuit = CircuitDefinition & {
  readonly id: CatalogueCircuitId;
  readonly catalogue: CatalogueMeta;
};

const DEG = Math.PI / 180;
/** Track's own sampling (track.ts): samples per lap and the spline. */
const TRACK_SAMPLES = 1536;
const catmull = (a: number, b: number, c: number, d: number, t: number) =>
  0.5 *
  (2 * b +
    (-a + c) * t +
    (2 * a - 5 * b + 4 * c - d) * t * t +
    (-a + 3 * b - 3 * c + d) * t * t * t);
/** Lap length exactly as Track computes it from a control polygon. */
export function controlPolygonLength(design: readonly (readonly [number, number])[]) {
  return sampleControlPolygon(design).length;
}
function sampleControlPolygon(design: readonly (readonly [number, number])[]) {
  const n = design.length,
    x = new Float64Array(TRACK_SAMPLES + 1),
    z = new Float64Array(TRACK_SAMPLES + 1),
    s = new Float64Array(TRACK_SAMPLES + 1);
  let distance = 0;
  for (let i = 0; i <= TRACK_SAMPLES; i++) {
    const t = (i / TRACK_SAMPLES) * n,
      k = Math.floor(t),
      f = t - k;
    const a = design[mod(k - 1, n)],
      b = design[mod(k, n)],
      c = design[mod(k + 1, n)],
      d = design[mod(k + 2, n)];
    x[i] = catmull(a[0], b[0], c[0], d[0], f);
    z[i] = catmull(a[1], b[1], c[1], d[1], f);
    if (i) distance += Math.hypot(x[i] - x[i - 1], z[i] - z[i - 1]);
    s[i] = distance;
  }
  return { x, z, s, length: distance };
}

interface Resolved {
  kind: 'straight' | 'arc';
  length: number;
  radius: number;
  /** Signed turn (radians, + left). */
  turn: number;
  /** +1 left, -1 right: the turn direction used for in/out (next corner for a straight). */
  hand: number;
  seg: Segment;
}
function sidesOf(spec: SideSpec | undefined, hand: number): (1 | -1)[] {
  if (!spec) return [];
  const outside: 1 | -1 = hand > 0 ? 1 : -1;
  switch (spec) {
    case 'both':
      return [-1, 1];
    case 'left':
      return [-1];
    case 'right':
      return [1];
    case 'out':
      return [outside];
    case 'in':
      return [outside === 1 ? -1 : 1];
  }
}
const RUNOFF_CODE: Record<RunoffKind, RunoffCode> = {
  grass: RUNOFF.GRASS,
  gravel: RUNOFF.GRAVEL,
  asphalt: RUNOFF.ASPHALT,
};
const BARRIER_CODE: Record<BarrierKind, number> = {
  armco: 0,
  concrete: 1,
  tyre: 2,
  safer: 3,
  rock: 4,
};
const BARRIER_NAMES = Object.keys(BARRIER_CODE) as BarrierKind[];

/** Resolve the authored segments: closing heading error is shared between
 * arcs by their turn, and the closing position error between straights by
 * their length (least squares), so curvature and corner sequence are kept. */
function resolve(spec: CircuitSpec) {
  const raw: Resolved[] = spec.path.map((seg) => {
    if (seg.r !== undefined && seg.turn !== undefined) {
      if (!(seg.r > 0) || seg.turn === 0) throw new Error(`${spec.id}: invalid arc`);
      const turn = seg.turn * DEG;
      return {
        kind: 'arc' as const,
        length: seg.r * Math.abs(turn),
        radius: seg.r,
        turn,
        hand: Math.sign(turn),
        seg,
      };
    }
    if (!(seg.s !== undefined && seg.s > 0)) throw new Error(`${spec.id}: invalid straight`);
    return { kind: 'straight' as const, length: seg.s, radius: Infinity, turn: 0, hand: 0, seg };
  });
  for (let i = 0; i < raw.length; i++)
    if (raw[i].kind === 'straight')
      for (let k = 1; k <= raw.length; k++) {
        const next = raw[(i + k) % raw.length];
        if (next.kind === 'arc') {
          raw[i].hand = next.hand;
          break;
        }
      }
  const total = raw.reduce((a, r) => a + r.turn, 0),
    target = spec.winding * 2 * Math.PI,
    absolute = raw.reduce((a, r) => a + Math.abs(r.turn), 0),
    headingError = target - total;
  for (const r of raw)
    if (r.kind === 'arc') {
      r.turn += (headingError * Math.abs(r.turn)) / absolute;
      r.length = r.radius * Math.abs(r.turn);
    }
  const walk = () => {
    let x = 0,
      z = 0,
      phi = (spec.heading ?? 90) * DEG;
    const straightDirections: [number, number][] = [];
    for (const r of raw) {
      if (r.kind === 'straight') {
        const ux = Math.cos(phi),
          uz = Math.sin(phi);
        straightDirections.push([ux, uz]);
        x += ux * r.length;
        z += uz * r.length;
      } else {
        const cx = x - Math.sin(phi) * r.radius * Math.sign(r.turn),
          cz = z + Math.cos(phi) * r.radius * Math.sign(r.turn);
        phi += r.turn;
        x = cx + Math.sin(phi) * r.radius * Math.sign(r.turn);
        z = cz - Math.cos(phi) * r.radius * Math.sign(r.turn);
      }
    }
    return { x, z, straightDirections };
  };
  const first = walk();
  // Least-squares straight-length change δ_j = L_j u_j·λ with Σ δ_j u_j = -E.
  let m00 = 0,
    m01 = 0,
    m11 = 0;
  const straights = raw.filter((r) => r.kind === 'straight');
  straights.forEach((r, j) => {
    const [ux, uz] = first.straightDirections[j];
    m00 += r.length * ux * ux;
    m01 += r.length * ux * uz;
    m11 += r.length * uz * uz;
  });
  const det = m00 * m11 - m01 * m01;
  if (Math.abs(det) < 1e-6) throw new Error(`${spec.id}: straights cannot close the layout`);
  const lx = (-first.x * m11 + first.z * m01) / det,
    lz = (first.x * m01 - first.z * m00) / det;
  let adjustment = 0;
  straights.forEach((r, j) => {
    const [ux, uz] = first.straightDirections[j],
      delta = r.length * (ux * lx + uz * lz);
    adjustment += Math.abs(delta);
    r.length += delta;
    if (!(r.length > 2)) throw new Error(`${spec.id}: closure consumed straight ${j}`);
  });
  return { raw, headingError, adjustment };
}

/** Authoring diagnostics without closing the layout: the open turtle path,
 * the heading error (degrees) and the closing gap (m). */
export function traceSpec(spec: CircuitSpec) {
  const points: [number, number][] = [[0, 0]];
  let x = 0,
    z = 0,
    phi = (spec.heading ?? 90) * DEG,
    turn = 0;
  for (const seg of spec.path) {
    if (seg.r !== undefined && seg.turn !== undefined) {
      const steps = Math.max(2, Math.ceil(seg.r * Math.abs(seg.turn * DEG)));
      for (let i = 0; i < steps; i++) {
        phi += (seg.turn * DEG) / steps;
        const ds = (seg.r * Math.abs(seg.turn * DEG)) / steps;
        x += Math.cos(phi) * ds;
        z += Math.sin(phi) * ds;
        points.push([x, z]);
      }
      turn += seg.turn;
    } else {
      x += Math.cos(phi) * (seg.s ?? 0);
      z += Math.sin(phi) * (seg.s ?? 0);
      points.push([x, z]);
    }
  }
  const length = spec.path.reduce(
    (a, seg) => a + (seg.s ?? (seg.r ?? 0) * Math.abs((seg.turn ?? 0) * DEG)),
    0,
  );
  return {
    points,
    gap: Math.hypot(x, z),
    end: [x, z],
    headingError: spec.winding * 360 - turn,
    length,
  };
}

/** Dense 1 m forward model of the closed authored path and its properties. */
interface Dense {
  count: number;
  length: number;
  x: Float64Array;
  z: Float64Array;
  radius: Float64Array;
  segment: Int32Array;
  /** Segment start/end distances. */
  starts: number[];
  ends: number[];
}
function densify(spec: CircuitSpec, raw: Resolved[]): Dense {
  const total = raw.reduce((a, r) => a + r.length, 0),
    count = Math.ceil(total),
    step = total / count;
  const x = new Float64Array(count + 1),
    z = new Float64Array(count + 1),
    radius = new Float64Array(count + 1),
    segment = new Int32Array(count + 1);
  const starts: number[] = [],
    ends: number[] = [];
  let acc = 0;
  for (const r of raw) {
    starts.push(acc);
    acc += r.length;
    ends.push(acc);
  }
  let px = 0,
    pz = 0,
    phi = (spec.heading ?? 90) * DEG,
    k = 0;
  for (let i = 0; i <= count; i++) {
    const d = Math.min(total, i * step);
    while (k < raw.length - 1 && d > ends[k]) {
      // Advance the turtle to the end of segment k.
      const r = raw[k];
      if (r.kind === 'straight') {
        px += Math.cos(phi) * r.length;
        pz += Math.sin(phi) * r.length;
      } else {
        const sg = Math.sign(r.turn),
          cx = px - Math.sin(phi) * r.radius * sg,
          cz = pz + Math.cos(phi) * r.radius * sg;
        phi += r.turn;
        px = cx + Math.sin(phi) * r.radius * sg;
        pz = cz - Math.cos(phi) * r.radius * sg;
      }
      k++;
    }
    const r = raw[k],
      local = d - starts[k];
    if (r.kind === 'straight') {
      x[i] = px + Math.cos(phi) * local;
      z[i] = pz + Math.sin(phi) * local;
    } else {
      const sg = Math.sign(r.turn),
        cx = px - Math.sin(phi) * r.radius * sg,
        cz = pz + Math.cos(phi) * r.radius * sg,
        a = phi + (local / r.radius) * sg;
      x[i] = cx + Math.sin(a) * r.radius * sg;
      z[i] = cz - Math.cos(a) * r.radius * sg;
    }
    radius[i] = r.radius;
    segment[i] = k;
  }
  return { count, length: total, x, z, radius, segment, starts, ends };
}

/** Control points with a smoothly varying spacing (tight corners densely),
 * placed at equal steps of the integrated density so the loop closes evenly. */
function resample(dense: Dense, maxPoints = 480) {
  const n = dense.count,
    h = new Float64Array(n);
  for (let i = 0; i < n; i++) h[i] = clamp(0.4 * dense.radius[i], 5, 30);
  // Lipschitz limit (spacing grows at most 0.25 m per metre), around the loop.
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i < 2 * n; i++) {
      const a = i % n,
        b = (i - 1) % n;
      h[a] = Math.min(h[a], h[b] + 0.25);
    }
    for (let i = 2 * n - 2; i >= 0; i--) {
      const a = i % n,
        b = (i + 1) % n;
      h[a] = Math.min(h[a], h[b] + 0.25);
    }
  }
  const cumulative = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) cumulative[i + 1] = cumulative[i] + 1 / h[i];
  const points = clamp(Math.round(cumulative[n]), 16, maxPoints),
    perPoint = cumulative[n] / points,
    design: [number, number][] = [],
    distance: number[] = [];
  let i = 0;
  const step = dense.length / dense.count;
  for (let k = 0; k < points; k++) {
    const target = k * perPoint;
    while (i < n - 1 && cumulative[i + 1] < target) i++;
    const f = (target - cumulative[i]) / (cumulative[i + 1] - cumulative[i] || 1);
    design.push([
      dense.x[i] + (dense.x[i + 1] - dense.x[i]) * f,
      dense.z[i] + (dense.z[i + 1] - dense.z[i]) * f,
    ]);
    distance.push((i + f) * step);
  }
  return { design, distance };
}

/** Periodic box filter (half-window w samples), applied twice: triangular. */
function smoothPeriodic(values: Float64Array, w: number) {
  const n = values.length;
  if (w < 1) return values;
  w = Math.min(w, Math.floor((n - 1) / 2));
  let src = values;
  for (let pass = 0; pass < 2; pass++) {
    const out = new Float64Array(n);
    let sum = 0;
    for (let k = -w; k <= w; k++) sum += src[(k + n) % n];
    let add = w + 1,
      remove = n - w;
    for (let i = 0; i < n; i++) {
      out[i] = sum / (2 * w + 1);
      if (add >= n) add -= n;
      if (remove >= n) remove -= n;
      sum += src[add++] - src[remove++];
    }
    src = out;
  }
  return src;
}
const lookup = (table: Float64Array | Float32Array, u: number) => {
  const n = table.length,
    x = mod(u, 1) * n,
    i = Math.floor(x) % n,
    f = x - Math.floor(x);
  return table[i] + (table[(i + 1) % n] - table[i]) * f;
};
function spans(flags: Uint8Array, bin: number, length: number): { from: number; to: number }[] {
  const n = flags.length,
    out: { from: number; to: number }[] = [];
  let start = -1;
  // Begin scanning at a cleared bin so wrapping spans stay whole.
  const origin = flags.findIndex((f) => !f);
  if (origin < 0) return [{ from: 0, to: length }];
  for (let k = 1; k <= n; k++) {
    const i = (origin + k) % n;
    if (flags[i] && start < 0) start = i;
    if (!flags[i] && start >= 0) {
      out.push({ from: start * bin, to: mod(i * bin, length) || length });
      start = -1;
    }
  }
  return out;
}

/** Where the sampled centreline crosses itself (stacked road layers). A
 * 40 m spatial hash keeps this linear in lap length. */
function findCrossings(
  sampled: ReturnType<typeof sampleControlPolygon>,
  height: (s: number) => number,
  L: number,
) {
  const grid = new Map<number, number[]>(),
    size = 40;
  for (let i = 0; i < TRACK_SAMPLES; i++) {
    const x0 = Math.floor(Math.min(sampled.x[i], sampled.x[i + 1]) / size),
      x1 = Math.floor(Math.max(sampled.x[i], sampled.x[i + 1]) / size),
      z0 = Math.floor(Math.min(sampled.z[i], sampled.z[i + 1]) / size),
      z1 = Math.floor(Math.max(sampled.z[i], sampled.z[i + 1]) / size);
    for (let gx = x0; gx <= x1; gx++)
      for (let gz = z0; gz <= z1; gz++) {
        const key = gx * 65536 + gz,
          list = grid.get(key);
        if (list) list.push(i);
        else grid.set(key, [i]);
      }
  }
  const seen = new Set<number>(),
    crossings: RouteCrossing[] = [];
  for (const list of grid.values())
    for (let a = 0; a < list.length; a++)
      for (let b = a + 1; b < list.length; b++) {
        const i = Math.min(list[a], list[b]),
          j = Math.max(list[a], list[b]),
          key = i * TRACK_SAMPLES + j;
        if (seen.has(key)) continue;
        seen.add(key);
        const ds = Math.abs(sampled.s[j] - sampled.s[i]);
        if (Math.min(ds, L - ds) < 120) continue;
        const ax = sampled.x[i],
          az = sampled.z[i],
          bx = sampled.x[i + 1],
          bz = sampled.z[i + 1],
          cx = sampled.x[j],
          cz = sampled.z[j],
          dx = sampled.x[j + 1],
          dz = sampled.z[j + 1];
        const den = (bx - ax) * (dz - cz) - (bz - az) * (dx - cx);
        if (Math.abs(den) < 1e-9) continue;
        const t = ((cx - ax) * (dz - cz) - (cz - az) * (dx - cx)) / den,
          u = ((cx - ax) * (bz - az) - (cz - az) * (bx - ax)) / den;
        if (t < 0 || t > 1 || u < 0 || u > 1) continue;
        const si = sampled.s[i] + (sampled.s[i + 1] - sampled.s[i]) * t,
          sj = sampled.s[j] + (sampled.s[j + 1] - sampled.s[j]) * u,
          yi = height(si),
          yj = height(sj);
        crossings.push({
          lower: yi < yj ? si : sj,
          upper: yi < yj ? sj : si,
          x: ax + (bx - ax) * t,
          z: az + (bz - az) * t,
          clearance: Math.abs(yj - yi),
        });
      }
  return crossings.sort((p, q) => p.lower - q.lower);
}

/** Build a complete circuit definition from an authored spec. Every derived
 * quantity (lengths, corner stations, profiles) uses Track's own sampling, so
 * the simulation, renderer and menus agree to the metre. */
export function defineCircuit(spec: CircuitSpec): CatalogueCircuit {
  const { raw, adjustment } = resolve(spec);
  const dense = densify(spec, raw);
  const reverse = !!spec.reverse,
    D = dense.length;
  // Forward d -> travelled distance d' (reverse runs the loop backwards).
  const travel = (d: number) => (reverse ? mod(D - d, D) : d);
  /** Dense sample index of a forward authored distance. */
  const at = (d: number) => clamp(Math.round(d / (D / dense.count)), 0, dense.count);
  // Dense polyline in travel order.
  const ordered = {
    ...dense,
    x: new Float64Array(dense.count + 1),
    z: new Float64Array(dense.count + 1),
    radius: new Float64Array(dense.count + 1),
  };
  for (let i = 0; i <= dense.count; i++) {
    const j = reverse ? dense.count - i : i;
    ordered.x[i] = dense.x[j];
    ordered.z[i] = dense.z[j];
    ordered.radius[i] = dense.radius[j];
  }
  let { design, distance } = resample(ordered);
  // Scale to the reference length: Catmull-Rom length scales linearly.
  const authoredLength = controlPolygonLength(design);
  const scale = spec.length ? spec.length / authoredLength : 1;
  if (scale !== 1) design = design.map(([x, z]) => [x * scale, z * scale]);
  // Centre the venue on the world origin: terrain, sea and shadow maps are
  // built around it.
  const bx = [Infinity, -Infinity],
    bz = [Infinity, -Infinity];
  for (const [x, z] of design) {
    bx[0] = Math.min(bx[0], x);
    bx[1] = Math.max(bx[1], x);
    bz[0] = Math.min(bz[0], z);
    bz[1] = Math.max(bz[1], z);
  }
  const ox = Math.round((bx[0] + bx[1]) / 2),
    oz = Math.round((bz[0] + bz[1]) / 2);
  design = design.map(([x, z]) => [x - ox, z - oz]);
  const sampled = sampleControlPolygon(design),
    L = sampled.length,
    n = design.length;
  distance = distance.map((d) => d * scale);
  const Ds = D * scale;
  // Travel distance (scaled authored metres) at each Track sample, through t.
  const sampleD = new Float64Array(TRACK_SAMPLES + 1);
  for (let i = 0; i <= TRACK_SAMPLES; i++) {
    const t = (i / TRACK_SAMPLES) * n,
      k = Math.min(n - 1, Math.floor(t)),
      f = t - k,
      a = distance[k],
      b = k + 1 < n ? distance[k + 1] : Ds;
    sampleD[i] = a + (b - a) * f;
  }
  const monotone = (from: Float64Array, to: Float64Array, value: number) => {
    let lo = 0,
      hi = from.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (from[mid] <= value) lo = mid;
      else hi = mid;
    }
    const f = (value - from[lo]) / (from[hi] - from[lo] || 1);
    return to[lo] + (to[hi] - to[lo]) * clamp(f, 0, 1);
  };
  /** Lap distance s of a forward authored distance d (unscaled). */
  const lapS = (d: number) => monotone(sampleD, sampled.s, travel(d) * scale);
  /** Forward authored distance (unscaled) of lap distance s. */
  const authored = (s: number) => {
    const t = monotone(sampled.s, sampleD, mod(s, L)) / scale;
    return reverse ? mod(D - t, D) : t;
  };
  // ---- per-metre property tables over lap distance ----
  const bins = Math.max(64, Math.ceil(L)),
    bin = L / bins;
  // Forward authored dense index of every 1 m bin (one inverse map per bin).
  const binDense = new Int32Array(bins);
  for (let j = 0; j < bins; j++) binDense[j] = at(authored((j + 0.5) * bin));
  const elevation = new Float64Array(bins),
    width = new Float64Array(bins),
    bank = new Float64Array(bins);
  // Elevation knots at segment ends (forward authored distance), linearly
  // interpolated on the dense 1 m grid in one sweep.
  const knots: [number, number][] = [[0, spec.y0 ?? 0]];
  raw.forEach((r, k) => {
    if (r.seg.y !== undefined) knots.push([dense.ends[k], r.seg.y]);
  });
  if (knots.at(-1)![0] < D - 1e-6) knots.push([D, spec.y0 ?? 0]);
  const denseHeight = new Float64Array(dense.count + 1),
    denseStep = D / dense.count;
  for (let i = 0, k = 0; i <= dense.count; i++) {
    const d = i * denseStep;
    while (k < knots.length - 2 && knots[k + 1][0] <= d) k++;
    const [d0, y0] = knots[k],
      [d1, y1] = knots[k + 1];
    denseHeight[i] = y0 + (y1 - y0) * clamp((d - d0) / (d1 - d0 || 1), 0, 1);
  }
  const crossFall = spec.crossFall ?? 0.012;
  // Per segment: width and signed slope (positive raises the right edge, the
  // outside of a left turn; reverse travel mirrors the hand of every corner).
  const segmentWidth = raw.map((r) => r.seg.w ?? spec.halfWidth),
    segmentBank = raw.map((r) => {
      const hand = (r.hand || 1) * (reverse ? -1 : 1);
      return r.seg.bank !== undefined ? hand * Math.tan(r.seg.bank * DEG) : hand * crossFall;
    });
  for (let j = 0; j < bins; j++) {
    const i = binDense[j],
      k = dense.segment[i];
    elevation[j] = denseHeight[i];
    width[j] = segmentWidth[k];
    bank[j] = segmentBank[k];
  }
  const smoothBins = (m: number) => Math.max(0, Math.round(m / bin));
  const E = smoothPeriodic(elevation, smoothBins(spec.elevationSmoothing ?? 60)),
    W = smoothPeriodic(width, smoothBins(30)),
    B = smoothPeriodic(bank, smoothBins(spec.bankSmoothing ?? 35));
  let maxBank = 1e-6;
  for (let j = 0; j < bins; j++) maxBank = Math.max(maxBank, Math.abs(B[j]) + 1e-6);
  // ---- categorical per-side tables at 2 m ----
  const cell = 2,
    cells = Math.ceil(L / cell);
  const runoff = [new Uint8Array(cells), new Uint8Array(cells)],
    barrierOffset = [new Float64Array(cells), new Float64Array(cells)],
    barrierKind = [new Uint8Array(cells), new Uint8Array(cells)],
    covered = new Uint8Array(cells),
    facades = [new Uint8Array(cells), new Uint8Array(cells)],
    rock = [new Uint8Array(cells), new Uint8Array(cells)],
    drops = [new Uint8Array(cells), new Uint8Array(cells)],
    stands = [new Uint8Array(cells), new Uint8Array(cells)];
  const defaults = {
    straight: spec.runoff?.straight ?? 'grass',
    outside: spec.runoff?.outside ?? 'gravel',
    inside: spec.runoff?.inside ?? 'grass',
  };
  // Resolve every segment's per-side properties once, indexed by the side of
  // TRAVEL (reversing swaps left and right).
  const perSegment = raw.map((r) => {
    const seg = r.seg,
      sides = [0, 1].map(() => ({ runoff: 0, offset: 0, kind: 0, flags: 0 }));
    for (const side of [-1, 1] as const) {
      // Default run-off by geometry (gravel outside corners under 300 m).
      let kind: RunoffKind =
        r.kind === 'arc' && r.radius < 300
          ? sidesOf('out', r.hand).includes(side)
            ? defaults.outside
            : defaults.inside
          : defaults.straight;
      if (typeof seg.runoff === 'string') kind = seg.runoff;
      else if (seg.runoff)
        for (const [key, value] of Object.entries(seg.runoff) as [SideSpec, RunoffKind][])
          if (value && sidesOf(key, r.hand).includes(side)) kind = value;
      let offset = spec.barrier.offset,
        barrier: BarrierKind = spec.barrier.kind;
      const authoredBarriers = seg.barrier
        ? Array.isArray(seg.barrier)
          ? (seg.barrier as readonly BarrierSpec[])
          : [seg.barrier as BarrierSpec]
        : [];
      for (const b of authoredBarriers)
        if (sidesOf(b.side ?? 'both', r.hand).includes(side)) {
          offset = b.offset ?? offset;
          barrier = b.kind ?? barrier;
        }
      const travelSide = reverse ? -side : side,
        out = sides[travelSide > 0 ? 1 : 0];
      out.runoff = RUNOFF_CODE[kind];
      out.offset = offset;
      out.kind = BARRIER_CODE[barrier];
      out.flags =
        (sidesOf(seg.facades, r.hand).includes(side) ? 1 : 0) |
        (sidesOf(seg.rock, r.hand).includes(side) ? 2 : 0) |
        (sidesOf(seg.drop, r.hand).includes(side) ? 4 : 0) |
        (sidesOf(seg.stands, r.hand).includes(side) ? 8 : 0);
    }
    return { sides, tunnel: !!seg.tunnel };
  });
  for (let c = 0; c < cells; c++) {
    const j = Math.min(bins - 1, Math.floor(((c + 0.5) * cell) / bin)),
      props = perSegment[dense.segment[binDense[j]]];
    for (let p = 0; p < 2; p++) {
      const side = props.sides[p];
      runoff[p][c] = side.runoff;
      barrierOffset[p][c] = side.offset;
      barrierKind[p][c] = side.kind;
      if (side.flags & 1) facades[p][c] = 1;
      if (side.flags & 2) rock[p][c] = 1;
      if (side.flags & 4) drops[p][c] = 1;
      if (side.flags & 8) stands[p][c] = 1;
    }
    if (props.tunnel) covered[c] = 1;
  }
  // Walls close in gradually (30 m per 9 m of offset), never as a step.
  for (const table of barrierOffset)
    for (let pass = 0; pass < 2; pass++) {
      for (let k = 1; k < 2 * cells; k++)
        table[k % cells] = Math.min(table[k % cells], table[(k - 1) % cells] + 0.6);
      for (let k = 2 * cells - 2; k >= 0; k--)
        table[k % cells] = Math.min(table[k % cells], table[(k + 1) % cells] + 0.6);
    }
  const cellOf = (s: number) => Math.min(cells - 1, Math.floor(mod(s, L) / cell));
  // ---- named features in lap distance ----
  const corners: { s: number; name: string }[] = [];
  raw.forEach((r, k) => {
    if (r.kind === 'arc' && r.seg.name)
      corners.push({ s: lapS((dense.starts[k] + dense.ends[k]) / 2), name: r.seg.name });
  });
  corners.sort((a, b) => a.s - b.s);
  // DRS: consecutive flagged segments (around the loop) form one straight.
  const drsZones: DrsZone[] = [];
  const flagged = raw.map((r) => !!r.seg.drs);
  if (flagged.some(Boolean) && !flagged.every(Boolean)) {
    const startIndex = flagged.findIndex((f) => !f);
    for (let k = 1; k <= raw.length; k++) {
      const i = (startIndex + k) % raw.length;
      if (!flagged[i] || flagged[mod(i - 1, raw.length)]) continue;
      let j = i;
      while (flagged[(j + 1) % raw.length]) j = (j + 1) % raw.length;
      // Forward authored range [starts[i], ends[j]] (may wrap).
      const a = lapS(dense.starts[i]),
        b = lapS(mod(dense.ends[j], D) || (reverse ? 0 : D));
      const from = reverse ? b : a,
        to = reverse ? a : b,
        span = mod(to - from, L) || L;
      if (span < 300) continue;
      drsZones.push({
        detect: mod(from - 260, L),
        start: mod(from + 40, L),
        end: mod(to - 90, L),
      });
    }
  }
  const segmentSpans = (flags: Uint8Array[]) =>
    flags.flatMap((table, p) =>
      spans(table, cell, L).map((span) => ({ ...span, side: (p ? 1 : -1) as 1 | -1 })),
    );
  const barrierSpans: BarrierSpan[] = [];
  for (const p of [0, 1]) {
    const table = barrierKind[p];
    let start = 0;
    for (let c = 1; c <= cells; c++)
      if (c === cells || table[c] !== table[start]) {
        barrierSpans.push({
          from: start * cell,
          to: Math.min(L, c * cell),
          side: p ? 1 : -1,
          kind: BARRIER_NAMES[table[start]],
        });
        start = c;
      }
  }
  const standSpans = segmentSpans(stands).map((span) => ({
    ...span,
    length: clamp(mod(span.to - span.from, L) * 0.8, 30, 110),
  }));
  // ---- road crossings (stacked layers) ----
  const crossings = findCrossings(sampled, (s) => lookup(E, s / L - 0.5 / bins), L);
  const meta: CatalogueMeta = Object.freeze({
    group: spec.group,
    venue: spec.venue,
    venueName: spec.venueName,
    layout: spec.layout,
    description: spec.description,
    length: L,
    theme: spec.theme,
    night: !!spec.night,
    ...(spec.referenceLength ? { referenceLength: spec.referenceLength } : {}),
    ...(spec.variantOf ? { variantOf: spec.variantOf } : {}),
    seaLevel: spec.seaLevel ?? null,
    dressing: Object.freeze({
      barriers: Object.freeze(barrierSpans),
      tunnels: Object.freeze(spans(covered, cell, L) as LapSpan[]),
      facades: Object.freeze(segmentSpans(facades) as VenueSpan[]),
      rock: Object.freeze(segmentSpans(rock) as VenueSpan[]),
      drops: Object.freeze(segmentSpans(drops) as VenueSpan[]),
      stands: Object.freeze(standSpans),
      crossings: Object.freeze(crossings),
    }),
    authoring: Object.freeze({
      authoredLength: D,
      scale,
      closureAdjustment: adjustment,
      controlPoints: n,
    }),
  });
  const runoffCodes = runoff,
    offsets = barrierOffset;
  return Object.freeze({
    id: spec.id,
    name: spec.name,
    short: spec.short,
    design: Object.freeze(design.map((p) => Object.freeze(p) as readonly [number, number])),
    elevation: (u: number, flat: boolean) => (flat ? 0 : lookup(E, u - 0.5 / bins)),
    gradient: (u: number, length: number, flat: boolean) => {
      if (flat) return 0;
      const du = 1 / bins;
      return (lookup(E, u - 0.5 / bins + du) - lookup(E, u - 0.5 / bins - du)) / (2 * du) / length;
    },
    halfWidth: (u: number) => lookup(W, u - 0.5 / bins),
    bankGain: () => 0,
    crossFall: (u: number, flat: boolean) => (flat ? 0 : lookup(B, u - 0.5 / bins)),
    maxBank,
    corners: Object.freeze(corners),
    drsZones: Object.freeze(drsZones),
    pit: Object.freeze({ ...spec.pit }),
    runoff: (s: number, side: number) => runoffCodes[side > 0 ? 1 : 0][cellOf(s)] as RunoffCode,
    barrier: (s: number, side: number) => offsets[side > 0 ? 1 : 0][cellOf(s)],
    covered: (s: number) => covered[cellOf(s)] === 1,
    catalogue: meta,
  }) as CatalogueCircuit;
}
