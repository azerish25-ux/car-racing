import { fbm, hash01, ridged, smoothstep, subSeed } from '../../simulation/open-world/noise.ts';

/**
 * Relief beyond the streamed festival terrain (render only, no colliders):
 * a landmark stratovolcano and the ranges that close the horizon around the
 * region. Dimensions follow the reference photographs (FH6 refs 006-098) and
 * the real volcano they show: a 3.7 km cone with a ~0.5 km summit crater,
 * slopes of 25-28 degrees near the top easing to 19-21 degrees mid-flank and a
 * 5-10 degree apron, about 35 km across at the foot; radial erosion gullies
 * (about 40 around the cone) that hold the snow lower than the ridges between
 * them; forested ranges 0.5-1.6 km high in layered crests parallel to the
 * region edge, higher (snow-capped in winter and spring) far inland.
 *
 * Every value is a pure function of position and the region seed (lattice
 * noise of the simulation), so it is deterministic and testable.
 */
export const DISTANT_RELIEF = Object.freeze({
  /** Half extent of the streamed terrain square (m): the relief starts there. */
  inner: 8192,
  /** Outer radius of the ranges around the region centre (m). */
  outer: 42000,
  /** At the terrain's edge the relief sits this far below it (m) and reaches
   * its own shape over `seamBlend` metres outward, so the seam never shows. */
  seamDrop: 25,
  seamBlend: 2200,
  /** Edge samples (m): the vertex spacing of the coarsest terrain tile. */
  edgeStep: 512,
  /** The edge heights use the coarsest tile's noise filter (terrain-tiles). */
  edgeWavelength: 768,
  /** Sea floor of the open water beyond the coast (m). */
  seaFloor: -60,
  volcano: Object.freeze({
    /** East of Port Ilse, across the bay: the spawn street (Harbour Front,
     * heading east; +z is on the right) frames it at its end, 26 km away and
     * half a degree left of the street axis (the event beacon stands 1.5
     * degrees right of it); the Varda pass road and the airfield runway look
     * at it from 24-30 km. */
    x: 26550,
    z: -2830,
    /** Radius (m) to height (m) above the sea: crater floor, rim, then the
     * concave flank (slopes in the comment of DISTANT_RELIEF). */
    profile: Object.freeze([
      [0, 3550],
      [170, 3590],
      [300, 3720],
      [480, 3690],
      [1200, 3330],
      [2200, 2880],
      [3500, 2360],
      [5000, 1850],
      [7000, 1300],
      [9500, 820],
      [13000, 400],
      [17500, 120],
      [22000, 0],
    ] as const),
    /** Radius (m) of the cone's own mesh; its apron continues in the ranges. */
    radius: 11000,
    /** Radial erosion gullies around the cone and their deepest cut (m). */
    gullies: 44,
    gullyDepth: 78,
    /** A parasitic shoulder on the south-west flank (bearing, radius, height). */
    shoulder: Object.freeze({ bearing: -2.36, radius: 3300, height: 240 }),
    /** One deep ravine down the west face (bearing, depth m). */
    ravine: Object.freeze({ bearing: -1.62, depth: 110 }),
  }),
});

/**
 * Snow line (m) of the cone and of the ranges per season (spring, summer,
 * autumn, winter). Spring keeps the deep cap of refs 021/031/094 (snow over
 * the top ~45 % of the visible cone, tongues down the gullies), summer only
 * gully streaks near the crater (006/079), autumn a first cap (016/017/036),
 * winter the whole cone and the forests dusted (035/064).
 */
export const DISTANT_SNOW = Object.freeze({
  cone: [2250, 3300, 2750, 900] as const,
  ranges: [1350, 2600, 1750, 380] as const,
});

/** Polynomial smooth maximum (k: blend width, m). */
export function smoothMax(a: number, b: number, k: number) {
  const h = Math.min(1, Math.max(0, 0.5 + (0.5 * (a - b)) / k));
  return b + (a - b) * h + k * h * (1 - h);
}

const TAU = Math.PI * 2;
function wrapAngle(a: number) {
  return a - TAU * Math.round(a / TAU);
}

/** Monotone (Fritsch-Carlson) cubic through the profile: no overshoot. */
function monotoneProfile(points: readonly (readonly [number, number])[]) {
  const n = points.length,
    x = points.map((p) => p[0]),
    y = points.map((p) => p[1]),
    d: number[] = [],
    m: number[] = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((y[i + 1] - y[i]) / (x[i + 1] - x[i]));
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i],
      b = m[i + 1] / d[i],
      s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return (r: number) => {
    if (r <= x[0]) return y[0];
    if (r >= x[n - 1]) return y[n - 1];
    let i = 0;
    while (r > x[i + 1]) i++;
    const h = x[i + 1] - x[i],
      t = (r - x[i]) / h,
      t2 = t * t,
      t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * y[i] +
      (t3 - 2 * t2 + t) * h * m[i] +
      (-2 * t3 + 3 * t2) * y[i + 1] +
      (t3 - t2) * h * m[i + 1]
    );
  };
}

