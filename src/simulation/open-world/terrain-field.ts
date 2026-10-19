import { fbm, ridged, smoothstep, subSeed, valueNoise } from './noise.ts';
import type { FlatSpec, RegionDefinition } from './region-data.ts';

/** Ground classes of the natural terrain (before roads are carved in). */
export const BIOME = Object.freeze({
  SEA: 0,
  BEACH: 1,
  MEADOW: 2,
  FARMLAND: 3,
  FOREST: 4,
  ROCK: 5,
  SNOW: 6,
  TOWN: 7,
  AIRFIELD: 8,
  RIVER: 9,
} as const);
export type Biome = (typeof BIOME)[keyof typeof BIOME];

/** Polyline as flat arrays: ax, az, bx, bz, ha, hb per segment. */
function packSegments(points: readonly (readonly number[])[]) {
  const n = points.length - 1,
    out = new Float64Array(n * 6);
  for (let i = 0; i < n; i++) {
    out[i * 6] = points[i][0];
    out[i * 6 + 1] = points[i][1];
    out[i * 6 + 2] = points[i + 1][0];
    out[i * 6 + 3] = points[i + 1][1];
    out[i * 6 + 4] = points[i][2] ?? 0;
    out[i * 6 + 5] = points[i + 1][2] ?? 0;
  }
  return out;
}

/** The valley at a point (a reused object: copy what you keep). */
export interface ValleySample {
  distance: number;
  floor: number;
  /** Weight pulling the ground toward the valley floor (0..1). */
  weight: number;
  /** River water surface (m). */
  water: number;
  /** Inside the river channel. */
  channel: boolean;
}

/** Natural terrain of a region: deterministic from the region seed and its
 * authored control features (coast, peaks, valley, flats, forests). Roads are
 * carved into it separately (terrain-tiles.ts), so this function never depends
 * on the road network and can be evaluated anywhere, in any thread. The hot
 * paths allocate nothing. */
