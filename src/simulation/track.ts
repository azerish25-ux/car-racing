import { racingLineFor } from './racing-line.ts';
import { TrackContactMesh, kerbHeight } from './contact.ts';
import { surfaceDrainageRate } from './surface-drainage.ts';
import { surfaceMaterial } from './surface-material.ts';
import { clamp, lerp, mod, smooth, Vec3 } from '../core/math.ts';
import type { WeatherPreset } from './config.ts';
import {
  WeatherTimeline,
  weatherKeyframes,
  advanceWater,
  type WeatherKeyframe,
} from './weather.ts';
import { AUREL, STANDARD_PIT, type CircuitDefinition, type PitLaneDefinition } from './circuits.ts';
import { RUNOFF } from './circuit-catalogue/venue-data.ts';
export const TRACK_NAME = AUREL.name,
  CELL_ROWS = 512,
  CELL_COLS = 7;
// Coverage-index conversion shared by tire pickup and road-cell depletion.
export const MARBLE_CELL_CAPACITY = 100;
/** Vertical separation (m) beyond which a centreline belongs to another road
 * layer (overpass/underpass). A car is at most ~1.5 m above its road. */
export const ROUTE_LAYER_GAP = 4;
export const SURFACE = { ASPHALT: 0, PAINT: 1, KERB: 2, GRASS: 3, GRAVEL: 4, PIT: 5 } as const;
export interface TrackPoint {
  s: number;
  x: number;
  y: number;
  z: number;
  tx: number;
  tz: number;
  nx: number;
  nz: number;
  curvature: number;
  width: number;
  bank: number;
  gradient: number;
}
export interface SurfaceSample {
  s: number;
  width: number;
  lateral: number;
  height: number;
  normal: Vec3;
  surface: number;
  water: number;
  rubber: number;
  marbles: number;
  temp: number;
  grip: number;
  resistance: number;
  cell: number;
  pit: boolean;
}
export const trackPoint = (): TrackPoint => ({
  s: 0,
  x: 0,
  y: 0,
  z: 0,
  tx: 0,
  tz: 1,
  nx: 1,
  nz: 0,
  curvature: 0,
  width: 8,
  bank: 0,
  gradient: 0,
});
export const surfaceSample = (): SurfaceSample => ({
  s: 0,
  width: 8,
  lateral: 0,
  height: 0,
  normal: new Vec3(0, 1, 0),
  surface: 0,
  water: 0,
  rubber: 0,
  marbles: 0,
  temp: 32,
  grip: 1,
  resistance: 0.015,
  cell: 0,
  pit: false,
});
const catmull = (a: number, b: number, c: number, d: number, t: number) =>
  0.5 *
  (2 * b +
    (-a + c) * t +
    (2 * a - 5 * b + 4 * c - d) * t * t +
    (-a + 3 * b - 3 * c + d) * t * t * t);
/** Analytic ribbon collision surface, accelerated by a uniform spatial hash.
 * Rendering consumes these same samples and kerb elevations. */