/** One relief sample (a reused object: copy what you keep). */
export interface ReliefSample {
  height: number;
  /** 0..1: inside a radial gully of the volcano (snow tongues). */
  gully: number;
  /** 0..1: below the local crests of the ranges (valley mist). */
  valley: number;
  /** 0..1: the volcano's share of the surface. */
  volcano: number;
}

/**
 * Height model of the distant landscape. `edge(x, z)` is the natural terrain
 * height of the region (TerrainField.height), sampled once along the edge of
 * the terrain square so the relief continues the streamed ground seamlessly.
 */
export class DistantRelief {
  private readonly edge: Float64Array;
  private readonly profile: (r: number) => number;
  private readonly seeds: Record<
    'warp' | 'crest' | 'peaks' | 'alpine' | 'coast' | 'meander' | 'gully',
    number
  >;
  private readonly out: ReliefSample = { height: 0, gully: 0, valley: 0, volcano: 0 };
  constructor(edge: (x: number, z: number, minWavelength: number) => number, seed: number) {
    const R = DISTANT_RELIEF,
      S = R.inner,
      count = Math.round((8 * S) / R.edgeStep);
    this.edge = new Float64Array(count);
    for (let k = 0; k < count; k++) {
      const [x, z] = DistantRelief.perimeterPoint(k * R.edgeStep);
      this.edge[k] = edge(x, z, R.edgeWavelength);
    }
    this.profile = monotoneProfile(R.volcano.profile);
    this.seeds = {
      warp: subSeed(seed, 41),
      crest: subSeed(seed, 42),
      peaks: subSeed(seed, 43),
      alpine: subSeed(seed, 44),
      coast: subSeed(seed, 45),
      meander: subSeed(seed, 46),
      gully: subSeed(seed, 47),
    };
  }
  /** Point of the terrain square's perimeter at arc length s (m), anticlockwise
   * from the south-west corner: south, east, north, west edges. */
  static perimeterPoint(s: number): [number, number] {
    const S = DISTANT_RELIEF.inner,
      side = 2 * S,
      t = ((s % (4 * side)) + 4 * side) % (4 * side);
    if (t < side) return [-S + t, -S];
    if (t < 2 * side) return [S, -S + (t - side)];
    if (t < 3 * side) return [S - (t - 2 * side), S];
    return [-S, S - (t - 3 * side)];
  }
  /** Arc length (m) of a point on the perimeter (inverse of perimeterPoint). */
  static perimeterArc(x: number, z: number) {
    const S = DISTANT_RELIEF.inner,
      side = 2 * S;
    const d = [z + S, S - x, S - z, x + S];
    let edge = 0;
    for (let k = 1; k < 4; k++) if (d[k] < d[edge]) edge = k;
    if (edge === 0) return x + S;
    if (edge === 1) return side + (z + S);
    if (edge === 2) return 2 * side + (S - x);
    return 3 * side + (S - z);
  }
  /** Terrain height at the nearest point of the square's edge (m), linear
   * between the coarse tile's vertices like the terrain mesh itself. */
  edgeHeight(x: number, z: number) {
    const S = DISTANT_RELIEF.inner,
      bx = Math.min(S, Math.max(-S, x)),
      bz = Math.min(S, Math.max(-S, z)),
      f = DistantRelief.perimeterArc(bx, bz) / DISTANT_RELIEF.edgeStep,
      n = this.edge.length,
      i = Math.floor(f),
      t = f - i;
    return this.edge[((i % n) + n) % n] * (1 - t) + this.edge[(((i + 1) % n) + n) % n] * t;
  }
  /** Horizontal distance outside the terrain square (m, 0 inside). */
  static outside(x: number, z: number) {
    const S = DISTANT_RELIEF.inner;
    return Math.hypot(Math.max(Math.abs(x) - S, 0), Math.max(Math.abs(z) - S, 0));
  }
  private coneGully = 0;
  /** The cone alone: height (m) at (x, z); its gully weight is left in
   * `gully` (no allocation in the hot path). */
  volcano(x: number, z: number) {
    const V = DISTANT_RELIEF.volcano,
      dx = x - V.x,
      dz = z - V.z,
      r = Math.hypot(dx, dz),
      phi = Math.atan2(dx, dz);
    // A slightly oval cone (no real volcano is a lathe solid).
    const re = r / (1 + 0.05 * Math.sin(phi + 1.1) + 0.025 * Math.sin(2 * phi + 0.4));
    let h = this.profile(re);
    this.coneGully = 0;
    if (re > 9500) return h;
    const shoulder = V.shoulder,
      ds = wrapAngle(phi - shoulder.bearing);
    h +=
      shoulder.height *
      Math.exp(-((ds / 0.32) ** 2)) *
      Math.exp(-(((re - shoulder.radius) / 1000) ** 2));
    // Radial gullies: V-shaped, meandering a little, of varying strength.
    const n = V.gullies,
      a = (phi / TAU + 0.5) * n + 0.45 * fbm(re / 2600, phi * 2, this.seeds.meander, 2),
      i = Math.floor(a),
      f = a - i,
      k = ((i % n) + n) % n,
      strength = 0.45 + 0.75 * hash01(k, 3, this.seeds.gully),
      width = 0.55 + 0.35 * hash01(k, 5, this.seeds.gully),
      v = Math.min(1, Math.max(0, 1 - (Math.abs(f - 0.5) * 2) / width)),
      shape = v * v * (3 - 2 * v),
      depth =
        V.gullyDepth *
        smoothstep(320, 1500, re) *
        (1 - smoothstep(4200, 9000, re)) *
        (0.6 + 0.4 * smoothstep(1500, 3000, re));
    h -= depth * strength * shape;
    const dr = wrapAngle(phi - V.ravine.bearing),
      ravine =
        Math.exp(-((dr / 0.035) ** 2)) *
        smoothstep(500, 1500, re) *
        (1 - smoothstep(3500, 6500, re));
    h -= V.ravine.depth * ravine;
    this.coneGully = Math.min(1, Math.max(shape * strength, ravine));
    return h;
  }
  /** Gully weight (0..1) of the last `volcano` call. */
  get gully() {
    return this.coneGully;
  }
  /** Relief at (x, z) outside the terrain square (a reused object). */
  sample(x: number, z: number): ReliefSample {
    const R = DISTANT_RELIEF,
      V = R.volcano,
      s = this.seeds,
      e = DistantRelief.outside(x, z),
      out = this.out;
    // The coast continues the region's own (z about -2350, coves and capes).
    const coastZ = -2350 + 700 * fbm(x / 6500, 3.3, s.coast, 3),
      land = smoothstep(-200, 2400, z - coastZ);
    const rv = Math.hypot(x - V.x, z - V.z),
      // The cone stands free: the ranges fall away to a foothill plain round it.
      free = smoothstep(7500, 19000, rv);
    let ranges: number = R.seaFloor,
      valley = 0;
    if (land > 0) {
      // Crests run along the region's edge (layered silhouettes from inside),
      // broken by isotropic peaks and a slow domain warp; higher far inland,
      // highest (alpine) in some sectors.
      const theta = Math.atan2(x, z),
        warp = fbm(x / 9000, z / 9000, s.warp, 2) * 2200,
        crest = ridged((theta * 14000 + warp) / 3800, (e + warp * 0.6) / 1500, s.crest, 4),
        peaks = ridged(x / 3300 + 11.3, z / 3300 - 4.1, s.peaks, 4),
        relief = 0.62 * crest + 0.38 * peaks,
        alpine = 0.4 + 0.6 * smoothstep(-0.15, 0.45, fbm(theta * 1.6, 2.7, s.alpine, 2)),
        // Relief grows to ~1.4 km 9 km out, so each layer stands above the
        // region's own 0.6-0.8 km edge hills seen from the Varda pass.
        amp =
          (500 + 900 * smoothstep(0, 9000, e) + 1200 * smoothstep(9000, 28000, e) * alpine) *
          (0.2 + 0.8 * free),
        // The outermost band rises as a wall of ranges, so even from the
        // highest roads the skyline is mountains, never the mesh's rim.
        base = 150 + 100 * smoothstep(0, 9000, e) + 650 * smoothstep(22000, 33000, e);
      ranges = base + amp * smoothstep(0.25, 0.85, relief);
      ranges = R.seaFloor + (ranges - R.seaFloor) * land;
      valley = Math.min(1, Math.max(0, (0.5 - relief) / 0.25)) * land;
    }
    let height = ranges,
      share = 0;
    out.gully = 0;
    if (rv < 23000) {
      const cone = this.volcano(x, z);
      height = smoothMax(cone, ranges, 160);
      share = smoothstep(-60, 60, cone - ranges);
      out.gully = this.coneGully * share;
    }
    out.volcano = share;
    out.valley = valley * (1 - share);
    if (e < R.seamBlend) {
      const edge = this.edgeHeight(x, z) - R.seamDrop;
      height = edge + (height - edge) * smoothstep(0, R.seamBlend, e);
    }
    out.height = height;
    return out;
  }
  /** Height (m) at (x, z). */
  height(x: number, z: number) {
    return this.sample(x, z).height;
  }
}
