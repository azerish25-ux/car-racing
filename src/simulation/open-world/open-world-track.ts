import { clamp, Vec3 } from '../../core/math.ts';
import { AUREL, STANDARD_PIT, type CircuitDefinition } from '../circuits.ts';
import type { WeatherPreset } from '../config.ts';
import {
  SURFACE,
  trackPoint,
  type SurfaceSample,
  type Track,
  type TrackPoint,
} from '../track.ts';
import { MATERIAL } from '../surface-material.ts';
import { advanceWater, weatherKeyframes, WeatherTimeline, type WeatherKeyframe } from '../weather.ts';
import { MAX_ROAD_CANDIDATES, ROAD_FLAG, roadCandidates } from './road-network.ts';
import { smoothstep } from './noise.ts';
import { TILE_STEP } from './terrain-tiles.ts';
import { BIOME, type Biome } from './terrain-field.ts';
import type { TerrainTileCache } from './terrain-tiles.ts';
import type { OpenWorld } from './world.ts';

/** Fine-grained ground classes of the festival region. Physics reads them
 * through the shared ground-material ids (surface-material.ts: the circuit
 * codes 0-5 plus dirt, mud, sand and snow) with grip and rolling resistance
 * of their own; the tyre takes stiffness, fall-off and sinkage from the
 * material. */
export const WORLD_SURFACE = Object.freeze({
  ASPHALT: 0,
  MARKING: 1,
  DIRT_ROAD: 2,
  SHOULDER: 3,
  PAVEMENT: 4,
  MEADOW: 5,
  FARMLAND: 6,
  FOREST: 7,
  SAND: 8,
  ROCK: 9,
  SNOW: 10,
  WATER: 11,
  AIRFIELD: 12,
} as const);
export type WorldSurface = (typeof WORLD_SURFACE)[keyof typeof WORLD_SURFACE];
export const WORLD_SURFACE_NAMES: readonly string[] = Object.freeze([
  'asphalt',
  'road marking',
  'dirt road',
  'gravel shoulder',
  'town paving',
  'meadow',
  'farmland',
  'forest floor',
  'sand',
  'rock',
  'snow',
  'water',
  'airfield grass',
]);
/** Physics properties per world surface: material id, grip, rolling
 * resistance and how much standing water it holds relative to a road. A
 * compacted dirt road or shoulder is dirt, not a gravel trap; ploughed and
 * forest ground is dirt; beaches sand; the river and sea bed mud. */
export const SURFACE_PHYSICS: Readonly<
  Record<WorldSurface, { code: number; grip: number; resistance: number; water: number }>
> = Object.freeze({
  [WORLD_SURFACE.ASPHALT]: { code: SURFACE.ASPHALT, grip: 1, resistance: 0.015, water: 1 },
  [WORLD_SURFACE.MARKING]: { code: SURFACE.PAINT, grip: 0.93, resistance: 0.015, water: 1 },
  [WORLD_SURFACE.DIRT_ROAD]: { code: MATERIAL.DIRT, grip: 0.66, resistance: 0.045, water: 1.3 },
  [WORLD_SURFACE.SHOULDER]: { code: MATERIAL.DIRT, grip: 0.62, resistance: 0.06, water: 1.1 },
  [WORLD_SURFACE.PAVEMENT]: { code: SURFACE.ASPHALT, grip: 0.86, resistance: 0.016, water: 0.9 },
  [WORLD_SURFACE.MEADOW]: { code: SURFACE.GRASS, grip: 0.56, resistance: 0.075, water: 0.7 },
  [WORLD_SURFACE.FARMLAND]: { code: MATERIAL.DIRT, grip: 0.52, resistance: 0.11, water: 1.2 },
  [WORLD_SURFACE.FOREST]: { code: MATERIAL.DIRT, grip: 0.54, resistance: 0.085, water: 0.6 },
  [WORLD_SURFACE.SAND]: { code: MATERIAL.SAND, grip: 0.48, resistance: 0.15, water: 0.5 },
  [WORLD_SURFACE.ROCK]: { code: SURFACE.ASPHALT, grip: 0.74, resistance: 0.022, water: 0.6 },
  [WORLD_SURFACE.SNOW]: { code: MATERIAL.SNOW, grip: 0.36, resistance: 0.07, water: 0.4 },
  [WORLD_SURFACE.WATER]: { code: MATERIAL.MUD, grip: 0.3, resistance: 0.4, water: 3 },
  [WORLD_SURFACE.AIRFIELD]: { code: SURFACE.GRASS, grip: 0.58, resistance: 0.07, water: 0.7 },
});
const BIOME_SURFACE: Readonly<Record<Biome, WorldSurface>> = Object.freeze({
  [BIOME.SEA]: WORLD_SURFACE.WATER,
  [BIOME.BEACH]: WORLD_SURFACE.SAND,
  [BIOME.MEADOW]: WORLD_SURFACE.MEADOW,
  [BIOME.FARMLAND]: WORLD_SURFACE.FARMLAND,
  [BIOME.FOREST]: WORLD_SURFACE.FOREST,
  [BIOME.ROCK]: WORLD_SURFACE.ROCK,
  [BIOME.SNOW]: WORLD_SURFACE.SNOW,
  [BIOME.TOWN]: WORLD_SURFACE.PAVEMENT,
  [BIOME.AIRFIELD]: WORLD_SURFACE.AIRFIELD,
  [BIOME.RIVER]: WORLD_SURFACE.WATER,
});