export class Track {
  readonly points: TrackPoint[] = [];
  readonly water = new Float32Array(CELL_ROWS * CELL_COLS);
  readonly rubber = new Float32Array(CELL_ROWS * CELL_COLS);
  readonly marbles = new Float32Array(CELL_ROWS * CELL_COLS);
  readonly temperature = new Float32Array(CELL_ROWS * CELL_COLS);
  readonly drainage = new Float32Array(CELL_ROWS * CELL_COLS);
  readonly hash = new Map<string, number[]>();
  readonly length: number;
  /** Venue pit lane/grid data (WP10). */
  readonly pit: PitLaneDefinition;
  /** Water-grid rows under a roof (tunnels): 1 where rain cannot fall. */
  readonly sheltered = new Uint8Array(CELL_ROWS);
  private contactMesh: TrackContactMesh | null = null;
  cast(origin: Vec3, down: Vec3, maximum: number, out: SurfaceSample) {
    // Long laps keep the standard ~0.9 m row spacing of the contact ribbon.
    this.contactMesh ??= new TrackContactMesh(
      this,
      this.circuit.samples ? Math.max(8192, Math.ceil(this.length / 0.9)) : undefined,
    );
    return this.contactMesh.cast(origin, down, maximum, out);
  }
  private queryPoint = trackPoint();
  readonly weather: WeatherTimeline;
  rain = 0;
  cloud = 0.12;
  ambient = 24;
  windX = 1.5;
  windZ = 0.6;
  surfaceClock = 0;
  constructor(
    readonly preset: WeatherPreset = 'clear',
    readonly flat = false,
    keyframes: readonly WeatherKeyframe[] = weatherKeyframes(preset),
    readonly circuit: CircuitDefinition = AUREL,
  ) {
    const DESIGN = circuit.design;
    this.pit = circuit.pit ?? STANDARD_PIT;
    this.weather = new WeatherTimeline(keyframes);
    this.weather.sample(0, this);
    const count = circuit.samples ?? 1536;
    let distance = 0;
    for (let i = 0; i <= count; i++) {
      const t = (i / count) * DESIGN.length,
        k = Math.floor(t),
        f = t - k,
        n = DESIGN.length;
      const a = DESIGN[mod(k - 1, n)],
        b = DESIGN[mod(k, n)],
        c = DESIGN[mod(k + 1, n)],
        d = DESIGN[mod(k + 2, n)];
      const p = trackPoint();
      p.x = catmull(a[0], b[0], c[0], d[0], f);
      p.z = catmull(a[1], b[1], c[1], d[1], f);
      if (i) distance += Math.hypot(p.x - this.points[i - 1].x, p.z - this.points[i - 1].z);
      p.s = distance;
      this.points.push(p);
    }
    this.length = distance;
    for (let i = 0; i < count; i++) {
      const p = this.points[i],
        prev = this.points[mod(i - 1, count)],
        next = this.points[(i + 1) % count];
      const len = Math.hypot(next.x - prev.x, next.z - prev.z);
      p.tx = (next.x - prev.x) / len;
      p.tz = (next.z - prev.z) / len;
      p.nx = p.tz;
      p.nz = -p.tx;
      const u = p.s / this.length;
      p.y = circuit.elevation(u, flat);
      if (circuit.gradient) p.gradient = circuit.gradient(u, this.length, flat);
      else {
        // Central difference over ±1 m of lap distance.
        const du = 1 / this.length;
        p.gradient = (circuit.elevation(u + du, flat) - circuit.elevation(u - du, flat)) / 2;
      }
      p.bank = circuit.crossFall(u, flat);
      p.width = circuit.halfWidth(u);
      const hx = Math.floor(p.x / 32),
        hz = Math.floor(p.z / 32);
      for (let dx = -1; dx <= 1; dx++)
        for (let dz = -1; dz <= 1; dz++) {
          const key = `${hx + dx},${hz + dz}`,
            list = this.hash.get(key);
          if (list) list.push(i);
          else this.hash.set(key, [i]);
        }
    }
    for (let i = 0; i < count; i++) {
      const prev = this.points[mod(i - 2, count)],
        next = this.points[(i + 2) % count],
        p = this.points[i];
      const ds = mod(next.s - prev.s, this.length) || 1;
      p.curvature =
        Math.atan2(prev.tz * next.tx - prev.tx * next.tz, prev.tx * next.tx + prev.tz * next.tz) /
        ds;
    }
    // Authored banking: raise the outside of corners in circuit-defined zones.
    // Curvature is smoothed over ±12 samples first so banking cannot chatter.
    if (!flat) {
      const smoothed = new Float64Array(count);
      for (let i = 0; i < count; i++) {
        let sum = 0;
        for (let k = -12; k <= 12; k++) sum += this.points[mod(i + k, count)].curvature;
        smoothed[i] = sum / 25;
      }
      for (let i = 0; i < count; i++) {
        const p = this.points[i],
          gain = circuit.bankGain(p.s / this.length);
        if (gain > 0)
          p.bank = clamp(
            p.bank - gain * smoothed[i],
            -circuit.maxBank,
            circuit.maxBank,
          );
      }
    }
    Object.assign(this.points[count], this.points[0], { s: this.length });
    const drainagePoint = trackPoint();
    for (let row = 0; row < CELL_ROWS; row++) {
      const s = ((row + 0.5) / CELL_ROWS) * this.length;
      this.at(s, drainagePoint);
      for (let col = 0; col < CELL_COLS; col++) {
        const cell = row * CELL_COLS + col;
        this.drainage[cell] = surfaceDrainageRate(
          s,
          this.length,
          drainagePoint.bank,
          drainagePoint.curvature,
          col,
        );
      }
    }
    // Race-day rubber was laid by earlier sessions where cars drive: along the
    // racing line (a band about a car wide), over a light general coating.
    if (circuit.covered)
      for (let row = 0; row < CELL_ROWS; row++)
        this.sheltered[row] = circuit.covered(((row + 0.5) / CELL_ROWS) * this.length) ? 1 : 0;
    const line = racingLineFor(this),
      rowPoint = trackPoint();
    for (let i = 0; i < this.water.length; i++) {
      this.temperature[i] = preset === 'rain' ? 22 : 34;
      this.water[i] =
        preset === 'rain' && !this.sheltered[Math.floor(i / CELL_COLS)]
          ? 0.7 + 0.35 * (0.5 + 0.5 * Math.sin(i * 0.27))
          : 0;
      const row = Math.floor(i / CELL_COLS),
        col = i % CELL_COLS,
        s = ((row + 0.5) / CELL_ROWS) * this.length;
      this.at(s, rowPoint);
      const lateral = (((col + 0.5) / CELL_COLS) * 2 - 1) * rowPoint.width;
      const fromLine = (lateral - line.offsetAt(s)) / 1.8;
      this.rubber[i] = 0.035 + 0.415 * Math.exp(-0.5 * fromLine * fromLine);
    }
  }
  at(s: number, out: TrackPoint): TrackPoint {
    s = mod(s, this.length);
    let lo = 0,
      hi = this.points.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.points[mid].s <= s) lo = mid;
      else hi = mid;
    }
    const a = this.points[lo],
      b = this.points[hi],
      t = (s - a.s) / (b.s - a.s || 1);
    out.s = s;
    out.x = lerp(a.x, b.x, t);
    out.y = lerp(a.y, b.y, t);
    out.z = lerp(a.z, b.z, t);
    out.tx = lerp(a.tx, b.tx, t);
    out.tz = lerp(a.tz, b.tz, t);
    const len = Math.hypot(out.tx, out.tz);
    out.tx /= len;
    out.tz /= len;
    out.nx = out.tz;
    out.nz = -out.tx;
    out.width = lerp(a.width, b.width, t);
    out.bank = lerp(a.bank, b.bank, t);
    out.gradient = lerp(a.gradient, b.gradient, t);
    out.curvature = lerp(a.curvature, b.curvature, t);
    return out;
  }
  /** Nearest centreline station. With a height `y` (WP11 / F05) a segment
   * more than ROUTE_LAYER_GAP above or below is a different road layer: it is
   * used only when no segment of the queried layer is a candidate, so driving
   * across or beneath a bridge keeps the road it is actually on. Without
   * stacked roads every candidate is in-layer and the result is unchanged. */
  nearest(x: number, z: number, out: TrackPoint, y?: number): number {
    const candidates = this.hash.get(`${Math.floor(x / 32)},${Math.floor(z / 32)}`);
    let best = Infinity,
      bestS = 0,
      other = Infinity,
      otherS = 0;
    const layered = y !== undefined && Number.isFinite(y);
    const scan = (i: number) => {
      const a = this.points[i],
        b = this.points[i + 1],
        dx = b.x - a.x,
        dz = b.z - a.z,
        t = clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz), 0, 1),
        d = (x - a.x - dx * t) ** 2 + (z - a.z - dz * t) ** 2;
      if (
        layered &&
        Math.abs((y as number) - lerp(a.y, b.y, t)) > ROUTE_LAYER_GAP &&
        // A steeply banked road (oval) is one layer across its whole width.
        Math.abs(
          (y as number) -
            lerp(a.y, b.y, t) -
            lerp(a.bank, b.bank, t) *
              clamp(((x - a.x) * dz - (z - a.z) * dx) / (Math.sqrt(dx * dx + dz * dz) || 1), -12, 12),
        ) > ROUTE_LAYER_GAP
      ) {
        if (d < other) {
          other = d;
          otherS = lerp(a.s, b.s, t);
        }
        return;
      }
      if (d < best) {
        best = d;
        bestS = lerp(a.s, b.s, t);
      }
    };
    if (candidates) {
      for (const i of candidates) scan(i);
    } else for (let i = 0; i < this.points.length - 1; i++) scan(i);
    if (best === Infinity && other < Infinity) bestS = otherS;
    this.at(bestS, out);
    return (x - out.x) * out.nx + (z - out.z) * out.nz;
  }
  /** Signed lateral position of the pit-lane centre (0 away from the lane). */
  pitOffset(s: number) {
    const p = this.pit;
    s = mod(s, this.length);
    let unsigned = 0;
    if (s > this.length - p.divergeStart)
      unsigned = p.offset * smooth(this.length - p.divergeStart, this.length - p.divergeEnd, s);
    else if (s < p.mergeStart) unsigned = p.offset;
    else if (s < p.mergeEnd) unsigned = p.offset * (1 - smooth(p.mergeStart, p.mergeEnd, s));
    return p.side * unsigned;
  }
  /** Lateral distance from the centreline toward the pit side (positive on it). */
  pitSideLateral(lateral: number) {
    return this.pit.side * lateral;
  }
  boundary(s: number, side: number) {
    return this.boundaryAt(this.at(s, trackPoint()), side);
  }
  /** Barrier distance at an already-resolved track point (no allocation). */
  boundaryAt(p: TrackPoint, side: number) {
    const wall = p.width + (this.circuit.barrier ? this.circuit.barrier(p.s, side < 0 ? -1 : 1) : 11);
    return side !== this.pit.side ? wall : Math.max(wall, Math.abs(this.pitOffset(p.s)) + 5);
  }
  /** Run-off surface beyond the paint band at a resolved station (shared by
   * contact and rendering): authored per venue, else gravel on the outside of
   * tighter corners and grass elsewhere. */
  runoffSurface(p: TrackPoint, lateral: number): number {
    const authored = this.circuit.runoff;
    if (!authored) return p.curvature * lateral < -0.009 ? SURFACE.GRAVEL : SURFACE.GRASS;
    const code = authored(p.s, lateral < 0 ? -1 : 1);
    return code === RUNOFF.GRAVEL
      ? SURFACE.GRAVEL
      : code === RUNOFF.ASPHALT
        ? SURFACE.ASPHALT
        : SURFACE.GRASS;
  }
  /** Is lap distance `s` under a roof (tunnel)? Weather and rendering read it. */
  isCovered(s: number) {
    return this.circuit.covered?.(mod(s, this.length)) ?? false;
  }
  isPitSection(s: number) {
    return s > this.length - this.pit.sectionBefore || s < this.pit.sectionAfter;
  }
  /** Pit-lane speed-limited zone (lap metres, wraps through the line). */
  pitSpeedZone(s: number) {
    const station = mod(s, this.length);
    return station > this.length - this.pit.limitBefore || station < this.pit.limitAfter;
  }
  /** Lap distance of car `id`'s garage box. */
  boxS(id: number) {
    return this.pit.firstBox + id * this.pit.boxSpacing;
  }
  /** Signed lateral of the garage boxes. */
  boxLateral() {
    return this.pit.side * this.pit.boxLateral;
  }
  /** Lap distance where the pit-entry commitment line is crossed. */
  pitEntryS() {
    return this.length - this.pit.entry;
  }
  /** Is a pit lane with service at `s` and lateral `l`? (shared by contact and render). */
  inPitLane(s: number, l: number) {
    const offset = this.pitOffset(s);
    return this.isPitSection(s) && Math.abs(offset) > 3 && Math.abs(l - offset) < 3.6;
  }
  sample(x: number, z: number, out: SurfaceSample, y?: number): SurfaceSample {
    const p = this.queryPoint,
      l = this.nearest(x, z, p, y),
      a = Math.abs(l),
      pit = this.inPitLane(p.s, l);
    let surface: number = SURFACE.ASPHALT,
      grip = 1,
      resistance = 0.015,
      kerb = 0;
    if (pit) surface = SURFACE.PIT;
    else if (a > p.width + 4) {
      surface = this.runoffSurface(p, l);
      // Grass and gravel friction and rigid rolling resistance come from the
      // material table; the tyre adds compaction work from its sinkage
      // (surface-material.ts). Asphalt run-off: dusty, unrubbered tarmac.
      if (surface === SURFACE.GRAVEL || surface === SURFACE.GRASS) {
        grip = surfaceMaterial(surface).grip;
        resistance = surfaceMaterial(surface).rolling;
      } else {
        grip = 0.9;
        resistance = 0.017;
      }
    } else if (a > p.width + 1.1) {
      surface = SURFACE.PAINT;
      grip = 0.93;
    } else if (a > p.width) {
      surface = SURFACE.KERB;
      grip = 0.91;
      kerb = kerbHeight(p.s, a - p.width);
    } else if (a > p.width - 0.18) {
      surface = SURFACE.PAINT;
      grip = 0.94;
    }
    const row = Math.min(CELL_ROWS - 1, Math.floor((p.s / this.length) * CELL_ROWS)),
      col = clamp(Math.floor(((l / p.width) * 0.5 + 0.5) * CELL_COLS), 0, CELL_COLS - 1),
      cell = row * CELL_COLS + col;
    out.s = p.s;
    out.lateral = l;
    out.width = p.width;
    out.height = p.y + p.bank * clamp(l, -12, 12) + kerb;
    out.pit = pit;
    out.normal
      .set(-p.tx * p.gradient - p.nx * p.bank, 1, -p.tz * p.gradient - p.nz * p.bank)
      .normalize();
    out.surface = surface;
    out.grip = grip;
    out.resistance = resistance;
    out.cell = cell;
    out.water = this.water[cell];
    const onRoad =
      surface === SURFACE.ASPHALT || surface === SURFACE.PAINT || surface === SURFACE.KERB;
    out.rubber = onRoad ? this.rubber[cell] : 0;
    out.marbles = onRoad ? this.marbles[cell] : 0;
    out.temp = this.temperature[cell];
    return out;
  }
  evolve(dt: number, time: number) {
    if (!Number.isFinite(dt) || dt <= 0) throw new Error('Invalid weather timestep');
    this.weather.sample(time, this);
    this.surfaceClock += dt;
    if (this.surfaceClock < 0.5) return;
    const step = this.surfaceClock;
    this.surfaceClock = 0;
    for (let r = 0; r < CELL_ROWS; r++)
      for (let c = 0; c < CELL_COLS; c++) {
        const i = r * CELL_COLS + c,
          depression = 0.65 + 0.35 * Math.sin(r * 0.113 + c * 0.4) ** 2,
          rainfall = this.sheltered[r] ? 0 : (this.rain / 3600) * depression,
          drainage = this.drainage[i],
          evaporation = (1 - this.cloud) * 0.0006;
        this.water[i] = advanceWater(this.water[i], rainfall - evaporation, drainage, step);
        this.rubber[i] = Math.max(0, this.rubber[i] - this.rain * 0.000001 * step);
        const target = this.ambient + 14 * (1 - this.cloud);
        this.temperature[i] += (target - this.temperature[i]) * -Math.expm1(-0.015 * step);
      }
  }
  interact(
    cell: number,
    load: number,
    energy: number,
    speed: number,
    dt: number,
    surface: number = SURFACE.ASPHALT,
    pickup = 0,
  ) {
    if (
      load <= 1 ||
      (surface !== SURFACE.ASPHALT && surface !== SURFACE.PAINT && surface !== SURFACE.KERB)
    )
      return;
    // Do not manufacture rubber at a stationary loaded contact or deposit it in
    // the road's clamped edge cell when the actual wheel is in grass or pits.
    const movingLoad = load * Math.min(1, Math.abs(speed));
    this.rubber[cell] = Math.min(1, this.rubber[cell] + (movingLoad * 1e-9 + energy * 8e-10) * dt);
    this.water[cell] = Math.max(0, this.water[cell] - Math.abs(speed) * 0.00025 * dt);
    this.marbles[cell] = Math.max(
      0,
      this.marbles[cell] - Math.max(0, pickup) / MARBLE_CELL_CAPACITY,
    );
    const c = cell % CELL_COLS,
      edge = cell - c + (c < 3 ? 0 : 6);
    this.marbles[edge] = Math.min(1, this.marbles[edge] + energy * 2e-9 * dt);
  }
  meanWater() {
    let total = 0;
    for (const w of this.water) total += w;
    return total / this.water.length;
  }
}