export class TerrainField {
  private readonly coast: Float64Array;
  private readonly valley: Float64Array;
  private readonly seeds: Record<
    'coast' | 'hills' | 'detail' | 'micro' | 'ridge' | 'forest' | 'farm' | 'horizon',
    number
  >;
  /** Resolved plane heights of the flats (NaN in the data = natural mean). */
  readonly flatHeights: readonly number[];
  private readonly valleySample: ValleySample = {
    distance: 0,
    floor: 0,
    weight: 0,
    water: 0,
    channel: false,
  };
  private closestDistance = 0;
  private closestValue = 0;
  constructor(readonly region: RegionDefinition) {
    this.coast = packSegments(region.coast);
    this.valley = packSegments(region.valley.points);
    const s = region.seed;
    this.seeds = {
      coast: subSeed(s, 1),
      hills: subSeed(s, 2),
      detail: subSeed(s, 3),
      micro: subSeed(s, 4),
      ridge: subSeed(s, 5),
      forest: subSeed(s, 6),
      farm: subSeed(s, 7),
      horizon: subSeed(s, 8),
    };
    // A flat with no authored height sits at the mean of the ground it replaces.
    this.flatHeights = region.flats.map((f) => {
      if (Number.isFinite(f.height)) return f.height;
      let sum = 0,
        n = 0;
      for (let i = 0; i <= 8; i++)
        for (let j = 0; j <= 8; j++) {
          const x = f.x0 + ((f.x1 - f.x0) * i) / 8,
            z = f.z0 + ((f.z1 - f.z0) * j) / 8;
          sum += this.valleyPull(x, z, this.unflattened(x, z, 0, this.coastDistance(x, z)));
          n++;
        }
      return Math.round((sum / n) * 10) / 10;
    });
  }
  /** Closest point of a packed polyline (results in closestDistance/Value). */
  private closest(list: Float64Array, x: number, z: number) {
    let best = Infinity,
      value = 0;
    for (let i = 0; i < list.length; i += 6) {
      const ax = list[i],
        az = list[i + 1],
        dx = list[i + 2] - ax,
        dz = list[i + 3] - az,
        t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz))),
        ex = x - ax - dx * t,
        ez = z - az - dz * t,
        d = ex * ex + ez * ez;
      if (d < best) {
        best = d;
        value = list[i + 4] + (list[i + 5] - list[i + 4]) * t;
      }
    }
    this.closestDistance = Math.sqrt(best);
    this.closestValue = value;
  }
  /** Signed horizontal distance to the coastline (m): positive inland. */
  coastDistance(x: number, z: number, minWavelength = 0) {
    const c = this.coast;
    // The coast is x-monotonic: the sign comes from the coast's z at this x.
    let coastZ = c[1];
    for (let i = 0; i < c.length; i += 6)
      if (x >= c[i] && x <= c[i + 2]) {
        coastZ = c[i + 1] + ((c[i + 3] - c[i + 1]) * (x - c[i])) / (c[i + 2] - c[i]);
        break;
      }
    this.closest(c, x, z);
    // Coves and headlands: a low-frequency wiggle of the shore.
    const wiggle = minWavelength < 400 ? 70 * fbm(x / 650, z / 650, this.seeds.coast, 3) : 0;
    return (z >= coastZ ? this.closestDistance : -this.closestDistance) + wiggle;
  }
  /** Mask of an axis-aligned flat with a smooth blend band. */
  private flatMask(f: FlatSpec, x: number, z: number) {
    const dx = Math.max(f.x0 - x, 0, x - f.x1),
      dz = Math.max(f.z0 - z, 0, z - f.z1);
    if (dx > f.blend || dz > f.blend) return 0;
    return 1 - smoothstep(0, f.blend, Math.sqrt(dx * dx + dz * dz));
  }
  /** Valley influence at (x, z). Returns a reused object. */
  valleyAt(x: number, z: number): ValleySample {
    const v = this.region.valley,
      out = this.valleySample;
    this.closest(this.valley, x, z);
    out.distance = this.closestDistance;
    out.floor = this.closestValue;
    out.weight = Math.exp(-((out.distance / v.width) ** 2));
    out.water = out.floor - 0.9;
    out.channel = out.distance < v.channel;
    return out;
  }
  /** Terrain before flats, valley channel and the sea (natural uplands). */
  private unflattened(x: number, z: number, minWavelength: number, d: number) {
    const inland = Math.max(0, d);
    // Gentle regional rise away from the sea, then rolling hills.
    let h = 14 + 0.026 * Math.min(inland, 5200);
    const hills = fbm(x / 1500, z / 1500, this.seeds.hills, 4) * 0.5 + 0.5;
    // A coastal plain: the hills grow inland.
    h += 58 * hills ** 1.4 * (0.3 + 0.7 * smoothstep(150, 2600, inland));
    if (minWavelength < 250) h += 7 * fbm(x / 240, z / 240, this.seeds.detail, 3);
    // Massifs: a bell profile with ridged relief that fades toward the foot.
    const peaks = this.region.peaks;
    for (let k = 0; k < peaks.length; k++) {
      const p = peaks[k],
        r = Math.hypot(x - p.x, z - p.z) / p.radius;
      if (r >= 1) continue;
      const t = 1 - r,
        bell = t * t * (3 - 2 * t);
      const relief = minWavelength < 300 ? ridged(x / 820, z / 820, this.seeds.ridge + k, 4) : 0.5;
      h += p.height * (bell ** 1.25 * (1 - p.ridge) + p.ridge * relief * bell);
    }
    // Distant ranges beyond the drivable region (horizon only).
    const edge = Math.max(Math.abs(x), z) - this.region.half;
    if (edge > -400) {
      const rise = smoothstep(-400, 2600, edge);
      h += rise * (180 + 420 * ridged(x / 1900, z / 1900, this.seeds.horizon, 3));
    }
    return h;
  }
  /** Ashvale: the valley pulls the ground down toward its floor (leaves the
   * valley sample of (x, z) in `valleySample`). */
  private valleyPull(x: number, z: number, h: number) {
    const valley = this.valleyAt(x, z);
    if (valley.weight <= 1e-4) return h;
    return (
      h +
      (valley.floor + 6 * (valley.distance / this.region.valley.width) ** 2 - h) *
        valley.weight *
        0.92
    );
  }
  /** Natural terrain height (m). `minWavelength` drops noise octaves finer
   * than the caller's sample spacing (coarse LODs); physics and the nearest
   * render LOD pass 0. */
  height(x: number, z: number, minWavelength = 0) {
    const plane = this.region.urbanPlane;
    if (plane) return plane.height + x * plane.slopeX + z * plane.slopeZ;
    const region = this.region;
    const d = this.coastDistance(x, z, minWavelength);
    let h = this.valleyPull(x, z, this.unflattened(x, z, minWavelength, d));
    const vDistance = this.valleySample.distance,
      vFloor = this.valleySample.floor;
    // Flats (town, airfield, village) replace the ground with authored planes.
    let townMask = 0;
    const flats = region.flats;
    for (let i = 0; i < flats.length; i++) {
      const f = flats[i],
        m = this.flatMask(f, x, z);
      if (m <= 0) continue;
      const plane = this.flatHeights[i] + f.slopeZ * (z - f.z0);
      h += (plane - h) * m;
      if (f.kind === 'town') townMask = Math.max(townMask, m);
    }
    // River channel (a canal through the town).
    const width = region.valley.channel * (1 - 0.35 * townMask);
    if (vDistance < width * 1.8) {
      const bank = 1 - smoothstep(width * 0.55, width * 1.8, vDistance);
      const bed = vFloor - region.valley.channelDepth;
      h += (Math.min(h, bed) - h) * bank;
    }
    if (minWavelength < 40) h += 0.9 * fbm(x / 34, z / 34, this.seeds.micro, 2) * (1 - townMask);
    // The sea: beaches, a quay along the town waterfront, then the shelf.
    if (d > 520) return h;
    const beach = region.seaLevel + 1.1,
      seabed = Math.max(-38, region.seaLevel - 1.6 + Math.min(0, d) * 0.035);
    // Open shore: a beach at d = 0 rising into the land over ~500 m.
    const base = d >= 0 ? beach : seabed + (beach - seabed) * smoothstep(-60, 0, d);
    const open = base + (h - beach) * smoothstep(-40, 520, d);
    if (townMask <= 0) return open;
    // Town waterfront: a vertical quay into 4 m of water.
    const quay = region.seaLevel - 4 + (h - region.seaLevel + 4) * smoothstep(-5, 3, d);
    return open + (quay - open) * townMask;
  }
  /** Weight 0..1 of the flats of a kind at (x, z). */
  flatWeight(kind: FlatSpec['kind'], x: number, z: number) {
    let w = 0;
    for (const f of this.region.flats) if (f.kind === kind) w = Math.max(w, this.flatMask(f, x, z));
    return w;
  }
  /** Forest density 0..1 (authored woods modulated by noise). */
  forestDensity(x: number, z: number) {
    let d = 0;
    for (const f of this.region.forests) {
      const r = Math.hypot(x - f.x, z - f.z) / f.radius;
      if (r < 1) d = Math.max(d, f.density * smoothstep(1, 0.45, r));
    }
    const n = valueNoise(x / 210, z / 210, this.seeds.forest) * 0.5 + 0.5;
    // Scattered copses and hedgerows outside the authored woods.
    return Math.min(1, Math.max(0, d * (0.55 + 0.6 * n) + Math.max(0, n - 0.78) * 1.6));
  }
  /** Field pattern of the lowland farms 0..1 (crop tone, not a surface). */
  farmPattern(x: number, z: number) {
    return valueNoise(x / 95, z / 140, this.seeds.farm) * 0.5 + 0.5;
  }
  /** Snow line at (x, z) (m). */
  snowLine(x: number, z: number) {
    return 600 + 45 * valueNoise(x / 300, z / 300, this.seeds.detail);
  }
  /** Natural ground class at (x, z) given its height and slope (rise/run). */
  biome(x: number, z: number, height: number, slope: number): Biome {
    const sea = this.region.seaLevel;
    if (this.flatWeight('airfield', x, z) > 0.6) return BIOME.AIRFIELD;
    if (this.flatWeight('town', x, z) > 0.55 && height > sea - 0.5) return BIOME.TOWN;
    const valley = this.valleyAt(x, z);
    if (valley.channel && height < valley.water) return BIOME.RIVER;
    if (height < sea - 0.25) return BIOME.SEA;
    if (height < sea + 3.2 && this.coastDistance(x, z) < 180) return BIOME.BEACH;
    if (height > this.snowLine(x, z)) return BIOME.SNOW;
    if (slope > 0.62) return BIOME.ROCK;
    if (this.forestDensity(x, z) > 0.42 && height < 520) return BIOME.FOREST;
    if (height < 140 && this.farmPattern(x, z) > 0.42) return BIOME.FARMLAND;
    return BIOME.MEADOW;
  }
}