/** Detailed result of a world-surface query (beyond SurfaceSample). */
export interface WorldQuery {
  surface: WorldSurface;
  onRoad: boolean;
  /** Road edge index (nearest road) and whether the road is on the queried layer. */
  edge: number;
  layer: boolean;
  bridge: boolean;
  /** Water surface above the ground at this point (m, 0 when dry land). */
  waterDepth: number;
}

/**
 * Track adapter for the festival region: everything Vehicle, the collision
 * solver and debris read from a Track, answered by the open world.
 *
 *  - `nearest`/`at` work in the road network's global station space, layer
 *    aware (bridges and the viaduct keep the road a car is actually on);
 *  - `sample`/`cast` return the real ground anywhere: the analytic cambered
 *    road surface (asphalt, markings, dirt, shoulders, bridge decks) or the
 *    carved terrain tiles with the biome's grip (grass, farmland, forest,
 *    sand, rock, snow, water);
 *  - boundaries are soft: there are no circuit walls, only guardrails along
 *    the runs the network marks (mountain drops, embankments, bridges), and
 *    only for a car on the road side of them;
 *  - there are no laps, pits or rubber/marble grids (`pitSpeedZone` is never
 *    true, `interact` keeps no state); weather and surface water evolve.
 *
 * It is not a subclass (a Track builds a circuit ribbon, racing line and
 * water grid in its constructor); `asTrack` is the single place it is handed
 * to code typed against Track, and tests assert it answers every public
 * Track member so a new Track method cannot silently go missing here.
 */
export class OpenWorldTrack {
  readonly network;
  readonly field;
  readonly tiles: TerrainTileCache;
  readonly length: number;
  readonly points: TrackPoint[] = [];
  readonly water = new Float32Array(0);
  readonly rubber = new Float32Array(0);
  readonly marbles = new Float32Array(0);
  readonly temperature = new Float32Array(0);
  readonly drainage = new Float32Array(0);
  readonly sheltered = new Uint8Array(0);
  readonly hash = new Map<string, number[]>();
  readonly pit = STANDARD_PIT;
  readonly circuit: CircuitDefinition;
  readonly weather: WeatherTimeline;
  readonly flat = false;
  rain = 0;
  cloud = 0.12;
  ambient = 22;
  windX = 1.5;
  windZ = 0.6;
  surfaceClock = 0;
  /** Standing water on a reference road surface (mm). */
  wetness: number;
  /** Last nearest(): lateral offset and segment, for boundaryAt. */
  private lastLateral = 0;
  private lastSegment = 0;
  private lastLayer = true;
  private readonly point = trackPoint();
  private readonly candidatePoint = trackPoint();
  private readonly candidates = roadCandidates();
  private readonly order = new Int32Array(MAX_ROAD_CANDIDATES);
  private readonly candH = new Float64Array(MAX_ROAD_CANDIDATES);
  private readonly candE = new Float64Array(MAX_ROAD_CANDIDATES);
  private readonly candG = new Float64Array(4 * MAX_ROAD_CANDIDATES);
  private readonly candLateral = new Float64Array(MAX_ROAD_CANDIDATES);
  private readonly candS = new Float64Array(MAX_ROAD_CANDIDATES);
  private roadH = 0;
  private roadGx = 0;
  private roadGz = 0;
  private edgeH = 0;
  private edgeGx = 0;
  private edgeGz = 0;
  private readonly castPoint = new Vec3();
  private readonly normal = { x: 0, y: 1, z: 0 };
  readonly query: WorldQuery = {
    surface: WORLD_SURFACE.ASPHALT,
    onRoad: true,
    edge: 0,
    layer: true,
    bridge: false,
    waterDepth: 0,
  };
  constructor(
    readonly world: OpenWorld,
    readonly preset: WeatherPreset = 'clear',
    keyframes: readonly WeatherKeyframe[] = weatherKeyframes(preset),
    tileBudget = 64,
  ) {
    this.network = world.network;
    this.field = world.field;
    this.tiles = world.tileCache(tileBudget);
    this.length = world.network.totalStation;
    this.weather = new WeatherTimeline(keyframes);
    this.weather.sample(0, this);
    this.wetness = preset === 'rain' ? 0.9 : 0;
    this.circuit = Object.freeze({
      ...AUREL,
      name: world.region.name,
      short: 'FESTIVAL',
      corners: [],
      drsZones: [],
    });
  }
  // --- Track geometry -----------------------------------------------------
  at(s: number, out: TrackPoint): TrackPoint {
    return this.network.at(s, out);
  }
  nearest(x: number, z: number, out: TrackPoint, y?: number): number {
    const lateral = this.network.nearest(x, z, out, y);
    this.lastLateral = lateral;
    this.lastSegment = this.network.lastSegment;
    this.lastLayer = this.network.lastLayerMatch;
    return lateral;
  }
  /** Guardrail face (m from the centreline) on `side` of the road at a
   * resolved point. Only rails the network built exist, and only for a body
   * on the road side of them; elsewhere the "boundary" is unreachable. */
  boundaryAt(_p: TrackPoint, side: number) {
    const net = this.network,
      i = this.lastSegment,
      e = net.edges[net.edgeOf[i]],
      bit = side < 0 ? ROAD_FLAG.BARRIER_LEFT : ROAD_FLAG.BARRIER_RIGHT,
      face = e.spec.halfWidth + e.spec.shoulder + 0.35;
    const railed = (net.flags[i] & bit) !== 0 && (net.flags[i + 1] & bit) !== 0;
    if (!railed || !this.lastLayer || Math.abs(this.lastLateral) > face + 1.6) return 1e6;
    return face;
  }
  boundary(s: number, side: number) {
    const p = this.at(s, trackPoint());
    this.nearest(p.x, p.z, p, p.y);
    return this.boundaryAt(p, side);
  }
  runoffSurface(): number {
    return SURFACE.GRASS;
  }
  pitOffset() {
    return 0;
  }
  pitSideLateral(lateral: number) {
    return lateral;
  }
  isCovered() {
    return false;
  }
  isPitSection() {
    return false;
  }
  pitSpeedZone() {
    return false;
  }
  boxS() {
    return 0;
  }
  boxLateral() {
    return 0;
  }
  pitEntryS() {
    return -1;
  }
  inPitLane() {
    return false;
  }
  // --- Surface ------------------------------------------------------------
  /** Road surface class at a lateral offset (markings, shoulders); a point
   * further than the half-width from the centreline (a shoulder, or the
   * rounded end of a piece at a junction) is shoulder. */
  private roadSurface(edge: number, lateral: number, distance: number): WorldSurface {
    const e = this.network.edges[edge],
      spec = e.spec,
      a = Math.abs(lateral),
      hw = spec.halfWidth;
    if (Math.max(a, distance) > hw)
      return spec.surface === 'dirt' || e.roadClass !== 'highway' ? WORLD_SURFACE.SHOULDER : WORLD_SURFACE.ASPHALT;
    if (spec.surface === 'dirt') return WORLD_SURFACE.DIRT_ROAD;
    if (spec.markings !== 'none') {
      // Edge lines, then the centre line (solid on mountain and town roads,
      // dashed elsewhere; the solid width is the physical paint).
      if (a > hw - 0.38 && a < hw - 0.16) return WORLD_SURFACE.MARKING;
      if (spec.markings !== 'runway' && a < 0.09) return WORLD_SURFACE.MARKING;
    }
    return WORLD_SURFACE.ASPHALT;
  }
  /** Surface height and gradient of candidate `k` at (x, z): the cambered
   * carriageway, then the shoulder falling to the verge edge the renderer
   * draws (asphalt edge -5 mm to the shoulder edge). Fills `roadH`/`roadG*`,
   * the shoulder-edge height `edgeH`/`edgeG*` and returns the lateral. */
  private candidateSurface(k: number, x: number, z: number) {
    const net = this.network,
      c = this.candidates,
      p = net.pointOnSegment(c.segment[k], c.t[k], this.candidatePoint),
      spec = net.edges[net.edgeOf[c.segment[k]]].spec,
      hw = spec.halfWidth,
      shoulder = Math.max(0.05, spec.shoulder),
      lateral = (x - p.x) * p.nx + (z - p.z) * p.nz,
      l = clamp(lateral, -hw, hw),
      crownLeft = Math.max(0, spec.crown - Math.abs(p.bank)),
      base = p.y + p.bank * l - crownLeft * Math.abs(l),
      slope = Math.abs(lateral) <= hw ? p.bank - crownLeft * Math.sign(lateral) : 0,
      bx = p.tx * p.gradient + p.nx * slope,
      bz = p.tz * p.gradient + p.nz * slope,
      fall = 0.055 + 0.03 * spec.shoulder,
      d = c.distance[k];
    this.edgeH = base - 0.005 - fall;
    this.edgeGx = bx;
    this.edgeGz = bz;
    this.roadH = base;
    this.roadGx = bx;
    this.roadGz = bz;
    if (d > hw) {
      const f = Math.min(1, (d - hw) / shoulder);
      this.roadH -= 0.005 + fall * f;
      if (f < 1) {
        this.roadGx -= (fall / shoulder) * c.rx[k];
        this.roadGz -= (fall / shoulder) * c.rz[k];
      }
    }
    return lateral;
  }
  /** Candidate k's surface, shoulder edge and gradients into the arrays. */
  private evaluate(k: number, x: number, z: number) {
    this.candLateral[k] = this.candidateSurface(k, x, z);
    this.candS[k] = this.candidatePoint.s;
    this.candH[k] = this.roadH;
    this.candE[k] = this.edgeH;
    this.candG[4 * k] = this.roadGx;
    this.candG[4 * k + 1] = this.roadGz;
    this.candG[4 * k + 2] = this.edgeGx;
    this.candG[4 * k + 3] = this.edgeGz;
  }
  /** How far a covered candidate has faded in across its shoulder (0 at its
   * footprint edge, 1 on its carriageway; a bridge deck is all or nothing). */
  private fade(k: number) {
    const c = this.candidates,
      spec = this.network.edges[this.network.edgeOf[c.segment[k]]].spec,
      margin = spec.halfWidth + spec.shoulder - c.distance[k];
    return c.bridge[k] ? 1 : smoothstep(0, Math.max(0.05, spec.shoulder), margin);
  }
  /**
   * World ground under (x, z): fills a SurfaceSample (Track contract) and
   * `query` (detailed class). `y` selects the road layer (bridges).
   *
   * The ground is one continuous surface:
   *  - beside the roads, the carved terrain tile, pulled up or down to each
   *    road's shoulder edge over a run-out of one tile step (the 4 m tile
   *    cannot follow the shoulder exactly, so without it the ground would
   *    step like a kerb where the shoulder ends);
   *  - on the roads, every road whose footprint covers the point (by true
   *    distance, so a dead end ends at its end line and the far side of a
   *    junction mouth is the crossing road, not grass), lowest first, each
   *    fading in across its shoulder: inside a carriageway the highest road
   *    is the surface, which is also the ribbon the renderer shows on top
   *    where two roads overlap. Bridge decks have no run-out or fade (a
   *    parapet, then the drop).
   * The class, grip and markings come from the road the point is on.
   */
  sample(x: number, z: number, out: SurfaceSample, y?: number): SurfaceSample {
    const net = this.network,
      p = this.point,
      c = this.candidates,
      layered = y !== undefined && Number.isFinite(y);
    // The nearest centreline (s, lateral, layer) is needed off the roads and
    // as the layer reference of a query without a height; on a road the
    // road the point is on answers it.
    let lateral = 0,
      resolved = false;
    if (!layered) {
      lateral = this.nearest(x, z, p);
      resolved = true;
    }
    const count = net.covering(x, z, layered ? (y as number) : p.y, RUN_OUT, c);
    const q = this.query;
    q.waterDepth = 0;
    out.pit = false;
    out.cell = 0;
    // Candidate heights: road surface (covered pieces) and shoulder edge.
    const order = this.order,
      roadH = this.candH,
      edgeH = this.candE;
    let covered = 0,
      top = -1;
    // Covered pieces first: inside the top road's carriageway nothing else
    // is needed (the common case for a car on a road).
    for (let k = 0; k < count; k++)
      if (c.outside[k] === 0) {
        this.evaluate(k, x, z);
        covered++;
        if (top < 0 || roadH[k] > roadH[top]) top = k;
      }
    let height: number, gx: number, gz: number;
    if (top >= 0 && this.fade(top) >= 1) {
      // Inside the highest road's carriageway: that road, exactly.
      height = roadH[top];
      gx = this.candG[4 * top];
      gz = this.candG[4 * top + 1];
    } else {
      for (let k = 0; k < count; k++) if (c.outside[k] !== 0) this.evaluate(k, x, z);
      // Ground: the tile, pulled to the shoulder edges within the run-out,
      // lowest edge first (order-independent where edges are level).
      let n = 0;
      for (let k = 0; k < count; k++) if (!c.bridge[k]) order[n++] = k;
      sortBy(order, n, edgeH);
      let first = 0;
      for (let m = 0; m < n; m++) if (c.outside[order[m]] === 0) first = m + 1;
      if (first > 0) {
        const k = order[first - 1];
        height = edgeH[k];
        gx = this.candG[4 * k + 2];
        gz = this.candG[4 * k + 3];
      } else {
        const normal = this.normal;
        height = this.tiles.height(x, z, normal);
        const ny = Math.max(0.05, normal.y);
        gx = -normal.x / ny;
        gz = -normal.z / ny;
      }
      for (let m = Math.max(0, first); m < n; m++) {
        const k = order[m],
          r = c.outside[k];
        // The run-out ends where the next road's footprint begins (two
        // roads side by side meet on the ground between them; inside a
        // footprint only that road's own edge counts).
        let gap = Infinity,
          gapX = 0,
          gapZ = 0;
        for (let o = 0; o < n; o++) {
          const other = order[o];
          if (other !== k && c.outside[other] < gap) {
            gap = c.outside[other];
            gapX = c.ox[other];
            gapZ = c.oz[other];
          }
        }
        let u: number, ux: number, uz: number;
        if (r + gap >= RUN_OUT) {
          const du = -smoothstepSlope(0, RUN_OUT, r);
          u = 1 - smoothstep(0, RUN_OUT, r);
          ux = du * c.ox[k];
          uz = du * c.oz[k];
        } else {
          const span = r + gap,
            f = r / span,
            du = -6 * f * (1 - f);
          u = 1 - f * f * (3 - 2 * f);
          // d(r / (r + gap)) = (gap dr - r dgap) / (r + gap)²
          ux = (du * (gap * c.ox[k] - r * gapX)) / (span * span);
          uz = (du * (gap * c.oz[k] - r * gapZ)) / (span * span);
        }
        const dh = edgeH[k] - height;
        gx += (this.candG[4 * k + 2] - gx) * u + dh * ux;
        gz += (this.candG[4 * k + 3] - gz) * u + dh * uz;
        height += dh * u;
      }
      // Roads on top, lowest first, each fading in across its shoulder.
      n = 0;
      for (let k = 0; k < count; k++) if (c.outside[k] === 0) order[n++] = k;
      sortBy(order, n, roadH);
      for (let m = 0; m < n; m++) {
        const k = order[m],
          spec = net.edges[net.edgeOf[c.segment[k]]].spec,
          ramp = Math.max(0.05, spec.shoulder),
          margin = spec.halfWidth + spec.shoulder - c.distance[k],
          w = this.fade(k),
          // d(w)/d(margin) and margin falls along the radial direction.
          dw = c.bridge[k] ? 0 : smoothstepSlope(0, ramp, margin),
          dh = roadH[k] - height;
        gx += (this.candG[4 * k] - gx) * w - dh * dw * c.rx[k];
        gz += (this.candG[4 * k + 1] - gz) * w - dh * dw * c.rz[k];
        height += dh * w;
      }
    }
    // The road the point is on: of the roads at about the surface height
    // (junction pads hold them within a crown of each other), one whose
    // carriageway holds the point, paved before loose, then the one it lies
    // furthest inside. A junction mouth is the through road's asphalt, not
    // the side road's shoulder, and a side road's asphalt where it crosses
    // the through road's shoulder; the renderer gives paved ribbons the
    // same priority where they meet level.
    let owner = -1,
      rank = -Infinity;
    for (let k = 0; k < count; k++) {
      if (c.outside[k] !== 0 || Math.abs(roadH[k] - height) > OWNER_TOLERANCE) continue;
      const spec = net.edges[net.edgeOf[c.segment[k]]].spec,
        margin = spec.halfWidth + spec.shoulder - c.distance[k],
        score = (c.distance[k] <= spec.halfWidth ? 2 : 0) + (spec.surface === 'dirt' ? 0 : 1) + margin / 100;
      if (score > rank) {
        rank = score;
        owner = k;
      }
    }
    if (owner < 0) owner = top;
    const onRoad = covered > 0;
    if (!onRoad && !resolved) lateral = this.nearest(x, z, p, y);
    out.height = height;
    out.normal.set(-gx, 1, -gz).normalize();
    let surface: WorldSurface, edge: number;
    if (onRoad && owner >= 0) {
      const i = c.segment[owner],
        roadLateral = this.candLateral[owner];
      edge = net.edgeOf[i];
      surface = this.roadSurface(edge, roadLateral, c.distance[owner]);
      q.bridge = c.bridge[owner] === 1;
      q.layer = true;
      // Station and lateral on the road the point is on.
      out.s = this.candS[owner];
      out.lateral = roadLateral;
      this.lastSegment = i;
      this.lastLateral = roadLateral;
      this.lastLayer = true;
    } else {
      out.s = p.s;
      out.lateral = lateral;
      edge = net.edgeOf[this.lastSegment];
      q.bridge = false;
      q.layer = this.lastLayer;
      const n = this.normal;
      n.x = out.normal.x;
      n.y = out.normal.y;
      n.z = out.normal.z;
      const slope = Math.sqrt(Math.max(0, 1 - n.y * n.y)) / Math.max(0.05, n.y);
      surface = BIOME_SURFACE[this.field.biome(x, z, height, slope)];
      // Water stands above sea level and in the river channel.
      const valley = this.field.valleyAt(x, z);
      const level = valley.channel ? Math.max(valley.water, this.field.region.seaLevel) : this.field.region.seaLevel;
      if (height < level - 0.05) {
        q.waterDepth = level - height;
        surface = WORLD_SURFACE.WATER;
      }
    }
    const spec = net.edges[edge].spec;
    out.width = spec.halfWidth;
    q.edge = edge;
    q.onRoad = onRoad;
    q.surface = surface;
    const physics = SURFACE_PHYSICS[surface];
    out.surface = physics.code;
    // The class grip (public asphalt by age and use) scales paved surfaces;
    // loose surfaces carry their own absolute grip.
    const paved = surface === WORLD_SURFACE.ASPHALT || surface === WORLD_SURFACE.MARKING;
    out.grip = physics.grip * (onRoad && paved ? spec.grip : 1);
    out.resistance = physics.resistance;
    out.water = Math.min(3, this.wetness * physics.water);
    // A light general rubber coat on public asphalt; no racing line.
    out.rubber = physics.code === SURFACE.ASPHALT || physics.code === SURFACE.PAINT ? 0.08 : 0;
    out.marbles = 0;
    out.temp = this.ambient + 12 * (1 - this.cloud);
    return out;
  }
  /** Ray along `down` from `origin` to the ground (Track.cast contract):
   * distance, or Infinity when the ground is beyond `maximum`. An origin
   * already below the ground returns a small negative distance so the
   * suspension pushes the body back out. */
  cast(origin: Vec3, down: Vec3, maximum: number, out: SurfaceSample) {
    let x = origin.x,
      z = origin.z,
      t = 0;
    for (let iteration = 0; iteration < 2; iteration++) {
      this.sample(x, z, out, origin.y);
      const n = out.normal,
        denominator = down.x * n.x + down.y * n.y + down.z * n.z;
      if (denominator > -0.05) return Infinity;
      // Plane through (x, height, z) with normal n.
      t = ((x - origin.x) * n.x + (out.height - origin.y) * n.y + (z - origin.z) * n.z) / denominator;
      if (t > maximum + 0.5) return Infinity;
      x = origin.x + down.x * t;
      z = origin.z + down.z * t;
    }
    // Like Track's mesh ray cast, a ray never reports a hit behind its
    // origin (callers treat distances as non-negative); an origin just
    // below the ground reads as touching it, one far below misses.
    if (t > maximum || t < -0.4) return Infinity;
    const hit = this.castPoint.copy(origin).addScaled(down, t);
    out.height = hit.y;
    return Math.max(0, t);
  }
  /** Ground height only (spawning, recovery, scripts). */
  groundHeight(x: number, z: number, y?: number) {
    return this.sample(x, z, SCRATCH, y).height;
  }
  // --- Time ---------------------------------------------------------------
  evolve(dt: number, time: number) {
    if (!Number.isFinite(dt) || dt <= 0) throw new Error('Invalid weather timestep');
    this.weather.sample(time, this);
    this.surfaceClock += dt;
    if (this.surfaceClock < 0.5) return;
    const step = this.surfaceClock;
    this.surfaceClock = 0;
    // A drained road: rain fills it, run-off and evaporation empty it.
    const evaporation = (1 - this.cloud) * 0.0006;
    this.wetness = advanceWater(this.wetness, Math.max(0, this.rain / 3600 - evaporation), 0.004, step);
  }
  interact() {}
  meanWater() {
    return this.wetness;
  }
}
const SCRATCH: SurfaceSample = {
  s: 0,
  width: 0,
  lateral: 0,
  height: 0,
  normal: new Vec3(0, 1, 0),
  surface: 0,
  water: 0,
  rubber: 0,
  marbles: 0,
  temp: 0,
  grip: 1,
  resistance: 0,
  cell: 0,
  pit: false,
};
/** Run-out beyond a road's shoulder edge (m) over which the ground meets
 * the carved terrain tile: one tile step. */
export const RUN_OUT = TILE_STEP;
/** Height window (m) within which overlapping roads at a point compete
 * for the surface class (a crown's worth). */
const OWNER_TOLERANCE = 0.15;
/** d/dx of smoothstep(a, b, x). */
function smoothstepSlope(a: number, b: number, x: number) {
  const t = (x - a) / (b - a);
  return t <= 0 || t >= 1 ? 0 : (6 * t * (1 - t)) / (b - a);
}
/** Insertion sort of the first n indices by key (tiny arrays, no allocation). */
function sortBy(order: Int32Array, n: number, key: Float64Array) {
  for (let i = 1; i < n; i++) {
    const v = order[i];
    let j = i - 1;
    while (j >= 0 && key[order[j]] > key[v]) {
      order[j + 1] = order[j];
      j--;
    }
    order[j + 1] = v;
  }
}
/** The festival world handed to code typed against a circuit Track
 * (Vehicle, CollisionSolver, debris). See OpenWorldTrack. */
export function asTrack(world: OpenWorldTrack): Track {
  return world as unknown as Track;
}
